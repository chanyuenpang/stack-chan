[CmdletBinding()]
param(
    [ValidateSet('Offline', 'Execute')]
    [string]$Stage = 'Offline',

    [Parameter(Mandatory = $true)]
    [string]$CandidatePath,

    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[0-9A-Fa-f]{64}$')]
    [string]$ExpectedSha256,

    [Parameter(Mandatory = $true)]
    [long]$ExpectedLength,

    [Parameter(Mandatory = $true)]
    [string]$EvidenceDirectory,

    [ValidatePattern('^COM\d+$')]
    [string]$Port = 'COM7',

    [ValidatePattern('^(?:[0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$')]
    [string]$ExpectedMac = '44:1b:f6:e2:78:a8',

    [switch]$ConfirmSerialDeviceDisruption,
    [switch]$ConfirmedOta0IsIntendedTarget,
    [switch]$FinalHardReset
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$pythonPath = 'C:\Espressif\python_env\idf5.5_py3.14_env\Scripts\python.exe'
$partitionTool = 'C:\Espressif\frameworks\esp-idf-v5.5.5\components\partition_table\gen_esp32part.py'
$appOffset = [long]0x20000
$appPartitionSize = [long]0x4f0000
$chunkSize = [long]0x100000
$baud = '115200'
$expectedHash = $ExpectedSha256.ToUpperInvariant()

function Get-ChunkPlan([long]$Length) {
    if ($Length -le 0 -or $Length -ge $appPartitionSize) {
        throw 'Candidate length must be positive and fit strictly inside ota_0.'
    }
    $plan = [Collections.Generic.List[object]]::new()
    for ($index = 0; ; $index++) {
        $relative = [long]$index * $chunkSize
        if ($relative -ge $Length) { break }
        $chunkLength = [Math]::Min($chunkSize, $Length - $relative)
        $plan.Add([pscustomobject]@{
            index = $index
            address = $appOffset + $relative
            length = $chunkLength
        })
    }
    if (($plan | Measure-Object -Property length -Sum).Sum -ne $Length) {
        throw 'Chunk plan does not exactly cover the candidate.'
    }
    return $plan
}

function Get-CombinedSha256([Collections.Generic.List[object]]$Plan, [string]$Directory) {
    $hasher = [Security.Cryptography.IncrementalHash]::CreateHash([Security.Cryptography.HashAlgorithmName]::SHA256)
    try {
        foreach ($chunk in $Plan) {
            $path = Join-Path $Directory ('readback-chunk-{0:D2}.bin' -f $chunk.index)
            $stream = [IO.File]::OpenRead($path)
            try {
                [byte[]]$buffer = [byte[]]::new(1MB)
                while (($count = $stream.Read($buffer, 0, $buffer.Length)) -gt 0) {
                    $hasher.AppendData($buffer, 0, $count)
                }
            } finally {
                $stream.Dispose()
            }
        }
        return [Convert]::ToHexString($hasher.GetHashAndReset())
    } finally {
        $hasher.Dispose()
    }
}

function Write-AtomicJson([string]$Path, [object]$Value) {
    $temporary = "$Path.new"
    $Value | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $temporary -Encoding utf8
    Move-Item -LiteralPath $temporary -Destination $Path -Force
}

$candidateResolved = [IO.Path]::GetFullPath($CandidatePath)
$evidenceResolved = [IO.Path]::GetFullPath($EvidenceDirectory)
if (-not (Test-Path -LiteralPath $candidateResolved -PathType Leaf)) {
    throw "Candidate is missing: $candidateResolved"
}
$candidate = Get-Item -LiteralPath $candidateResolved
$candidateHash = (Get-FileHash -LiteralPath $candidateResolved -Algorithm SHA256).Hash
if ($candidate.Length -ne $ExpectedLength -or $candidateHash -ne $expectedHash) {
    throw "Candidate identity mismatch: $($candidate.Length)/$candidateHash"
}
$stream = [IO.File]::OpenRead($candidateResolved)
try {
    [byte[]]$header = [byte[]]::new(24)
    if ($stream.Read($header, 0, $header.Length) -ne $header.Length) {
        throw 'Candidate ESP image header is short.'
    }
} finally {
    $stream.Dispose()
}
if ($header[0] -ne 0xE9 -or [BitConverter]::ToUInt16($header, 12) -ne 9) {
    throw 'Candidate is not an ESP32-S3 application image.'
}
$plan = Get-ChunkPlan -Length $ExpectedLength
$offlinePlan = [ordered]@{
    stage = 'Offline'
    candidate_sha256 = $candidateHash
    candidate_length = $candidate.Length
    offset = '0x20000'
    partition_size = $appPartitionSize
    chunk_size = $chunkSize
    chunks = $plan.Count
    covered_length = ($plan | Measure-Object -Property length -Sum).Sum
    serial_access = $false
    writes = 0
}

if ($Stage -eq 'Offline') {
    Write-Host 'OFFLINE PREFLIGHT PASSED. No serial device or evidence directory was accessed.'
    $offlinePlan | ConvertTo-Json -Compress
    return
}

if (-not $ConfirmSerialDeviceDisruption -or -not $ConfirmedOta0IsIntendedTarget) {
    throw 'Execute requires explicit serial-disruption and fixed ota_0 intent confirmations.'
}
foreach ($required in @($pythonPath, $partitionTool)) {
    if (-not (Test-Path -LiteralPath $required -PathType Leaf)) {
        throw "Required tool is missing: $required"
    }
}
$com = Get-CimInstance Win32_SerialPort | Where-Object DeviceID -eq $Port
if (-not $com -or $com.PNPDeviceID -notmatch '^USB\\VID_303A&PID_1001&MI_00\\') {
    throw 'The selected port is not the expected ESP32-S3 USB Serial/JTAG interface.'
}
$conflicts = @(Get-CimInstance Win32_Process | Where-Object {
    $_.ProcessId -ne $PID -and
    ($_.Name -match '^(openocd|esptool|idf_monitor)' -or $_.CommandLine -match '(?i)(openocd|esptool|idf_monitor)')
})
if ($conflicts.Count -ne 0) {
    throw 'Another debugger, flash tool, or serial monitor is active.'
}

if (-not (Test-Path -LiteralPath $evidenceResolved)) {
    New-Item -ItemType Directory -Path $evidenceResolved | Out-Null
} elseif (-not (Test-Path -LiteralPath $evidenceResolved -PathType Container)) {
    throw 'Evidence path is not a directory.'
}
$manifestPath = Join-Path $evidenceResolved 'readback-manifest.json'
$resultPath = Join-Path $evidenceResolved 'result.json'
if (Test-Path -LiteralPath $resultPath) {
    throw 'This evidence directory already contains a completed result.'
}
$existingFiles = @(Get-ChildItem -LiteralPath $evidenceResolved -Force)
if ($existingFiles.Count -gt 0 -and -not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
    throw 'Non-empty evidence directory has no resumable manifest.'
}

$manifest = if (Test-Path -LiteralPath $manifestPath) {
    Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
} else {
    [pscustomobject]@{
        schema = 1
        candidate_sha256 = $candidateHash
        candidate_length = $candidate.Length
        offset = '0x20000'
        partition_size = $appPartitionSize
        chunk_size = $chunkSize
        completed_chunks = [Collections.Generic.List[object]]::new()
        phase = 'planned'
    }
}
if ($manifest.schema -ne 1 -or $manifest.candidate_sha256 -ne $candidateHash -or
    $manifest.candidate_length -ne $candidate.Length -or $manifest.offset -ne '0x20000' -or
    $manifest.partition_size -ne $appPartitionSize -or $manifest.chunk_size -ne $chunkSize) {
    throw 'Existing readback manifest does not match this candidate transaction.'
}
$completed = [Collections.Generic.List[object]]::new()
foreach ($entry in @($manifest.completed_chunks)) { $completed.Add($entry) }

foreach ($chunk in $plan) {
    $finalPath = Join-Path $evidenceResolved ('readback-chunk-{0:D2}.bin' -f $chunk.index)
    $record = @($completed | Where-Object index -eq $chunk.index)
    if ((Test-Path -LiteralPath $finalPath) -or $record.Count -ne 0) {
        if (-not (Test-Path -LiteralPath $finalPath -PathType Leaf) -or $record.Count -ne 1 -or
            $record[0].address -ne ('0x{0:x}' -f $chunk.address) -or
            $record[0].length -ne $chunk.length -or
            (Get-Item -LiteralPath $finalPath).Length -ne $chunk.length -or
            (Get-FileHash -LiteralPath $finalPath -Algorithm SHA256).Hash -ne $record[0].sha256) {
            throw 'Existing completed chunk evidence is inconsistent; nothing was overwritten.'
        }
    }
}
$manifest.completed_chunks = $completed
Write-AtomicJson -Path $manifestPath -Value $manifest

$attemptNumber = @(Get-ChildItem -LiteralPath $evidenceResolved -Directory -Filter 'attempt-*').Count + 1
$attemptDirectory = Join-Path $evidenceResolved ('attempt-{0:D3}' -f $attemptNumber)
New-Item -ItemType Directory -Path $attemptDirectory | Out-Null
$journal = Join-Path $attemptDirectory 'journal.log'
function Write-Journal([string]$Message) {
    Add-Content -LiteralPath $journal -Value ((Get-Date).ToString('o') + ' ' + $Message) -Encoding utf8
}
function Invoke-EspTool {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][string[]]$Arguments
    )
    $logPath = Join-Path $attemptDirectory ($Name + '.log')
    Write-Journal ($Name + '_BEGIN')
    & $pythonPath -m esptool @Arguments *> $logPath
    if ($LASTEXITCODE -ne 0) {
        Write-Journal ($Name + "_FAILED exit_code=$LASTEXITCODE")
        throw "$Name failed with exit code $LASTEXITCODE; no reset or write was attempted."
    }
    Write-Journal ($Name + '_OK')
    return $logPath
}

$identityLog = Invoke-EspTool -Name '01-identity' -Arguments @(
    '--chip','esp32s3','--port',$Port,'--baud',$baud,'--before','default_reset','--after','no_reset','chip_id'
)
$identity = Get-Content -LiteralPath $identityLog -Raw
if ($identity -notmatch 'Chip is ESP32-S3' -or
    $identity -notmatch ("(?i)MAC:\s*" + [regex]::Escape($ExpectedMac))) {
    throw 'Live ESP32-S3 identity does not match the authorized device.'
}

$partitionBin = Join-Path $attemptDirectory 'live-partition-table.bin'
Invoke-EspTool -Name '02-partition-read' -Arguments @(
    '--chip','esp32s3','--port',$Port,'--baud',$baud,'--before','no_reset','--after','no_reset',
    'read_flash','0x8000','0x1000',$partitionBin
) | Out-Null
$partitionCsv = Join-Path $attemptDirectory 'live-partition-table.csv'
& $pythonPath $partitionTool $partitionBin *> $partitionCsv
if ($LASTEXITCODE -ne 0 -or
    (Get-Content -LiteralPath $partitionCsv -Raw) -notmatch '(?im)^ota_0\s*,\s*app\s*,\s*ota_0\s*,\s*0x20000\s*,\s*(?:0x4f0000|5056K)\s*,') {
    throw 'Live partition contract is not ota_0@0x20000/0x4f0000.'
}

foreach ($chunk in $plan) {
    $finalPath = Join-Path $evidenceResolved ('readback-chunk-{0:D2}.bin' -f $chunk.index)
    if (Test-Path -LiteralPath $finalPath) { continue }
    $partialPath = Join-Path $attemptDirectory ('readback-chunk-{0:D2}.partial' -f $chunk.index)
    Invoke-EspTool -Name ('03-readback-chunk-{0:D2}' -f $chunk.index) -Arguments @(
        '--chip','esp32s3','--port',$Port,'--baud',$baud,'--before','no_reset','--after','no_reset',
        'read_flash',('0x{0:x}' -f $chunk.address),([string]$chunk.length),$partialPath
    ) | Out-Null
    if ((Get-Item -LiteralPath $partialPath).Length -ne $chunk.length) {
        throw "Chunk $($chunk.index) has an incomplete length; partial evidence was preserved."
    }
    $chunkHash = (Get-FileHash -LiteralPath $partialPath -Algorithm SHA256).Hash
    Move-Item -LiteralPath $partialPath -Destination $finalPath
    $completed.Add([pscustomobject]@{
        index = $chunk.index
        address = ('0x{0:x}' -f $chunk.address)
        length = $chunk.length
        sha256 = $chunkHash
    })
    $manifest.completed_chunks = $completed
    $manifest.phase = 'reading'
    Write-AtomicJson -Path $manifestPath -Value $manifest
}

$combinedSha = Get-CombinedSha256 -Plan $plan -Directory $evidenceResolved
if ($combinedSha -ne $expectedHash) {
    $manifest.phase = 'readback_mismatch'
    Write-AtomicJson -Path $manifestPath -Value $manifest
    throw "Combined chunk readback SHA mismatch: $combinedSha"
}
$manifest.phase = 'readback_verified'
Write-AtomicJson -Path $manifestPath -Value $manifest
Write-Journal "READBACK_OK sha256=$combinedSha completed_chunks=$($completed.Count)"

$afterVerify = if ($FinalHardReset) { 'hard_reset' } else { 'no_reset' }
$verifyLog = Invoke-EspTool -Name '04-independent-verify' -Arguments @(
    '--chip','esp32s3','--port',$Port,'--baud',$baud,'--before','no_reset','--after',$afterVerify,
    'verify_flash','0x20000',$candidateResolved
)
$verify = Get-Content -LiteralPath $verifyLog -Raw
if ($verify -notmatch '(?i)verify OK \(digest matched\)') {
    throw 'Independent verify did not report a matching digest.'
}
if ($FinalHardReset) {
    if ($verify -notmatch '(?i)Hard resetting via RTS pin') {
        throw 'Final hard-reset evidence is missing.'
    }
    Write-Journal 'FINAL_HARD_RESET_COMPLETE count=1'
} else {
    Write-Journal 'FINAL_RESET_DEFERRED count=0'
}
$manifest.phase = 'complete'
Write-AtomicJson -Path $manifestPath -Value $manifest
[ordered]@{
    completed_at = (Get-Date).ToString('o')
    candidate_sha256 = $candidateHash
    candidate_length = $candidate.Length
    readback_sha256 = $combinedSha
    completed_chunks = $completed.Count
    verify = 'digest matched'
    writes = 0
    non_app_writes = 0
    hard_reset_count = $(if ($FinalHardReset) { 1 } else { 0 })
} | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $resultPath -Encoding utf8

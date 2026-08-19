[CmdletBinding()]
param(
    [ValidateSet('Offline', 'Execute')]
    [string]$Stage = 'Offline',

    [Parameter(Mandatory = $true)][string]$CandidatePath,
    [Parameter(Mandatory = $true)][ValidatePattern('^[0-9A-Fa-f]{64}$')][string]$ExpectedSha256,
    [Parameter(Mandatory = $true)][long]$ExpectedLength,
    [Parameter(Mandatory = $true)][string]$EvidenceDirectory,
    [Parameter(Mandatory = $true)][int]$ExpectedOwnerPid,

    [ValidatePattern('^COM\d+$')][string]$Port = 'COM7',
    [ValidatePattern('^(?:[0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$')]
    [string]$ExpectedMac = '44:1b:f6:e2:78:a8',

    [switch]$AllowUnauthenticatedRecovery,

    [switch]$ConfirmSerialDeviceDisruption,
    [switch]$ConfirmedOta0IsIntendedTarget,
    [switch]$FinalHardReset
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$workspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$modulePath = Join-Path $workspace 'ops\lib\StackChanAppOnlyTransaction.psm1'
$pythonPath = 'C:\Espressif\python_env\idf5.5_py3.14_env\Scripts\python.exe'
$partitionTool = 'C:\Espressif\frameworks\esp-idf-v5.5.5\components\partition_table\gen_esp32part.py'
$appOffset = [long]0x20000
$appPartitionSize = [long]0x4f0000
$chunkSize = [long]0x100000
$baud = '115200'

$candidateResolved = [IO.Path]::GetFullPath($CandidatePath)
$evidenceResolved = [IO.Path]::GetFullPath($EvidenceDirectory)
$runtimeRoot = [IO.Path]::GetFullPath((Join-Path $workspace '.claw\runtime'))
# Windows PowerShell 5/.NET Framework does not expose
# Path.IsPathFullyQualified.  A rooted path other than a single leading slash
# is equivalent for this script's accepted drive-letter and UNC evidence paths.
if (-not [IO.Path]::IsPathRooted($EvidenceDirectory) -or $EvidenceDirectory -match '^[\\/](?![\\/])') {
    throw 'EvidenceDirectory must be an absolute child of the workspace runtime directory.'
}
$runtimePrefix = $runtimeRoot.TrimEnd([char]'\') + '\'
if ($evidenceResolved -eq $runtimeRoot -or -not $evidenceResolved.StartsWith($runtimePrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw 'EvidenceDirectory must be an absolute child of the workspace runtime directory.'
}
if (-not (Test-Path -LiteralPath $candidateResolved -PathType Leaf)) { throw 'Candidate is missing.' }
$candidate = Get-Item -LiteralPath $candidateResolved
$candidateHash = (Get-FileHash -LiteralPath $candidateResolved -Algorithm SHA256).Hash
if ($candidate.Length -ne $ExpectedLength -or $candidateHash -ne $ExpectedSha256.ToUpperInvariant()) {
    throw 'Candidate identity mismatch.'
}
$stream = [IO.File]::OpenRead($candidateResolved)
try {
    [byte[]]$header = [byte[]]::new(24)
    if ($stream.Read($header, 0, $header.Length) -ne $header.Length) { throw 'Candidate header is short.' }
} finally { $stream.Dispose() }
if ($header[0] -ne 0xE9 -or [BitConverter]::ToUInt16($header, 12) -ne 9) {
    throw 'Candidate is not an ESP32-S3 app image.'
}
if ($candidate.Length -le 0 -or $candidate.Length -ge $appPartitionSize) { throw 'Candidate does not fit ota_0.' }
$offlinePlan = [ordered]@{
    stage = 'Offline'
    candidate_sha256 = $candidateHash
    candidate_length = $candidate.Length
    app_offset = '0x20000'
    app_partition_size = $appPartitionSize
    chunk_size = $chunkSize
    backup_chunks = [Math]::Ceiling($appPartitionSize / $chunkSize)
    readback_chunks = [Math]::Ceiling($candidate.Length / $chunkSize)
    serial_access = $false
    writes = 0
}
if ($Stage -eq 'Offline') {
    Write-Host 'OFFLINE PREFLIGHT PASSED. No serial device or evidence directory was accessed.'
    $offlinePlan | ConvertTo-Json -Compress
    return
}

if (-not $ConfirmSerialDeviceDisruption -or -not $ConfirmedOta0IsIntendedTarget -or -not $FinalHardReset) {
    throw 'Execute requires serial-disruption, fixed ota_0, and single-final-reset confirmations.'
}
$existingResultPath = Join-Path $evidenceResolved 'result.json'
if (Test-Path -LiteralPath $existingResultPath) {
    $existingResult = Get-Content -LiteralPath $existingResultPath -Raw | ConvertFrom-Json
    if ($existingResult.candidate_sha256 -ne $candidateHash -or
        $existingResult.candidate_length -ne $candidate.Length -or
        $existingResult.write_count -ne 1 -or $existingResult.hard_reset_count -ne 1) {
        throw 'Existing completed result does not match this candidate transaction.'
    }
    $existingResult | ConvertTo-Json -Depth 5 -Compress
    return
}
$existingStatePath = Join-Path $evidenceResolved 'transaction.json'
if (Test-Path -LiteralPath $existingStatePath) {
    $existingState = Get-Content -LiteralPath $existingStatePath -Raw | ConvertFrom-Json
    if ($existingState.candidate_sha256 -ne $candidateHash -or
        $existingState.candidate_length -ne $candidate.Length) {
        throw 'Existing transaction state does not match this candidate.'
    }
    if ($existingState.hard_reset_count -ne 0) {
        throw 'The final reset was already armed; inspect runtime state and do not reopen serial automatically.'
    }
}
foreach ($required in @($modulePath, $pythonPath, $partitionTool)) {
    if (-not (Test-Path -LiteralPath $required -PathType Leaf)) { throw "Required tool is missing: $required" }
}
$com = Get-CimInstance Win32_SerialPort | Where-Object DeviceID -eq $Port
if (-not $com -or $com.PNPDeviceID -notmatch '^USB\\VID_303A&PID_1001&MI_00\\') {
    throw 'The selected port is not the expected ESP32-S3 USB Serial/JTAG interface.'
}
$conflicts = @(Get-CimInstance Win32_Process | Where-Object {
    $_.ProcessId -ne $PID -and
    ($_.Name -match '^(openocd|esptool|idf_monitor)' -or $_.CommandLine -match '(?i)(openocd|esptool|idf_monitor)')
})
if ($conflicts.Count -ne 0) { throw 'Another debugger, flash tool, or serial monitor is active.' }
$owners = @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
    Where-Object LocalPort -in 8765,8766 | Select-Object -ExpandProperty OwningProcess -Unique)
$authenticated = [bool](Get-NetTCPConnection -State Established -ErrorAction SilentlyContinue |
    Where-Object { $_.LocalPort -eq 8765 -and $_.RemoteAddress -eq '192.168.0.8' -and $_.OwningProcess -eq $ExpectedOwnerPid } |
    Select-Object -First 1)
if (-not $AllowUnauthenticatedRecovery) {
    if ($owners.Count -ne 1 -or $owners[0] -ne $ExpectedOwnerPid) { throw 'Unique Dock Owner preflight failed.' }
    if (-not $authenticated) { throw 'Device is not authenticated to the expected Owner.' }
}

if (-not (Test-Path -LiteralPath $evidenceResolved)) {
    New-Item -ItemType Directory -Path $evidenceResolved | Out-Null
} elseif (-not (Test-Path -LiteralPath $evidenceResolved -PathType Container)) {
    throw 'Evidence path is not a directory.'
}
$preflightNumber = @(Get-ChildItem -LiteralPath $evidenceResolved -Directory -Filter 'preflight-attempt-*').Count + 1
$preflightDirectory = Join-Path $evidenceResolved ('preflight-attempt-{0:D3}' -f $preflightNumber)
New-Item -ItemType Directory -Path $preflightDirectory | Out-Null

function Invoke-LiveEspTool {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][string[]]$Arguments,
        [Parameter(Mandatory = $true)][string]$LogDirectory,
        [int]$TimeoutSeconds = 240
    )
    $logPath = Join-Path $LogDirectory ($Name + '.log')
    $supervisorPath = Join-Path $LogDirectory ($Name + '.supervisor.log')
    $startInfo = [System.Diagnostics.ProcessStartInfo]::new()
    $startInfo.FileName = $pythonPath
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    $startInfo.ArgumentList.Add('-m')
    $startInfo.ArgumentList.Add('esptool')
    foreach ($argument in $Arguments) { $startInfo.ArgumentList.Add($argument) }
    $process = [System.Diagnostics.Process]::new()
    $process.StartInfo = $startInfo
    $stdoutTask = $null
    $stderrTask = $null
    try {
        if (-not $process.Start()) { throw "$Name failed to start esptool." }
        $pidValue = $process.Id
        $stdoutTask = $process.StandardOutput.ReadToEndAsync()
        $stderrTask = $process.StandardError.ReadToEndAsync()
        $timedOut = -not $process.WaitForExit($TimeoutSeconds * 1000)
        if ($timedOut) {
            $cleanupFailed = $false
            try {
                $process.Kill($true)
                if (-not $process.WaitForExit(5000)) { $cleanupFailed = $true }
            } catch {
                $cleanupFailed = $true
            }
            if ($cleanupFailed) {
                "exact_pid_cleanup_failed pid=$pidValue name=$Name" | Set-Content -LiteralPath $supervisorPath -Encoding utf8
                throw "$Name esptool_timeout and exact_pid_cleanup_failed for PID $pidValue."
            }
        }
        $process.WaitForExit()
        $stdout = if ($stdoutTask) { $stdoutTask.GetAwaiter().GetResult() } else { '' }
        $stderr = if ($stderrTask) { $stderrTask.GetAwaiter().GetResult() } else { '' }
        ($stdout + $stderr) | Set-Content -LiteralPath $logPath -Encoding utf8
        "pid=$pidValue exit_code=$($process.ExitCode) timed_out=$timedOut" |
            Set-Content -LiteralPath $supervisorPath -Encoding utf8
        if ($timedOut) { throw "$Name esptool_timeout after $TimeoutSeconds seconds; exact PID tree was terminated." }
        if ($process.ExitCode -ne 0) {
            $exitCode = $process.ExitCode
            $tail = (Get-Content -LiteralPath $logPath -Tail 30 -ErrorAction SilentlyContinue) -join "`n"
            throw "$Name failed with exit code $exitCode. No automatic reset or retry occurred.`n$tail"
        }
    } finally {
        $process.Dispose()
    }
    if (-not (Test-Path -LiteralPath $logPath -PathType Leaf)) {
        throw "$Name did not produce a bounded esptool log."
    }
    if ((Get-Content -LiteralPath $supervisorPath -Raw) -match 'exact_pid_cleanup_failed') {
        throw "$Name left an uncertain esptool process state."
    }
    if ((Get-Content -LiteralPath $supervisorPath -Raw) -notmatch 'exit_code=0') {
        $tail = (Get-Content -LiteralPath $logPath -Tail 30 -ErrorAction SilentlyContinue) -join "`n"
        throw "$Name supervisor did not record success.`n$tail"
    }
    return Get-Content -LiteralPath $logPath -Raw
}

$identity = Invoke-LiveEspTool -Name '01-identity' -LogDirectory $preflightDirectory -Arguments @(
    '--chip','esp32s3','--port',$Port,'--baud',$baud,'--before','default_reset','--after','no_reset','chip_id'
)
if ($identity -notmatch 'Chip is ESP32-S3' -or
    $identity -notmatch ("(?i)MAC:\s*" + [regex]::Escape($ExpectedMac))) {
    throw 'Live device identity mismatch.'
}
$partitionBin = Join-Path $preflightDirectory 'live-partition-table.bin'
Invoke-LiveEspTool -Name '02-partition-read' -LogDirectory $preflightDirectory -Arguments @(
    '--chip','esp32s3','--port',$Port,'--baud',$baud,'--before','no_reset','--after','no_reset',
    'read_flash','0x8000','0x1000',$partitionBin
) | Out-Null
$partitionCsv = Join-Path $preflightDirectory 'live-partition-table.csv'
& $pythonPath $partitionTool $partitionBin *> $partitionCsv
if ($LASTEXITCODE -ne 0 -or
    (Get-Content -LiteralPath $partitionCsv -Raw) -notmatch '(?im)^ota_0\s*,\s*app\s*,\s*ota_0\s*,\s*0x20000\s*,\s*(?:0x4f0000|5056K)\s*,') {
    throw 'Live ota_0 partition contract mismatch.'
}
[ordered]@{
    checked_at = (Get-Date).ToString('o')
    candidate_sha256 = $candidateHash
    candidate_length = $candidate.Length
    device_mac = $ExpectedMac.ToLowerInvariant()
    port = $Port
    port_pnp = $com.PNPDeviceID
    owner_pid = $ExpectedOwnerPid
    authenticated_before = $authenticated
    unauthenticated_recovery = [bool]$AllowUnauthenticatedRecovery
    app_offset = '0x20000'
    app_partition_size = '0x4f0000'
    chunk_size = '0x100000'
} | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $preflightDirectory 'preflight.json') -Encoding utf8

$transportNumber = @(Get-ChildItem -LiteralPath $evidenceResolved -Directory -Filter 'live-transport-*').Count + 1
$transportDirectory = Join-Path $evidenceResolved ('live-transport-{0:D3}' -f $transportNumber)
New-Item -ItemType Directory -Path $transportDirectory | Out-Null
$transportCall = 0
$invokeLiveEspTool = ${function:Invoke-LiveEspTool}
$transport = {
    param($Action)
    $transportCall++
    $name = ('{0:D3}-{1}' -f $transportCall, $Action.name)
    $common = @('--chip','esp32s3','--port',$Port,'--baud',$baud,'--before','no_reset','--after',$Action.after)
    if ($Action.operation -eq 'read_flash') {
        return & $invokeLiveEspTool -Name $name -LogDirectory $transportDirectory -Arguments @(
            $common + @('read_flash',('0x{0:x}' -f $Action.address),([string]$Action.length),$Action.path)
        )
    }
    if ($Action.operation -eq 'write_flash') {
        return & $invokeLiveEspTool -Name $name -LogDirectory $transportDirectory -Arguments @(
            $common + @('write_flash','0x20000',$Action.path)
        )
    }
    if ($Action.operation -eq 'verify_flash') {
        return & $invokeLiveEspTool -Name $name -LogDirectory $transportDirectory -Arguments @(
            $common + @('verify_flash','0x20000',$Action.path)
        )
    }
    throw "Unsupported transport operation: $($Action.operation)"
}.GetNewClosure()

Import-Module $modulePath -Force
$result = Invoke-StackChanAppOnlyTransaction -CandidatePath $candidateResolved `
    -ExpectedSha256 $candidateHash -ExpectedLength $candidate.Length -EvidenceDirectory $evidenceResolved `
    -Transport $transport -FinalHardReset -AppOffset $appOffset -AppPartitionSize $appPartitionSize -ChunkSize $chunkSize
$result | ConvertTo-Json -Depth 5 -Compress

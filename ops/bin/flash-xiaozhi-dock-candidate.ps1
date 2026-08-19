[CmdletBinding()]
param(
    [ValidatePattern('^COM\d+$')]
    [string]$Port = 'COM7',

    [switch]$Execute
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$workspaceRoot = 'D:\Users\chany\Documents\StackChan'
$candidatePath = Join-Path $workspaceRoot 'firmware\build-xiaozhi-dock\stack-chan.bin'
$backupPath = Join-Path $workspaceRoot '.claw\runtime\xiaozhi-hil-20260809\preflash-ota0.bin'
$backupSidecarPath = "$backupPath.sha256"
$pythonPath = 'C:\Espressif\python_env\idf5.5_py3.14_env\Scripts\python.exe'
$partitionTool = 'C:\Espressif\frameworks\esp-idf-v5.5.5\components\partition_table\gen_esp32part.py'

$expectedCandidateSha256 = 'B665DCA764BC687FA8DD10C778B0988DF66632AF9DD1757A1A9893B9C0DFB4C2'
$expectedCandidateLength = 4952912
$expectedBackupSha256 = '00DB4A753B86C5D5A41ACEDA960F7915905038C3B6094D47BF508D444164E236'
$expectedMac = '44:1b:f6:e2:78:a8'
$appOffset = 0x20000
$appPartitionSize = 0x4f0000

function Invoke-CheckedExternal {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Program,
        [Parameter(Mandatory = $true)]
        [string[]]$Arguments
    )

    $captured = @(& $Program @Arguments 2>&1)
    $captured | ForEach-Object { Write-Host $_ }
    if ($LASTEXITCODE -ne 0) {
        throw "Command failed with exit code $LASTEXITCODE`: $Program $($Arguments -join ' ')"
    }
    return ($captured -join "`n")
}

foreach ($requiredPath in @($candidatePath, $backupPath, $backupSidecarPath, $pythonPath, $partitionTool)) {
    if (-not (Test-Path -LiteralPath $requiredPath -PathType Leaf)) {
        throw "Required file is missing: $requiredPath"
    }
}

$candidate = Get-Item -LiteralPath $candidatePath
$candidateHash = (Get-FileHash -LiteralPath $candidatePath -Algorithm SHA256).Hash
if ($candidate.Length -ne $expectedCandidateLength -or $candidateHash -ne $expectedCandidateSha256) {
    throw "Candidate identity mismatch; expected length/hash $expectedCandidateLength/$expectedCandidateSha256, got $($candidate.Length)/$candidateHash"
}
if ($candidate.Length -gt $appPartitionSize) {
    throw 'Candidate exceeds ota_0 partition boundary.'
}

$backup = Get-Item -LiteralPath $backupPath
$backupHash = (Get-FileHash -LiteralPath $backupPath -Algorithm SHA256).Hash
$sidecarHash = ([System.IO.File]::ReadAllText($backupSidecarPath).Trim() -split '\s+')[0]
if ($backup.Length -ne $appPartitionSize -or $backupHash -ne $expectedBackupSha256 -or $sidecarHash -ne $backupHash) {
    throw 'Rollback backup length/hash/sidecar validation failed. No flash was attempted.'
}

Write-Host "Candidate: $candidatePath"
Write-Host "Candidate SHA-256: $candidateHash"
Write-Host "Rollback backup: $backupPath"
Write-Host "Rollback SHA-256: $backupHash"

$identity = Invoke-CheckedExternal -Program $pythonPath -Arguments @(
    '-m', 'esptool', '--chip', 'esp32s3', '--port', $Port, '--after', 'no_reset', 'chip_id'
)
if ($identity -notmatch '(?i)ESP32-S3' -or $identity -notmatch [regex]::Escape($expectedMac)) {
    throw "Connected target identity mismatch; expected ESP32-S3 $expectedMac. No flash was attempted."
}

$partitionDump = [System.IO.Path]::GetTempFileName()
try {
    Invoke-CheckedExternal -Program $pythonPath -Arguments @(
        '-m', 'esptool', '--chip', 'esp32s3', '--port', $Port, '--after', 'no_reset',
        'read_flash', '0x8000', '0x1000', $partitionDump
    ) | Out-Null
    $partitionCsv = Invoke-CheckedExternal -Program $pythonPath -Arguments @($partitionTool, $partitionDump)
    if ($partitionCsv -notmatch '(?im)^ota_0\s*,\s*app\s*,\s*ota_0\s*,\s*0x20000\s*,\s*(?:0x4f0000|5056K)\s*,') {
        throw 'Live partition table does not contain ota_0 at 0x20000 with size 0x4f0000. No flash was attempted.'
    }
}
finally {
    if (Test-Path -LiteralPath $partitionDump) {
        Remove-Item -LiteralPath $partitionDump -Force
    }
}

if (-not $Execute) {
    Write-Host 'PREFLIGHT PASSED. Re-run with -Execute for the single app-only write and independent verification.'
    exit 0
}

Write-Host 'Writing only ota_0 app bytes at 0x20000. Bootloader, partition table, NVS, and assets are not touched.'
Invoke-CheckedExternal -Program $pythonPath -Arguments @(
    '-m', 'esptool', '--chip', 'esp32s3', '--port', $Port, '--after', 'no_reset',
    'write_flash', ('0x{0:X}' -f $appOffset), $candidatePath
) | Out-Null

Invoke-CheckedExternal -Program $pythonPath -Arguments @(
    '-m', 'esptool', '--chip', 'esp32s3', '--port', $Port, '--after', 'hard_reset',
    'verify_flash', ('0x{0:X}' -f $appOffset), $candidatePath
) | Out-Null

Write-Host 'FLASH AND VERIFY PASSED.'
Write-Host "Rollback backup remains at: $backupPath"

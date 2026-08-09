[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^COM\d+$')]
    [string]$Port,

    [switch]$Execute,

    [string]$ExistingBackupPath
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$workspaceRoot = 'D:\Users\chany\Documents\StackChan'
$candidatePath = Join-Path $workspaceRoot 'firmware\build-wifi-audio-opus\stack-chan.bin'
$pythonPath = 'C:\Espressif\python_env\idf5.5_py3.11_env\Scripts\python.exe'
$partitionTool = 'C:\Espressif\frameworks\esp-idf-v5.5.5\components\partition_table\gen_esp32part.py'
$expectedSha256 = '13AD1C62513A0931F3BF5F56FA211C5CA72F1BAC885A5ACF2B17AC72D7DC5F7E'
$expectedLength = 3837472
$expectedMac = '44:1b:f6:e2:78:a8'
$appOffset = 0x20000
$appPartitionSize = 0x4f0000

foreach ($requiredPath in @($candidatePath, $pythonPath, $partitionTool)) {
    if (-not (Test-Path -LiteralPath $requiredPath -PathType Leaf)) {
        throw "Required file is missing: $requiredPath"
    }
}

$candidate = Get-Item -LiteralPath $candidatePath
$actualHash = (Get-FileHash -LiteralPath $candidatePath -Algorithm SHA256).Hash
if ($candidate.Length -ne $expectedLength) {
    throw "Candidate length mismatch: expected $expectedLength, got $($candidate.Length)"
}
if ($actualHash -ne $expectedSha256) {
    throw "Candidate SHA-256 mismatch: expected $expectedSha256, got $actualHash"
}
if (($candidate.Length + $appOffset) -gt ($appOffset + $appPartitionSize)) {
    throw 'Candidate exceeds ota_0 partition boundary.'
}

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

Write-Host "Candidate: $candidatePath"
Write-Host "Length:    $($candidate.Length) bytes (0x$('{0:X}' -f $candidate.Length))"
Write-Host "SHA-256:  $actualHash"
Write-Host "Port:      $Port"

$identity = Invoke-CheckedExternal -Program $pythonPath -Arguments @(
    '-m', 'esptool', '--chip', 'esp32s3', '--port', $Port, 'chip_id'
)
if ($identity -notmatch '(?i)ESP32-S3') {
    throw 'Connected target did not identify as ESP32-S3.'
}
if ($identity -notmatch [regex]::Escape($expectedMac)) {
    throw "Factory MAC mismatch; expected $expectedMac. No flash was attempted."
}

$partitionDump = [System.IO.Path]::GetTempFileName()
try {
    Invoke-CheckedExternal -Program $pythonPath -Arguments @(
        '-m', 'esptool', '--chip', 'esp32s3', '--port', $Port,
        'read_flash', '0x8000', '0x1000', $partitionDump
    ) | Out-Null
    $partitionCsv = Invoke-CheckedExternal -Program $pythonPath -Arguments @($partitionTool, $partitionDump)
    # gen_esp32part may render 0x4f0000 as the equivalent human-readable 5056K.
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
    Write-Host 'PREFLIGHT PASSED. Re-run with -Execute to perform the single app-only write and independent verification.'
    exit 0
}

if ($ExistingBackupPath) {
    if (-not (Test-Path -LiteralPath $ExistingBackupPath -PathType Leaf)) {
        throw "Existing rollback backup is missing: $ExistingBackupPath"
    }
    $backupPath = (Resolve-Path -LiteralPath $ExistingBackupPath).Path
    $backup = Get-Item -LiteralPath $backupPath
    if ($backup.Length -ne $appPartitionSize) {
        throw "Existing rollback backup length mismatch: expected $appPartitionSize, got $($backup.Length)"
    }
    $sidecarPath = "$backupPath.sha256.txt"
    if (-not (Test-Path -LiteralPath $sidecarPath -PathType Leaf)) {
        throw "Existing rollback backup SHA-256 sidecar is missing: $sidecarPath"
    }
    $backupHash = (Get-FileHash -LiteralPath $backupPath -Algorithm SHA256).Hash
    $sidecarHash = ([System.IO.File]::ReadAllText($sidecarPath).Trim() -split '\s+')[0]
    if ($sidecarHash -ne $backupHash) {
        throw "Existing rollback backup SHA-256 mismatch: sidecar $sidecarHash, actual $backupHash"
    }
    Write-Host "Reusing verified full ota_0 rollback backup: $backupPath"
    Write-Host "Rollback backup SHA-256: $backupHash"
} else {
    $backupDirectory = Join-Path $workspaceRoot 'backups\wifi-audio-preflash'
    New-Item -ItemType Directory -Path $backupDirectory -Force | Out-Null
    $backupTimestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $backupPath = Join-Path $backupDirectory "$backupTimestamp-ota_0-full.bin"
    Write-Host "Reading the current ota_0 partition before write: $backupPath"
    Invoke-CheckedExternal -Program $pythonPath -Arguments @(
        '-m', 'esptool', '--chip', 'esp32s3', '--port', $Port,
        'read_flash', ('0x{0:X}' -f $appOffset), ('0x{0:X}' -f $appPartitionSize), $backupPath
    ) | Out-Null
    $backupHash = (Get-FileHash -LiteralPath $backupPath -Algorithm SHA256).Hash
    Set-Content -LiteralPath "$backupPath.sha256.txt" -Value "$backupHash  $([System.IO.Path]::GetFileName($backupPath))" -Encoding ascii
    Write-Host "Rollback backup SHA-256: $backupHash"
}

Write-Host 'Writing only ota_0 app bytes at 0x20000. Bootloader, partition table, NVS, and assets are not touched.'
Invoke-CheckedExternal -Program $pythonPath -Arguments @(
    '-m', 'esptool', '--chip', 'esp32s3', '--port', $Port,
    'write_flash', '0x20000', $candidatePath
) | Out-Null

Invoke-CheckedExternal -Program $pythonPath -Arguments @(
    '-m', 'esptool', '--chip', 'esp32s3', '--port', $Port,
    'verify_flash', '0x20000', $candidatePath
) | Out-Null

Write-Host "FLASH AND VERIFY PASSED. Rollback backup: $backupPath"
Write-Host 'Use the physical RST button once to boot the application.'

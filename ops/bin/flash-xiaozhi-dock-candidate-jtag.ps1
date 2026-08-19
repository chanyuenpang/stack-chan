<#
.SYNOPSIS
Offline-first USB-JTAG recovery gate for one StackChan XiaoZhi application image.

.DESCRIPTION
This is a recovery-only, app-only path. The default Offline stage validates local
artifacts and Windows USB enumeration without starting OpenOCD or disturbing the
device. Probe and Execute are intentionally explicit because Probe resets and halts
the target, while Execute erases and writes flash.

Windows enumeration of VID_303A/PID_1001/MI_02 proves only that the interface is
visible. A current JTAG connection is proven only by a Probe that matches the pinned
adapter serial, both TAPs and CPU examinations, chip revision, MAC, and the 16 MiB
bank at base zero. This repository has historical program_esp verification evidence,
but no current-session Probe, backup, or readback evidence until those stages run.

The fixed raw target is ota_0 at 0x20000 with size 0x4f0000. Raw JTAG does not update
OTA selection metadata and does not create NEW or PENDING_VERIFY state, so it is not
an inactive-slot OTA and provides no automatic rollback. The preferred inactive-slot
route remains the application OTA implementation: dynamically choose the non-running
partition, validate the image, and select it for boot. The current application marks
a pending image valid shortly after HAL initialization, so even application rollback
does not cover later Dock or HIL stability.

This script never starts or stops Dock ownership and never invokes a serial flasher.
It refuses to run beside an existing OpenOCD or GDB process and disables OpenOCD's
GDB, TCL, and telnet listeners for every one-shot invocation.

Execute accepts only an ESP32-S3 app image header, copies it to a controlled .bin
inside the unique evidence directory, and rechecks that staged file before program_esp.
#>

[CmdletBinding()]
param(
    [ValidateSet('Offline', 'Probe', 'Execute')]
    [string]$Stage = 'Offline',

    [Parameter(Mandatory = $true)]
    [ValidateNotNullOrEmpty()]
    [string]$CandidatePath,

    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[0-9A-Fa-f]{64}$')]
    [string]$ExpectedSha256,

    [Parameter(Mandatory = $true)]
    [ValidateRange(1, 5177344)]
    [long]$ExpectedLength,

    [string]$EvidenceDirectory,

    [ValidatePattern('^(?:[0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$')]
    [string]$ExpectedAdapterSerial = '44:1B:F6:E2:78:A8',

    [ValidatePattern('^(?:[0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$')]
    [string]$ExpectedMac = '44:1b:f6:e2:78:a8',

    [ValidateRange(10, 300)]
    [int]$ProbeTimeoutSeconds = 60,

    [ValidateRange(30, 600)]
    [int]$TransferTimeoutSeconds = 240,

    [switch]$ConfirmDisruptiveProbe,

    [switch]$ConfirmedPlaintextFlashAndEfuses,

    [switch]$ConfirmedOta0IsIntendedTarget,

    [switch]$ConfirmAppOnlyJtagWrite
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$workspaceRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$openOcdRoot = 'C:\Espressif\tools\openocd-esp32\v0.12.0-esp32-20260424\openocd-esp32'
$openOcdPath = Join-Path $openOcdRoot 'bin\openocd.exe'
$openOcdScripts = Join-Path $openOcdRoot 'share\openocd\scripts'
$boardConfig = Join-Path $openOcdScripts 'board\esp32s3-builtin.cfg'
$interfaceConfig = Join-Path $openOcdScripts 'interface\esp_usb_jtag.cfg'
$partitionCsvPath = Join-Path $workspaceRoot 'firmware\partitions.csv'
$appOffset = [long]0x20000
$appPartitionSize = [long]0x4f0000
$expectedTapId = '0x120034e5'
$expectedEsp32S3ImageChipId = [uint16]9

function Assert-SafeTclLiteral {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Value,
        [Parameter(Mandatory = $true)]
        [string]$Description
    )

    $forbiddenCharacters = @(
        [char]'[', [char]']', [char]'{', [char]'}', [char]'$', [char]';', [char]'"', [char]13, [char]10
    )
    if ($Value.IndexOfAny($forbiddenCharacters) -ge 0) {
        throw "$Description contains characters that are unsafe in an OpenOCD Tcl literal."
    }
}

function ConvertTo-TclPath {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,
        [switch]$AllowMissing
    )

    $fullPath = if ($AllowMissing) {
        [System.IO.Path]::GetFullPath($Path)
    }
    else {
        (Resolve-Path -LiteralPath $Path).Path
    }
    Assert-SafeTclLiteral -Value $fullPath -Description 'OpenOCD path'
    return $fullPath.Replace('\', '/')
}

function Assert-NoDebugServerConflict {
    $conflicts = @(
        Get-Process -ErrorAction SilentlyContinue |
            Where-Object { $_.ProcessName -in @('openocd', 'xtensa-esp32s3-elf-gdb', 'gdb') }
    )
    if ($conflicts.Count -ne 0) {
        $summary = ($conflicts | ForEach-Object { "$($_.ProcessName):$($_.Id)" }) -join ', '
        throw "Refusing to start a second debug owner: $summary"
    }
}

function Invoke-OpenOcdOneShot {
    param(
        [Parameter(Mandatory = $true)]
        [string[]]$Commands,
        [Parameter(Mandatory = $true)]
        [ValidateRange(10, 600)]
        [int]$TimeoutSeconds,
        [Parameter(Mandatory = $true)]
        [string]$LogPath
    )

    Assert-NoDebugServerConflict
    $commonCommands = @(
        'gdb port disabled',
        'tcl port disabled',
        'telnet port disabled',
        "adapter serial {$ExpectedAdapterSerial}",
        'adapter speed 10000'
    )
    $commandText = (($commonCommands + $Commands) -join '; ')
    $logFullPath = [System.IO.Path]::GetFullPath($LogPath)
    # OpenOCD treats backslashes in its -l argument as escapes on Windows.
    # Pass a forward-slash absolute path so evidence logging works without
    # changing the filesystem destination.
    $logArgumentPath = $logFullPath.Replace('\', '/')
    $supervisorLogPath = "$logFullPath.supervisor.txt"
    if (Test-Path -LiteralPath $logFullPath) {
        throw "OpenOCD log already exists; refusing to overwrite evidence: $logFullPath"
    }
    $writeSupervisorEvidence = {
        param([string]$Message)
        try {
            $timestamp = [DateTimeOffset]::Now.ToString('o')
            [System.IO.File]::AppendAllText(
                $supervisorLogPath,
                "$timestamp $Message`n",
                [System.Text.UTF8Encoding]::new($false)
            )
        }
        catch {
            $supervisorWriteFailure = $_.Exception.Message
            try {
                Write-Warning "Could not append OpenOCD supervisor evidence to $supervisorLogPath`: $supervisorWriteFailure" -WarningAction Continue
            }
            catch {
                # Evidence reporting must never prevent exact-PID cleanup.
            }
        }
    }

    $startInfo = [System.Diagnostics.ProcessStartInfo]::new()
    if ($startInfo.PSObject.Properties.Name -notcontains 'ArgumentList') {
        throw 'This script requires PowerShell 7 on a .NET runtime with ProcessStartInfo.ArgumentList.'
    }
    $startInfo.FileName = $openOcdPath
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    foreach ($argument in @('-s', $openOcdScripts, '-l', $logArgumentPath, '-f', 'board/esp32s3-builtin.cfg', '-c', $commandText)) {
        [void]$startInfo.ArgumentList.Add($argument)
    }

    $process = [System.Diagnostics.Process]::new()
    $process.StartInfo = $startInfo
    $started = $false
    try {
        if (-not $process.Start()) {
            throw 'OpenOCD did not start.'
        }
        $started = $true
        & $writeSupervisorEvidence "Started OpenOCD PID $($process.Id) with a $TimeoutSeconds second timeout."
        $stdoutTask = $process.StandardOutput.ReadToEndAsync()
        $stderrTask = $process.StandardError.ReadToEndAsync()
        $timedOut = -not $process.WaitForExit($TimeoutSeconds * 1000)
        if ($timedOut) {
            & $writeSupervisorEvidence "Timeout reached for OpenOCD PID $($process.Id); attempting exact process-tree termination."
            $killFailure = $null
            try {
                $process.Kill($true)
            }
            catch {
                try {
                    $process.Kill()
                }
                catch {
                    $killFailure = $_.Exception.Message
                }
            }
            $exitedAfterKill = $false
            try {
                $exitedAfterKill = $process.WaitForExit(5000)
            }
            catch {
                $killFailure = "$killFailure $($_.Exception.Message)".Trim()
            }
            if (-not $exitedAfterKill) {
                & $writeSupervisorEvidence "OpenOCD PID $($process.Id) remained alive after the first bounded termination attempt. Error: $killFailure"
                throw "OpenOCD PID $($process.Id) timed out and did not exit after bounded termination. See $logFullPath and $supervisorLogPath."
            }
        }

        $process.WaitForExit()
        $stdout = $stdoutTask.GetAwaiter().GetResult().TrimEnd()
        $stderr = $stderrTask.GetAwaiter().GetResult().TrimEnd()
        $toolLog = if (Test-Path -LiteralPath $logFullPath) {
            [System.IO.File]::ReadAllText($logFullPath).TrimEnd()
        }
        else {
            ''
        }
        $text = (@($toolLog, $stdout, $stderr) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }) -join "`n"
        & $writeSupervisorEvidence "OpenOCD PID $($process.Id) exited with code $($process.ExitCode); timed_out=$timedOut."
        if (-not [string]::IsNullOrWhiteSpace($text)) {
            Write-Host $text
        }
        if ($timedOut) {
            throw "OpenOCD timed out after $TimeoutSeconds seconds; its process was terminated. No automatic reset or recovery was attempted."
        }
        if ($process.ExitCode -ne 0) {
            throw "OpenOCD failed with exit code $($process.ExitCode). No automatic reset or recovery was attempted."
        }
        return $text
    }
    finally {
        try {
            if ($started) {
                $shouldAttemptKill = $true
                $stateQueryFailure = $null
                try {
                    $shouldAttemptKill = -not $process.HasExited
                }
                catch {
                    $stateQueryFailure = $_.Exception.Message
                }
                if ($shouldAttemptKill) {
                    $cleanupResult = $null
                    try {
                        $process.Kill($true)
                        if ($process.WaitForExit(5000)) {
                            $cleanupResult = "Final bounded cleanup terminated exact OpenOCD PID $($process.Id); no target reset was attempted."
                        }
                        else {
                            $cleanupResult = "OpenOCD PID $($process.Id) still appears alive after final bounded cleanup; no target reset was attempted."
                        }
                    }
                    catch {
                        $cleanupResult = "Final cleanup of OpenOCD PID $($process.Id) failed or found it already exited: $($_.Exception.Message); no target reset was attempted."
                    }
                    if (-not [string]::IsNullOrWhiteSpace($stateQueryFailure)) {
                        $cleanupResult = "HasExited query failed ($stateQueryFailure); conservatively attempted exact-PID termination. $cleanupResult"
                    }
                    & $writeSupervisorEvidence $cleanupResult
                }
            }
        }
        finally {
            $process.Dispose()
        }
    }
}

function Assert-ProbeEvidence {
    param(
        [Parameter(Mandatory = $true)]
        [string]$ProbeOutput
    )

    $tapMatches = [regex]::Matches(
        $ProbeOutput,
        "(?im)tap/device found:\s*$([regex]::Escape($expectedTapId))"
    ).Count
    $requiredPatterns = @(
        '(?im)^Open On-Chip Debugger v0\.12\.0-esp32-20260424\b',
        '(?im)esp_usb_jtag: Device found\.',
        "(?im)esp_usb_jtag: serial \($([regex]::Escape($ExpectedAdapterSerial))\)",
        "(?im)JTAG tap: esp32s3\.tap0 tap/device found:\s*$([regex]::Escape($expectedTapId))",
        "(?im)JTAG tap: esp32s3\.tap1 tap/device found:\s*$([regex]::Escape($expectedTapId))",
        '(?im)\[esp32s3\.cpu0\] Examination succeed',
        '(?im)\[esp32s3\.cpu1\] Examination succeed',
        '(?im)Chip revision v0\.2',
        '(?im)(?:#0\s*:.*?at\s+0x0+|flash bank.*?base\s+0x0+)',
        '(?im)(?:size\s+(?:0x0?1000000|16384\s*KB|16\s*MiB)|flash.*?size\s+16384\s*KB)',
        "(?im)^STACKCHAN_TARGET_MAC=$([regex]::Escape($ExpectedMac))\s*$"
    )
    if ($tapMatches -lt 2) {
        throw "Probe did not prove both expected TAPs ($expectedTapId)."
    }
    foreach ($pattern in $requiredPatterns) {
        if ($ProbeOutput -notmatch $pattern) {
            throw "Probe evidence is incomplete; missing pattern: $pattern"
        }
    }
}

foreach ($requiredPath in @($openOcdPath, $boardConfig, $interfaceConfig, $partitionCsvPath)) {
    if (-not (Test-Path -LiteralPath $requiredPath -PathType Leaf)) {
        throw "Required local tool or configuration is missing: $requiredPath"
    }
}

$candidateResolved = (Resolve-Path -LiteralPath $CandidatePath).Path
$candidate = Get-Item -LiteralPath $candidateResolved
$candidateHash = (Get-FileHash -LiteralPath $candidateResolved -Algorithm SHA256).Hash
$expectedHash = $ExpectedSha256.ToUpperInvariant()
if ([System.IO.Path]::GetExtension($candidateResolved) -ine '.bin') {
    throw 'Candidate must have a .bin extension so OpenOCD cannot auto-detect an ELF or other sectioned image format.'
}
if ($candidate.Length -ne $ExpectedLength -or $candidateHash -ne $expectedHash) {
    throw "Candidate identity mismatch; expected $ExpectedLength/$expectedHash, got $($candidate.Length)/$candidateHash"
}
if ($candidate.Length -gt $appPartitionSize) {
    throw 'Candidate exceeds the fixed ota_0 application partition.'
}
$imageHeader = [byte[]]::new(14)
$candidateStream = [System.IO.File]::OpenRead($candidateResolved)
try {
    $headerLength = $candidateStream.Read($imageHeader, 0, $imageHeader.Length)
}
finally {
    $candidateStream.Dispose()
}
$imageChipId = [uint16]($imageHeader[12] -bor ($imageHeader[13] -shl 8))
if ($headerLength -ne $imageHeader.Length -or $imageHeader[0] -ne 0xE9 -or $imageChipId -ne $expectedEsp32S3ImageChipId) {
    throw 'Candidate is not a raw ESP32-S3 application image (expected magic 0xE9 and chip_id 9).'
}

$partitionCsv = [System.IO.File]::ReadAllText($partitionCsvPath)
if ($partitionCsv -notmatch '(?im)^ota_0\s*,\s*app\s*,\s*ota_0\s*,\s*0x20000\s*,\s*0x4f0000\s*,') {
    throw 'Repository partition contract drifted: ota_0 is not 0x20000/0x4f0000.'
}

$jtagDevices = @(
    Get-PnpDevice -PresentOnly |
        Where-Object { $_.InstanceId -like 'USB\VID_303A&PID_1001&MI_02\*' }
)
if ($jtagDevices.Count -ne 1 -or $jtagDevices[0].Status -ne 'OK') {
    throw "Expected exactly one healthy USB-JTAG MI_02 interface; found $($jtagDevices.Count)."
}

Write-Host "Candidate: $candidateResolved"
Write-Host "Candidate SHA-256: $candidateHash"
Write-Host "Candidate length: $($candidate.Length)"
Write-Host ('Fixed app range: 0x{0:X}-0x{1:X} (slot 0x{2:X})' -f `
    $appOffset, ($appOffset + $candidate.Length), $appPartitionSize)
Write-Host "USB enumeration: $($jtagDevices[0].FriendlyName) [$($jtagDevices[0].InstanceId)]"
Write-Host "Pinned OpenOCD: $openOcdPath"

if ($Stage -eq 'Offline') {
    Write-Host 'OFFLINE PREFLIGHT PASSED.'
    Write-Host 'Verified now: candidate identity/bounds, repository ota_0 contract, tool/config presence, and Windows MI_02 enumeration.'
    Write-Host 'Not verified now: OpenOCD access, TAP/CPU examination, live flash bank/eFuses, running slot, backup, write, readback, or reset.'
    return
}

if (-not $ConfirmDisruptiveProbe) {
    throw 'Probe resets and halts the target. Re-run with -ConfirmDisruptiveProbe only in an authorized maintenance window.'
}
if ($Stage -eq 'Execute') {
    if (-not $ConfirmedPlaintextFlashAndEfuses) {
        throw 'Execute requires independent live evidence that secure boot, flash encryption, and anti-rollback eFuses permit this raw write.'
    }
    if (-not $ConfirmedOta0IsIntendedTarget) {
        throw 'Execute requires independent evidence that fixed ota_0 is the intended overwrite target; this script cannot infer the running slot offline.'
    }
    if (-not $ConfirmAppOnlyJtagWrite) {
        throw 'Execute requires -ConfirmAppOnlyJtagWrite.'
    }
}

if ([string]::IsNullOrWhiteSpace($EvidenceDirectory)) {
    throw 'Probe and Execute require a unique -EvidenceDirectory.'
}
$evidenceFullPath = [System.IO.Path]::GetFullPath($EvidenceDirectory)
Assert-SafeTclLiteral -Value $evidenceFullPath -Description 'Evidence directory'
if ($Stage -eq 'Execute') {
    [void](ConvertTo-TclPath -Path $candidateResolved)
}
if (Test-Path -LiteralPath $evidenceFullPath) {
    throw "Evidence directory already exists; choose a new path to prevent overwrite: $evidenceFullPath"
}
[void](New-Item -ItemType Directory -Path $evidenceFullPath)
$programCandidatePath = $null
if ($Stage -eq 'Execute') {
    $programCandidatePath = Join-Path $evidenceFullPath 'candidate-app.bin'
    Copy-Item -LiteralPath $candidateResolved -Destination $programCandidatePath
    $programCandidate = Get-Item -LiteralPath $programCandidatePath
    $programCandidateHash = (Get-FileHash -LiteralPath $programCandidatePath -Algorithm SHA256).Hash
    if ($programCandidate.Length -ne $ExpectedLength -or $programCandidateHash -ne $expectedHash) {
        throw 'Controlled candidate-app.bin staging copy failed identity verification. No device access was attempted.'
    }
}

$probeOutput = Invoke-OpenOcdOneShot -TimeoutSeconds $ProbeTimeoutSeconds -LogPath (Join-Path $evidenceFullPath 'probe.log') -Commands @(
    'init',
    'reset halt',
    'sleep 500',
    'flash probe 0',
    'flash banks',
    'targets',
    'echo STACKCHAN_TARGET_MAC=[esp_get_mac format]',
    'reset run',
    'shutdown'
)
Assert-ProbeEvidence -ProbeOutput $probeOutput
Write-Host 'CURRENT JTAG PROBE PASSED.'

if ($Stage -eq 'Probe') {
    return
}

$sampleA = Join-Path $evidenceFullPath 'read-sample-a.bin'
$sampleB = Join-Path $evidenceFullPath 'read-sample-b.bin'
$sampleATcl = ConvertTo-TclPath -Path $sampleA -AllowMissing
$sampleBTcl = ConvertTo-TclPath -Path $sampleB -AllowMissing
Invoke-OpenOcdOneShot -TimeoutSeconds $TransferTimeoutSeconds -LogPath (Join-Path $evidenceFullPath 'read-sample.log') -Commands @(
    'init',
    'reset halt',
    'sleep 500',
    'flash probe 0',
    "flash read_bank 0 {$sampleATcl} 0x20000 0x1000",
    "flash read_bank 0 {$sampleBTcl} 0x20000 0x1000",
    'reset run',
    'shutdown'
) | Out-Null
$sampleAItem = Get-Item -LiteralPath $sampleA
$sampleBItem = Get-Item -LiteralPath $sampleB
$sampleAHash = (Get-FileHash -LiteralPath $sampleA -Algorithm SHA256).Hash
$sampleBHash = (Get-FileHash -LiteralPath $sampleB -Algorithm SHA256).Hash
if ($sampleAItem.Length -ne 0x1000 -or $sampleBItem.Length -ne 0x1000 -or $sampleAHash -ne $sampleBHash) {
    throw 'Repeated read_bank sample was not stable. No write was attempted.'
}

$backupPath = Join-Path $evidenceFullPath 'pre-ota0.bin'
$backupTcl = ConvertTo-TclPath -Path $backupPath -AllowMissing
Invoke-OpenOcdOneShot -TimeoutSeconds $TransferTimeoutSeconds -LogPath (Join-Path $evidenceFullPath 'backup.log') -Commands @(
    'init',
    'reset halt',
    'sleep 500',
    'flash probe 0',
    "flash read_bank 0 {$backupTcl} 0x20000 0x4f0000",
    'reset run',
    'shutdown'
) | Out-Null
$backup = Get-Item -LiteralPath $backupPath
if ($backup.Length -ne $appPartitionSize) {
    throw 'Full ota_0 backup length mismatch. No write was attempted.'
}
$backupHash = (Get-FileHash -LiteralPath $backupPath -Algorithm SHA256).Hash
[System.IO.File]::WriteAllText(
    "$backupPath.sha256",
    "$backupHash  $($backup.Name)`n",
    [System.Text.UTF8Encoding]::new($false)
)

$programCandidate = Get-Item -LiteralPath $programCandidatePath
$programCandidateHash = (Get-FileHash -LiteralPath $programCandidatePath -Algorithm SHA256).Hash
if ($programCandidate.Length -ne $ExpectedLength -or $programCandidateHash -ne $expectedHash) {
    throw 'Controlled candidate-app.bin changed before program_esp. No write was attempted.'
}
$programCandidateTcl = ConvertTo-TclPath -Path $programCandidatePath
$writeStarted = $false
try {
    $writeStarted = $true
    $programOutput = Invoke-OpenOcdOneShot -TimeoutSeconds $TransferTimeoutSeconds -LogPath (Join-Path $evidenceFullPath 'program.log') -Commands @(
        'init',
        'reset halt',
        'sleep 500',
        "program_esp {$programCandidateTcl} 0x20000 verify exit"
    )
    if ($programOutput -notmatch '(?im)\*\* (?:Verify OK|Existing flash content matches) \*\*') {
        throw 'program_esp returned success without a Verify OK or Existing flash content matches proof marker.'
    }

    $readbackPath = Join-Path $evidenceFullPath 'post-app.bin'
    $readbackTcl = ConvertTo-TclPath -Path $readbackPath -AllowMissing
    Invoke-OpenOcdOneShot -TimeoutSeconds $TransferTimeoutSeconds -LogPath (Join-Path $evidenceFullPath 'readback.log') -Commands @(
        'init',
        'reset halt',
        'sleep 500',
        'flash probe 0',
        ('flash read_bank 0 {{{0}}} 0x20000 0x{1:X}' -f $readbackTcl, $ExpectedLength),
        'shutdown'
    ) | Out-Null
    $readback = Get-Item -LiteralPath $readbackPath
    $readbackHash = (Get-FileHash -LiteralPath $readbackPath -Algorithm SHA256).Hash
    if ($readback.Length -ne $ExpectedLength -or $readbackHash -ne $expectedHash) {
        throw 'Independent readback length or SHA-256 mismatch.'
    }

    Invoke-OpenOcdOneShot -TimeoutSeconds $ProbeTimeoutSeconds -LogPath (Join-Path $evidenceFullPath 'reset.log') -Commands @(
        'init',
        'reset run',
        'sleep 500',
        'shutdown'
    ) | Out-Null
}
catch {
    if ($writeStarted) {
        Write-Warning "A write may have started. The target was deliberately not reset. Preserve $evidenceFullPath and decide whether to restore the verified full-slot backup manually."
    }
    throw
}

Write-Host 'APP-ONLY JTAG WRITE, VERIFY, READBACK, AND RESET PASSED.'
Write-Host "Manual byte backup (not OTA rollback): $backupPath"

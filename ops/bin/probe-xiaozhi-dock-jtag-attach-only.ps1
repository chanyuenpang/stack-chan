<#
.SYNOPSIS
Plans or performs a TAP-only ESP32-S3 USB-JTAG attachment without creating CPU targets.

.DESCRIPTION
DryRun is the default and never starts OpenOCD. It validates only local tooling,
the repository partition contract, and Windows enumeration of the MI_02 interface,
then prints the exact future command plan and capability matrix.

Contact is intentionally narrower than the disruptive recovery Probe. It loads only
the pinned USB-JTAG interface config, declares the two expected ESP32-S3 TAPs, and
validates their IDCODEs. It never loads board or target configs and therefore creates
no CPU target, flash bank, work area, or target event handlers.

There is no reliable zero-reset TAP discovery: OpenOCD's `jtag arp_init` issues a
JTAG Test-Logic-Reset before reading IDCODEs. OpenOCD documents that TAP reset as
normally invisible to the rest of the system, but that is still a hardware-side
effect and has not been HIL-validated on this running device. Adapter initialization
can also send an SRST-deassert (`srst0`) transition from an initially unknown line
state; it never requests SRST assertion, but that line-side effect is also unverified.
Contact therefore
requires both explicit contact and TAP-reset confirmations. The script overrides jtag_init so a failed TAP scan
cannot fall back to init_reset, and overrides init_reset to fail closed.

This probe can prove only that the pinned MI_02 adapter opens and that two expected
TAP IDCODEs are visible. It cannot prove CPU examination/liveness, MAC, flash ID or
live flash layout, running OTA slot, eFuse security state, or application health.
Those require a CPU target, target memory/register access, a flash driver/stub, or
an application-side API and are deliberately outside this strict attach profile.
Even a trusted otadata read would show configured boot selection, not necessarily
the partition that is currently executing after fallback or rollback.

The script never opens a serial port and contains no target reset, halt, resume,
memory access, flash access, backup, erase, program, or verify command.
#>

[CmdletBinding()]
param(
    [ValidateSet('DryRun', 'Contact')]
    [string]$Stage = 'DryRun',

    [ValidatePattern('^(?:[0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$')]
    [string]$ExpectedAdapterSerial = '44:1B:F6:E2:78:A8',

    [switch]$ConfirmUsbJtagContact,

    [switch]$ConfirmJtagTapStateMachineReset,

    [string]$EvidenceDirectory,

    [ValidateRange(10, 120)]
    [int]$TimeoutSeconds = 30
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$workspaceRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$openOcdRoot = 'C:\Espressif\tools\openocd-esp32\v0.12.0-esp32-20260424\openocd-esp32'
$openOcdPath = Join-Path $openOcdRoot 'bin\openocd.exe'
$openOcdScripts = Join-Path $openOcdRoot 'share\openocd\scripts'
$interfaceConfig = Join-Path $openOcdScripts 'interface\esp_usb_jtag.cfg'
$openOcdScriptsForOpenOcd = $openOcdScripts.Replace('\', '/')
$interfaceConfigForOpenOcd = $interfaceConfig.Replace('\', '/')
$openOcdInfoPath = Join-Path $openOcdRoot 'share\info\openocd.info-1'
$partitionCsvPath = Join-Path $workspaceRoot 'firmware\partitions.csv'
$expectedTapId = '0x120034e5'
$expectedOpenOcdSha256 = '7461DBBEC251F1D4A2189C3C57B74A45B2FE64DEC1EC1B9EDDCB348A2AB2EBAB'
$expectedInterfaceSha256 = '9C2201DDCDB416A471E8D7F8BF309E4F20C364BBF416CA67D6475A8495934722'

$attachCommands = @(
    'noinit',
    'gdb port disabled',
    'tcl port disabled',
    'telnet port disabled',
    "adapter serial {$ExpectedAdapterSerial}",
    'adapter speed 1000',
    'reset_config none',
    'proc init_reset {mode} { error "STACKCHAN_TARGET_RESET_FORBIDDEN" }',
    'proc jtag_init {} { jtag arp_init }',
    "jtag newtap esp32s3 tap0 -irlen 5 -expected-id $expectedTapId",
    "jtag newtap esp32s3 tap1 -irlen 5 -expected-id $expectedTapId",
    'init',
    'scan_chain',
    'echo STACKCHAN_TAP_ONLY_COMPLETE',
    'shutdown'
)

$capabilityMatrix = @(
    [pscustomobject]@{ Fact = 'Windows MI_02 enumeration'; DryRun = 'yes'; Contact = 'yes'; Meaning = 'Interface presence only' },
    [pscustomobject]@{ Fact = 'OpenOCD adapter access'; DryRun = 'no'; Contact = 'yes'; Meaning = 'Pinned WinUSB interface can be claimed' },
    [pscustomobject]@{ Fact = 'TAP0/TAP1 IDCODE'; DryRun = 'no'; Contact = 'yes'; Meaning = 'Two expected 0x120034e5 TAPs only' },
    [pscustomobject]@{ Fact = 'CPU examination/liveness'; DryRun = 'no'; Contact = 'no'; Meaning = 'No CPU target is created' },
    [pscustomobject]@{ Fact = 'MAC'; DryRun = 'no'; Contact = 'no'; Meaning = 'esp_get_mac/read_memory excluded' },
    [pscustomobject]@{ Fact = 'Flash ID/live layout'; DryRun = 'no'; Contact = 'no'; Meaning = 'No flash bank, probe, stub, or read' },
    [pscustomobject]@{ Fact = 'Running OTA slot'; DryRun = 'no'; Contact = 'no'; Meaning = 'Needs application running-partition API' },
    [pscustomobject]@{ Fact = 'eFuse security state'; DryRun = 'no'; Contact = 'no'; Meaning = 'No target register/memory access' },
    [pscustomobject]@{ Fact = 'Application remained healthy'; DryRun = 'no'; Contact = 'no'; Meaning = 'Requires independent Dock/HIL evidence' }
)

$dryRunArgv = @(
    '-s', $openOcdScriptsForOpenOcd,
    '-l', '<unique-evidence>/tap-only-attach.log',
    '-c', 'noinit',
    '-f', $interfaceConfigForOpenOcd,
    '-c', ($attachCommands -join '; ')
)

function Assert-NoDebugOwnerConflict {
    $conflicts = @(
        Get-Process -ErrorAction SilentlyContinue |
            Where-Object { $_.ProcessName -in @('openocd', 'xtensa-esp32s3-elf-gdb', 'gdb') }
    )
    if ($conflicts.Count -ne 0) {
        $summary = ($conflicts | ForEach-Object { "$($_.ProcessName):$($_.Id)" }) -join ', '
        throw "Refusing to start beside an existing debug owner: $summary"
    }
}

function Assert-SafeOpenOcdOptionPath {
    param(
        [Parameter(Mandatory = $true)]
        [string]$PathValue
    )

    if ($PathValue -notmatch '^[A-Za-z]:/[A-Za-z0-9_./-]+$') {
        throw "OpenOCD option path is not Tcl-safe; use a forward-slash drive-letter path containing only ASCII letters, digits, dot, underscore, hyphen, and slash: $PathValue"
    }
}

function Invoke-TapOnlyOpenOcd {
    param(
        [Parameter(Mandatory = $true)]
        [string[]]$Commands,
        [Parameter(Mandatory = $true)]
        [string]$LogPath,
        [Parameter(Mandatory = $true)]
        [ValidateRange(10, 120)]
        [int]$CommandTimeoutSeconds
    )

    Assert-NoDebugOwnerConflict
    $logFullPath = [System.IO.Path]::GetFullPath($LogPath)
    $logPathForOpenOcd = $logFullPath.Replace('\', '/')
    Assert-SafeOpenOcdOptionPath -PathValue $logPathForOpenOcd
    $supervisorLogPath = "$logFullPath.supervisor.txt"
    if (Test-Path -LiteralPath $logFullPath) {
        throw "Evidence log already exists: $logFullPath"
    }
    $writeSupervisorEvidence = {
        param([string]$Message)
        try {
            [System.IO.File]::AppendAllText(
                $supervisorLogPath,
                "$([DateTimeOffset]::Now.ToString('o')) $Message`n",
                [System.Text.UTF8Encoding]::new($false)
            )
        }
        catch {
            $failure = $_.Exception.Message
            try {
                Write-Warning "Could not append attach supervisor evidence: $failure" -WarningAction Continue
            }
            catch {
                # Evidence reporting must never prevent exact-PID cleanup.
            }
        }
    }

    $startInfo = [System.Diagnostics.ProcessStartInfo]::new()
    if ($startInfo.PSObject.Properties.Name -notcontains 'ArgumentList') {
        throw 'PowerShell 7 with ProcessStartInfo.ArgumentList is required.'
    }
    $startInfo.FileName = $openOcdPath
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    [void]$startInfo.Environment.Remove('OPENOCD_USB_ADAPTER_LOCATION')
    $commandText = $Commands -join '; '
    foreach ($argument in @(
        '-s', $openOcdScriptsForOpenOcd,
        '-l', $logPathForOpenOcd,
        '-c', 'noinit',
        '-f', $interfaceConfigForOpenOcd,
        '-c', $commandText
    )) {
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
        & $writeSupervisorEvidence "Started TAP-only OpenOCD PID $($process.Id)."
        $stdoutTask = $process.StandardOutput.ReadToEndAsync()
        $stderrTask = $process.StandardError.ReadToEndAsync()
        $timedOut = -not $process.WaitForExit($CommandTimeoutSeconds * 1000)
        if ($timedOut) {
            try {
                $process.Kill($true)
            }
            catch {
                # The finally block performs a second exact-PID attempt.
            }
            [void]$process.WaitForExit(5000)
        }
        if (-not $process.HasExited) {
            throw "TAP-only OpenOCD PID $($process.Id) did not exit after bounded cleanup."
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
        $text = (@($toolLog, $stdout, $stderr) |
            Where-Object { -not [string]::IsNullOrWhiteSpace($_) }) -join "`n"
        & $writeSupervisorEvidence "OpenOCD exited code=$($process.ExitCode) timed_out=$timedOut."
        if ($timedOut) {
            throw 'TAP-only OpenOCD timed out. No target recovery command was attempted.'
        }
        if ($process.ExitCode -ne 0) {
            throw "TAP-only OpenOCD failed with exit code $($process.ExitCode)."
        }
        return $text
    }
    finally {
        $cleanupFailure = $null
        try {
            if ($started) {
                $shouldKill = $true
                try {
                    $shouldKill = -not $process.HasExited
                }
                catch {
                    $shouldKill = $true
                }
                if ($shouldKill) {
                    try {
                        $process.Kill($true)
                    }
                    catch {
                        $cleanupFailure = "Exact-PID process-tree kill failed: $($_.Exception.Message)"
                    }
                    try {
                        if (-not $process.WaitForExit(5000)) {
                            $cleanupFailure = 'Exact-PID process-tree cleanup exceeded 5 seconds.'
                        }
                    }
                    catch {
                        $cleanupFailure = "Could not wait for exact-PID cleanup: $($_.Exception.Message)"
                    }

                    $stillRunning = $true
                    try {
                        $stillRunning = -not $process.HasExited
                    }
                    catch {
                        $cleanupFailure = "Could not prove exact-PID cleanup: $($_.Exception.Message)"
                        $stillRunning = $true
                    }
                    if ($stillRunning) {
                        if ([string]::IsNullOrWhiteSpace($cleanupFailure)) {
                            $cleanupFailure = 'Exact-PID process tree remained alive after cleanup.'
                        }
                        & $writeSupervisorEvidence "CLEANUP FAILURE PID $($process.Id): $cleanupFailure"
                        throw "TAP-only OpenOCD cleanup failed for PID $($process.Id); a debug owner may remain. $cleanupFailure"
                    }
                }
            }
        }
        finally {
            $process.Dispose()
        }
    }
}

foreach ($requiredPath in @($openOcdPath, $interfaceConfig, $openOcdInfoPath, $partitionCsvPath)) {
    if (-not (Test-Path -LiteralPath $requiredPath -PathType Leaf)) {
        throw "Required local file is missing: $requiredPath"
    }
}

$openOcdHash = (Get-FileHash -LiteralPath $openOcdPath -Algorithm SHA256).Hash
$interfaceHash = (Get-FileHash -LiteralPath $interfaceConfig -Algorithm SHA256).Hash
if ($openOcdHash -ne $expectedOpenOcdSha256 -or $interfaceHash -ne $expectedInterfaceSha256) {
    throw "Pinned OpenOCD binary/interface identity drifted: $openOcdHash / $interfaceHash"
}
Assert-SafeOpenOcdOptionPath -PathValue $openOcdScriptsForOpenOcd
Assert-SafeOpenOcdOptionPath -PathValue $interfaceConfigForOpenOcd
if (-not [string]::IsNullOrWhiteSpace($env:OPENOCD_USB_ADAPTER_LOCATION)) {
    throw 'OPENOCD_USB_ADAPTER_LOCATION must be unset; inherited adapter routing is not allowed.'
}

$interfaceText = [System.IO.File]::ReadAllText($interfaceConfig)
foreach ($requiredPattern in @(
    '(?m)^adapter driver esp_usb_jtag$',
    '(?m)^espusbjtag vid_pid 0x303a 0x1001$',
    '(?m)^transport select jtag$'
)) {
    if ($interfaceText -notmatch $requiredPattern) {
        throw "Pinned interface config drifted; missing: $requiredPattern"
    }
}
$openOcdInfo = [System.IO.File]::ReadAllText($openOcdInfoPath)
$normalizedOpenOcdInfo = [regex]::Replace($openOcdInfo, '\s+', ' ')
foreach ($evidenceText in @(
    "The default implementation first tries 'jtag arp_init'",
    "If that fails, it tries again, using a harder reset",
    'It starts by issuing a JTAG-only reset',
    'Such resets should not be visible to the rest of the system'
)) {
    if (-not $normalizedOpenOcdInfo.Contains($evidenceText)) {
        throw "Pinned OpenOCD semantics documentation drifted; missing: $evidenceText"
    }
}
$partitionCsv = [System.IO.File]::ReadAllText($partitionCsvPath)
if ($partitionCsv -notmatch '(?im)^ota_0\s*,\s*app\s*,\s*ota_0\s*,\s*0x20000\s*,\s*0x4f0000\s*,') {
    throw 'Repository ota_0 contract drifted from 0x20000/0x4f0000.'
}

$jtagDevices = @(
    Get-PnpDevice -PresentOnly |
        Where-Object { $_.InstanceId -like 'USB\VID_303A&PID_1001&MI_02\*' }
)
if ($jtagDevices.Count -ne 1 -or $jtagDevices[0].Status -ne 'OK') {
    throw "Expected exactly one healthy MI_02 interface; found $($jtagDevices.Count)."
}

Write-Host "Stage: $Stage"
Write-Host "USB enumeration only: $($jtagDevices[0].FriendlyName) [$($jtagDevices[0].InstanceId)]"
Write-Host "Pinned OpenOCD: $openOcdPath"
Write-Host 'Future OpenOCD argv (one token per line):'
$dryRunArgv | ForEach-Object { Write-Host "  $_" }
Write-Host 'Future OpenOCD command plan:'
$attachCommands | ForEach-Object { Write-Host "  $_" }
Write-Host 'Capability matrix:'
$capabilityMatrix | Format-Table -AutoSize | Out-Host
Write-Host 'Expected hardware-side effects if Contact is later authorized:'
Write-Host '  - Claims the MI_02 WinUSB interface for one bounded process.'
Write-Host '  - May send SRST deassert (srst0); never requests SRST assertion.'
Write-Host '  - Toggles JTAG TMS/TCK/TDI and performs JTAG Test-Logic-Reset.'
Write-Host '  - Does not create a CPU target or issue SoC reset, halt, resume, memory, or flash commands.'
Write-Host '  - First live use still requires independent Dock/HIL continuity evidence.'

if ($Stage -eq 'DryRun') {
    Write-Host 'DRY RUN PASSED. OpenOCD was not started and the device was not attached.'
    return
}

if (-not $ConfirmUsbJtagContact) {
    throw 'Contact requires -ConfirmUsbJtagContact because OpenOCD will claim the MI_02 WinUSB interface.'
}
if (-not $ConfirmJtagTapStateMachineReset) {
    throw 'Contact requires -ConfirmJtagTapStateMachineReset because reliable IDCODE discovery resets the JTAG TAP state machine.'
}
if ([string]::IsNullOrWhiteSpace($EvidenceDirectory)) {
    throw 'Contact requires a unique -EvidenceDirectory.'
}
$evidenceFullPath = [System.IO.Path]::GetFullPath($EvidenceDirectory)
$evidencePathForOpenOcd = $evidenceFullPath.Replace('\', '/')
Assert-SafeOpenOcdOptionPath -PathValue $evidencePathForOpenOcd
if (Test-Path -LiteralPath $evidenceFullPath) {
    throw "Evidence directory already exists: $evidenceFullPath"
}
[void](New-Item -ItemType Directory -Path $evidenceFullPath)

$attachOutput = Invoke-TapOnlyOpenOcd `
    -Commands $attachCommands `
    -LogPath (Join-Path $evidenceFullPath 'tap-only-attach.log') `
    -CommandTimeoutSeconds $TimeoutSeconds

$tapEvidenceMatches = [regex]::Matches(
    $attachOutput,
    '(?im)JTAG tap: esp32s3\.(?<tap>\S+) tap/device found:\s*(?<id>0x[0-9a-f]+)'
)
$unexpectedTapEvidence = @(
    $tapEvidenceMatches |
        Where-Object { $_.Groups['id'].Value -ine $expectedTapId }
)
$uniqueTapNames = @(
    $tapEvidenceMatches |
        ForEach-Object { $_.Groups['tap'].Value.ToLowerInvariant() } |
        Sort-Object -Unique
)
foreach ($requiredPattern in @(
    '(?im)^Open On-Chip Debugger v0\.12\.0-esp32-20260424\b',
    '(?im)esp_usb_jtag: Device found\.',
    "(?im)esp_usb_jtag: serial \($([regex]::Escape($ExpectedAdapterSerial))\)",
    '(?im)^STACKCHAN_TAP_ONLY_COMPLETE\s*$'
)) {
    if ($attachOutput -notmatch $requiredPattern) {
        throw "TAP-only evidence is incomplete; missing: $requiredPattern"
    }
}
if (
    $unexpectedTapEvidence.Count -ne 0 -or
    $uniqueTapNames.Count -ne 2 -or
    $uniqueTapNames -notcontains 'tap0' -or
    $uniqueTapNames -notcontains 'tap1'
) {
    $observedTaps = @(
        $tapEvidenceMatches |
            ForEach-Object { "$($_.Groups['tap'].Value)=$($_.Groups['id'].Value)" } |
            Sort-Object -Unique
    ) -join ', '
    throw "Expected unique tap0/tap1 evidence with ID $expectedTapId; observed: $observedTaps"
}
if ($attachOutput -match '(?im)Examination succeed|target halted|reset halt|reset run') {
    throw 'Unexpected CPU examination, halt, or target-reset evidence appeared in a TAP-only run.'
}

Write-Host 'TAP-ONLY ATTACH PASSED.'
Write-Host 'Proved: adapter access and two expected TAP IDCODEs.'
Write-Host 'Not proved: CPU, MAC, flash, running slot, eFuse, or application continuity.'

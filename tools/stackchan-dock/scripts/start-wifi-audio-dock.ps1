[CmdletBinding()]
param(
    [ValidateRange(1, 65535)]
    [int]$Port = 8765,

    [Nullable[bool]]$MicrophoneEnabled,

    [string]$SecretPath = (Join-Path $env:LOCALAPPDATA 'StackChan\secrets\wifi-audio-dock-key.dpapi'),

    [string]$LogDirectory = (Join-Path $env:LOCALAPPDATA 'StackChan\logs')
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $SecretPath -PathType Leaf)) {
    throw "Wi-Fi Audio Dock secret was not found at $SecretPath"
}

$dockDirectory = Split-Path -Parent $PSScriptRoot
$dockEntryPoint = Join-Path $dockDirectory 'bin\wifi-audio-dock.mjs'
if (-not (Test-Path -LiteralPath $dockEntryPoint -PathType Leaf)) {
    throw "Wi-Fi Audio Dock entry point was not found at $dockEntryPoint"
}

$existingListener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if ($existingListener) {
    throw "TCP port $Port already has a listener (PID $($existingListener[0].OwningProcess))"
}
$encryptedSecret = [System.IO.File]::ReadAllText($SecretPath).Trim()
$secureSecret = ConvertTo-SecureString $encryptedSecret
$secretPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureSecret)
$pairingKey = $null

try {
    $pairingKey = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($secretPointer)
    if ($pairingKey -notmatch '^[0-9a-fA-F]{64}$') {
        throw 'The decrypted Wi-Fi Audio Dock key is not a 256-bit hexadecimal value'
    }

    New-Item -ItemType Directory -Force -Path $LogDirectory | Out-Null
    $timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $stdoutPath = Join-Path $LogDirectory "wifi-audio-dock-$timestamp.stdout.log"
    $stderrPath = Join-Path $LogDirectory "wifi-audio-dock-$timestamp.stderr.log"
    $nodePath = (Get-Command node -ErrorAction Stop).Source
    $dockArguments = @($dockEntryPoint, '--port', $Port.ToString())
    if ($null -ne $MicrophoneEnabled) {
        $dockArguments += @('--microphone-enabled', ([bool]$MicrophoneEnabled).ToString().ToLowerInvariant())
    }

    $env:STACKCHAN_WIFI_PAIRING_KEY = $pairingKey
    $process = Start-Process `
        -FilePath $nodePath `
        -ArgumentList $dockArguments `
        -WorkingDirectory $dockDirectory `
        -RedirectStandardOutput $stdoutPath `
        -RedirectStandardError $stderrPath `
        -WindowStyle Hidden `
        -PassThru

    Start-Sleep -Milliseconds 750
    if ($process.HasExited) {
        $failure = if (Test-Path -LiteralPath $stderrPath) {
            [System.IO.File]::ReadAllText($stderrPath).Trim()
        } else {
            'no stderr was captured'
        }
        throw "Wi-Fi Audio Dock exited during startup: $failure"
    }

    [pscustomobject]@{
        ProcessId = $process.Id
        Port = $Port
        StdoutLog = $stdoutPath
        StderrLog = $stderrPath
        SecretProvider = 'Windows DPAPI current user'
    }
} finally {
    Remove-Item Env:\STACKCHAN_WIFI_PAIRING_KEY -ErrorAction SilentlyContinue
    $pairingKey = $null
    if ($secretPointer -ne [IntPtr]::Zero) {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($secretPointer)
    }
}

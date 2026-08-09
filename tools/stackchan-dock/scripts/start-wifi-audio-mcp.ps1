[CmdletBinding()]
param(
    [ValidateRange(1, 65535)]
    [int]$Port = 8765,

    [string]$SecretPath = (Join-Path $env:LOCALAPPDATA 'StackChan\secrets\wifi-audio-dock-key.dpapi')
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

    $nodePath = (Get-Command node -ErrorAction Stop).Source
    $env:STACKCHAN_WIFI_PAIRING_KEY = $pairingKey
    & $nodePath $dockEntryPoint '--port' $Port.ToString() '--mcp-stdio'
    if ($LASTEXITCODE -ne 0) {
        throw "Wi-Fi Audio MCP exited with code $LASTEXITCODE"
    }
} finally {
    Remove-Item Env:\STACKCHAN_WIFI_PAIRING_KEY -ErrorAction SilentlyContinue
    $pairingKey = $null
    if ($secretPointer -ne [IntPtr]::Zero) {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($secretPointer)
    }
}

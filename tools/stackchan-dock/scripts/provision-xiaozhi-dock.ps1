[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string]$BleAddress,

    [ValidatePattern('^\d{1,3}(\.\d{1,3}){3}$')]
    [string]$DeviceAddress = '192.168.0.8',

    [ValidateRange(1, 65535)]
    [int]$BootstrapPort = 8766,

    [string]$SecretPath = (Join-Path $env:LOCALAPPDATA 'StackChan\secrets\wifi-audio-dock-key.dpapi'),

    [switch]$Execute
)

$ErrorActionPreference = 'Stop'
function ConvertTo-StartProcessArgument([string]$Value) {
    if ($Value.Contains('"')) { throw 'Process arguments must not contain a double quote' }
    if ($Value -match '\s') { return '"' + $Value + '"' }
    return $Value
}

$dockDirectory = Split-Path -Parent $PSScriptRoot
$provisioner = Join-Path $dockDirectory 'scripts\ble-provision-wifi-audio.py'
foreach ($path in @($SecretPath, $provisioner)) {
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        throw "Required XiaoZhi provisioning component was not found at $path"
    }
}

# Derive the address from the route Windows already uses. No adapter, route,
# gateway, DNS, or Wi-Fi setting is changed by this script.
$route = @(Find-NetRoute -RemoteIPAddress $DeviceAddress -ErrorAction Stop)
if ($route.Count -eq 0 -or $route[0].IPAddress -notmatch '^\d{1,3}(\.\d{1,3}){3}$') {
    throw "No existing IPv4 route to StackChan $DeviceAddress was found"
}
$bootstrapUrl = "http://$($route[0].IPAddress):$BootstrapPort/xiaozhi/ota"
$preflight = [ordered]@{
    execute = [bool]$Execute
    ble_address = $BleAddress
    bootstrap_url = $bootstrapUrl
    secret_present = Test-Path -LiteralPath $SecretPath -PathType Leaf
    changes_pc_network = $false
    changes_robot_wifi_credentials = $false
    writes_robot_xiaozhi_bootstrap = [bool]$Execute
}
if (-not $Execute) {
    $preflight | ConvertTo-Json
    return
}

$encryptedSecret = [System.IO.File]::ReadAllText($SecretPath).Trim()
$secureSecret = ConvertTo-SecureString $encryptedSecret
$secretPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureSecret)
$token = $null
try {
    $token = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($secretPointer)
    if ($token -notmatch '^[0-9a-fA-F]{64}$') {
        throw 'The decrypted StackChan XiaoZhi token is not a 256-bit hexadecimal value'
    }
    $python = (Get-Command python -ErrorAction Stop).Source
    $arguments = @(
        $provisioner,
        '--address', $BleAddress,
        '--endpoint', $bootstrapUrl
    ) | ForEach-Object { ConvertTo-StartProcessArgument ([string]$_) }
    $process = Start-Process -FilePath $python -ArgumentList $arguments -NoNewWindow -Wait -PassThru `
        -Environment @{ STACKCHAN_WIFI_PAIRING_KEY = $token }
    if ($process.ExitCode -ne 0) {
        throw "StackChan XiaoZhi BLE provisioning failed with exit code $($process.ExitCode)"
    }
} finally {
    $token = $null
    if ($secretPointer -ne [IntPtr]::Zero) {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($secretPointer)
    }
}

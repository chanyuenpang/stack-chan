[CmdletBinding()]
param(
    [ValidatePattern('^\d{1,3}(\.\d{1,3}){3}$')]
    [string]$DeviceAddress = '192.168.0.8',

    [ValidateRange(1, 65535)]
    [int]$BootstrapPort = 8766,

    [string]$SecretPath = (Join-Path $env:LOCALAPPDATA 'StackChan\secrets\wifi-audio-dock-key.dpapi'),

    [switch]$Execute
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$dockDirectory = Split-Path -Parent $PSScriptRoot
$repositoryRoot = Split-Path -Parent (Split-Path -Parent $dockDirectory)
$remoteControl = Join-Path $repositoryRoot 'tools\remote_control\remote_control.py'
$deviceControlToken = 'stackchan-dev'

foreach ($path in @($SecretPath, $remoteControl)) {
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        throw "Required XiaoZhi provisioning component was not found at $path"
    }
}

# Read only the route already selected by Windows. This script never changes
# adapters, routes, gateways, DNS, PC Wi-Fi, or robot Wi-Fi credentials.
$route = @(Find-NetRoute -RemoteIPAddress $DeviceAddress -ErrorAction Stop)
if ($route.Count -eq 0 -or $route[0].IPAddress -notmatch '^\d{1,3}(\.\d{1,3}){3}$') {
    throw "No existing IPv4 route to StackChan $DeviceAddress was found"
}
$bootstrapUrl = "http://$($route[0].IPAddress):$BootstrapPort/xiaozhi/ota"
$status = Invoke-RestMethod -Uri "http://${DeviceAddress}:18080/dev/status" -Headers @{
    'X-StackChan-Dev-Token' = $deviceControlToken
} -TimeoutSec 5

$preflight = [ordered]@{
    execute = [bool]$Execute
    device_address = $DeviceAddress
    device_version = $status.version
    device_ip = $status.ip
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
$pairingToken = $null
try {
    $pairingToken = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($secretPointer)
    if ($pairingToken -notmatch '^[0-9a-fA-F]{64}$') {
        throw 'The decrypted StackChan XiaoZhi token is not a 256-bit hexadecimal value'
    }
    $python = (Get-Command python -ErrorAction Stop).Source
    $arguments = @(
        $remoteControl,
        '--ip', $DeviceAddress,
        'configure-xiaozhi-local',
        '--bootstrap-url', $bootstrapUrl
    )
    $process = Start-Process -FilePath $python -ArgumentList $arguments -NoNewWindow -Wait -PassThru `
        -Environment @{ STACKCHAN_WIFI_PAIRING_KEY = $pairingToken }
    if ($process.ExitCode -ne 0) {
        throw "StackChan XiaoZhi LAN provisioning failed with exit code $($process.ExitCode)"
    }
} finally {
    $pairingToken = $null
    if ($secretPointer -ne [IntPtr]::Zero) {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($secretPointer)
    }
}

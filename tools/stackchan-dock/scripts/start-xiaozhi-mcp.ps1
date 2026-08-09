[CmdletBinding()]
param(
    [ValidatePattern('^[0-9a-fA-F]{2}(:[0-9a-fA-F]{2}){5}$')]
    [string]$DeviceId = '44:1b:f6:e2:78:a8',

    [ValidatePattern('^\d{1,3}(\.\d{1,3}){3}$')]
    [string]$DeviceAddress = '192.168.0.8',

    [ValidateRange(1, 4294967295)]
    [uint32]$TargetProcessId,

    [ValidateRange(1, 65535)]
    [int]$WebSocketPort = 8765,

    [ValidateRange(1, 65535)]
    [int]$BootstrapPort = 8766,

    [string]$RenderDevice = 'CABLE Input',

    [string]$SecretPath = (Join-Path $env:LOCALAPPDATA 'StackChan\secrets\wifi-audio-dock-key.dpapi'),

    [string]$NativeTargetDirectory = (Join-Path $env:LOCALAPPDATA 'StackChan\build\process-loopback'),

    [switch]$Rebuild
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $SecretPath -PathType Leaf)) {
    throw "StackChan XiaoZhi token was not found at $SecretPath"
}

$dockDirectory = Split-Path -Parent $PSScriptRoot
$entryPoint = Join-Path $dockDirectory 'bin\xiaozhi-dock.mjs'
$nativeDirectory = Join-Path $dockDirectory 'native\process-loopback'
$manifestPath = Join-Path $nativeDirectory 'Cargo.toml'
$brokerPath = Join-Path $NativeTargetDirectory 'release\stackchan-wasapi-broker.exe'
foreach ($requiredPath in @($entryPoint, $manifestPath)) {
    if (-not (Test-Path -LiteralPath $requiredPath -PathType Leaf)) {
        throw "Required StackChan XiaoZhi component was not found at $requiredPath"
    }
}

foreach ($port in @($WebSocketPort, $BootstrapPort)) {
    $listener = @(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)
    if ($listener.Count -gt 0) {
        throw "TCP port $port already has a listener (PID $($listener[0].OwningProcess))"
    }
}

# Read the route Windows would already use for the robot. This does not change
# the PC network, route table, adapter, gateway, or DNS configuration.
$route = @(Find-NetRoute -RemoteIPAddress $DeviceAddress -ErrorAction Stop)
if ($route.Count -eq 0 -or $route[0].IPAddress -notmatch '^\d{1,3}(\.\d{1,3}){3}$') {
    throw "No existing IPv4 route to StackChan $DeviceAddress was found"
}
$advertiseHost = $route[0].IPAddress

if ($TargetProcessId -eq 0) {
    $chatProcesses = @(Get-CimInstance Win32_Process -Filter "Name = 'ChatGPT.exe'")
    $chatProcessIds = @($chatProcesses | ForEach-Object { [uint32]$_.ProcessId })
    $roots = @($chatProcesses | Where-Object { [uint32]$_.ParentProcessId -notin $chatProcessIds })
    if ($roots.Count -ne 1) {
        $rootIds = ($roots | ForEach-Object { $_.ProcessId }) -join ', '
        throw "Expected one Codex app root process, found $($roots.Count): $rootIds. Pass -TargetProcessId explicitly."
    }
    $TargetProcessId = [uint32]$roots[0].ProcessId
}
$target = Get-Process -Id $TargetProcessId -ErrorAction Stop
if ($target.ProcessName -ne 'ChatGPT' -and $target.ProcessName -ne 'python') {
    Write-Warning "Capturing process $TargetProcessId ($($target.ProcessName)); production normally targets ChatGPT.exe."
}

if ($Rebuild -or -not (Test-Path -LiteralPath $brokerPath -PathType Leaf)) {
    $cargo = (Get-Command cargo -ErrorAction Stop).Source
    & $cargo build --release --manifest-path $manifestPath --target-dir $NativeTargetDirectory
    if ($LASTEXITCODE -ne 0) {
        throw "StackChan WASAPI broker build failed with exit code $LASTEXITCODE"
    }
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

    $nodePath = (Get-Command node -ErrorAction Stop).Source
    $env:STACKCHAN_XIAOZHI_TOKEN = $token
    & $nodePath $entryPoint `
        '--device-id' $DeviceId.ToLowerInvariant() `
        '--advertise-host' $advertiseHost `
        '--codex-pid' $TargetProcessId.ToString() `
        '--broker' $brokerPath `
        '--websocket-port' $WebSocketPort.ToString() `
        '--bootstrap-port' $BootstrapPort.ToString() `
        '--render-device' $RenderDevice
    if ($LASTEXITCODE -ne 0) {
        throw "StackChan XiaoZhi MCP exited with code $LASTEXITCODE"
    }
} finally {
    Remove-Item Env:\STACKCHAN_XIAOZHI_TOKEN -ErrorAction SilentlyContinue
    $token = $null
    if ($secretPointer -ne [IntPtr]::Zero) {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($secretPointer)
    }
}

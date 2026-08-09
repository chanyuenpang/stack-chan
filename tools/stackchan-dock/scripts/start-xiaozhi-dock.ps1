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

    [string]$NativeTargetDirectory = 'D:\scab-target',

    [string]$OutputDirectory,

    [switch]$Rebuild
)

$ErrorActionPreference = 'Stop'
function ConvertTo-StartProcessArgument([string]$Value) {
    if ($Value.Contains('"')) {
        throw 'Process arguments must not contain a double quote'
    }
    if ($Value -match '\s') { return '"' + $Value + '"' }
    return $Value
}

$dockDirectory = Split-Path -Parent $PSScriptRoot
$repositoryRoot = Split-Path -Parent (Split-Path -Parent $dockDirectory)
if ([string]::IsNullOrWhiteSpace($OutputDirectory)) {
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $OutputDirectory = Join-Path $repositoryRoot ".claw\runtime\xiaozhi-dock-$stamp"
}
$entryPoint = Join-Path $dockDirectory 'bin\xiaozhi-dock.mjs'
$nativeDirectory = Join-Path $dockDirectory 'native\process-loopback'
$manifestPath = Join-Path $nativeDirectory 'Cargo.toml'
$brokerPath = Join-Path $NativeTargetDirectory 'release\stackchan-wasapi-broker.exe'

foreach ($requiredPath in @($SecretPath, $entryPoint, $manifestPath)) {
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

# Read only the route Windows already selected for the robot.
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
$null = Get-Process -Id $TargetProcessId -ErrorAction Stop

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
    New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
    $stdoutPath = Join-Path $OutputDirectory 'stdout.log'
    $stderrPath = Join-Path $OutputDirectory 'stderr.log'
    $arguments = @(
        $entryPoint,
        '--standalone',
        '--device-id', $DeviceId.ToLowerInvariant(),
        '--advertise-host', $advertiseHost,
        '--codex-pid', $TargetProcessId.ToString(),
        '--broker', $brokerPath,
        '--websocket-port', $WebSocketPort.ToString(),
        '--bootstrap-port', $BootstrapPort.ToString(),
        '--render-device', $RenderDevice
    ) | ForEach-Object { ConvertTo-StartProcessArgument ([string]$_) }
    $nodePath = (Get-Command node -ErrorAction Stop).Source
    $process = Start-Process -FilePath $nodePath -ArgumentList $arguments -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath `
        -Environment @{ STACKCHAN_XIAOZHI_TOKEN = $token }
    Start-Sleep -Milliseconds 750
    if ($process.HasExited) {
        $details = if (Test-Path -LiteralPath $stderrPath) { [System.IO.File]::ReadAllText($stderrPath) } else { '' }
        throw "StackChan XiaoZhi standalone Dock exited during startup: $details"
    }
    [pscustomobject]@{
        ProcessId = $process.Id
        BootstrapUrl = "http://${advertiseHost}:$BootstrapPort/xiaozhi/ota"
        WebSocketUrl = "ws://${advertiseHost}:$WebSocketPort/xiaozhi/v1"
        OutputDirectory = (Resolve-Path -LiteralPath $OutputDirectory).Path
        StdoutLog = $stdoutPath
        StderrLog = $stderrPath
    }
} finally {
    $token = $null
    if ($secretPointer -ne [IntPtr]::Zero) {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($secretPointer)
    }
}

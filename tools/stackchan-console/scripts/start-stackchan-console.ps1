[CmdletBinding()]
param(
    [string]$SecretPath = (Join-Path $env:LOCALAPPDATA 'StackChan\secrets\wifi-audio-dock-key.dpapi'),
    [switch]$Owner,
    [string]$DeviceId = '44:1b:f6:e2:78:a8',
    [string]$DeviceAddress = '192.168.0.8',
    [uint32]$TargetProcessId,
    [ValidateRange(0, 600)]
    [uint32]$WaitForCodexSeconds = 0,
    [string]$NativeTargetDirectory = 'D:\scab-target',
    [switch]$TimingDiagnostics,
    [switch]$CpuCorrelationDiagnostics,
    [switch]$SubtitleTrace
)

$ErrorActionPreference = 'Stop'
$consoleDirectory = Split-Path -Parent $PSScriptRoot
if (-not (Test-Path -LiteralPath $SecretPath -PathType Leaf)) { throw "StackChan secret was not found: $SecretPath" }
if (-not (Test-Path -LiteralPath (Join-Path $consoleDirectory 'package.json') -PathType Leaf)) { throw "StackChan console package was not found: $consoleDirectory" }
# Codex MCP and launcher contexts can omit PSModulePath, preventing automatic
# discovery of this inbox module even though DPAPI is available to this user.
$securityModule = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\Modules\Microsoft.PowerShell.Security\Microsoft.PowerShell.Security.psd1'
Import-Module -Name $securityModule -ErrorAction Stop

# Without -Owner the console is an observer only. Owner mode hosts the one
# Dock runtime, including the robot's authenticated OTA/bootstrap endpoint.
$encryptedSecret = [System.IO.File]::ReadAllText($SecretPath).Trim()
$secureSecret = ConvertTo-SecureString $encryptedSecret
$secretPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureSecret)
try {
    $token = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($secretPointer)
    if ($token -notmatch '^[0-9a-fA-F]{64}$') { throw 'The decrypted StackChan token is not a 256-bit hexadecimal value' }
    $env:STACKCHAN_XIAOZHI_TOKEN = $token
    if ($Owner) {
        $brokerPath = Join-Path $NativeTargetDirectory 'release\stackchan-wasapi-broker.exe'
        if (-not (Test-Path -LiteralPath $brokerPath -PathType Leaf)) { throw "StackChan broker was not found: $brokerPath" }
        foreach ($port in @(8765, 8766)) { if (@(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue).Count -gt 0) { throw "Dock port $port is still occupied" } }
        $route = @(Find-NetRoute -RemoteIPAddress $DeviceAddress -ErrorAction Stop)
        if ($route.Count -eq 0) { throw "No IPv4 route to StackChan $DeviceAddress" }
        if ($TargetProcessId -eq 0) {
            $deadline = (Get-Date).AddSeconds($WaitForCodexSeconds)
            do {
                $chatProcesses = @(Get-CimInstance Win32_Process -Filter "Name = 'ChatGPT.exe'")
                $chatProcessIds = @($chatProcesses | ForEach-Object { [uint32]$_.ProcessId })
                $roots = @($chatProcesses | Where-Object { [uint32]$_.ParentProcessId -notin $chatProcessIds })
                if ($roots.Count -eq 1) { break }
                if ((Get-Date) -ge $deadline) {
                    $rootIds = ($roots | ForEach-Object { $_.ProcessId }) -join ', '
                    throw "Expected one Codex app root process, found $($roots.Count): $rootIds. Start Codex, then start the Dock again."
                }
                Start-Sleep -Seconds 2
            } while ($true)
            $TargetProcessId = [uint32]$roots[0].ProcessId
        }
        $null = Get-Process -Id $TargetProcessId -ErrorAction Stop
        $env:STACKCHAN_CONSOLE_MODE = 'owner'; $env:STACKCHAN_DEVICE_ID = $DeviceId.ToLowerInvariant(); $env:STACKCHAN_DOCK_HOST = $route[0].IPAddress
        $env:STACKCHAN_WASAPI_BROKER = $brokerPath; $env:CODEX_ROOT_PID = $TargetProcessId.ToString()
        if ($TimingDiagnostics) { $env:STACKCHAN_TIMING_DIAGNOSTICS = '1' }
        if ($CpuCorrelationDiagnostics) { $env:STACKCHAN_CPU_CORRELATION_DIAGNOSTICS = '1'; $env:STACKCHAN_SUBTITLE_TRACE = '1'; $env:STACKCHAN_TIMING_DIAGNOSTICS = '1' }
        if ($SubtitleTrace) { $env:STACKCHAN_SUBTITLE_TRACE = '1' }
    }
    Push-Location -LiteralPath $consoleDirectory
    try { & npm exec -- electron . } finally { Pop-Location }
} finally {
    if ($secretPointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($secretPointer) }
    Remove-Item Env:STACKCHAN_XIAOZHI_TOKEN -ErrorAction SilentlyContinue
    Remove-Item Env:STACKCHAN_CONSOLE_MODE,Env:STACKCHAN_DEVICE_ID,Env:STACKCHAN_DOCK_HOST,Env:STACKCHAN_WASAPI_BROKER,Env:CODEX_ROOT_PID,Env:STACKCHAN_TIMING_DIAGNOSTICS,Env:STACKCHAN_SUBTITLE_TRACE,Env:STACKCHAN_CPU_CORRELATION_DIAGNOSTICS -ErrorAction SilentlyContinue
}

[CmdletBinding()]
param(
    [switch]$Execute,

    [ValidatePattern('^\d{1,3}(\.\d{1,3}){3}$')]
    [string]$DeviceAddress = '192.168.0.8',

    [ValidateRange(1, 65535)]
    [int]$WebSocketPort = 8765,

    [ValidateRange(1, 65535)]
    [int]$DevHttpPort = 18080,

    [ValidateRange(5, 30)]
    [int]$DurationSeconds = 10,

    [string]$CaptureDevice = 'CABLE Output',

    [string]$NativeTargetDirectory = 'D:\scab-target',

    [string]$OutputDirectory
)

$ErrorActionPreference = 'Stop'
function ConvertTo-StartProcessArgument([string]$Value) {
    if ($Value.Contains('"')) {
        throw 'Process arguments must not contain a double quote'
    }
    if ($Value -match '\s') { return '"' + $Value + '"' }
    return $Value
}

$repositoryRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$sourceWav = Join-Path $repositoryRoot 'firmware\main\assets\dev_serial\celebration-short-16k-mono-s16.wav'
$captureBinary = Join-Path $NativeTargetDirectory 'release\stackchan-wasapi-capture.exe'
$comparator = Join-Path $repositoryRoot 'tools\wifi_audio_analysis\compare_reference_pcm.py'
$remoteControl = Join-Path $repositoryRoot 'tools\remote_control\remote_control.py'
foreach ($path in @($sourceWav, $captureBinary, $comparator, $remoteControl)) {
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        throw "Required HIL component was not found at $path"
    }
}

$connections = @(
    Get-NetTCPConnection -LocalPort $WebSocketPort -RemoteAddress $DeviceAddress -State Established -ErrorAction SilentlyContinue
)
$devHttpReachable = Test-NetConnection -ComputerName $DeviceAddress -Port $DevHttpPort -InformationLevel Quiet -WarningAction SilentlyContinue
$preflight = [ordered]@{
    execute = [bool]$Execute
    device_address = $DeviceAddress
    websocket_port = $WebSocketPort
    authenticated_connection_present = $connections.Count -eq 1
    dev_http_port = $DevHttpPort
    dev_http_reachable = [bool]$devHttpReachable
    source_wav = $sourceWav
    capture_binary = $captureBinary
    capture_device = $CaptureDevice
    duration_seconds = $DurationSeconds
}
if (-not $Execute) {
    $preflight | ConvertTo-Json
    return
}
if ($connections.Count -ne 1) {
    throw "Expected exactly one authenticated StackChan TCP connection from $DeviceAddress to local port $WebSocketPort"
}
if (-not $devHttpReachable) {
    throw "StackChan development HTTP control is not reachable at ${DeviceAddress}:$DevHttpPort"
}

if ([string]::IsNullOrWhiteSpace($OutputDirectory)) {
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $OutputDirectory = Join-Path $repositoryRoot ".claw\runtime\xiaozhi-hil-$stamp"
}
New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
$capturePath = Join-Path $OutputDirectory 'known-source-cable-output-16k-s16le.pcm'
$captureStdout = Join-Path $OutputDirectory 'capture.stdout.log'
$captureStderr = Join-Path $OutputDirectory 'capture.stderr.log'
$analysisPath = Join-Path $OutputDirectory 'known-source-comparison.json'

$captureArguments = @(
    '--device', $CaptureDevice,
    '--sample-rate', '16000',
    '--duration', $DurationSeconds.ToString(),
    '--output', $capturePath
) | ForEach-Object { ConvertTo-StartProcessArgument ([string]$_) }
$capture = Start-Process -FilePath $captureBinary -ArgumentList $captureArguments -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput $captureStdout -RedirectStandardError $captureStderr
Start-Sleep -Milliseconds 1000
if ($capture.HasExited) {
    $details = if (Test-Path -LiteralPath $captureStderr) { [System.IO.File]::ReadAllText($captureStderr) } else { '' }
    throw "WASAPI capture exited before serial injection: $details"
}

try {
    $python = (Get-Command python -ErrorAction Stop).Source
    & $python $remoteControl '--ip' $DeviceAddress '--port' $DevHttpPort.ToString() 'inject-prompt'
    if ($LASTEXITCODE -ne 0) { throw "StackChan prompt injection failed with exit code $LASTEXITCODE" }
} catch {
    Stop-Process -Id $capture.Id -Force -ErrorAction SilentlyContinue
    throw
}

if (-not $capture.WaitForExit(($DurationSeconds + 8) * 1000)) {
    Stop-Process -Id $capture.Id -Force -ErrorAction SilentlyContinue
    throw 'WASAPI capture did not finish within the bounded HIL window'
}
if ($capture.ExitCode -ne 0) {
    $details = if (Test-Path -LiteralPath $captureStderr) { [System.IO.File]::ReadAllText($captureStderr) } else { '' }
    throw "WASAPI capture failed with exit code $($capture.ExitCode): $details"
}

& $python $comparator '--source' $sourceWav '--candidate' $capturePath '--sample-rate' '16000' '--output' $analysisPath
$comparisonExitCode = $LASTEXITCODE
$result = Get-Content -Raw -LiteralPath $analysisPath | ConvertFrom-Json
[pscustomobject]@{
    pass = ($comparisonExitCode -eq 0 -and [bool]$result.pass)
    source_wav = $sourceWav
    captured_pcm = $capturePath
    comparison = $analysisPath
    output_directory = (Resolve-Path -LiteralPath $OutputDirectory).Path
    time_scale = $result.time_scale
    envelope_correlation = $result.envelope_correlation
    sample_correlation = $result.sample_correlation
    fitted_snr_db = $result.fitted_snr_db
} | ConvertTo-Json
if ($comparisonExitCode -ne 0) {
    throw "Known-source XiaoZhi uplink HIL failed its reference-relative quality gate; see $analysisPath"
}

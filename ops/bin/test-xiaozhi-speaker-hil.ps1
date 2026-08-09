[CmdletBinding()]
param(
    [switch]$Execute,

    [ValidatePattern('^[0-9a-fA-F]{2}(:[0-9a-fA-F]{2}){5}$')]
    [string]$DeviceId = '44:1b:f6:e2:78:a8',

    [ValidatePattern('^\d{1,3}(\.\d{1,3}){3}$')]
    [string]$DeviceAddress = '192.168.0.8',

    [ValidateRange(1, 65535)]
    [int]$WebSocketPort = 8765,

    [ValidateRange(1, 65535)]
    [int]$BootstrapPort = 8766,

    [ValidateRange(5, 30)]
    [int]$AuthenticationTimeoutSeconds = 10,

    [string]$FixtureRenderDevice = 'CABLE Input',

    [string]$RobotMicrophoneRenderDevice = 'CABLE Input',

    [string]$NativeTargetDirectory = 'D:\scab-target',

    [string]$OutputDirectory
)

$ErrorActionPreference = 'Stop'
function ConvertTo-StartProcessArgument([string]$Value) {
    if ($Value.Contains('"')) { throw 'Process arguments must not contain a double quote' }
    if ($Value -match '\s') { return '"' + $Value + '"' }
    return $Value
}

$repositoryRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$sourceWav = Join-Path $repositoryRoot 'firmware\main\assets\dev_serial\celebration-short-16k-mono-s16.wav'
$extractor = Join-Path $repositoryRoot 'tools\wifi_audio_analysis\extract_wave_pcm.py'
$playBinary = Join-Path $NativeTargetDirectory 'release\stackchan-wasapi-play.exe'
$dockScript = Join-Path $repositoryRoot 'tools\stackchan-dock\scripts\start-xiaozhi-dock.ps1'
$remoteControl = Join-Path $repositoryRoot 'tools\remote_control\remote_control.py'
foreach ($path in @($sourceWav, $extractor, $playBinary, $dockScript, $remoteControl)) {
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        throw "Required speaker HIL component was not found at $path"
    }
}
$listeners = @(Get-NetTCPConnection -LocalPort $WebSocketPort,$BootstrapPort -State Listen -ErrorAction SilentlyContinue)
$preflight = [ordered]@{
    execute = [bool]$Execute
    device_address = $DeviceAddress
    ports_available = $listeners.Count -eq 0
    source_wav = $sourceWav
    play_binary = $playBinary
    fixture_render_device = $FixtureRenderDevice
    authentication_timeout_seconds = $AuthenticationTimeoutSeconds
    user_listening_required = $true
}
if (-not $Execute) {
    $preflight | ConvertTo-Json
    return
}
if ($listeners.Count -ne 0) {
    throw 'The XiaoZhi speaker HIL requires exclusive ownership of its WebSocket and bootstrap ports'
}

if ([string]::IsNullOrWhiteSpace($OutputDirectory)) {
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $OutputDirectory = Join-Path $repositoryRoot ".claw\runtime\xiaozhi-speaker-hil-$stamp"
}
New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
$sourcePcm = Join-Path $OutputDirectory 'speaker-source-16k-mono-s16le.pcm'
$python = (Get-Command python -ErrorAction Stop).Source
& $python $extractor '--source' $sourceWav '--output' $sourcePcm '--sample-rate' '16000'
if ($LASTEXITCODE -ne 0) { throw "Speaker fixture extraction failed with exit code $LASTEXITCODE" }

$fixtureStdout = Join-Path $OutputDirectory 'fixture.stdout.log'
$fixtureStderr = Join-Path $OutputDirectory 'fixture.stderr.log'
$delayMilliseconds = ($AuthenticationTimeoutSeconds + 2) * 1000
$fixtureArguments = @(
    '--device', $FixtureRenderDevice,
    '--sample-rate', '16000',
    '--input', $sourcePcm,
    '--start-delay-ms', $delayMilliseconds.ToString()
) | ForEach-Object { ConvertTo-StartProcessArgument ([string]$_) }
$fixture = Start-Process -FilePath $playBinary -ArgumentList $fixtureArguments -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput $fixtureStdout -RedirectStandardError $fixtureStderr

$dock = $null
try {
    $dockOutput = Join-Path $OutputDirectory 'dock'
    $dock = & $dockScript -DeviceId $DeviceId -DeviceAddress $DeviceAddress `
        -TargetProcessId $fixture.Id -WebSocketPort $WebSocketPort -BootstrapPort $BootstrapPort `
        -RenderDevice $RobotMicrophoneRenderDevice -NativeTargetDirectory $NativeTargetDirectory `
        -OutputDirectory $dockOutput
    & $python $remoteControl '--ip' $DeviceAddress 'wake'
    if ($LASTEXITCODE -ne 0) {
        throw "StackChan wake request failed before the speaker authentication gate"
    }
    $deadline = [DateTime]::UtcNow.AddSeconds($AuthenticationTimeoutSeconds)
    $authenticated = $false
    while ([DateTime]::UtcNow -lt $deadline) {
        $authenticated = @(Get-NetTCPConnection -LocalPort $WebSocketPort -RemoteAddress $DeviceAddress -State Established -ErrorAction SilentlyContinue).Count -eq 1
        if ($authenticated) { break }
        Start-Sleep -Milliseconds 200
    }
    if (-not $authenticated) {
        throw "StackChan did not authenticate before the bounded speaker fixture deadline"
    }
    if (-not $fixture.WaitForExit(($AuthenticationTimeoutSeconds + 10) * 1000)) {
        throw 'The bounded speaker fixture did not finish'
    }
    if ($fixture.ExitCode -ne 0) {
        $details = if (Test-Path -LiteralPath $fixtureStderr) { [System.IO.File]::ReadAllText($fixtureStderr) } else { '' }
        throw "Speaker fixture failed with exit code $($fixture.ExitCode): $details"
    }
    Start-Sleep -Seconds 2
    $dockStderr = Get-Content -Raw -LiteralPath $dock.StderrLog
    if ($dockStderr -notmatch 'half_duplex_speaking=true' -or $dockStderr -notmatch 'half_duplex_speaking=false') {
        throw "Speaker fixture ended without a complete XiaoZhi speaking lifecycle; see $($dock.StderrLog)"
    }
    if ($dockStderr -match 'runtime error|disconnected code=') {
        throw "XiaoZhi runtime reported an error or disconnect during the speaker fixture; see $($dock.StderrLog)"
    }
    [pscustomobject]@{
        automated_transport_complete = $true
        user_listening_required = $true
        source_wav = $sourceWav
        dock_process_id = $dock.ProcessId
        fixture_process_id = $fixture.Id
        output_directory = (Resolve-Path -LiteralPath $OutputDirectory).Path
    } | ConvertTo-Json
} finally {
    if (-not $fixture.HasExited) { Stop-Process -Id $fixture.Id -Force -ErrorAction SilentlyContinue }
    if ($null -ne $dock) {
        $children = @(Get-CimInstance Win32_Process | Where-Object ParentProcessId -eq $dock.ProcessId | Select-Object -ExpandProperty ProcessId)
        Stop-Process -Id $dock.ProcessId -Force -ErrorAction SilentlyContinue
        Start-Sleep -Milliseconds 300
        foreach ($child in $children) { Stop-Process -Id $child -Force -ErrorAction SilentlyContinue }
    }
}

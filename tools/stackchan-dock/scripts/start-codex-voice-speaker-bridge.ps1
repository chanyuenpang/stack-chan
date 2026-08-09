[CmdletBinding()]
param(
    [ValidateRange(1, 4294967295)]
    [uint32]$TargetProcessId,

    [string]$PipePath = '\\.\pipe\stackchan-wifi-speaker',

    [string]$LogDirectory = (Join-Path $env:LOCALAPPDATA 'StackChan\logs'),

    [switch]$Rebuild
)

$ErrorActionPreference = 'Stop'

$dockDirectory = Split-Path -Parent $PSScriptRoot
$nativeDirectory = Join-Path $dockDirectory 'native\process-loopback'
$bridgePath = Join-Path $nativeDirectory 'target\release\stackchan-process-loopback.exe'

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
    Write-Warning "Capturing process $TargetProcessId ($($target.ProcessName)); production normally targets the Codex app root ChatGPT.exe."
}

if ($Rebuild -or -not (Test-Path -LiteralPath $bridgePath -PathType Leaf)) {
    $cargo = (Get-Command cargo -ErrorAction Stop).Source
    & $cargo build --release --manifest-path (Join-Path $nativeDirectory 'Cargo.toml')
    if ($LASTEXITCODE -ne 0) {
        throw "Process-loopback release build failed with exit code $LASTEXITCODE"
    }
}

$existing = @(Get-CimInstance Win32_Process | Where-Object {
    $_.Name -eq 'stackchan-process-loopback.exe' -and $_.CommandLine -like "*--pipe*$PipePath*"
})
if ($existing.Count -gt 0) {
    $ids = ($existing | ForEach-Object { $_.ProcessId }) -join ', '
    throw "A Codex Voice speaker bridge is already using $PipePath (PID $ids)."
}

New-Item -ItemType Directory -Force -Path $LogDirectory | Out-Null
$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$stdoutPath = Join-Path $LogDirectory "codex-voice-speaker-bridge-$timestamp.stdout.log"
$stderrPath = Join-Path $LogDirectory "codex-voice-speaker-bridge-$timestamp.stderr.log"
$arguments = @(
    '--pid', $TargetProcessId.ToString(),
    '--pipe', $PipePath,
    '--gate-threshold', '64',
    '--pre-roll-ms', '20',
    '--hangover-ms', '300'
)

$process = Start-Process `
    -FilePath $bridgePath `
    -ArgumentList $arguments `
    -WorkingDirectory $nativeDirectory `
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
    throw "Codex Voice speaker bridge exited during startup: $failure"
}

[pscustomobject]@{
    ProcessId = $process.Id
    CapturedProcessId = $TargetProcessId
    PipePath = $PipePath
    StdoutLog = $stdoutPath
    StderrLog = $stderrPath
}

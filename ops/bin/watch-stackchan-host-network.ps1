[CmdletBinding()]
param(
    [int[]]$Ports = @(8765, 8766),
    [int]$PollMilliseconds = 500,
    [int]$MaxSamples = 0,
    [string]$TracePath = 'D:\Users\chany\Documents\StackChan\tools\stackchan-console\logs\subtitle-trace-live.ndjson',
    [string]$LogPath = 'D:\Users\chany\Documents\StackChan\.claw\runtime\stackchan-host-network-watch.ndjson'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if ($PollMilliseconds -lt 100) { throw 'PollMilliseconds must be at least 100' }
if ($MaxSamples -lt 0) { throw 'MaxSamples must be zero (forever) or positive' }
if (@($Ports | Where-Object { $_ -lt 1 -or $_ -gt 65535 }).Count -gt 0) { throw 'Ports must be valid TCP ports' }

$directory = Split-Path -Parent $LogPath
New-Item -ItemType Directory -Force -Path $directory | Out-Null

function Write-Event([string]$Event, [hashtable]$Fields = @{}) {
    $record = [ordered]@{ at = (Get-Date).ToUniversalTime().ToString('o'); source = 'host_network_watch'; event = $Event }
    foreach ($key in $Fields.Keys) { $record[$key] = $Fields[$key] }
    ($record | ConvertTo-Json -Compress -Depth 5) | Add-Content -LiteralPath $LogPath -Encoding utf8
}

function Get-ProcessSnapshot {
    $owner = @(Get-CimInstance Win32_Process -Filter "Name='electron.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -match 'stackchan-console' } |
        ForEach-Object { [ordered]@{ pid = [int]$_.ProcessId; created = $_.CreationDate } })
    $broker = @(Get-CimInstance Win32_Process -Filter "Name='stackchan-wasapi-broker.exe'" -ErrorAction SilentlyContinue |
        ForEach-Object { [ordered]@{ pid = [int]$_.ProcessId; created = $_.CreationDate } })
    return [ordered]@{ owner = @($owner); broker = @($broker) }
}

function Get-NetworkSnapshot {
    $connections = @(Get-NetTCPConnection -ErrorAction SilentlyContinue |
        Where-Object { $_.LocalPort -in $Ports -or $_.RemotePort -in $Ports } |
        Sort-Object State, LocalPort, RemoteAddress, RemotePort |
        ForEach-Object { [ordered]@{ state = $_.State.ToString(); local = "$($_.LocalAddress):$($_.LocalPort)"; remote = "$($_.RemoteAddress):$($_.RemotePort)"; pid = [int]$_.OwningProcess } })
    return @($connections)
}

function Get-StackChanUsbSnapshot {
    return @(Get-PnpDevice -PresentOnly -ErrorAction SilentlyContinue |
        Where-Object { $_.InstanceId -match 'VID_303A&PID_1001' } |
        Sort-Object InstanceId |
        ForEach-Object { [ordered]@{ status = $_.Status; class = $_.Class; name = $_.FriendlyName; instance_id = $_.InstanceId } })
}

function Get-LastRelevantTrace {
    if (-not (Test-Path -LiteralPath $TracePath -PathType Leaf)) { return $null }
    $last = Get-Content -LiteralPath $TracePath -Tail 400 -ErrorAction Stop |
        Where-Object { $_ -match '"source":"(?:broker|voice_status|websocket)"' } |
        Select-Object -Last 1
    if (-not $last) { return $null }
    try {
        $entry = $last | ConvertFrom-Json
        $value = { param([string]$name) if ($entry.PSObject.Properties.Name -contains $name) { $entry.$name } else { $null } }
        return [ordered]@{ at = & $value 'at'; source = & $value 'source'; event = & $value 'event'; state = & $value 'state'; reason = & $value 'reason'; error = & $value 'error'; message = & $value 'message'; bytes = & $value 'bytes' }
    } catch {
        return [ordered]@{ parse_error = $_.Exception.Message; line_length = $last.Length }
    }
}

$previous = $null
$previousTrace = $null
$samples = 0
Write-Event 'started' @{ ports = @($Ports); poll_ms = $PollMilliseconds; trace_path = $TracePath; pid = $PID }
try {
    while ($MaxSamples -eq 0 -or $samples -lt $MaxSamples) {
        $snapshot = [ordered]@{ usb = @(Get-StackChanUsbSnapshot); network = @(Get-NetworkSnapshot); processes = Get-ProcessSnapshot }
        $fingerprint = $snapshot | ConvertTo-Json -Compress -Depth 6
        if ($fingerprint -ne $previous) {
            Write-Event 'state_changed' @{ snapshot = $snapshot }
            $previous = $fingerprint
        }
        $trace = Get-LastRelevantTrace
        $traceFingerprint = if ($null -eq $trace) { '' } else { $trace | ConvertTo-Json -Compress -Depth 4 }
        if ($traceFingerprint -ne $previousTrace) {
            Write-Event 'trace_tail_changed' @{ trace = $trace }
            $previousTrace = $traceFingerprint
        }
        $samples += 1
        if ($MaxSamples -eq 0 -or $samples -lt $MaxSamples) { Start-Sleep -Milliseconds $PollMilliseconds }
    }
    Write-Event 'stopped' @{ reason = if ($MaxSamples -eq 0) { 'external_stop' } else { 'max_samples' }; samples = $samples }
} catch {
    Write-Event 'watch_error' @{ message = $_.Exception.Message; samples = $samples }
    throw
}

[CmdletBinding()]
param(
    [ValidateRange(0, 100)]
    [int]$Volume,
    [string]$SecretPath = (Join-Path $env:LOCALAPPDATA 'StackChan\secrets\wifi-audio-dock-key.dpapi'),
    [string]$PipeName = 'stackchan-xiaozhi-admin'
)

$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath $SecretPath -PathType Leaf)) { throw "StackChan secret was not found: $SecretPath" }
$encrypted = [System.IO.File]::ReadAllText($SecretPath).Trim()
$secure = ConvertTo-SecureString $encrypted
$ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try {
    $token = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
    if ($token -notmatch '^[0-9a-fA-F]{64}$') { throw 'StackChan secret is invalid' }
    $client = [System.IO.Pipes.NamedPipeClientStream]::new('.', $PipeName, [System.IO.Pipes.PipeDirection]::InOut)
    try {
        $client.Connect(2000)
        $writer = [System.IO.StreamWriter]::new($client, [Text.Encoding]::UTF8, 1024, $true)
        $writer.AutoFlush = $true
        $reader = [System.IO.StreamReader]::new($client, [Text.Encoding]::UTF8, $false, 1024, $true)
        $writer.WriteLine((@{ token = $token; operation = 'set-speaker-volume'; volume = $Volume } | ConvertTo-Json -Compress))
        $reply = $reader.ReadLine() | ConvertFrom-Json
        if (-not $reply.ok) { throw "StackChan volume command failed: $($reply.error)" }
        if ([int]$reply.result.volume -ne $Volume) { throw "StackChan volume verification failed: expected $Volume, got $($reply.result.volume)" }
        [pscustomobject]@{ Volume = [int]$reply.result.volume; Verified = $true }
    } finally { $client.Dispose() }
} finally {
    $token = $null
    if ($ptr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}

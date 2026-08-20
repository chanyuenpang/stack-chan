[CmdletBinding()]
param(
    [string]$SecretPath = (Join-Path $env:LOCALAPPDATA 'StackChan\secrets\wifi-audio-dock-key.dpapi'),
    [string]$NodePath = 'node.exe'
)

$ErrorActionPreference = 'Stop'
if ([string]::IsNullOrWhiteSpace($env:PATHEXT)) { $env:PATHEXT = '.COM;.EXE;.BAT;.CMD' }
if (-not (Test-Path -LiteralPath $SecretPath -PathType Leaf)) { throw "StackChan secret was not found: $SecretPath" }
$securityModule = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\Modules\Microsoft.PowerShell.Security\Microsoft.PowerShell.Security.psd1'
Import-Module -Name $securityModule -ErrorAction Stop
$encrypted = [System.IO.File]::ReadAllText($SecretPath).Trim()
$secure = ConvertTo-SecureString $encrypted
$ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try {
    $token = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
    if ($token -notmatch '^[0-9a-fA-F]{64}$') { throw 'StackChan secret is invalid' }
    $env:STACKCHAN_XIAOZHI_TOKEN = $token
    $entrypoint = Join-Path (Split-Path -Parent $PSScriptRoot) 'bin\stackchan-mcp.mjs'
    & $NodePath $entrypoint
    exit $LASTEXITCODE
}
finally {
    $token = $null
    Remove-Item Env:STACKCHAN_XIAOZHI_TOKEN -ErrorAction SilentlyContinue
    if ($ptr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}

[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$launcherDirectory = $PSScriptRoot
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$source = Join-Path $launcherDirectory 'StackChanDockLauncher.cs'
$output = Join-Path $launcherDirectory 'StackChan-Dock-Launcher.exe'

foreach ($path in @($compiler, $source)) {
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "StackChan launcher build input was not found: $path" }
}

& $compiler /nologo /target:winexe /out:$output /reference:System.Windows.Forms.dll /reference:System.dll /reference:System.Core.dll $source
if ($LASTEXITCODE -ne 0) { throw "StackChan launcher compilation failed with exit code $LASTEXITCODE" }
$sha256 = [System.Security.Cryptography.SHA256]::Create()
try {
    $stream = [System.IO.File]::OpenRead($output)
    try { $hash = ([System.BitConverter]::ToString($sha256.ComputeHash($stream))).Replace('-', '') } finally { $stream.Dispose() }
} finally {
    $sha256.Dispose()
}
[pscustomobject]@{ Path = $output; Hash = $hash }

[CmdletBinding()]
param(
    [string]$ShortcutName = 'StackChan Dock.lnk',
    [uint32]$WaitForCodexSeconds = 120
)

$ErrorActionPreference = 'Stop'
if ($WaitForCodexSeconds -gt 600) { throw 'WaitForCodexSeconds must be between 0 and 600' }

$consoleDirectory = Split-Path -Parent $PSScriptRoot
$startScript = Join-Path $PSScriptRoot 'start-stackchan-console.ps1'
foreach ($path in @($startScript, (Join-Path $consoleDirectory 'package.json'))) {
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "StackChan Dock component was not found: $path" }
}

# A Startup-folder shortcut runs only in the interactive user's session and
# does not require Task Scheduler permissions. The start script decrypts the
# current-user DPAPI secret itself, so no token is stored in the shortcut,
# command line, or logs.
$quotedScript = '"' + $startScript.Replace('"', '""') + '"'
$arguments = "-NoProfile -ExecutionPolicy Bypass -File $quotedScript -Owner -WaitForCodexSeconds $WaitForCodexSeconds"
$startupDirectory = [Environment]::GetFolderPath([Environment+SpecialFolder]::Startup)
$shortcutPath = Join-Path $startupDirectory $ShortcutName
$shell = New-Object -ComObject WScript.Shell
try {
    $shortcut = $shell.CreateShortcut($shortcutPath)
    $shortcut.TargetPath = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
    $shortcut.Arguments = $arguments
    $shortcut.WorkingDirectory = $consoleDirectory
    $shortcut.WindowStyle = 7
    $shortcut.Description = 'Starts the StackChan Electron Dock owner at user sign-in.'
    $shortcut.Save()
} finally {
    [void][Runtime.InteropServices.Marshal]::ReleaseComObject($shell)
}
Get-Item -LiteralPath $shortcutPath | Select-Object FullName, Length, LastWriteTime

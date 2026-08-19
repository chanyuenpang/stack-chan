[CmdletBinding()]
param(
    [string]$PortName = 'COM7',
    [string]$LogPath = 'D:\Users\chany\Documents\StackChan\.claw\runtime\stackchan-com7-watch.log'
)

# Permanently disabled: opening the ESP32-S3 USB serial endpoint produced a
# USB_UART_CHIP_RESET despite DTR/RTS being false.  Use the PnP + Host monitor
# instead; this script must never touch COM7 automatically.
throw 'watch-stackchan-com7.ps1 is disabled: use watch-stackchan-host-network.ps1 (PnP + Host only).'

# Passive crash capture only: no serial writes and no DTR/RTS assertions.
$directory = Split-Path -Parent $LogPath
New-Item -ItemType Directory -Force -Path $directory | Out-Null
function Write-WatchLine([string]$line) {
    ('[{0:o}] {1}' -f (Get-Date), $line) | Add-Content -LiteralPath $LogPath -Encoding utf8
}

while ($true) {
    $serial = [System.IO.Ports.SerialPort]::new($PortName, 115200, [System.IO.Ports.Parity]::None, 8, [System.IO.Ports.StopBits]::One)
    $serial.DtrEnable = $false
    $serial.RtsEnable = $false
    try {
        $serial.Open()
        Write-WatchLine "opened $PortName read-only dtr=false rts=false"
        while ($serial.IsOpen) {
            $chunk = $serial.ReadExisting()
            if ($chunk) { Write-WatchLine $chunk }
            Start-Sleep -Milliseconds 100
        }
    } catch {
        Write-WatchLine ("serial_error: " + $_.Exception.Message)
    } finally {
        if ($serial.IsOpen) { $serial.Close() }
        $serial.Dispose()
        Write-WatchLine "closed $PortName; retrying passive open in 2s"
    }
    Start-Sleep -Seconds 2
}

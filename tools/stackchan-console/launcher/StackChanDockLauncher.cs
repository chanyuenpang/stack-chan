using System;
using System.Diagnostics;
using System.IO;
using System.Net.NetworkInformation;
using System.Threading;
using System.Windows.Forms;

namespace StackChanDockLauncher
{
    internal static class Program
    {
        private const string LauncherMutexName = "Local\\StackChan-Dock-Launcher";
        private const int StartupTimeoutMilliseconds = 20000;

        [STAThread]
        private static void Main()
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            bool createdNew;
            using (var mutex = new Mutex(true, LauncherMutexName, out createdNew))
            {
                if (!createdNew)
                {
                    ShowError("StackChan Dock is already starting. Please wait a moment.");
                    return;
                }

                try
                {
                    StartOwner();
                }
                catch (Exception error)
                {
                    ShowError("StackChan Dock could not start.\r\n\r\n" + SafeMessage(error.Message));
                }
            }
        }

        private static void StartOwner()
        {
            if (IsListening(8765) || IsListening(8766))
            {
                ShowError("StackChan Dock is already running (port 8765 or 8766 is in use).\r\nIt was not started a second time.");
                return;
            }

            var launcherDirectory = AppDomain.CurrentDomain.BaseDirectory;
            var startScript = Path.GetFullPath(Path.Combine(launcherDirectory, "..", "scripts", "start-stackchan-console.ps1"));
            if (!File.Exists(startScript))
            {
                throw new FileNotFoundException("The official StackChan startup script was not found.", startScript);
            }

            var process = new Process();
            process.StartInfo = new ProcessStartInfo
            {
                FileName = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "WindowsPowerShell\\v1.0\\powershell.exe"),
                Arguments = "-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File " + Quote(startScript) + " -Owner",
                // The owner is long-lived.  Do not redirect its standard streams
                // through this short-lived GUI launcher: when this process exits,
                // Electron would otherwise inherit a broken pipe and an ordinary
                // IPC error reply could become an unhandled EPIPE.
                UseShellExecute = true,
                CreateNoWindow = true,
                WindowStyle = ProcessWindowStyle.Hidden,
                WorkingDirectory = Path.GetDirectoryName(startScript)
            };

            if (!process.Start()) throw new InvalidOperationException("Windows could not create the Dock startup process.");

            var deadline = Environment.TickCount + StartupTimeoutMilliseconds;
            while (unchecked(Environment.TickCount - deadline) < 0)
            {
                if (IsListening(8765) && IsListening(8766)) return;
                if (process.HasExited)
                {
                    process.WaitForExit();
                    throw new InvalidOperationException("The official startup script exited before the Dock opened.");
                }
                Thread.Sleep(250);
            }

            if (process.HasExited)
            {
                throw new InvalidOperationException("The official startup script exited before the Dock opened.");
            }
            throw new TimeoutException("Dock startup did not open ports 8765 and 8766 within 20 seconds.");
        }

        private static bool IsListening(int port)
        {
            foreach (var endpoint in IPGlobalProperties.GetIPGlobalProperties().GetActiveTcpListeners())
            {
                if (endpoint.Port == port) return true;
            }
            return false;
        }

        private static string Quote(string value)
        {
            return "\"" + value.Replace("\"", "\\\"") + "\"";
        }

        private static string SafeMessage(string message)
        {
            if (String.IsNullOrWhiteSpace(message)) return "Unknown startup error.";
            var redacted = System.Text.RegularExpressions.Regex.Replace(message, "(?i)\\b[0-9a-f]{64}\\b", "[redacted token]");
            return redacted.Length <= 1800 ? redacted : redacted.Substring(0, 1800) + "\r\n[message truncated]";
        }

        private static void ShowError(string message)
        {
            MessageBox.Show(SafeMessage(message), "StackChan Dock", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }
}

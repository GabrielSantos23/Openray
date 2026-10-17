// Auto Quit — quits installed applications once they have not been used for a while.
//
// A 30-second tick tracks which process owns the foreground window; any installed application
// (an entry of the applications scan) whose windows have not been foreground for the configured
// delay is closed gracefully. System surfaces, the launcher itself and apps that prompt on close
// (CloseMainWindow returns false) are left alone; a declined close is simply retried on a later
// tick like Raycast's quit attempt.

using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Runtime.InteropServices;
using System.Windows.Threading;

namespace Openray.Launcher;

public static class AutoQuit
{
    private static readonly Dictionary<int, DateTimeOffset> LastActive = new();
    private static readonly HashSet<int> QuitRequested = new();

    /// <summary>Processes that must never be Auto-Quit, whatever the scan says.</summary>
    private static readonly HashSet<string> NeverQuit = new(StringComparer.OrdinalIgnoreCase)
    { "openray", "msedgewebview2", "node", "explorer", "applicationframehost", "searchhost",
      "startmenuexperiencehost", "shellexperiencehost", "textinputhost", "runtimebroker",
      "widgets", "gamebar", "svchost", "dllhost", "ctfmon", "dwm" };

    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);

    public static void Start(Dispatcher dispatcher)
    {
        var timer = new DispatcherTimer(DispatcherPriority.Background)
        {
            Interval = TimeSpan.FromSeconds(30),
        };
        timer.Tick += (_, _) => _ = TickAsync();
        dispatcher.BeginInvoke(() => timer.Start());
    }

    private static async Task TickAsync()
    {
        try
        {
            if (MainWindow.ReadStoredSetting("applications-auto-quit-enabled") is not true) return;
            var delay = DelayFor();
            var now = DateTimeOffset.UtcNow;

            var foregroundPid = -1;
            var foreground = GetForegroundWindow();
            if (foreground != IntPtr.Zero)
            {
                _ = GetWindowThreadProcessId(foreground, out var ownerPid);
                foregroundPid = (int)ownerPid;
                LastActive[foregroundPid] = now;
            }

            // Only applications from the scan are candidates, so system surfaces and infrastructure
            // processes are out of scope by construction.
            var apps = await Applications.GetAllAsync();
            var paths = new HashSet<string>(
                apps.Where(a => a.Path is not null).Select(a => a.Path!),
                StringComparer.OrdinalIgnoreCase);

            foreach (var process in Process.GetProcesses())
            {
                try
                {
                    if (process.Id == Environment.ProcessId) continue;
                    if (process.SessionId != Process.GetCurrentProcess().SessionId) continue;
                    if (NeverQuit.Contains(process.ProcessName)) continue;
                    if (process.MainWindowHandle == IntPtr.Zero) continue;
                    var modulePath = process.MainModule?.FileName;
                    if (modulePath is null || !paths.Contains(modulePath)) continue;

                    if (process.Id == foregroundPid) LastActive[process.Id] = now;
                    if (!LastActive.TryGetValue(process.Id, out var lastActive))
                    {
                        LastActive[process.Id] = now;
                        continue;
                    }
                    if (now - lastActive < delay) continue;
                    if (!QuitRequested.Add(process.Id)) continue;

                    var accepted = false;
                    try { accepted = process.CloseMainWindow(); } catch { /* already gone */ }
                    Openray.Launcher.App.Log.Write(
                        $"[auto-quit] {process.ProcessName} (pid {process.Id}) idle {(now - lastActive).TotalMinutes:F0}m -> {(accepted ? "close requested" : "close declined")}");
                }
                catch
                {
                    /* process exited or access denied */
                }
                finally
                {
                    process.Dispose();
                }
            }

            // Forget dead pids so the dictionaries cannot grow unbounded.
            foreach (var pid in LastActive.Keys.Where(pid => !IsAlive(pid)).ToList())
            {
                _ = LastActive.Remove(pid);
                _ = QuitRequested.Remove(pid);
            }
        }
        catch (Exception error)
        {
            Openray.Launcher.App.Log.Write($"[auto-quit] tick failed: {error.Message}");
        }
    }

    private static TimeSpan DelayFor()
    {
        var label = MainWindow.ReadStoredSetting("applications-auto-quit-delay") as string;
        return label switch
        {
            "After 1 minute" => TimeSpan.FromMinutes(1),
            "After 10 minutes" => TimeSpan.FromMinutes(10),
            "After 30 minutes" => TimeSpan.FromMinutes(30),
            "After 1 hour" => TimeSpan.FromHours(1),
            _ => TimeSpan.FromMinutes(5),
        };
    }

    private static bool IsAlive(int pid)
    {
        try
        {
            using var process = Process.GetProcessById(pid);
            return !process.HasExited;
        }
        catch
        {
            return false;
        }
    }
}

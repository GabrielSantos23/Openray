// Game Mode host surface (`games.setGameMode`), docs/focus-games-taskbar-spec.md §B.
//
// The shipped mechanism suppresses Raycast hotkeys while a game window is foreground
// ("Game in foreground: {IsGameInForeground}" / "Failed to set hotkeys suppressed={Suppressed}");
// the exact trigger scope is unconfirmed, so the clone uses a deterministic proxy: the foreground
// window is a borderless fullscreen window covering a monitor. While that holds, every registered
// hotkey (launcher, Clipboard History, Window Management commands) is unregistered; leaving
// fullscreen restores them untouched.

using System.Runtime.InteropServices;
using System.Text.Json;
using System.Windows;
using System.Windows.Threading;

namespace RaycastMini.Launcher;

public static class GameMode
{
    private const uint WsCaption = 0x00C00000;
    private const int GwlStyle = -16;
    private const int MonitorDefaultToNearest = 2;

    private static bool _enabled;
    private static bool _suppressed;
    private static DispatcherTimer? _watchTimer;

    public static Task<object?> DispatchAsync(string method, JsonElement? data)
    {
        if (method != "games.setGameMode") throw new InvalidOperationException($"no games handler for {method}");
        var enabled = data?.TryGetProperty("enabled", out var enabledElement) == true && enabledElement.ValueKind == JsonValueKind.True;
        Application.Current.Dispatcher.Invoke(() => SetEnabled(enabled));
        return Task.FromResult<object?>(new { enabled });
    }

    private static void SetEnabled(bool enabled)
    {
        if (_enabled == enabled) return;
        _enabled = enabled;
        if (_enabled)
        {
            if (_watchTimer is null)
            {
                _watchTimer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(1) };
                _watchTimer.Tick += (_, _) => WatchTick();
            }
            _watchTimer.Start();
        }
        else
        {
            _watchTimer?.Stop();
            SetSuppressed(false);
        }
        App.Log.Write($"[game-mode] enabled={enabled}");
    }

    private static void WatchTick()
    {
        var foreground = GetForegroundWindow();
        var gameInForeground = foreground != IntPtr.Zero
            && !IsOwnWindow(foreground)
            && IsBorderlessFullscreen(foreground);
        App.Log.Write($"[game-mode] Game in foreground: {gameInForeground}");
        SetSuppressed(gameInForeground);
    }

    private static void SetSuppressed(bool suppressed)
    {
        if (_suppressed == suppressed) return;
        var launcherOk = (Application.Current.MainWindow as MainWindow)?.SetLauncherHotkeysSuppressed(suppressed) ?? true;
        var commandOk = WindowManagementNative.SetCommandHotkeysSuppressed(suppressed);
        if (launcherOk && commandOk)
        {
            _suppressed = suppressed;
            App.Log.Write($"[game-mode] hotkeys suppressed={suppressed}");
        }
        else
        {
            App.Log.Write($"[game-mode] Failed to set hotkeys suppressed={suppressed}");
        }
    }

    /// <summary>Borderless fullscreen: the window covers its monitor entirely and has no caption.</summary>
    private static bool IsBorderlessFullscreen(IntPtr hwnd)
    {
        if (IsIconic(hwnd)) return false;
        var monitor = MonitorFromWindow(hwnd, MonitorDefaultToNearest);
        var info = new MONITORINFO { cbSize = Marshal.SizeOf<MONITORINFO>() };
        if (!GetMonitorInfo(monitor, ref info)) return false;
        if (!GetWindowRect(hwnd, out var rect)) return false;
        var coversMonitor = rect.Left <= info.rcMonitor.Left
            && rect.Top <= info.rcMonitor.Top
            && rect.Right >= info.rcMonitor.Right
            && rect.Bottom >= info.rcMonitor.Bottom;
        if (!coversMonitor) return false;
        var style = (uint)GetWindowLong(hwnd, GwlStyle);
        return (style & WsCaption) == 0;
    }

    private static bool IsOwnWindow(IntPtr handle)
    {
        foreach (Window window in Application.Current.Windows)
        {
            try
            {
                if (new System.Windows.Interop.WindowInteropHelper(window).Handle == handle) return true;
            }
            catch
            {
                // A window without a handle yet cannot be ours.
            }
        }
        return false;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct RECT
    {
        public int Left, Top, Right, Bottom;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct MONITORINFO
    {
        public int cbSize;
        public RECT rcMonitor;
        public RECT rcWork;
        public uint dwFlags;
    }

    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    private static extern IntPtr MonitorFromWindow(IntPtr hwnd, uint flags);

    [DllImport("user32.dll", CharSet = CharSet.Auto)]
    private static extern bool GetMonitorInfo(IntPtr monitor, ref MONITORINFO info);

    [DllImport("user32.dll")]
    private static extern bool GetWindowRect(IntPtr hwnd, out RECT rect);

    [DllImport("user32.dll")]
    private static extern bool IsIconic(IntPtr hwnd);

    [DllImport("user32.dll", EntryPoint = "GetWindowLongW")]
    private static extern int GetWindowLong(IntPtr hwnd, int index);
}

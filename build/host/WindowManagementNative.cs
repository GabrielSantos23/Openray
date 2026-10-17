// Window Management host surface (`windowManagement.*`), the clone's counterpart of the UniFFI
// `window_management` namespace in Raycast's native.dll: display enumeration, the focused window,
// geometry application, minimize/topmost, app-window cycling, and the command-hotkey map the
// Magnet preset populates.
//
// Coordinates: every rect the renderer sees is relative to its display's work area, in logical
// pixels (physical ÷ that monitor's DPI scale). The process is PerMonitorV2 via app.manifest, so
// `GetDpiForMonitor` reports per-monitor values and `GetWindowRect` is true physical pixels.

using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Windows;

namespace Openray.Launcher;

public static class WindowManagementNative
{
    private static IntPtr _capturedForeground;

    // Launcher hotkeys own 0x1000/0x1001; command hotkeys start above them.
    private const int FirstCommandHotkeyId = 0x1100;

    private const uint WsCaption = 0x00C00000;
    private const uint WsThickframe = 0x00040000;
    private const uint WsExToolWindow = 0x00000080;
    private const uint WsExTopmost = 0x00000008;
    private const int GwlStyle = -16;
    private const int GwlExStyle = -20;
    private const uint SwpNosize = 0x0001;
    private const uint SwpNomove = 0x0002;
    private const uint SwpNozorder = 0x0004;
    private const uint SwpNoactivate = 0x0010;
    private const uint SwpNoownerzorder = 0x0200;
    private const int SwMinimize = 6;
    private const int SwRestore = 9;
    private const uint ModAlt = 0x0001;
    private const uint ModControl = 0x0002;
    private const uint ModShift = 0x0004;
    private const uint ModWin = 0x0008;
    private const uint ModNoRepeat = 0x4000;
    private const int MonitorDefaultToNearest = 2;
    private const int DwmwaCloaked = 14;

    private static readonly object HotkeyLock = new();
    private static readonly Dictionary<int, (IntPtr hwnd, string commandKey, uint modifiers, ushort key)> CommandHotkeys = new();
    private static int _nextHotkeyId = FirstCommandHotkeyId;
    // Game Mode suppression unregisters every command hotkey without forgetting it; the map keeps
    // its entries so `RestoreCommandHotkeys` can re-register the same id/modifier/key triple.
    private static bool _commandHotkeysSuppressed;

    [StructLayout(LayoutKind.Sequential)]
    private struct RECT
    {
        public int Left, Top, Right, Bottom;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct MONITORINFOEXW
    {
        public int cbSize;
        public RECT rcMonitor;
        public RECT rcWork;
        public uint dwFlags;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)]
        public string szDevice;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct POINT { public int X, Y; }

    public static void CaptureForeground()
    {
        var handle = GetForegroundWindow();
        // Never capture one of our own windows (launcher, Settings, HUD): the command target is
        // the app the user was in, and a transitional own-foreground must not clobber the last
        // real capture.
        if (handle != IntPtr.Zero && !IsOwnWindow(handle)) _capturedForeground = handle;
    }

    public static Task<object?> DispatchAsync(string method, JsonElement? data)
    {
        var name = method["windowManagement.".Length..];
        return name switch
        {
            "getDisplays" => Task.FromResult(GetDisplays()),
            "getActiveWindow" => Task.FromResult(GetActiveWindow()),
            "setWindowBounds" => Task.FromResult(SetWindowBounds(data)),
            "minimizeWindow" => Task.FromResult(MinimizeWindow(data)),
            "toggleAlwaysOnTop" => Task.FromResult(ToggleAlwaysOnTop(data)),
            "enumerateVisibleWindows" => Task.FromResult(EnumerateVisibleWindows()),
            "cycleAppWindows" => Task.FromResult(CycleAppWindows(data)),
            "registerCommandHotkey" => Task.FromResult(RegisterCommandHotkey(data)),
            _ => Task.FromException<object?>(new InvalidOperationException($"no windowManagement handler for {name}")),
        };
    }

    /// <summary>WM_HOTKEY lookup from the main window's message pump; null when not ours.</summary>
    public static string? MapHotkey(int id)
    {
        lock (HotkeyLock)
        {
            return CommandHotkeys.TryGetValue(id, out var entry) ? entry.commandKey : null;
        }
    }

    // -----------------------------------------------------------------------------------------
    // Displays
    // -----------------------------------------------------------------------------------------

    private sealed record DisplayEntry(IntPtr Handle, RECT WorkArea, uint Dpi, bool IsPrimary);

    private static List<DisplayEntry> EnumerateDisplays()
    {
        var list = displays.Value!;
        list.Clear();
        EnumDisplayMonitors(IntPtr.Zero, IntPtr.Zero, MonitorEnumCallback, IntPtr.Zero);
        // Primary first, then left-to-right/top-to-bottom so `displayIndex` is stable across calls.
        list.Sort((a, b) =>
        {
            if (a.IsPrimary != b.IsPrimary) return a.IsPrimary ? -1 : 1;
            return a.WorkArea.Left != b.WorkArea.Left
                ? a.WorkArea.Left.CompareTo(b.WorkArea.Left)
                : a.WorkArea.Top.CompareTo(b.WorkArea.Top);
        });
        return list;
    }

    private static bool MonitorEnumCallback(IntPtr monitor, IntPtr hdc, ref RECT rect, IntPtr data)
    {
        var info = new MONITORINFOEXW();
        info.cbSize = Marshal.SizeOf(typeof(MONITORINFOEXW));
        if (!GetMonitorInfoW(monitor, ref info)) return true;
        try
        {
            GetDpiForMonitor(monitor, 0 /* MDT_EFFECTIVE_DPI */, out uint dpiX, out _);
            displays.Value!.Add(new DisplayEntry(monitor, info.rcWork, dpiX == 0 ? 96 : dpiX,
                (info.dwFlags & 1) != 0 /* MONITORINFOF_PRIMARY */));
        }
        catch (DllNotFoundException)
        {
            // Pre-8.1 Shcore: assume 96 DPI rather than fail the whole route.
            displays.Value!.Add(new DisplayEntry(monitor, info.rcWork, 96, (info.dwFlags & 1) != 0));
        }
        return true;
    }

    private static readonly ThreadLocal<List<DisplayEntry>> displays = new(() => new List<DisplayEntry>());

    private static object GetDisplays()
    {
        var displays = EnumerateDisplays();
        var currentMonitor = MonitorFromWindow(CurrentTargetHandle(), MonitorDefaultToNearest);
        var result = new List<object>();
        for (var index = 0; index < displays.Count; index++)
        {
            var display = displays[index];
            double scale = display.Dpi / 96.0;
            result.Add(new
            {
                index,
                id = display.Handle.ToInt64(),
                x = 0,
                y = 0,
                width = Math.Round((display.WorkArea.Right - display.WorkArea.Left) / scale),
                height = Math.Round((display.WorkArea.Bottom - display.WorkArea.Top) / scale),
                scaleFactor = scale,
                isPrimary = display.IsPrimary,
                isCurrent = display.Handle == currentMonitor,
                name = display.DeviceName(),
            });
        }
        return new { displays = result };
    }

    private static string DeviceName(this DisplayEntry entry)
    {
        var info = new MONITORINFOEXW();
        info.cbSize = Marshal.SizeOf(typeof(MONITORINFOEXW));
        return GetMonitorInfoW(entry.Handle, ref info) ? info.szDevice : string.Empty;
    }

    private static DisplayEntry? DisplayForWindow(IntPtr hwnd, List<DisplayEntry>? displays = null)
    {
        displays ??= EnumerateDisplays();
        var monitor = MonitorFromWindow(hwnd, MonitorDefaultToNearest);
        if (monitor == IntPtr.Zero) return null;
        return displays.FirstOrDefault(entry => entry.Handle == monitor);
    }

    // -----------------------------------------------------------------------------------------
    // Focused window
    // -----------------------------------------------------------------------------------------

    /// <summary>
    /// The window a command should act on: the foreground window captured when the launcher was
    /// revealed, falling back to the live foreground window (global-hotkey runs never toggled the
    /// launcher, so there was nothing to capture).
    /// </summary>
    private static IntPtr CurrentTargetHandle()
    {
        if (IsWindow(_capturedForeground) && !IsOwnWindow(_capturedForeground)) return _capturedForeground;
        var foreground = GetForegroundWindow();
        if (foreground != IntPtr.Zero && !IsOwnWindow(foreground)) return foreground;
        return IntPtr.Zero;
    }

    /// <summary>The last real (non-own) foreground window, for screen placement decisions.</summary>
    public static IntPtr CapturedTargetHandle() => CurrentTargetHandle();

    private static bool IsOwnWindow(IntPtr hwnd)
    {
        GetWindowThreadProcessId(hwnd, out var pid);
        return pid == Environment.ProcessId;
    }

    private static object? GetActiveWindow()
    {
        var hwnd = CurrentTargetHandle();
        if (hwnd == IntPtr.Zero) return null;
        return DescribeWindow(hwnd);
    }

    private static object? DescribeWindow(IntPtr hwnd)
    {
        var displays = EnumerateDisplays();
        var display = DisplayForWindow(hwnd, displays);
        if (display is null) return null;
        return DescribeWindow(hwnd, displays.IndexOf(display), display);
    }

    private static object DescribeWindow(IntPtr hwnd, int displayIndex, DisplayEntry display)
    {
        GetWindowRect(hwnd, out var rect);
        double scale = display.Dpi / 96.0;
        var style = (uint)GetWindowLong(hwnd, GwlStyle);
        var exStyle = (uint)GetWindowLong(hwnd, GwlExStyle);
        GetWindowThreadProcessId(hwnd, out var pid);
        return new
        {
            id = hwnd.ToInt64(),
            pid,
            exeName = ExeNameFor(pid),
            title = WindowTitle(hwnd),
            bounds = new
            {
                x = Math.Round((rect.Left - display.WorkArea.Left) / scale),
                y = Math.Round((rect.Top - display.WorkArea.Top) / scale),
                width = Math.Round((rect.Right - rect.Left) / scale),
                height = Math.Round((rect.Bottom - rect.Top) / scale),
            },
            displayIndex,
            resizable = (style & WsThickframe) != 0,
            positionable = (style & WsCaption) != 0,
            topmost = (exStyle & WsExTopmost) != 0,
            maximized = IsZoomed(hwnd),
            minimized = IsIconic(hwnd),
        };
    }

    private static string ExeNameFor(uint pid)
    {
        try
        {
            var process = System.Diagnostics.Process.GetProcessById((int)pid);
            return System.IO.Path.GetFileName(process.MainModule?.FileName ?? process.ProcessName);
        }
        catch
        {
            // Access-denied on elevated processes: the pid is still useful, the name is not.
            return string.Empty;
        }
    }

    private static string WindowTitle(IntPtr hwnd)
    {
        var length = GetWindowTextLength(hwnd);
        if (length <= 0) return string.Empty;
        var buffer = new StringBuilder(length + 1);
        GetWindowText(hwnd, buffer, buffer.Capacity);
        return buffer.ToString();
    }

    // -----------------------------------------------------------------------------------------
    // Geometry application
    // -----------------------------------------------------------------------------------------

    private static object SetWindowBounds(JsonElement? data)
    {
        var id = (IntPtr)RequireLong(data, "id");
        if (!IsWindow(id)) throw new InvalidOperationException("no such window");
        var bounds = data?.TryGetProperty("bounds", out var boundsElement) == true ? boundsElement : (JsonElement?)null;
        if (bounds is null || bounds.Value.ValueKind != JsonValueKind.Object)
            throw new InvalidOperationException("missing \"bounds\"");

        GetWindowRect(id, out var current);
        var display = DisplayForWindow(id) ?? throw new InvalidOperationException("no display for window");
        double scale = display.Dpi / 96.0;

        int left = current.Left, top = current.Top, width = current.Right - current.Left, height = current.Bottom - current.Top;
        if (bounds.Value.TryGetProperty("position", out var position) && position.ValueKind == JsonValueKind.Object)
        {
            if (position.TryGetProperty("x", out var x) && x.ValueKind == JsonValueKind.Number)
                left = display.WorkArea.Left + (int)Math.Round(x.GetDouble() * scale);
            if (position.TryGetProperty("y", out var y) && y.ValueKind == JsonValueKind.Number)
                top = display.WorkArea.Top + (int)Math.Round(y.GetDouble() * scale);
        }
        if (bounds.Value.TryGetProperty("size", out var size) && size.ValueKind == JsonValueKind.Object)
        {
            if (size.TryGetProperty("width", out var w) && w.ValueKind == JsonValueKind.Number)
                width = (int)Math.Round(w.GetDouble() * scale);
            if (size.TryGetProperty("height", out var h) && h.ValueKind == JsonValueKind.Number)
                height = (int)Math.Round(h.GetDouble() * scale);
        }

        // A refused move (elevated/UWP targets) is a routine outcome, not a crash.
        if (!SetWindowPos(id, IntPtr.Zero, left, top, width, height, SwpNozorder | SwpNoactivate | SwpNoownerzorder))
            throw new InvalidOperationException("setWindowPos was refused");

        GetWindowRect(id, out var achieved);
        var achievedDisplay = DisplayForWindow(id, [display]) ?? display;
        double achievedScale = achievedDisplay.Dpi / 96.0;
        return new
        {
            bounds = new
            {
                x = Math.Round((achieved.Left - achievedDisplay.WorkArea.Left) / achievedScale),
                y = Math.Round((achieved.Top - achievedDisplay.WorkArea.Top) / achievedScale),
                width = Math.Round((achieved.Right - achieved.Left) / achievedScale),
                height = Math.Round((achieved.Bottom - achieved.Top) / achievedScale),
            },
            displayIndex = achievedDisplay.Handle == display.Handle ? (int?)DisplayIndexOf(achievedDisplay) : null,
        };
    }

    private static int DisplayIndexOf(DisplayEntry display)
    {
        var displays = EnumerateDisplays();
        var index = displays.FindIndex(entry => entry.Handle == display.Handle);
        return index < 0 ? 0 : index;
    }

    private static object MinimizeWindow(JsonElement? data)
    {
        var id = (IntPtr)RequireLong(data, "id");
        if (!IsWindow(id)) throw new InvalidOperationException("no such window");
        ShowWindow(id, SwMinimize);
        return new { ok = true };
    }

    private static object ToggleAlwaysOnTop(JsonElement? data)
    {
        var id = (IntPtr)RequireLong(data, "id");
        if (!IsWindow(id)) throw new InvalidOperationException("no such window");
        var exStyle = (uint)GetWindowLong(id, GwlExStyle);
        var topmost = (exStyle & WsExTopmost) != 0;
        var insertAfter = topmost ? new IntPtr(-2) /* HWND_NOTOPMOST */ : new IntPtr(-1) /* HWND_TOPMOST */;
        if (!SetWindowPos(id, insertAfter, 0, 0, 0, 0, SwpNomove | SwpNosize | SwpNoactivate))
            throw new InvalidOperationException("setWindowPos was refused");
        return new { topmost = !topmost };
    }

    // -----------------------------------------------------------------------------------------
    // Window enumeration + app cycling
    // -----------------------------------------------------------------------------------------

    private static bool IsAppWindow(IntPtr hwnd)
    {
        if (!IsWindowVisible(hwnd) || IsIconic(hwnd)) return false;
        if (IsOwnWindow(hwnd)) return false;
        var exStyle = (uint)GetWindowLong(hwnd, GwlExStyle);
        if ((exStyle & WsExToolWindow) != 0) return false;
        try
        {
            DwmGetWindowAttribute(hwnd, DwmwaCloaked, out var cloaked, sizeof(int));
            if (cloaked != 0) return false;
        }
        catch (DllNotFoundException)
        {
            // Pre-8.1 DWM: the visibility flags above are the whole story.
        }
        return WindowTitle(hwnd).Length > 0;
    }

    private static object EnumerateVisibleWindows()
    {
        var displays = EnumerateDisplays();
        var windows = new List<object>();
        var order = 0;
        EnumWindows(hwnd =>
        {
            if (!IsAppWindow(hwnd)) return true;
            var display = DisplayForWindow(hwnd, displays);
            if (display is null) return true;
            GetWindowRect(hwnd, out var rect);
            double scale = display.Dpi / 96.0;
            GetWindowThreadProcessId(hwnd, out var pid);
            windows.Add(new
            {
                id = hwnd.ToInt64(),
                pid,
                exeName = ExeNameFor(pid),
                title = WindowTitle(hwnd),
                bounds = new
                {
                    x = Math.Round((rect.Left - display.WorkArea.Left) / scale),
                    y = Math.Round((rect.Top - display.WorkArea.Top) / scale),
                    width = Math.Round((rect.Right - rect.Left) / scale),
                    height = Math.Round((rect.Bottom - rect.Top) / scale),
                },
                displayIndex = displays.IndexOf(display),
                zIndex = order,
            });
            order++;
            return true;
        });
        return new { windows };
    }

    private static object CycleAppWindows(JsonElement? data)
    {
        var direction = data?.TryGetProperty("direction", out var directionElement) == true
            && directionElement.ValueKind == JsonValueKind.String
            ? directionElement.GetString()
            : "next";
        var previous = direction == "previous";

        var current = CurrentTargetHandle();
        if (current == IntPtr.Zero) return new { outcome = "noWindow", appName = (string?)null };
        GetWindowThreadProcessId(current, out var pid);

        var appWindows = new List<IntPtr>();
        EnumWindows(hwnd =>
        {
            if (hwnd == current || !IsAppWindow(hwnd)) return true;
            GetWindowThreadProcessId(hwnd, out var windowPid);
            if (windowPid == pid) appWindows.Add(hwnd);
            return true;
        });

        if (appWindows.Count == 0) return new { outcome = "noOtherWindows", appName = ExeNameFor(pid) };

        // EnumWindows walks top-down z-order; `next` moves down the stack, `previous` up.
        var target = previous ? appWindows[0] : appWindows[^1];
        if (IsIconic(target)) ShowWindow(target, SwRestore);
        SetForegroundWindowWithWorkaround(target);
        return new { outcome = "ok", appName = ExeNameFor(pid) };
    }

    /// <summary>
    /// SetForegroundWindow from a background process is refused; attaching to the foreground
    /// thread's input queue is the standard workaround.
    /// </summary>
    private static void SetForegroundWindowWithWorkaround(IntPtr hwnd)
    {
        var foregroundThread = GetWindowThreadProcessId(GetForegroundWindow(), out _);
        var currentThread = GetCurrentThreadId();
        if (foregroundThread != currentThread) AttachThreadInput(currentThread, foregroundThread, true);
        SetForegroundWindow(hwnd);
        if (foregroundThread != currentThread) AttachThreadInput(currentThread, foregroundThread, false);
    }

    // -----------------------------------------------------------------------------------------
    // Command hotkeys (Magnet preset)
    // -----------------------------------------------------------------------------------------

    private static object RegisterCommandHotkey(JsonElement? data)
    {
        var commandKey = RequireString(data, "commandKey");
        return Application.Current.Dispatcher.Invoke(() => RegisterCommandHotkeyOnUi(commandKey, data));
    }

    private static object RegisterCommandHotkeyOnUi(string commandKey, JsonElement? data)
    {
        var window = Application.Current.MainWindow ?? throw new InvalidOperationException("no main window");
        var handle = new System.Windows.Interop.WindowInteropHelper(window).Handle;

        int? existingId = null;
        lock (HotkeyLock)
        {
            foreach (var pair in CommandHotkeys)
            {
                if (pair.Value.commandKey != commandKey) continue;
                existingId = pair.Key;
                break;
            }
        }
        if (existingId is not null)
        {
            UnregisterHotKey(handle, existingId.Value);
            lock (HotkeyLock) CommandHotkeys.Remove(existingId.Value);
        }

        var hotkeyElement = default(JsonElement);
        var hasHotkey = data?.TryGetProperty("hotkey", out hotkeyElement) == true
            && hotkeyElement.ValueKind == JsonValueKind.Object;
        if (!hasHotkey) return new { ok = true };

        uint modifiers = ModNoRepeat;
        if (hotkeyElement.TryGetProperty("modifiers", out var mods) && mods.ValueKind == JsonValueKind.Array)
        {
            foreach (var mod in mods.EnumerateArray())
            {
                switch (mod.GetString())
                {
                    case "ctrl": modifiers |= ModControl; break;
                    case "alt": modifiers |= ModAlt; break;
                    case "shift": modifiers |= ModShift; break;
                    case "meta": modifiers |= ModWin; break;
                }
            }
        }
        var key = VirtualKey(RequireString(hotkeyElement, "key"));
        if (key == 0) throw new InvalidOperationException($"unsupported hotkey key");

        int id;
        lock (HotkeyLock) id = _nextHotkeyId++;
        if (!RegisterHotKey(handle, id, modifiers, key))
            throw new InvalidOperationException("hotkey registration failed");
        lock (HotkeyLock) CommandHotkeys[id] = (handle, commandKey, modifiers, key);
        return new { ok = true };
    }

    /// <summary>
    /// Game Mode (docs/focus-games-taskbar-spec.md §B): while suppressed every command hotkey is
    /// unregistered but remembered, so restoring re-registers the identical id/modifier/key triple.
    /// </summary>
    public static bool SetCommandHotkeysSuppressed(bool suppressed)
    {
        lock (HotkeyLock)
        {
            if (_commandHotkeysSuppressed == suppressed) return true;
            var failed = false;
            if (suppressed)
            {
                foreach (var pair in CommandHotkeys)
                {
                    if (!UnregisterHotKey(pair.Value.hwnd, pair.Key)) failed = true;
                }
            }
            else
            {
                foreach (var pair in CommandHotkeys)
                {
                    if (!RegisterHotKey(pair.Value.hwnd, pair.Key, pair.Value.modifiers, pair.Value.key)) failed = true;
                }
            }
            if (!failed) _commandHotkeysSuppressed = suppressed;
            return !failed;
        }
    }

    private static ushort VirtualKey(string key) => key switch
    {
        "ArrowLeft" => 0x25,
        "ArrowUp" => 0x26,
        "ArrowRight" => 0x27,
        "ArrowDown" => 0x28,
        "Backspace" => 0x08,
        "Delete" => 0x2E,
        "Enter" or "Return" => 0x0D,
        "Escape" => 0x1B,
        "Minus" => 0xBD,
        "Equal" => 0xBB,
        "Space" => 0x20,
        "Tab" => 0x09,
        "Home" => 0x24,
        "End" => 0x23,
        "PageUp" => 0x21,
        "PageDown" => 0x22,
        "Insert" => 0x2D,
        _ when key.Length == 1 && char.IsAsciiLetterOrDigit(key[0]) => (ushort)char.ToUpperInvariant(key[0]),
        _ when key.Length is 2 or 3 && key[0] == 'F' && ushort.TryParse(key[1..], out var fn) && fn is >= 1 and <= 24
            => (ushort)(0x6F + fn),
        _ => 0,
    };

    private static long RequireLong(JsonElement? data, string property)
    {
        if (data?.TryGetProperty(property, out var element) == true && element.ValueKind == JsonValueKind.Number)
            return element.GetInt64();
        throw new InvalidOperationException($"missing \"{property}\"");
    }

    private static string RequireString(JsonElement? data, string property)
    {
        if (data?.TryGetProperty(property, out var element) == true && element.ValueKind == JsonValueKind.String)
        {
            var value = element.GetString();
            if (!string.IsNullOrWhiteSpace(value)) return value;
        }
        throw new InvalidOperationException($"missing \"{property}\"");
    }

    [DllImport("user32.dll")] private static extern bool EnumDisplayMonitors(IntPtr hdc, IntPtr clip, MonitorEnumProc callback, IntPtr data);
    private delegate bool MonitorEnumProc(IntPtr monitor, IntPtr hdc, ref RECT rect, IntPtr data);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern bool GetMonitorInfoW(IntPtr monitor, ref MONITORINFOEXW info);
    [DllImport("user32.dll")] private static extern IntPtr MonitorFromWindow(IntPtr hwnd, uint flags);
    [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] private static extern bool SetForegroundWindow(IntPtr hwnd);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
    [DllImport("user32.dll")] private static extern bool IsWindow(IntPtr hwnd);
    [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr hwnd);
    [DllImport("user32.dll")] private static extern bool IsIconic(IntPtr hwnd);
    [DllImport("user32.dll")] private static extern bool IsZoomed(IntPtr hwnd);
    [DllImport("user32.dll")] private static extern bool ShowWindow(IntPtr hwnd, int command);
    [DllImport("user32.dll")] private static extern int GetWindowLong(IntPtr hwnd, int index);
    [DllImport("user32.dll")] private static extern bool GetWindowRect(IntPtr hwnd, out RECT rect);
    [DllImport("user32.dll")] private static extern bool SetWindowPos(IntPtr hwnd, IntPtr insertAfter, int x, int y, int width, int height, uint flags);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetWindowText(IntPtr hwnd, StringBuilder buffer, int maxCount);
    [DllImport("user32.dll")] private static extern int GetWindowTextLength(IntPtr hwnd);
    [DllImport("user32.dll")] private static extern bool EnumWindows(EnumWindowsProc callback);
    private delegate bool EnumWindowsProc(IntPtr hwnd);
    [DllImport("user32.dll")] private static extern bool RegisterHotKey(IntPtr hwnd, int id, uint modifiers, ushort key);
    [DllImport("user32.dll")] private static extern bool UnregisterHotKey(IntPtr hwnd, int id);
    [DllImport("user32.dll")] private static extern uint GetCurrentThreadId();
    [DllImport("user32.dll")] private static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool attach);
    [DllImport("shcore.dll")] private static extern int GetDpiForMonitor(IntPtr monitor, uint type, out uint dpiX, out uint dpiY);
    [DllImport("dwmapi.dll")] private static extern int DwmGetWindowAttribute(IntPtr hwnd, int attribute, out int value, int size);
}

// Focus host surface (`focus.*`), the clone's counterpart of the shipped `raycastFocus.*` host
// RPC (docs/focus-games-taskbar-spec.md §A).
//
// The backend owns the session state machine; this class owns the Windows half:
//   - the blocking watch loop — a blocked app that comes to the foreground is covered by a
//     fullscreen overlay ("X has been blocked by Openray" + a Snooze button). Switching
//     focus away closes the blocked app (graceful -> force), and terminated processes are remembered
//     so `restoreAppsWhenSessionEnds` can re-launch them.
//   - the floating Focus panel — a compact 265x40 dark capsule with the two shipped variants:
//     idle displays the green bullseye mark + "Focus session" title; hovering displays the
//     Pause / Complete / ⋯ action buttons and the 2x3 dot grip for dragging.
//   - the taskbar presentation — Move to Taskbar hides the panel and shows a tray icon with
//     a working context menu for Pause / Complete / Cancel / Detach from Taskbar.

using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Shapes;
using System.Windows.Threading;

namespace Openray.Launcher;

public static class FocusSession
{
    private sealed record AppRule(string Kind, string Value);

    private sealed record TerminatedApp(string Path, string Name);

    private static readonly object StateLock = new();
    private static bool _active;
    private static bool _paused;
    private static bool _restore;
    private static bool _playSound;
    private static string _title = "Focus session";
    private static string _mode = "block";
    private static string _sessionId = string.Empty;
    private static double? _durationMs;
    private static double _snoozeDurationMs = 180000;
    private static List<AppRule> _rules = new();
    private static DateTime _endAtUtc;
    private static double _remainingAtPauseMs;

    // The overlay target while it is foreground; switching focus away closes it.
    private static int? _overlayTargetPid;
    private static string _overlayTargetName = "";
    private static string _overlayTargetPath = "";
    private static DateTime? _pendingCloseDeadline;
    private static int? _pendingClosePid;
    private static readonly Dictionary<string, DateTime> SnoozedUntil = new(StringComparer.OrdinalIgnoreCase);
    private static readonly List<TerminatedApp> Terminated = new();

    private static DispatcherTimer? _watchTimer;

    public static Task<object?> DispatchAsync(string method, JsonElement? data)
    {
        var name = method["focus.".Length..];
        return name switch
        {
            "startSession" => Task.FromResult(StartSession(data)),
            "pauseSession" => Task.FromResult(PauseSession()),
            "resumeSession" => Task.FromResult(ResumeSession()),
            "completeSession" => Task.FromResult(CompleteSession()),
            "cancelSession" => Task.FromResult(CancelSession()),
            _ => Task.FromException<object?>(new InvalidOperationException($"no focus handler for {name}")),
        };
    }

    private static object StartSession(JsonElement? data)
    {
        var id = data?.TryGetProperty("id", out var idElement) == true ? idElement.GetString() ?? string.Empty : string.Empty;
        double? durationMs = data?.TryGetProperty("durationMs", out var durationElement) == true
            && durationElement.ValueKind == JsonValueKind.Number
            && durationElement.TryGetInt64(out var duration)
            ? duration
            : null;
        var title = data?.TryGetProperty("title", out var titleElement) == true
            && titleElement.ValueKind == JsonValueKind.String
            && !string.IsNullOrWhiteSpace(titleElement.GetString())
            ? titleElement.GetString()!
            : "Focus session";
        var mode = data?.TryGetProperty("mode", out var modeElement) == true
            && modeElement.ValueKind == JsonValueKind.String
            ? modeElement.GetString() ?? "block"
            : "block";
        var restore = data?.TryGetProperty("restoreAppsWhenSessionEnds", out var restoreElement) == true
            && restoreElement.ValueKind == JsonValueKind.True;
        var playSound = data?.TryGetProperty("playSound", out var soundElement) == true && soundElement.ValueKind == JsonValueKind.True;
        double snoozeDurationMs = data?.TryGetProperty("snoozeDurationMs", out var snoozeElement) == true
            && snoozeElement.ValueKind == JsonValueKind.Number
            && snoozeElement.TryGetDouble(out var snooze)
            ? snooze
            : 180000;

        var rules = new List<AppRule>();
        if (data?.TryGetProperty("appRules", out var rulesElement) == true && rulesElement.ValueKind == JsonValueKind.Array)
        {
            foreach (var rule in rulesElement.EnumerateArray())
            {
                if (rule.ValueKind != JsonValueKind.Object) continue;
                var kind = rule.TryGetProperty("kind", out var kindElement) ? kindElement.GetString() : null;
                var value = rule.TryGetProperty("value", out var valueElement) ? valueElement.GetString() : null;
                if (string.IsNullOrWhiteSpace(kind) || string.IsNullOrWhiteSpace(value)) continue;
                rules.Add(new AppRule(kind, value));
            }
        }

        Application.Current.Dispatcher.Invoke(() =>
        {
            lock (StateLock)
            {
                _sessionId = id;
                _title = title;
                _mode = mode;
                _durationMs = durationMs;
                _restore = restore;
                _playSound = playSound;
                _snoozeDurationMs = snoozeDurationMs;
                _rules = rules;
                _paused = false;
                _active = true;
                _endAtUtc = durationMs is null ? DateTime.MaxValue : DateTime.UtcNow.AddMilliseconds(durationMs.Value);
                _remainingAtPauseMs = durationMs ?? 0;
            }
            SnoozedUntil.Clear();
            Terminated.Clear();
            ResetOverlayTarget();
            // A fresh start returns the presentation to the floating panel.
            FocusTrayButtonWindow.Current?.HideTray();
            FocusPanelWindow.GetOrCreate().Start(_title, durationMs);
            StartWatchTimer();
        });
        App.Log.Write($"[Focus] Starting app blocking, {rules.Count} match rules, mode={mode}");
        return new { ok = true };
    }

    public static object PauseSession()
    {
        Application.Current.Dispatcher.Invoke(() =>
        {
            lock (StateLock)
            {
                _paused = true;
                if (_durationMs is not null) _remainingAtPauseMs = Math.Max(0, (_endAtUtc - DateTime.UtcNow).TotalMilliseconds);
            }
            HideOverlay();
            FocusPanelWindow.Current?.Pause();
        });
        return new { ok = true };
    }

    public static object ResumeSession()
    {
        Application.Current.Dispatcher.Invoke(() =>
        {
            lock (StateLock)
            {
                _paused = false;
                if (_durationMs is not null) _endAtUtc = DateTime.UtcNow.AddMilliseconds(_remainingAtPauseMs);
            }
            FocusPanelWindow.Current?.Resume();
        });
        return new { ok = true };
    }

    public static object CompleteSession()
    {
        var restore = false;
        Application.Current.Dispatcher.Invoke(() =>
        {
            lock (StateLock)
            {
                restore = _restore;
                _active = false;
            }
            ResetOverlayTarget();
            HideOverlay();
            FocusPanelWindow.Current?.Stop();
            FocusTrayButtonWindow.Current?.HideTray();
            StopWatchTimer();
        });
        if (_playSound) System.Media.SystemSounds.Asterisk.Play();
        if (restore) RestoreTerminatedApps();
        return new { ok = true };
    }

    public static object CancelSession()
    {
        Application.Current.Dispatcher.Invoke(() =>
        {
            lock (StateLock) _active = false;
            ResetOverlayTarget();
            HideOverlay();
            FocusPanelWindow.Current?.Stop();
            FocusTrayButtonWindow.Current?.HideTray();
            StopWatchTimer();
        });
        return new { ok = true };
    }

    private static void RestoreTerminatedApps()
    {
        lock (StateLock)
        {
            foreach (var path in Terminated.Select(entry => entry.Path).Distinct(StringComparer.OrdinalIgnoreCase))
            {
                try
                {
                    Process.Start(new ProcessStartInfo(path) { UseShellExecute = true });
                    App.Log.Write("[Focus] Restoring previously terminated app");
                }
                catch (Exception error)
                {
                    App.Log.Write($"[Focus] restore failed: {error.Message}");
                }
            }
            Terminated.Clear();
        }
    }

    // -----------------------------------------------------------------------------------------
    // Blocking watch loop: overlay on foreground match, close on focus switch
    // -----------------------------------------------------------------------------------------

    private static void StartWatchTimer()
    {
        if (_watchTimer is not null) return;
        _watchTimer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(500) };
        _watchTimer.Tick += (_, _) => WatchTick();
        _watchTimer.Start();
    }

    private static void StopWatchTimer()
    {
        _watchTimer?.Stop();
        _watchTimer = null;
    }

    private static void WatchTick()
    {
        bool active;
        bool paused;
        string mode;
        List<AppRule> rules;
        lock (StateLock)
        {
            active = _active;
            paused = _paused;
            mode = _mode;
            rules = _rules;
        }
        if (!active)
        {
            StopWatchTimer();
            return;
        }
        if (paused || (mode == "block" && rules.Count == 0))
        {
            HideOverlay();
            return;
        }

        var foreground = GetForegroundWindow();
        if (foreground == IntPtr.Zero) return;
        if (IsOwnWindow(foreground)) return;

        // Correctly read the process ID from the out parameter
        GetWindowThreadProcessId(foreground, out var pid);
        if (pid == 0 || pid == (uint)Environment.ProcessId) return;

        string processName = "";
        string exePath = "";
        try
        {
            using var process = Process.GetProcessById((int)pid);
            processName = process.ProcessName;
            exePath = process.MainModule?.FileName ?? "";
        }
        catch
        {
            // Access-guarded processes cannot be inspected; they cannot be matched either.
        }
        if (processName.Length == 0) return;

        if (IsSystemProcess(processName, exePath)) return;

        LogForegroundSample(processName, exePath, rules);

        if (IsSnoozed(processName, exePath))
        {
            if (_overlayTargetPid == (int)pid) HideOverlay();
            return;
        }

        bool matches = MatchesRules(processName, exePath, rules);
        bool shouldBlock = mode == "allow" ? !matches : matches;

        if (shouldBlock)
        {
            if (_overlayTargetPid == (int)pid) return;
            ShowOverlayFor((int)pid, foreground, processName, exePath);
            return;
        }

        // Focus left the blocked app: the overlay's promise is that the app then closes.
        if (_overlayTargetPid is not null)
        {
            CloseOverlayTarget();
            HideOverlay();
        }
    }

    private static bool IsSystemProcess(string processName, string exePath)
    {
        var lower = processName.ToLowerInvariant();
        return lower is "explorer" or "shellexperiencehost" or "searchhost" or "startmenuexperiencehost"
            or "textinputhost" or "taskmgr" or "csrss" or "dwm" or "svchost" or "systemsettings"
            or "applicationframehost" or "raycast" or "openray" or "conhost";
    }

    private static DateTime _lastForegroundSampleUtc = DateTime.MinValue;

    /// <summary>One log line every 5 s naming the foreground process — the evidence trail for
    /// why a blocked app did (or did not) match the session's rules.</summary>
    private static void LogForegroundSample(string processName, string exePath, List<AppRule> rules)
    {
        if (DateTime.UtcNow - _lastForegroundSampleUtc < TimeSpan.FromSeconds(5)) return;
        _lastForegroundSampleUtc = DateTime.UtcNow;
        var ruleText = string.Join(", ", rules.Select(rule => $"{rule.Kind}={rule.Value}"));
        App.Log.Write($"[Focus] foreground={processName} path={exePath} rules=[{ruleText}]");
    }

    private static bool IsSnoozed(string processName, string exePath)
    {
        lock (StateLock)
        {
            PruneSnoozed();
            if (exePath.Length > 0 && SnoozedUntil.TryGetValue(exePath.ToLowerInvariant(), out var pathExpiry) && pathExpiry > DateTime.UtcNow) return true;
            return SnoozedUntil.TryGetValue(processName.ToLowerInvariant(), out var nameExpiry) && nameExpiry > DateTime.UtcNow;
        }
    }

    private static void PruneSnoozed()
    {
        var expired = SnoozedUntil.Where(pair => pair.Value <= DateTime.UtcNow).Select(pair => pair.Key).ToArray();
        foreach (var key in expired) SnoozedUntil.Remove(key);
    }

    private static bool MatchesRules(string processName, string exePath, List<AppRule> rules)
    {
        var exePathLower = exePath.ToLowerInvariant();
        var processNameLower = processName.ToLowerInvariant();
        foreach (var rule in rules)
        {
            switch (rule.Kind)
            {
                case "path" when exePathLower.Length > 0:
                    if (exePathLower == rule.Value || exePathLower == rule.Value.Replace('/', '\\')) return true;
                    break;
                case "exeName":
                    if ($"{processNameLower}.exe" == rule.Value || processNameLower == rule.Value) return true;
                    break;
                case "exeBase":
                    if (processNameLower == rule.Value) return true;
                    break;
            }
        }
        return false;
    }

    private static void ShowOverlayFor(int pid, IntPtr foregroundHwnd, string processName, string exePath)
    {
        lock (StateLock)
        {
            _overlayTargetPid = pid;
            _overlayTargetName = processName;
            _overlayTargetPath = exePath;
        }
        Application.Current.Dispatcher.Invoke(() =>
        {
            FocusOverlayWindow.GetOrCreate().ShowOver(foregroundHwnd, DisplayName(processName, exePath));
        });
        App.Log.Write("[Focus] Blocked app came to the foreground; overlay shown");
    }

    private static void CloseOverlayTarget()
    {
        int? pid;
        lock (StateLock)
        {
            pid = _overlayTargetPid;
            if (pid is null) return;
            if (_overlayTargetPath.Length > 0 && !Terminated.Any(entry => entry.Path.Equals(_overlayTargetPath, StringComparison.OrdinalIgnoreCase)))
            {
                Terminated.Add(new TerminatedApp(_overlayTargetPath, _overlayTargetName));
            }
            _pendingClosePid = pid;
            _pendingCloseDeadline = DateTime.UtcNow.AddSeconds(5);
            ResetOverlayTarget();
        }
        try
        {
            using var process = Process.GetProcessById(pid.Value);
            App.Log.Write("[Focus] Blocked app lost focus; requesting graceful quit");
            process.CloseMainWindow();
        }
        catch
        {
            _pendingClosePid = null;
        }
        EnforcePendingClose();
    }

    private static void EnforcePendingClose()
    {
        int? pid;
        lock (StateLock)
        {
            if (_pendingClosePid is null || _pendingCloseDeadline is null) return;
            if (DateTime.UtcNow < _pendingCloseDeadline.Value) return;
            pid = _pendingClosePid;
            _pendingClosePid = null;
            _pendingCloseDeadline = null;
        }
        try
        {
            using var process = Process.GetProcessById(pid.Value);
            if (!process.HasExited)
            {
                App.Log.Write("[Focus] Blocked app is still running; requesting force quit");
                process.Kill(true);
            }
        }
        catch
        {
            // The process exited on its own.
        }
    }

    private static void ResetOverlayTarget()
    {
        _overlayTargetPid = null;
        _overlayTargetName = "";
        _overlayTargetPath = "";
    }

    private static void HideOverlay()
    {
        Application.Current.Dispatcher.Invoke(() => FocusOverlayWindow.Current?.HideNow());
    }

    /// <summary>The overlay's Snooze button: allow this app for the session's snooze duration.</summary>
    internal static void SnoozeCurrentOverlay()
    {
        string key;
        lock (StateLock)
        {
            key = (_overlayTargetPath.Length > 0 ? _overlayTargetPath : _overlayTargetName).ToLowerInvariant();
            if (key.Length > 0) SnoozedUntil[key] = DateTime.UtcNow.AddMilliseconds(_snoozeDurationMs);
            ResetOverlayTarget();
        }
        App.Log.Write($"[Focus] Blocked app snoozed for {_snoozeDurationMs} ms");
        HideOverlay();
        EnforcePendingClose();
    }

    internal static void MovePresentationToTaskbar()
    {
        Application.Current.Dispatcher.Invoke(() =>
        {
            FocusPanelWindow.Current?.Stop();
            FocusTrayButtonWindow.GetOrCreate().ShowTray();
        });
    }

    internal static void MovePresentationToPanel()
    {
        Application.Current.Dispatcher.Invoke(() =>
        {
            FocusTrayButtonWindow.Current?.HideTray();
            FocusPanelWindow.GetOrCreate().ShowAgain();
        });
    }

    internal static void ResetPanelPosition() => Application.Current.Dispatcher.Invoke(() => FocusPanelWindow.Current?.PositionBottomRight());

    private static string DisplayName(string processName, string exePath)
    {
        var fromPath = string.IsNullOrEmpty(exePath) ? null : System.IO.Path.GetFileNameWithoutExtension(exePath);
        var name = string.IsNullOrWhiteSpace(fromPath) ? processName : fromPath;
        return string.IsNullOrWhiteSpace(name) ? "This app" : name;
    }

    private static bool IsOwnWindow(IntPtr handle)
    {
        foreach (Window window in Application.Current.Windows)
        {
            try
            {
                if (new WindowInteropHelper(window).Handle == handle) return true;
            }
            catch
            {
                // A window without a handle yet cannot be ours.
            }
        }
        return false;
    }

    /// <summary>The session's snooze length in minutes, for the overlay's button copy.</summary>
    internal static double SessionSnoozeMinutes()
    {
        lock (StateLock) return Math.Max(1, _snoozeDurationMs / 60000.0);
    }

    internal static string SessionTitle()
    {
        lock (StateLock) return string.IsNullOrWhiteSpace(_title) ? "Focus session" : _title;
    }

    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);

    // -----------------------------------------------------------------------------------------
    // Shared host helpers for the focus windows
    // -----------------------------------------------------------------------------------------

    internal sealed record FocusPanelAction(
        [property: JsonPropertyName("action")] string Action,
        [property: JsonPropertyName("durationMs")] double? DurationMs);

    internal static void PostPanelAction(string action, double? durationMs = null)
    {
        var payload = JsonSerializer.SerializeToElement(new FocusPanelAction(action, durationMs));
        var mw = Application.Current.MainWindow as MainWindow;
        mw?.PostToRenderer("focus.panelAction", payload);

        // Update local host state immediately so floating panel and tray react instantly
        Application.Current.Dispatcher.Invoke(() =>
        {
            if (action == "pause") PauseSession();
            else if (action == "resume") ResumeSession();
            else if (action == "complete") CompleteSession();
            else if (action == "cancel") CancelSession();
        });

        // Also route directly to the Node backend state machine
        _ = Task.Run(async () =>
        {
            try
            {
                if (action == "pause")
                {
                    await (mw?.RequestBackendAsync("focus.pauseSession", new { durationMs }) ?? Task.FromResult<JsonElement?>(null));
                }
                else if (action == "resume")
                {
                    await (mw?.RequestBackendAsync("focus.resumeSession", new { }) ?? Task.FromResult<JsonElement?>(null));
                }
                else if (action == "complete")
                {
                    await (mw?.RequestBackendAsync("focus.completeSession", new { }) ?? Task.FromResult<JsonElement?>(null));
                }
                else if (action == "cancel")
                {
                    await (mw?.RequestBackendAsync("focus.cancelSession", new { }) ?? Task.FromResult<JsonElement?>(null));
                }
            }
            catch (Exception ex)
            {
                App.Log.Write($"[Focus] backend request for {action} failed: {ex.Message}");
            }
        });
    }

    /// <summary>The green Raycast Focus mark used on the panel pill, tray button and menus.</summary>
    internal static FrameworkElement BuildFocusMark(double size)
    {
        var grid = new Grid { Width = size, Height = size };
        var badge = new Border
        {
            Background = new SolidColorBrush(Color.FromRgb(0x0e, 0x3d, 0x26)),
            BorderBrush = new SolidColorBrush(Color.FromRgb(0x30, 0xa4, 0x6e)),
            BorderThickness = new Thickness(1.5),
            CornerRadius = new CornerRadius(size * 0.3),
        };
        var glyph = new TextBlock
        {
            Text = "\uE72C", // Segoe MDL2 Assets bullseye
            FontFamily = new FontFamily("Segoe MDL2 Assets"),
            FontSize = size * 0.58,
            Foreground = Brushes.White,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        };
        badge.Child = glyph;
        grid.Children.Add(badge);
        return grid;
    }

    internal static MenuItem MenuItem(string header, object? icon, RoutedEventHandler onClick)
    {
        var item = new MenuItem { Header = header };
        if (icon is FrameworkElement element) item.Icon = element;
        if (onClick is not null) item.Click += onClick;
        return item;
    }

    internal static FrameworkElement GlyphIcon(string glyph, Brush brush)
    {
        return new TextBlock
        {
            Text = glyph,
            FontFamily = new FontFamily("Segoe MDL2 Assets"),
            FontSize = 13,
            Foreground = brush,
        };
    }
}

/// <summary>
/// The floating Focus panel, matching the Raycast design in the uploaded screenshots:
/// - Fixed 265x40 dark rounded rectangle pill with no height resizing.
/// - Variant 1 (mouse NOT on top): Green target badge + session title ("Focus session").
/// - Variant 2 (mouse ON top): Pause / Complete / ⋯ action buttons + 2x3 dot grip for dragging.
/// </summary>
public sealed class FocusPanelWindow : Window
{
    private TextBlock _title = null!;
    private Border _idleRow = null!;
    private Border _hoverRow = null!;
    private Button _pauseButton = null!;
    private Button _completeButton = null!;
    private Button _moreButton = null!;
    private ContextMenu _pauseMenu = null!;
    private ContextMenu _moreMenu = null!;

    private double? _durationMs;
    private bool _paused;

    public static FocusPanelWindow? Current { get; private set; }

    public static FocusPanelWindow GetOrCreate()
    {
        if (Current is null)
        {
            Current = new FocusPanelWindow();
        }
        return Current;
    }

    private FocusPanelWindow()
    {
        WindowStyle = WindowStyle.None;
        ResizeMode = ResizeMode.NoResize;
        ShowInTaskbar = false;
        ShowActivated = false;
        Topmost = true;
        Width = 265;
        Height = 40;
        Background = Brushes.Transparent;
        AllowsTransparency = true;
        Content = BuildContent();
    }

    private FrameworkElement BuildContent()
    {
        var root = new Border
        {
            Width = 265,
            Height = 40,
            Background = new SolidColorBrush(Color.FromRgb(0x1e, 0x1e, 0x20)),
            CornerRadius = new CornerRadius(8),
            BorderBrush = new SolidColorBrush(Color.FromRgb(0x38, 0x38, 0x3c)),
            BorderThickness = new Thickness(1),
            ClipToBounds = true,
        };

        var grid = new Grid();

        // ---------------------------------------------------------------------------------
        // Variant 1: Mouse NOT on top (Image 1) - Focus target icon + Title
        // ---------------------------------------------------------------------------------
        _idleRow = new Border
        {
            Padding = new Thickness(10, 0, 10, 0),
            VerticalAlignment = VerticalAlignment.Stretch,
            HorizontalAlignment = HorizontalAlignment.Stretch,
            Background = Brushes.Transparent,
        };

        var idleStack = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            VerticalAlignment = VerticalAlignment.Center,
        };
        idleStack.Children.Add(FocusSession.BuildFocusMark(22));

        _title = new TextBlock
        {
            Text = "Focus session",
            Foreground = Brushes.White,
            FontSize = 13,
            FontWeight = FontWeights.SemiBold,
            FontFamily = new FontFamily("Segoe UI"),
            Margin = new Thickness(10, 0, 0, 0),
            VerticalAlignment = VerticalAlignment.Center,
            MaxWidth = 210,
            TextTrimming = TextTrimming.CharacterEllipsis,
        };
        idleStack.Children.Add(_title);
        _idleRow.Child = idleStack;

        // ---------------------------------------------------------------------------------
        // Variant 2: Mouse ON top (Image 2) - Pause + Complete + ⋯ + Grip
        // ---------------------------------------------------------------------------------
        _hoverRow = new Border
        {
            Padding = new Thickness(8, 0, 8, 0),
            VerticalAlignment = VerticalAlignment.Stretch,
            HorizontalAlignment = HorizontalAlignment.Stretch,
            Background = Brushes.Transparent,
            Visibility = Visibility.Collapsed,
        };

        var hoverGrid = new Grid { VerticalAlignment = VerticalAlignment.Center };
        hoverGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        hoverGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        hoverGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var buttonStack = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            VerticalAlignment = VerticalAlignment.Center,
        };

        _pauseButton = PanelButton("Pause", "\uE769", OnPauseClicked, OnPauseRightClicked);
        _completeButton = PanelButton("Complete", "\uE73E", OnCompleteClicked, null);
        _moreButton = PanelIconButton("\uE10C", OnMoreClicked);

        buttonStack.Children.Add(_pauseButton);
        buttonStack.Children.Add(_completeButton);
        buttonStack.Children.Add(_moreButton);

        Grid.SetColumn(buttonStack, 0);
        hoverGrid.Children.Add(buttonStack);

        var grip = BuildGrip();
        Grid.SetColumn(grip, 2);
        hoverGrid.Children.Add(grip);

        _hoverRow.Child = hoverGrid;

        grid.Children.Add(_idleRow);
        grid.Children.Add(_hoverRow);

        root.MouseEnter += (_, _) =>
        {
            _idleRow.Visibility = Visibility.Collapsed;
            _hoverRow.Visibility = Visibility.Visible;
        };
        root.MouseLeave += (_, _) =>
        {
            _idleRow.Visibility = Visibility.Visible;
            _hoverRow.Visibility = Visibility.Collapsed;
        };

        root.Child = grid;
        return root;
    }

    private static Button PanelButton(string label, string glyph, RoutedEventHandler onClick, MouseButtonEventHandler? onRightClick)
    {
        var row = new StackPanel { Orientation = Orientation.Horizontal, VerticalAlignment = VerticalAlignment.Center };
        row.Children.Add(new TextBlock
        {
            Text = label,
            Foreground = new SolidColorBrush(Color.FromRgb(0xf0, 0xf0, 0xf2)),
            FontSize = 12,
            FontWeight = FontWeights.SemiBold,
            FontFamily = new FontFamily("Segoe UI"),
            VerticalAlignment = VerticalAlignment.Center,
        });
        row.Children.Add(new TextBlock
        {
            Text = glyph,
            FontFamily = new FontFamily("Segoe MDL2 Assets"),
            FontSize = 11,
            Foreground = new SolidColorBrush(Color.FromRgb(0xd0, 0xd0, 0xd5)),
            Margin = new Thickness(6, 0, 0, 0),
            VerticalAlignment = VerticalAlignment.Center,
        });

        var button = new Button
        {
            Content = row,
            Background = new SolidColorBrush(Color.FromRgb(0x32, 0x32, 0x35)),
            BorderThickness = new Thickness(0),
            Margin = new Thickness(0, 0, 6, 0),
            Padding = new Thickness(9, 4, 9, 5),
            Cursor = Cursors.Hand,
            Height = 28,
        };
        button.Click += onClick;
        if (onRightClick is not null) button.MouseRightButtonUp += onRightClick;
        return button;
    }

    private static Button PanelIconButton(string glyph, RoutedEventHandler onClick)
    {
        var icon = new TextBlock
        {
            Text = glyph,
            FontFamily = new FontFamily("Segoe MDL2 Assets"),
            FontSize = 12,
            Foreground = new SolidColorBrush(Color.FromRgb(0xd0, 0xd0, 0xd5)),
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        };

        var button = new Button
        {
            Content = icon,
            Background = new SolidColorBrush(Color.FromRgb(0x32, 0x32, 0x35)),
            BorderThickness = new Thickness(0),
            Padding = new Thickness(8, 4, 8, 5),
            Cursor = Cursors.Hand,
            Height = 28,
            MinWidth = 28,
        };
        button.Click += onClick;
        return button;
    }

    /// <summary>The 2x3 dot grip for dragging the window.</summary>
    private FrameworkElement BuildGrip()
    {
        var grid = new Grid
        {
            Margin = new Thickness(8, 0, 4, 0),
            VerticalAlignment = VerticalAlignment.Center,
            Cursor = Cursors.SizeAll,
            Background = Brushes.Transparent,
            Width = 14,
            Height = 18,
        };
        for (var row = 0; row < 3; row++)
        {
            grid.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
        }
        for (var column = 0; column < 2; column++)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }
        for (var row = 0; row < 3; row++)
        {
            for (var column = 0; column < 2; column++)
            {
                var dot = new Ellipse
                {
                    Width = 2.6,
                    Height = 2.6,
                    Fill = new SolidColorBrush(Color.FromRgb(0x8a, 0x8a, 0x90)),
                    HorizontalAlignment = HorizontalAlignment.Center,
                    VerticalAlignment = VerticalAlignment.Center,
                };
                Grid.SetRow(dot, row);
                Grid.SetColumn(dot, column);
                grid.Children.Add(dot);
            }
        }
        grid.MouseLeftButtonDown += (_, e) =>
        {
            if (e.LeftButton == MouseButtonState.Pressed)
            {
                try
                {
                    DragMove();
                }
                catch
                {
                    // DragMove throws if released already.
                }
            }
        };
        return grid;
    }

    private void BuildMenus()
    {
        _pauseMenu = new ContextMenu();
        foreach (var (label, durationMs) in new[]
        {
            ("Pause for 1 minute", 60000.0),
            ("Pause for 2 minutes", 120000.0),
            ("Pause for 5 minutes", 300000.0),
            ("Pause for 10 minutes", 600000.0),
            ("Indefinitely", double.NaN),
        })
        {
            var captured = durationMs;
            _pauseMenu.Items.Add(FocusSession.MenuItem(
                label,
                null,
                (_, _) => FocusSession.PostPanelAction("pause", double.IsNaN(captured) ? null : captured)));
        }

        _moreMenu = new ContextMenu();
        _moreMenu.Items.Add(FocusSession.MenuItem("Edit", FocusSession.GlyphIcon("\uE70F", Brushes.Gainsboro), (_, _) => FocusSession.PostPanelAction("edit")));
        _moreMenu.Items.Add(FocusSession.MenuItem("Cancel", FocusSession.GlyphIcon("\uE711", Brushes.Gainsboro), (_, _) => FocusSession.PostPanelAction("cancel")));
        _moreMenu.Items.Add(FocusSession.MenuItem("Move to Taskbar", FocusSession.GlyphIcon("\uE710", Brushes.Gainsboro), (_, _) => FocusSession.MovePresentationToTaskbar()));
        _moreMenu.Items.Add(FocusSession.MenuItem("Reset Panel Position", FocusSession.GlyphIcon("\uE7F8", Brushes.Gainsboro), (_, _) => FocusSession.ResetPanelPosition()));
    }

    private void OpenMenu(ContextMenu menu, FrameworkElement target)
    {
        menu.PlacementTarget = target;
        menu.Placement = System.Windows.Controls.Primitives.PlacementMode.Bottom;
        menu.IsOpen = true;
    }

    private void OnPauseClicked(object sender, RoutedEventArgs e)
    {
        if (_paused)
        {
            FocusSession.PostPanelAction("resume");
        }
        else
        {
            FocusSession.PostPanelAction("pause");
        }
    }

    private void OnPauseRightClicked(object sender, MouseButtonEventArgs e)
    {
        OpenMenu(_pauseMenu, _pauseButton);
        e.Handled = true;
    }

    private void OnCompleteClicked(object sender, RoutedEventArgs e) => FocusSession.PostPanelAction("complete");

    private void OnMoreClicked(object sender, RoutedEventArgs e) => OpenMenu(_moreMenu, (Button)sender);

    public void Start(string title, double? durationMs)
    {
        _title.Text = string.IsNullOrWhiteSpace(title) ? "Focus session" : title;
        _durationMs = durationMs;
        _paused = false;
        _pauseButton.Content = PanelButtonRow("Pause", "\uE769");
        _idleRow.Visibility = Visibility.Visible;
        _hoverRow.Visibility = Visibility.Collapsed;
        BuildMenus();
        PositionBottomRight();
        Show();
    }

    public void ShowAgain()
    {
        PositionBottomRight();
        Show();
    }

    public void Pause()
    {
        _paused = true;
        _pauseButton.Content = PanelButtonRow("Resume", "\uE768");
    }

    public void Resume()
    {
        _paused = false;
        _pauseButton.Content = PanelButtonRow("Pause", "\uE769");
    }

    public void Stop()
    {
        Hide();
    }

    private static StackPanel PanelButtonRow(string label, string glyph)
    {
        var row = new StackPanel { Orientation = Orientation.Horizontal, VerticalAlignment = VerticalAlignment.Center };
        row.Children.Add(new TextBlock
        {
            Text = label,
            Foreground = new SolidColorBrush(Color.FromRgb(0xf0, 0xf0, 0xf2)),
            FontSize = 12,
            FontWeight = FontWeights.SemiBold,
            FontFamily = new FontFamily("Segoe UI"),
            VerticalAlignment = VerticalAlignment.Center,
        });
        row.Children.Add(new TextBlock
        {
            Text = glyph,
            FontFamily = new FontFamily("Segoe MDL2 Assets"),
            FontSize = 11,
            Foreground = new SolidColorBrush(Color.FromRgb(0xd0, 0xd0, 0xd5)),
            Margin = new Thickness(6, 0, 0, 0),
            VerticalAlignment = VerticalAlignment.Center,
        });
        return row;
    }

    internal void PositionBottomRight()
    {
        var area = SystemParameters.WorkArea;
        Left = area.Left + area.Width - Width - 24;
        Top = area.Top + area.Height - Height - 24;
    }

    protected override void OnSourceInitialized(EventArgs e)
    {
        base.OnSourceInitialized(e);
        var handle = new WindowInteropHelper(this).Handle;
        var exStyle = GetWindowLong(handle, GWL_EXSTYLE);
        SetWindowLong(handle, GWL_EXSTYLE, exStyle | WS_EX_TOOLWINDOW);
    }

    private const int GWL_EXSTYLE = -20;
    private const int WS_EX_TOOLWINDOW = 0x00000080;

    [DllImport("user32.dll", EntryPoint = "GetWindowLongW")]
    private static extern int GetWindowLong(IntPtr hwnd, int index);

    [DllImport("user32.dll", EntryPoint = "SetWindowLongW")]
    private static extern int SetWindowLong(IntPtr hwnd, int index, int newStyle);
}

/// <summary>
/// The Move to Taskbar presentation: a real tray icon (Shell_NotifyIcon) with the session menu —
/// header, Pause (submenu with the five durations), Complete, Cancel, Detach from Taskbar.
/// </summary>
public sealed class FocusTrayButtonWindow : Window
{
    private const int WM_TRAYICON = unchecked((int)0x8000u); // WM_APP — kept as int so msg comparison doesn't overflow
    private const uint NIM_ADD = 0;
    private const uint NIM_MODIFY = 1;
    private const uint NIM_DELETE = 2;
    private const uint NIF_MESSAGE = 1;
    private const uint NIF_ICON = 2;
    private const uint NIF_TIP = 4;
    private const uint WM_LBUTTONUP = 0x0202;
    private const uint WM_RBUTTONUP = 0x0205;

    private ContextMenu _menu = null!;
    private bool _added;
    private System.Drawing.Icon? _icon;

    public static FocusTrayButtonWindow? Current { get; private set; }

    public static FocusTrayButtonWindow GetOrCreate()
    {
        if (Current is null)
        {
            Current = new FocusTrayButtonWindow();
        }
        return Current;
    }

    private FocusTrayButtonWindow()
    {
        WindowStyle = WindowStyle.None;
        ShowInTaskbar = false;
        ShowActivated = false;
        // Position off-screen so if briefly visible it doesn't flash.
        // Do NOT set WindowState=Minimized — that can prevent HWND creation before Show().
        Left = -32000;
        Top = -32000;
        Width = 1;
        Height = 1;
        Opacity = 0;
        AllowsTransparency = true;
        Background = Brushes.Transparent;
    }

    protected override void OnSourceInitialized(EventArgs e)
    {
        base.OnSourceInitialized(e);
        var handle = new WindowInteropHelper(this).Handle;
        var source = HwndSource.FromHwnd(handle);
        source?.AddHook(WndProc);
    }

    private IntPtr WndProc(IntPtr hwnd, int msg, IntPtr wParam, IntPtr lParam, ref bool handled)
    {
        if (msg == WM_TRAYICON && _added)
        {
            var mouse = lParam.LowWord();
            if (mouse == WM_LBUTTONUP || mouse == WM_RBUTTONUP)
            {
                Dispatcher.BeginInvoke(OpenMenu);
                handled = true;
            }
        }
        return IntPtr.Zero;
    }

    private System.Drawing.Icon TrayIcon()
    {
        if (_icon is not null) return _icon;
        using var bitmap = new System.Drawing.Bitmap(32, 32);
        using (var graphics = System.Drawing.Graphics.FromImage(bitmap))
        {
            graphics.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.AntiAlias;
            using var fill = new System.Drawing.SolidBrush(System.Drawing.Color.FromArgb(0x30, 0xA4, 0x6E));
            graphics.FillRectangle(fill, 4, 4, 24, 24);
            using var text = new System.Drawing.SolidBrush(System.Drawing.Color.White);
            using var font = new System.Drawing.Font("Segoe MDL2 Assets", 13f, System.Drawing.FontStyle.Regular, System.Drawing.GraphicsUnit.Pixel);
            var size = graphics.MeasureString("\uE72C", font);
            graphics.DrawString("\uE72C", font, text, (32 - size.Width) / 2f, (32 - size.Height) / 2f);
        }
        _icon = System.Drawing.Icon.FromHandle(bitmap.GetHicon());
        return _icon;
    }

    public void ShowTray()
    {
        // Ensure HWND exists before passing it to Shell_NotifyIcon.
        EnsureHandle();
        var handle = new WindowInteropHelper(this).Handle;
        if (handle == IntPtr.Zero)
        {
            App.Log.Write("[Focus] ShowTray: could not get window handle");
            return;
        }
        var data = new NOTIFYICONDATA
        {
            cbSize = Marshal.SizeOf<NOTIFYICONDATA>(),
            hWnd = handle,
            uID = 1,
            uFlags = NIF_MESSAGE | NIF_ICON | NIF_TIP,
            uCallbackMessage = unchecked((uint)WM_TRAYICON),
            hIcon = TrayIcon().Handle,
            szTip = "Openray Focus",
        };
        var ok = _added
            ? Shell_NotifyIcon(NIM_MODIFY, ref data)
            : Shell_NotifyIcon(NIM_ADD, ref data);
        if (ok) _added = true;
        App.Log.Write($"[Focus] tray icon {(_added && ok ? "added/updated" : "failed")}");
    }

    private void EnsureHandle()
    {
        if (new WindowInteropHelper(this).Handle != IntPtr.Zero) return;
        // Show then hide forces HWND creation; the window is off-screen and transparent.
        Visibility = Visibility.Visible;
        Show();
        Dispatcher.Invoke(() => { }, System.Windows.Threading.DispatcherPriority.Render);
        Hide();
    }

    private void BuildMenu()
    {
        _menu = new ContextMenu();
        var header = new MenuItem { Header = FocusSession.SessionTitle(), IsEnabled = false };
        _menu.Items.Add(header);
        _menu.Items.Add(new Separator());

        var pause = new MenuItem { Header = "Pause" };
        pause.Icon = FocusSession.GlyphIcon("\uE769", Brushes.Gainsboro);
        foreach (var (label, durationMs) in new[]
        {
            ("Pause for 1 minute", 60000.0),
            ("Pause for 2 minutes", 120000.0),
            ("Pause for 5 minutes", 300000.0),
            ("Pause for 10 minutes", 600000.0),
            ("Indefinitely", double.NaN),
        })
        {
            var captured = durationMs;
            pause.Items.Add(FocusSession.MenuItem(
                label,
                null,
                (_, _) => FocusSession.PostPanelAction("pause", double.IsNaN(captured) ? null : captured)));
        }
        _menu.Items.Add(pause);

        _menu.Items.Add(FocusSession.MenuItem("Complete", FocusSession.GlyphIcon("\uE73E", Brushes.Gainsboro), (_, _) => FocusSession.PostPanelAction("complete")));
        _menu.Items.Add(FocusSession.MenuItem("Cancel", FocusSession.GlyphIcon("\uE711", Brushes.Gainsboro), (_, _) => FocusSession.PostPanelAction("cancel")));
        _menu.Items.Add(new Separator());
        _menu.Items.Add(FocusSession.MenuItem("Detach from Taskbar", FocusSession.GlyphIcon("\uE8A9", Brushes.Gainsboro), (_, _) => FocusSession.MovePresentationToPanel()));
    }

    [DllImport("user32.dll")]
    private static extern bool SetForegroundWindow(IntPtr hWnd);

    private void OpenMenu()
    {
        BuildMenu();
        var handle = new WindowInteropHelper(this).Handle;
        SetForegroundWindow(handle);
        _menu.Placement = System.Windows.Controls.Primitives.PlacementMode.MousePoint;
        _menu.IsOpen = true;
    }

    public void HideTray()
    {
        if (!_added) return;
        var handle = new WindowInteropHelper(this).Handle;
        if (handle == IntPtr.Zero) return;
        var data = new NOTIFYICONDATA
        {
            cbSize = Marshal.SizeOf<NOTIFYICONDATA>(),
            hWnd = handle,
            uID = 1,
        };
        Shell_NotifyIcon(NIM_DELETE, ref data);
        _added = false;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct NOTIFYICONDATA
    {
        public int cbSize;
        public IntPtr hWnd;
        public uint uID;
        public uint uFlags;
        public uint uCallbackMessage;
        public IntPtr hIcon;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)]
        public string szTip;
    }

    [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool Shell_NotifyIcon(uint message, ref NOTIFYICONDATA data);
}

internal static class IntPtrExtensions
{
    public static uint LowWord(this IntPtr value) => unchecked((uint)((long)value & 0xFFFF));
}

/// <summary>
/// The fullscreen blocked-app overlay: a dark window covering the blocked app's monitor with
/// the bullseye mark, "X has been blocked by Openray", a Snooze button, and
/// "Switching focus to another window will close this app."
/// </summary>
public sealed class FocusOverlayWindow : Window
{
    private TextBlock _title = null!;
    private Button _snoozeButton = null!;

    public static FocusOverlayWindow? Current { get; private set; }

    public static FocusOverlayWindow GetOrCreate()
    {
        if (Current is null)
        {
            Current = new FocusOverlayWindow();
        }
        return Current;
    }

    private FocusOverlayWindow()
    {
        WindowStyle = WindowStyle.None;
        ResizeMode = ResizeMode.NoResize;
        ShowInTaskbar = false;
        ShowActivated = false;
        Topmost = true;
        Background = Brushes.Black;
        Content = BuildContent();
    }

    private FrameworkElement BuildContent()
    {
        var stack = new StackPanel { HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center };

        stack.Children.Add(BuildBlockedIcon());

        _title = new TextBlock
        {
            Foreground = Brushes.White,
            FontSize = 17,
            FontWeight = FontWeights.Bold,
            HorizontalAlignment = HorizontalAlignment.Center,
            Margin = new Thickness(0, 14, 0, 0),
        };
        stack.Children.Add(_title);

        _snoozeButton = new Button
        {
            Content = "Snooze for 3 minutes",
            Foreground = Brushes.White,
            Background = new SolidColorBrush(Color.FromRgb(0x3a, 0x3a, 0x3d)),
            BorderThickness = new Thickness(0),
            FontSize = 13,
            Padding = new Thickness(18, 8, 18, 9),
            HorizontalAlignment = HorizontalAlignment.Center,
            Margin = new Thickness(0, 18, 0, 0),
            Cursor = Cursors.Hand,
        };
        _snoozeButton.Click += (_, _) => FocusSession.SnoozeCurrentOverlay();
        stack.Children.Add(_snoozeButton);

        stack.Children.Add(new TextBlock
        {
            Text = "Switching focus to another window will close this app.",
            Foreground = new SolidColorBrush(Color.FromRgb(0xc4, 0xc4, 0xc8)),
            FontSize = 12,
            HorizontalAlignment = HorizontalAlignment.Center,
            Margin = new Thickness(0, 18, 0, 0),
        });

        return stack;
    }

    private static FrameworkElement BuildBlockedIcon()
    {
        var grid = new Grid { Width = 34, Height = 34, HorizontalAlignment = HorizontalAlignment.Center };
        var outer = new Ellipse
        {
            Stroke = Brushes.White,
            StrokeThickness = 2,
            Width = 24,
            Height = 24,
            Margin = new Thickness(0, 0, 6, 6),
        };
        var inner = new Ellipse
        {
            Stroke = Brushes.White,
            StrokeThickness = 2,
            Width = 10,
            Height = 10,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
            Margin = new Thickness(0, 0, 6, 6),
        };
        var cursor = new TextBlock
        {
            Text = "\uE8B9",
            FontFamily = new FontFamily("Segoe MDL2 Assets"),
            FontSize = 14,
            Foreground = Brushes.White,
            HorizontalAlignment = HorizontalAlignment.Right,
            VerticalAlignment = VerticalAlignment.Bottom,
        };
        grid.Children.Add(outer);
        grid.Children.Add(inner);
        grid.Children.Add(cursor);
        return grid;
    }

    public void ShowOver(IntPtr foregroundHwnd, string appName)
    {
        _title.Text = $"{appName} has been blocked by Openray";
        _snoozeButton.Content = $"Snooze for {(int)Math.Round(FocusSession.SessionSnoozeMinutes())} minutes";
        AnchorToWindowOf(foregroundHwnd);
        Topmost = true;
        Show();
        try { Activate(); } catch { }
    }

    /// <summary>Sizes and positions the overlay to cover exactly the blocked app's window.</summary>
    private void AnchorToWindowOf(IntPtr hwnd)
    {
        // Try to get the window's actual rect first.
        if (GetWindowRect(hwnd, out var rect))
        {
            double scale = 1.0;
            try
            {
                var dpi = GetDpiForWindow(hwnd);
                if (dpi > 0) scale = dpi / 96.0;
            }
            catch { scale = 1.0; }
            if (scale <= 0 || double.IsNaN(scale)) scale = 1.0;

            Left   = rect.Left   / scale;
            Top    = rect.Top    / scale;
            Width  = Math.Max(1, (rect.Right  - rect.Left) / scale);
            Height = Math.Max(1, (rect.Bottom - rect.Top)  / scale);
            return;
        }

        // Fall back to the monitor bounds if the window rect is unavailable.
        AnchorToMonitorOf(hwnd);
    }

    private void AnchorToMonitorOf(IntPtr hwnd)
    {
        var monitor = MonitorFromWindow(hwnd, MonitorDefaultToNearest);
        var info = new MONITORINFO { cbSize = Marshal.SizeOf<MONITORINFO>() };
        if (!GetMonitorInfo(monitor, ref info))
        {
            Left = 0;
            Top = 0;
            Width = SystemParameters.PrimaryScreenWidth;
            Height = SystemParameters.PrimaryScreenHeight;
            return;
        }

        var scale = 1.0;
        try
        {
            var dpi = GetDpiForWindow(hwnd);
            if (dpi > 0) scale = dpi / 96.0;
        }
        catch
        {
            scale = 1.0;
        }
        if (scale <= 0 || double.IsNaN(scale)) scale = 1.0;

        Left = info.rcMonitor.Left / scale;
        Top = info.rcMonitor.Top / scale;
        Width = (info.rcMonitor.Right - info.rcMonitor.Left) / scale;
        Height = (info.rcMonitor.Bottom - info.rcMonitor.Top) / scale;
    }

    public void HideNow() => Hide();

    protected override void OnSourceInitialized(EventArgs e)
    {
        base.OnSourceInitialized(e);
        var handle = new WindowInteropHelper(this).Handle;
        var exStyle = GetWindowLong(handle, GWL_EXSTYLE);
        SetWindowLong(handle, GWL_EXSTYLE, exStyle | WS_EX_TOOLWINDOW);
    }

    private const int GWL_EXSTYLE = -20;
    private const int WS_EX_TOOLWINDOW = 0x00000080;
    private const uint MonitorDefaultToNearest = 2;

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
    private static extern IntPtr MonitorFromWindow(IntPtr hwnd, uint flags);

    [DllImport("user32.dll", CharSet = CharSet.Auto)]
    private static extern bool GetMonitorInfo(IntPtr monitor, ref MONITORINFO info);

    [DllImport("user32.dll")]
    private static extern uint GetDpiForWindow(IntPtr hwnd);

    [DllImport("user32.dll", EntryPoint = "GetWindowLongW")]
    private static extern int GetWindowLong(IntPtr hwnd, int index);

    [DllImport("user32.dll", EntryPoint = "SetWindowLongW")]
    private static extern int SetWindowLong(IntPtr hwnd, int index, int newStyle);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetWindowRect(IntPtr hwnd, out RECT rect);
}

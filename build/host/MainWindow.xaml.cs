// The launcher window.
//
// A borderless, topmost, centred window that shows/hides on a global hotkey — the shape of
// Raycast's `Raycast.WebView.MainWindow` / `Raycast.WebView.Window`. WebView2 hosts the TypeScript
// frontend from a virtual host mapping, exactly like Raycast's `Raycast.WebView.ResourceHandler` +
// `<HandleWebResourceRequest>` serve `frontend/main-window.html` over a custom scheme.

using System.ComponentModel;
using System.IO;
using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Interop;
using System.Windows.Media;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;

namespace RaycastMini.Launcher;

public partial class MainWindow : Window
{
    private const int HotkeyId = 0x1000;
    private const uint ModAlt = 0x0001;
    private const uint ModControl = 0x0002;
    private const uint VkSpace = 0x20;

    private readonly WebView2 _webView = new();
    private readonly BackendProcess _backend;
    private readonly NamedPipeBridge _pipe;
    private readonly WebViewBridge _bridge;
    private SettingsWindow? _settingsWindow;
    private bool _reallyClosing;
    // Loaded re-fires every time the window is hidden and shown again (the launcher hides itself
    // whenever it loses focus, which can happen seconds after startup). A second
    // EnsureCoreWebView2Async while the first is still in flight fails with 0x800700AA
    // ("resource in use") and used to leave a black window — so initialization runs exactly once.
    private int _webViewInitState; // 0 = not started, 1 = in flight, 2 = done

    public MainWindow(NamedPipeBridge pipe, BackendProcess backend)
    {
        _pipe = pipe;
        _backend = backend;

        InitializeComponent();

        Title = "Raycast Mini";
        Width = 720;
        Height = 480;
        Topmost = true;
        ShowInTaskbar = false;

        // The WebView2 must be transparent too, otherwise the rounded frame is filled by an opaque
        // white rectangle before the page paints.
        _webView.DefaultBackgroundColor = System.Drawing.Color.Transparent;

        var border = (System.Windows.Controls.Border)FindName("Root");
        border.Child = _webView;

        _bridge = new WebViewBridge(_webView);
        _bridge.Install(DispatchIpcAsync);

        Loaded += OnLoaded;
        Closing += OnClosing;

        // Raycast hides the launcher when it loses focus. `--keep-open` (or
        // RAYCAST_MINI_KEEP_OPEN=1) keeps it on screen, which is handy when debugging.
        // WebView2's controller creation requires a visible parent: hiding mid-init (launched from
        // a background terminal, focus flickers) fails EnsureCoreWebView2Async with 0x800700AA
        // ("resource in use"), so the hide is deferred until initialisation settles.
        var keepOpen = Environment.GetEnvironmentVariable("RAYCAST_MINI_KEEP_OPEN") == "1" ||
                       Environment.GetCommandLineArgs().Any(arg =>
                           arg.Equals("--keep-open", StringComparison.OrdinalIgnoreCase));
        if (!keepOpen)
        {
            Deactivated += (_, _) =>
            {
                if (_webViewInitState == 1) return;
                Hide();
            };
        }

        // Remember which window had focus before the launcher took over, so Paste can hand it back.
        // Raycast keeps the same handle (`paste: no last foreground window available` when it is gone).
        Deactivated += (_, _) => ClipboardHistory.RecordForegroundWindow();
    }

    private async void OnLoaded(object sender, RoutedEventArgs e)
    {
        // Re-entrant Loaded guard: only the first invocation initialises WebView2. On failure the
        // state resets so a later show can retry.
        if (System.Threading.Interlocked.CompareExchange(ref _webViewInitState, 1, 0) != 0) return;

        // Async void: an exception here would disappear and leave a black window. Log it and show
        // the error inside the window instead.
        try
        {
            var environment = await CoreWebView2Environment.CreateAsync(
                userDataFolder: Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                    "RaycastMini",
                    "WebView2"));

            await _webView.EnsureCoreWebView2Async(environment);
            _webViewInitState = 2;
        }
        catch (Exception error)
        {
            _webViewInitState = 0;
            App.Log.Write($"[webview2] initialisation failed: {error}");
            Content = new System.Windows.Controls.TextBlock
            {
                Text = $"WebView2 failed to initialise:\n{error.Message}\n\nSee launcher.log / launcher-fallback.log next to the exe.",
                Foreground = System.Windows.Media.Brushes.IndianRed,
                Margin = new Thickness(16),
                TextWrapping = System.Windows.TextWrapping.Wrap,
            };
            return;
        }

        // Raycast maps the frontend bundle onto a virtual host; we do the same so that module
        // scripts, relative asset URLs and `crossorigin` all behave as they do in production.
        var frontend = _backend.FrontendRoot;
        var html = Path.Combine(frontend, "dist", "main-window.html");
        _webView.CoreWebView2.SetVirtualHostNameToFolderMapping(
            "raycast.mini", frontend, CoreWebView2HostResourceAccessKind.Allow);

        _webView.CoreWebView2.Navigate(
            File.Exists(html) ? $"https://raycast.mini/dist/main-window.html?v={DateTime.UtcNow.Ticks}" : $"file:///{html}");

        // Prewarm the floating-HUD window so its page is loaded and ready before the first
        // `window.showHud` (the handshake would hold the payload anyway, but this removes the
        // first-show latency entirely).
        _ = HudWindow.GetOrCreate(() => _backend.FrontendRoot).PrewarmAsync();

        // Dev flag: `--dev-extensions` (or RAYCAST_MINI_DEV_EXTENSIONS=1) reveals the internal test
        // extensions in the root search (RaycastMini: `command-ux-test`).
        if (Environment.GetCommandLineArgs().Any(arg => arg.Equals("--dev-extensions", StringComparison.OrdinalIgnoreCase)) ||
            Environment.GetEnvironmentVariable("RAYCAST_MINI_DEV_EXTENSIONS") == "1")
        {
            App.DevExtensions = true;
            PostToRenderer("window.devExtensions",
                System.Text.Json.JsonSerializer.SerializeToElement(new { enabled = true }));
        }
        // Diagnostics: read the renderer's own IPC state back so a broken bridge is visible in
        // launcher.log instead of a silent empty UI.
        _ = Task.Run(async () =>
        {
            for (var attempt = 0; attempt < 6; attempt++)
            {
                await Task.Delay(2000);
                try
                {
                    // CoreWebView2 is UI-thread affine, so hop to the dispatcher and unwrap twice.
                    var dispatcherOperation = _webView.Dispatcher.InvokeAsync<Task<string>>(async () =>
                        await _webView.CoreWebView2.ExecuteScriptAsync(
                            "JSON.stringify({ diag: window.__raycastMiniDiag ?? null, errors: window.__raycastMiniErrors ?? null, marks: window.__raycastMiniMarks ?? null, ipcEntries: window.__ipcEntries ?? 0 })"));
                    var inner = await dispatcherOperation;
                    string json = await inner;
                    App.Log.Write($"[diag] {json}");
                }
                catch (Exception error)
                {
                    App.Log.Write($"[diag] failed: {error.Message}");
                    return;
                }
            }
        });
    }

    // -----------------------------------------------------------------------------------------
    // Renderer -> host dispatch. Mirrors the frontend's `ipcRequest.postMessage(method, json,
    // isBackend, …)`: `isBackend` selects Node (extension host) vs. the native .NET host.
    // -----------------------------------------------------------------------------------------

    private async Task<System.Text.Json.JsonElement?> DispatchIpcAsync(
        string method, string jsonParams, System.Text.Json.JsonElement? data, bool isBackend)
    {
        // `Esc` / the footer close action: the renderer asks the host to hide the launcher (the
        // global hotkey brings it back), matching Raycast's `closeMainRaycastWindow`.
        if (method is "window.close" or "window.hide" or "extensionHost.closeMainRaycastWindow")
        {
            _webView.Dispatcher.Invoke(() =>
            {
                Hide();
                PostVisibility(false);
            });
            return null;
        }

        // The renderer (alert store) asking for the launcher while hidden.
        if (method == "window.showMainWindow")
        {
            _webView.Dispatcher.Invoke(ShowMainWindow);
            return null;
        }

        // The toast store's floating-HUD fallback (toast while the launcher is hidden) and the
        // `showHUD` API: the host owns the HUD window, mirroring Raycast's Raycast.dll HUDs.
        if (method == "window.showHud")
        {
            if (data is { ValueKind: System.Text.Json.JsonValueKind.Object } hudPayload)
            {
                _webView.Dispatcher.Invoke(() =>
                    HudWindow.GetOrCreate(() => _backend.FrontendRoot).ShowHud(hudPayload));
            }
            return null;
        }

        if (method == "window.hideHud")
        {
            _webView.Dispatcher.Invoke(() => HudWindow.Current?.HideHud());
            return null;
        }

        // The renderer pulls the dev-extensions flag at startup (the one-shot push can race it).
        if (method == "window.getDevExtensions")
        {
            return System.Text.Json.JsonSerializer.SerializeToElement(new { enabled = App.DevExtensions });
        }

        // Automation only (dev): run a script in the renderer and return its JSON result. The
        // renderer exposes its hooks as `window.__raycastMiniTest` when --dev-extensions is on.
        if (method == "window.eval" && App.DevExtensions)
        {
            var script = data is { ValueKind: System.Text.Json.JsonValueKind.Object } evalPayload &&
                         evalPayload.TryGetProperty("script", out var scriptElement)
                ? scriptElement.GetString()
                : null;
            if (script is null) return null;
            var output = await _webView.CoreWebView2.ExecuteScriptAsync(script);
            App.Log.Write($"[test] {output}");
            return System.Text.Json.JsonSerializer.Deserialize<System.Text.Json.JsonElement>(output);
        }

        if (isBackend)
        {
            // Do not gate on `_backend.IsRunning`: the watchdog may be mid-restart, and the pipe
            // bridge waits for the backend to reconnect before failing.
            if (!_backend.IsRunning) _ = Task.Run(() => _backend.EnsureRunning());
            return await _pipe.RequestAsync("backend", method, data);
        }

        var result = await NativeHost.DispatchAsync(method, data);
        return result is null ? null : System.Text.Json.JsonSerializer.SerializeToElement(result);
    }

    /// <summary>Deliver a host-originated message to the renderer (`z.frontend.*`).</summary>
    public void PostToRenderer(string method, System.Text.Json.JsonElement? data)
    {
        var payload = System.Text.Json.JsonSerializer.Serialize(new
        {
            module = "frontend",
            method,
            data,
        });
        _bridge.PostMessage(payload);
    }

    // -----------------------------------------------------------------------------------------
    // Global hotkey + show/hide
    // -----------------------------------------------------------------------------------------

    private HwndSource? _source;

    private const int ClipboardHotkeyId = 0x1001;

    protected override void OnSourceInitialized(EventArgs e)
    {
        base.OnSourceInitialized(e);
        _source = HwndSource.FromHwnd(new WindowInteropHelper(this).Handle);
        _source?.AddHook(WndProc);
        RegisterHotKey(new WindowInteropHelper(this).Handle, HotkeyId, ModAlt | ModControl, VkSpace);
    }

    private bool _clipboardHotkeyRegistered;
    private string? _clipboardHotkeyText;

    /// <summary>
    /// Registers the Clipboard History shortcut on this window's message pump. Raycast stores the
    /// combination per command and hands it to the host, which is where `Ctrl + Shift + V` lives here.
    /// Returns null when the string cannot be expressed as a modifier pair plus one key.
    /// </summary>
    internal static string? RegisterCommandHotkey(string hotkey) =>
        (System.Windows.Application.Current?.MainWindow as MainWindow)?.SetClipboardHotkey(hotkey);

    private string? SetClipboardHotkey(string hotkey)
    {
        var handle = new WindowInteropHelper(this).Handle;
        if (_clipboardHotkeyRegistered)
        {
            if (UnregisterHotKey(handle, ClipboardHotkeyId)) _clipboardHotkeyRegistered = false;
        }

        if (!TryParseHotkey(hotkey, out var modifiers, out var key))
        {
            App.Log.Write($"[clipboard] could not parse hotkey '{hotkey}'");
            return null;
        }

        if (!RegisterHotKey(handle, ClipboardHotkeyId, modifiers, key))
        {
            App.Log.Write($"[clipboard] Windows refused hotkey '{hotkey}' (error {Marshal.GetLastWin32Error()})");
            return null;
        }
        _clipboardHotkeyRegistered = true;
        _clipboardHotkeyText = hotkey;
        App.Log.Write($"[clipboard] registered clipboard history hotkey '{hotkey}'");
        return hotkey;
    }

    private static bool TryParseHotkey(string hotkey, out uint modifiers, out uint key)
    {
        modifiers = 0;
        key = 0;
        var parts = hotkey.Split('+', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        if (parts.Length < 2) return false;
        foreach (var part in parts[..^1])
        {
            switch (part.ToLowerInvariant())
            {
                case "ctrl":
                    modifiers |= 0x0002;
                    break;
                case "alt":
                    modifiers |= 0x0001;
                    break;
                case "shift":
                    modifiers |= 0x0004;
                    break;
                default:
                    return false;
            }
        }
        if (modifiers == 0) return false;
        key = partToVirtualKey(parts[^1]);
        return key != 0;
    }

    private static uint partToVirtualKey(string part)
    {
        if (part.Length == 1)
        {
            var upper = char.ToUpperInvariant(part[0]);
            if (upper is >= 'A' and <= 'Z') return (uint)upper;
            if (upper is >= '0' and <= '9') return (uint)upper;
            if (part.Length >= 2 && char.ToUpperInvariant(part[0]) == 'F' && part[1] is >= '1' and <= '9')
            {
                return (uint)(0x70 + (part[1] - '0'));
            }
        }
        return part.ToLowerInvariant() switch
        {
            "space" => VkSpace,
            "enter" => 0x0D,
            "tab" => 0x09,
            "escape" => 0x1B,
            "backspace" => 0x08,
            "delete" => 0x2E,
            "insert" => 0x2D,
            "home" => 0x24,
            "end" => 0x23,
            "pageup" => 0x21,
            "pagedown" => 0x22,
            "left" => 0x25,
            "up" => 0x26,
            "right" => 0x27,
            "down" => 0x28,
            _ => 0,
        };
    }

    private void OnClosing(object? sender, CancelEventArgs e)
    {
        if (!_reallyClosing)
        {
            e.Cancel = true;
            Hide();
            return;
        }
        var handle = new WindowInteropHelper(this).Handle;
        UnregisterHotKey(handle, HotkeyId);
    }

    private IntPtr WndProc(IntPtr hwnd, int message, IntPtr wParam, IntPtr lParam, ref bool handled)
    {
        const int WmHotkey = 0x0312;
        if (message == WmHotkey)
        {
            if (wParam.ToInt32() == HotkeyId)
            {
                Toggle();
                handled = true;
            }
            else if (wParam.ToInt32() == ClipboardHotkeyId)
            {
                // The Clipboard History shortcut opens that command directly rather than toggling.
                App.OpenClipboardHistory();
                handled = true;
            }
        }
        return IntPtr.Zero;
    }

    /// <summary>
    /// Reveals the launcher already pointed at Clipboard History, which is what a command hotkey does.
    /// The renderer owns the route, so it is handed the same message the deep link uses.
    /// </summary>
    public void OpenClipboardHistory()
    {
        if (!IsVisible)
        {
            CenterOnScreen();
            Show();
            Activate();
            Topmost = true;
            HudWindow.Current?.OnMainWindowActivated();
            PostVisibility(true);
        }
        _webView.Focus();
        _webView.CoreWebView2?.PostWebMessageAsJson(
            "{\"type\":\"raycast-mini:navigate\",\"route\":\"/extension/clipboard-history\"}");
    }

    public void Toggle()
    {
        if (IsVisible)
        {
            Hide();
            PostVisibility(false);
        }
        else
        {
            CenterOnScreen();
            Show();
            Activate();
            Topmost = true;
            _webView.Focus();
            // Raycast's `Huds`: a pending HUD dies the moment the main window becomes active.
            HudWindow.Current?.OnMainWindowActivated();
            PostVisibility(true);
        }
    }

    /// <summary>
    /// `window.showMainWindow` — the renderer asks for the launcher when an alert arrives while it
    /// is hidden (Raycast's `ipc.host.raycast.showMainWindow({})` from the alert store's `open`).
    /// </summary>
    public void ShowMainWindow()
    {
        if (!IsVisible)
        {
            CenterOnScreen();
            Show();
            Activate();
            Topmost = true;
            PostVisibility(true);
        }
        _webView.Focus();
    }

    /// <summary>Tells the renderer the window was hidden/shown so it can run pop-to-root timers.</summary>
    private void PostVisibility(bool visible)
    {
        try
        {
            PostToRenderer("window.visibilityChanged",
                System.Text.Json.JsonSerializer.SerializeToElement(new { visible }));
        }
        catch
        {
            // The WebView may be mid-teardown; visibility is best-effort.
        }
    }

    private void CenterOnScreen()
    {
        var workArea = SystemParameters.WorkArea;
        Left = workArea.Left + (workArea.Width - Width) / 2;
        Top = workArea.Top + Math.Max(0, (workArea.Height - Height) / 3);
    }

    public void ShutdownForReal()
    {
        _reallyClosing = true;
        // The settings window hides itself on close; shutdown must bypass that.
        _settingsWindow?.ShutdownForReal();
        HudWindow.Current?.Close();
        Close();
    }

    private void OpenSettings()
    {
        if (_settingsWindow is { IsLoaded: true })
        {
            // The settings window hides itself when closed, so a "second instance" just re-shows it.
            if (!_settingsWindow.IsVisible) _settingsWindow.Show();
            if (_settingsWindow.WindowState == WindowState.Minimized) _settingsWindow.WindowState = WindowState.Normal;
            _settingsWindow.Activate();
            return;
        }
        _settingsWindow = new SettingsWindow(_backend.FrontendRoot);
        _settingsWindow.Show();
    }

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool RegisterHotKey(IntPtr hWnd, int id, uint fsModifiers, uint vk);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool UnregisterHotKey(IntPtr hWnd, int id);
}

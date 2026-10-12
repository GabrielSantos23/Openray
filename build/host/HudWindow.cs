// The floating HUD window.
//
// Raycast renders the HUD in a separate always-on-top native window: `Raycast.dll` ships
// `HUDWindowParameters`, `CancelAnimateOut` / `NotifyAnimateOutComplete` and work-area
// positioning, and the frontend drives it through `HudNativeView` (feature `hud`) calling
// `getWindow().animateOut()` after its 1200ms timer. Same split here: this window owns the
// placement and lifetime; the web page (`frontend/hud.html`, `hud-main.tsx`) owns the markup,
// the auto-dismiss timer and the fade-out animation.
//
// Renderer contract (`window.showHud` / `window.hideHud`, dispatched in `MainWindow`):
//
//   showHud  { title, message, variant, durationMs }   -> show + post `hud:show`
//   hideHud                                            -> post `hud:animateOut`
//   page -> host: `hud:size` {width,height}            -> shrink to content, keep bottom anchor
//                 `hud:dismissed`                      -> hide the window

using System.IO;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Windows;
using System.Windows.Interop;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;

namespace RaycastMini.Launcher;

public sealed class HudWindow : Window
{
    private const int FadeOutGraceMs = 2500;

    private readonly WebView2 _webView = new();
    private readonly Func<string> _frontendRoot;
    private int _initState; // 0 = not started, 1 = in flight, 2 = done
    private string? _currentVariant;
    private bool _visible;
    private bool _messageHandlerRegistered;
    // The page registers its message listener asynchronously after Navigate; a payload posted
    // before that handshake would be lost. `hud:ready` from the page opens the gate, and the
    // latest `hud:show` is held until then.
    private bool _pageReady;
    private string? _pendingShowJson;

    public HudWindow(Func<string> frontendRoot)
    {
        _frontendRoot = frontendRoot;

        WindowStyle = WindowStyle.None;
        AllowsTransparency = true;
        Background = System.Windows.Media.Brushes.Transparent;
        ShowInTaskbar = false;
        ShowActivated = false;
        ResizeMode = ResizeMode.NoResize;
        Topmost = true;
        Width = 320;
        Height = 46;
        Content = _webView;
        _webView.DefaultBackgroundColor = System.Drawing.Color.Transparent;
    }

    public static HudWindow? Current { get; private set; }

    public static HudWindow GetOrCreate(Func<string> frontendRoot)
    {
        if (Current is null)
        {
            Current = new HudWindow(frontendRoot);
        }
        return Current;
    }

    protected override void OnSourceInitialized(EventArgs e)
    {
        base.OnSourceInitialized(e);
        // Toolwindow + no-activate: the HUD must never steal focus from whatever the user was
        // doing — Raycast's HUD window behaves the same way.
        var handle = new WindowInteropHelper(this).Handle;
        var exStyle = GetWindowLong(handle, GWL_EXSTYLE);
        SetWindowLong(handle, GWL_EXSTYLE, exStyle | WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW);
    }

    /// <summary>Loads the HUD page ahead of the first `showHud` (called at launcher startup).</summary>
    public async System.Threading.Tasks.Task PrewarmAsync()
    {
        try
        {
            await EnsureInitializedAsync();
            App.Log.Write($"[hud] prewarmed (pageReady follows the page's hud:ready)");
        }
        catch (Exception error)
        {
            App.Log.Write($"[hud] prewarm failed: {error.Message}");
        }
    }

    /// <summary>Renderer -> host entry point (`window.showHud`). Must run on the UI thread.</summary>
    public async void ShowHud(JsonElement payload)
    {
        try
        {
            var title = payload.TryGetProperty("title", out var t) ? t.GetString() ?? "" : "";
            var message = payload.TryGetProperty("message", out var m) && m.ValueKind == JsonValueKind.String ? m.GetString() : null;
            var variant = payload.TryGetProperty("variant", out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : "default";
            var durationMs = payload.TryGetProperty("durationMs", out var d) && d.ValueKind == JsonValueKind.Number && d.TryGetInt32(out var duration)
                ? (int?)duration
                : null;
            _currentVariant = variant;
            _visible = true;

            // Show FIRST: WebView2 initialization cannot complete while the window has never been
            // shown (no HWND), so waiting on init before Show() deadlocks — init waits for Show,
            // Show waits for init. Both launcher-log incidents trace to exactly this ordering.
            PositionBottomCenter();
            if (!IsVisible) Show();

            await EnsureInitializedAsync();
            App.Log.Write($"[hud] showHud received (pageReady={_pageReady}, pending={_pendingShowJson is not null})");

            var json = JsonSerializer.Serialize(new
            {
                type = "hud:show",
                payload = new { title, message, variant, durationMs },
            });
            if (_pageReady)
            {
                _webView.CoreWebView2.PostWebMessageAsJson(json);
            }
            else
            {
                _pendingShowJson = json;
            }

            // Safety net: if the page never reports `hud:dismissed` (renderer dead, page not
            // loaded yet), the HUD must still not outlive its welcome.
            var lifetime = (durationMs ?? (variant == "pending" ? FadeOutGraceMs : 1200)) + FadeOutGraceMs;
            var dispatcherTimer = new System.Windows.Threading.DispatcherTimer
            {
                Interval = TimeSpan.FromMilliseconds(lifetime),
            };
            dispatcherTimer.Tick += (_, _) =>
            {
                dispatcherTimer.Stop();
                if (_visible) HideNow();
            };
            dispatcherTimer.Start();
        }
        catch (Exception error)
        {
            App.Log.Write($"[hud] show failed: {error.Message}");
        }
    }

    /// <summary>Renderer -> host entry point (`window.hideHud`).</summary>
    public void HideHud()
    {
        if (!_visible) return;
        if (_webView.CoreWebView2 is not null)
        {
            _webView.CoreWebView2.PostWebMessageAsJson("{\"type\":\"hud:animateOut\"}");
        }
        else
        {
            HideNow();
        }
    }

    /// <summary>A pending HUD dies the moment the launcher re-activates (Raycast's `Huds` rule).</summary>
    public void OnMainWindowActivated()
    {
        if (_visible && _currentVariant == "pending") HideHud();
    }

    private void HideNow()
    {
        _visible = false;
        Hide();
    }

    private async System.Threading.Tasks.Task EnsureInitializedAsync()
    {
        while (true)
        {
            if (_initState == 2) return;
            if (System.Threading.Interlocked.CompareExchange(ref _initState, 1, 0) == 0)
            {
                try
                {
                    await InitializeCoreAsync();
                    _initState = 2;
                    return;
                }
                catch (Exception error)
                {
                    _initState = 0;
                    App.Log.Write($"[hud] webview initialisation failed: {error}");
                    throw;
                }
            }
            // Another init is in flight: wait for it to settle, then loop — if it failed, this
            // caller takes the lock and retries. The old bounded poll returned while the winner
            // was still initializing, so a payload ShowHud queued afterwards was wiped by the
            // winner's reset (the inconsistent first HUD toast).
            while (System.Threading.Volatile.Read(ref _initState) == 1)
            {
                await System.Threading.Tasks.Task.Delay(50);
            }
        }
    }

    private async System.Threading.Tasks.Task InitializeCoreAsync()
    {
        var udir = MainWindow.GetSafeUserDataFolder("WebView2-HUD");
        var environment = await CoreWebView2Environment.CreateAsync(userDataFolder: udir);
        await _webView.EnsureCoreWebView2Async(environment);

        var core = _webView.CoreWebView2;
        core.Settings.AreDevToolsEnabled = false;
        core.Settings.AreDefaultContextMenusEnabled = false;
        core.Settings.IsStatusBarEnabled = false;
        core.Settings.IsZoomControlEnabled = false;
        core.Settings.IsWebMessageEnabled = true;

        var frontend = _frontendRoot();
        core.SetVirtualHostNameToFolderMapping(
            "raycast.mini", frontend, CoreWebView2HostResourceAccessKind.Allow);
        var html = Path.Combine(frontend, "dist", "hud.html");

        if (!_messageHandlerRegistered)
        {
            core.WebMessageReceived += OnWebMessageReceived;
            _messageHandlerRegistered = true;
        }
        _pageReady = false;
        _pendingShowJson = null;
        // Cache-busted like the launcher window: a stale hud.html would never post
        // `hud:ready` and every pending payload would be held forever.
        core.Navigate(File.Exists(html) ? $"https://raycast.mini/dist/hud.html?v={DateTime.UtcNow.Ticks}" : $"file:///{html}");
    }

    private void OnWebMessageReceived(object? sender, CoreWebView2WebMessageReceivedEventArgs args)
    {
        try
        {
            using var document = JsonDocument.Parse(args.WebMessageAsJson);
            if (document.RootElement.ValueKind == JsonValueKind.String)
            {
                // The page posts with `postMessage(JSON.stringify(...))` — a string web message,
                // which `WebMessageAsJson` double-encodes. Unwrap before reading fields.
                var inner = document.RootElement.GetString();
                if (string.IsNullOrEmpty(inner)) return;
                using var innerDoc = JsonDocument.Parse(inner);
                HandleHudMessage(innerDoc.RootElement);
            }
            else
            {
                HandleHudMessage(document.RootElement);
            }
        }
        catch (Exception error)
        {
            App.Log.Write($"[hud] message handling failed: {error.Message}");
        }
    }

    private void HandleHudMessage(JsonElement root)
    {
        var type = root.TryGetProperty("type", out var t) ? t.GetString() : null;
        if (type == "hud:ready")
        {
            _pageReady = true;
            App.Log.Write("[hud] page ready");
            if (_pendingShowJson is not null && _webView.CoreWebView2 is not null)
            {
                _webView.CoreWebView2.PostWebMessageAsJson(_pendingShowJson);
                App.Log.Write("[hud] delivered pending hud:show");
                _pendingShowJson = null;
            }
        }
        else if (type == "hud:size" && _visible)
        {
            var width = root.GetProperty("width").GetDouble();
            var height = root.GetProperty("height").GetDouble();
            App.Log.Write($"[hud] size {width}x{height}");
            PositionBottomCenter(Math.Max(80, width), Math.Max(24, height));
        }
        else if (type == "hud:dismissed")
        {
            App.Log.Write("[hud] dismissed by page");
            HideNow();
        }
    }

    private void PositionBottomCenter(double? width = null, double? height = null)
    {
        Width = width ?? Width;
        Height = height ?? Height;

        var workArea = WorkAreaOfLauncherScreen();
        // The monitor rect is in physical pixels; WPF wants DIPs. Borrow the scale from the
        // launcher window — this one is not visible yet on the first show.
        var scaleSource = System.Windows.Application.Current?.MainWindow ?? (System.Windows.Media.Visual)this;
        var scale = PresentationSource.FromVisual(scaleSource)?.CompositionTarget?.TransformToDevice.M11 ?? 1.0;
        if (scale <= 0 || double.IsNaN(scale)) scale = 1.0;

        var leftDip = workArea.Left / scale;
        var topDip = workArea.Top / scale;
        var widthDip = (workArea.Right - workArea.Left) / scale;
        var heightDip = (workArea.Bottom - workArea.Top) / scale;
        Left = leftDip + (widthDip - Width) / 2;
        Top = topDip + heightDip - Height - 24;
    }

    private static NativeRect WorkAreaOfLauncherScreen()
    {
        var mainWindow = System.Windows.Application.Current?.MainWindow;
        var hwnd = mainWindow is null ? IntPtr.Zero : new WindowInteropHelper(mainWindow).Handle;
        if (hwnd != IntPtr.Zero)
        {
            var monitor = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
            var info = new MONITORINFO { cbSize = Marshal.SizeOf<MONITORINFO>() };
            if (GetMonitorInfo(monitor, ref info)) return info.rcWork;
        }
        var area = SystemParameters.WorkArea;
        return new NativeRect { Left = (int)area.Left, Top = (int)area.Top, Right = (int)(area.Left + area.Width), Bottom = (int)(area.Top + area.Height) };
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct NativeRect
    {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct MONITORINFO
    {
        public int cbSize;
        public NativeRect rcMonitor;
        public NativeRect rcWork;
        public uint dwFlags;
    }

    private const int GWL_EXSTYLE = -20;
    private const int WS_EX_NOACTIVATE = unchecked((int)0x08000000);
    private const int WS_EX_TOOLWINDOW = 0x00000080;
    private const uint MONITOR_DEFAULTTONEAREST = 2;

    [DllImport("user32.dll")]
    private static extern IntPtr MonitorFromWindow(IntPtr hwnd, uint dwFlags);

    [DllImport("user32.dll", CharSet = CharSet.Auto)]
    private static extern bool GetMonitorInfo(IntPtr hMonitor, ref MONITORINFO lpmi);

    [DllImport("user32.dll", EntryPoint = "GetWindowLongW")]
    private static extern int GetWindowLong(IntPtr hwnd, int index);

    [DllImport("user32.dll", EntryPoint = "SetWindowLongW")]
    private static extern int SetWindowLong(IntPtr hwnd, int index, int newStyle);
}

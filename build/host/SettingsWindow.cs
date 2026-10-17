// The Settings window.
//
// Raycast opens Settings in its own OS window (the `settings-window-*.js` template) rather than
// as an overlay inside the launcher, so the footer gear button opens a separate top-level window
// hosted by its own WebView2 page.
//
// The window keeps a *standard* frame: Windows itself draws the caption buttons, handles drag,
// resize, snap layouts and double-click-to-maximise. Only the caption colour and the window shape
// are overridden (Raycast's settings window is a dark, rounded window), because a borderless
// window over a WebView2 cannot composite its own caption buttons on top of the renderer's HWND.

using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Windows;
using System.Windows.Interop;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;

namespace Openray.Launcher;

public sealed class SettingsWindow : Window
{
    // Raycast's settings window is wide: its sidebar plus two columns of rows need room.
    private const double DefaultWidth = 1180;
    private const double DefaultHeight = 700;

    private readonly WebView2 _webView = new();
    private readonly WebViewBridge _bridge;
    private readonly string _frontendRoot;
    private readonly string _boundsPath = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "Openray", "settings-window.json");

    private Rect? _restoreBounds;

    public SettingsWindow(
        string frontendRoot,
        Func<string, System.Text.Json.JsonElement?, Task<System.Text.Json.JsonElement?>>? backendDispatch = null,
        Func<string, System.Text.Json.JsonElement?, Task<System.Text.Json.JsonElement?>>? frontendDispatch = null)
    {
        _frontendRoot = frontendRoot;

        Title = "Openray Settings";
        Width = DefaultWidth;
        Height = DefaultHeight;
        MinWidth = 560;
        MinHeight = 400;
        WindowStartupLocation = WindowStartupLocation.CenterScreen;
        ResizeMode = ResizeMode.CanResize;
        ShowInTaskbar = true;
        UseLayoutRounding = true;
        // Raycast draws its own titlebar inside the page (the native one would stack above it).
        // WindowChrome keeps the resize borders and snap; dragging comes from the renderer via
        // `window.dragSettings` (the WebView child HWND swallows caption hits otherwise).
        WindowStyle = WindowStyle.None;
        var chrome = new System.Windows.Shell.WindowChrome
        {
            ResizeBorderThickness = new Thickness(6),
            CaptionHeight = 0,
            GlassFrameThickness = new Thickness(0),
            CornerRadius = new CornerRadius(0),
            UseAeroCaptionButtons = false,
        };
        System.Windows.Shell.WindowChrome.SetWindowChrome(this, chrome);

        // The settings page talks to the backend through the same IPC bridge the launcher uses;
        // without it the page's `ipc.backend(...)` calls all fail and e.g. the extensions page
        // would stay empty forever. Frontend-module requests (settings.*, the caption buttons)
        // reach the launcher's dispatch so the host-side General rows actually apply.
        _bridge = new WebViewBridge(_webView);
        _bridge.Install((method, _jsonParams, data, isBackend) =>
        {
            if (isBackend) return backendDispatch?.Invoke(method, data) ?? Task.FromResult<System.Text.Json.JsonElement?>(null);
            // The in-page caption buttons (the window draws its own titlebar like Raycast's).
            if (method == "window.minimize")
            {
                Dispatcher.Invoke(() => WindowState = WindowState.Minimized);
                return Task.FromResult<System.Text.Json.JsonElement?>(null);
            }
            if (method == "window.closeSettings")
            {
                Dispatcher.Invoke(Close);
                return Task.FromResult<System.Text.Json.JsonElement?>(null);
            }
            if (method == "window.dragSettings")
            {
                // ReleaseCapture + WM_NCLBUTTONDOWN/HTCAPTION enters the native move loop even
                // though the mousedown happened over the WebView child (DragMove's button check
                // races the IPC hop and silently does nothing).
                Dispatcher.Invoke(() =>
                {
                    var handle = new WindowInteropHelper(this).Handle;
                    ReleaseCapture();
                    _ = SendMessage(handle, WmNcLButtonDown, (IntPtr)HtCaption, IntPtr.Zero);
                });
                return Task.FromResult<System.Text.Json.JsonElement?>(null);
            }
            if (method == "window.maximizeSettings")
            {
                Dispatcher.Invoke(() =>
                    WindowState = WindowState == WindowState.Maximized ? WindowState.Normal : WindowState.Maximized);
                return Task.FromResult<System.Text.Json.JsonElement?>(null);
            }
            // Deep link (action-panel Configure commands, session drivers): navigate the settings
            // page to `#/{route}` so it lands on a page or row directly.
            if (method == "window.openSettingsPage")
            {
                var route = data is { ValueKind: System.Text.Json.JsonValueKind.Object } routePayload
                    && routePayload.TryGetProperty("route", out var routeValue)
                    ? routeValue.GetString()
                    : null;
                if (!string.IsNullOrWhiteSpace(route))
                {
                    Dispatcher.Invoke(() => OpenPage(route));
                }
                return Task.FromResult<System.Text.Json.JsonElement?>(null);
            }
            return frontendDispatch?.Invoke(method, data) ?? Task.FromResult<System.Text.Json.JsonElement?>(null);
        });

        // Opaque: the settings page paints its own surfaces on top of this colour, matching
        // Raycast's #1f1f1f window background. The WebView is inset on three sides so the WPF
        // surface owns the window edges and the WindowChrome resize borders are reachable (the
        // child HWND would swallow every hit otherwise); the page and this background are the
        // same colour, so the inset reads as part of the page.
        Background = new System.Windows.Media.SolidColorBrush(
            System.Windows.Media.Color.FromRgb(0x1F, 0x1F, 0x1F));

        _webView.DefaultBackgroundColor = System.Drawing.Color.FromArgb(0, 0x1F, 0x1F, 0x1F);
        _webView.Margin = new Thickness(6, 6, 6, 6);
        Content = _webView;

        SourceInitialized += OnSourceInitialized;
        Loaded += OnLoaded;
        Closing += OnClosing;
        StateChanged += OnStateChanged;

        ApplyStoredBounds();
    }

    /// <summary>Dark caption + rounded corners, so the native frame matches Raycast's window.</summary>
    private void OnSourceInitialized(object? sender, EventArgs e)
    {
        var handle = new WindowInteropHelper(this).Handle;
        var source = HwndSource.FromHwnd(handle);
        // Alt+Space is the Windows system-menu shortcut; swallowing WM_SYSCOMMAND's key-menu
        // variant lets the page see the combination so the hotkey recorder can record it.
        source?.AddHook(WndProcHook);
        var dark = 1;
        DwmSetWindowAttribute(handle, DwmwaUseImmersiveDarkMode, ref dark, sizeof(int));
        var rounded = DwmwtcpRound;
        DwmSetWindowAttribute(handle, DwmwaWindowCornerPreference, ref rounded, sizeof(int));
        var border = 1; // keep the 1px window border, like Raycast
        DwmSetWindowAttribute(handle, DwmwaBorderColor, ref border, sizeof(int));
    }

    private async void OnLoaded(object sender, RoutedEventArgs e)
    {
        var udir = MainWindow.GetSafeUserDataFolder("WebView2.Settings");
        var environment = await CoreWebView2Environment.CreateAsync(userDataFolder: udir);
        await _webView.EnsureCoreWebView2Async(environment);
        _webView.CoreWebView2.SetVirtualHostNameToFolderMapping(
            "raycast.mini", _frontendRoot, CoreWebView2HostResourceAccessKind.Allow);
        WebView2Permissions.AllowClipboardRead(_webView.CoreWebView2);

        var html = Path.Combine(_frontendRoot, "dist", "settings.html");
        _webView.CoreWebView2.Navigate(
            File.Exists(html) ? "https://raycast.mini/dist/settings.html" : $"file:///{html}");
        App.Log.Write("settings window shown");
    }

    private void OnClosing(object sender, System.ComponentModel.CancelEventArgs e)
    {
        // Second instance semantics: closing the window hides it; opening Settings brings it back
        // (the same contract the launcher window uses).
        SaveBounds();
    }

    /// <summary>Navigates the settings page to `#/{route}` (deep link to a page or `page?row=id`).</summary>
    public void OpenPage(string route)
    {
        var html = Path.Combine(_frontendRoot, "dist", "settings.html");
        var baseUri = File.Exists(html) ? "https://raycast.mini/dist/settings.html" : $"file:///{html}";
        _webView.CoreWebView2?.Navigate($"{baseUri}#/{route.TrimStart('/')}");
    }

    /// <summary>Deliver a host-originated message to this window's renderer (`z.frontend.*`).</summary>
    public void PostToRenderer(string method, System.Text.Json.JsonElement? data)
    {
        var payload = System.Text.Json.JsonSerializer.Serialize(new { module = "frontend", method, data });
        Dispatcher.Invoke(() => _webView.CoreWebView2?.PostWebMessageAsJson(payload));
    }

    /// <summary>The native strips around the inset WebView follow the active theme's appearance.</summary>
    public void SetChromeLight(System.Windows.Media.Color color)
    {
        Background = new System.Windows.Media.SolidColorBrush(color);
    }

    /// <summary>Actually close on shutdown, so the process is never kept alive by this window.</summary>
    public void ShutdownForReal()
    {
        Closing -= OnClosing;
        Close();
    }

    private IntPtr WndProcHook(IntPtr hwnd, int msg, IntPtr wParam, IntPtr lParam, ref bool handled)
    {
        const int wmSysCommand = 0x0112;
        const int scKeyMenu = 0xF100;
        if (msg == wmSysCommand && (wParam.ToInt64() & 0xFFF0) == scKeyMenu)
        {
            handled = true;
            return IntPtr.Zero;
        }
        return IntPtr.Zero;
    }

    private void OnStateChanged(object? sender, EventArgs e)
    {
        if (WindowState == WindowState.Maximized && _restoreBounds is null)
        {
            _restoreBounds = new Rect(Left, Top, Width, Height);
        }
        else if (WindowState == WindowState.Normal && _restoreBounds is not null)
        {
            Left = _restoreBounds.Value.Left;
            Top = _restoreBounds.Value.Top;
            Width = _restoreBounds.Value.Width;
            Height = _restoreBounds.Value.Height;
            _restoreBounds = null;
        }
    }

    private void ApplyStoredBounds()
    {
        try
        {
            if (!File.Exists(_boundsPath)) return;
            var json = JsonDocument.Parse(File.ReadAllText(_boundsPath)).RootElement;
            if (json.TryGetProperty("width", out var width) && json.TryGetProperty("height", out var height) &&
                json.TryGetProperty("x", out var x) && json.TryGetProperty("y", out var y))
            {
                var rect = new Rect(x.GetDouble(), y.GetDouble(), width.GetDouble(), height.GetDouble());
                if (rect.Width >= MinWidth && rect.Height >= MinHeight &&
                    rect.Left >= 0 && rect.Top >= 0 &&
                    rect.Left < SystemParameters.VirtualScreenWidth && rect.Top < SystemParameters.VirtualScreenHeight)
                {
                    // A stored width from an older, narrower default never wins over the new one.
                    WindowStartupLocation = WindowStartupLocation.Manual;
                    Left = rect.Left;
                    Top = rect.Top;
                    Width = Math.Max(rect.Width, DefaultWidth);
                    Height = rect.Height;
                }
            }

            if (json.TryGetProperty("maximized", out var maximized) && maximized.GetBoolean())
            {
                Loaded += (_, _) => WindowState = WindowState.Maximized;
            }
        }
        catch
        {
            /* a corrupt bounds file must never keep the window from opening */
        }
    }

    private void SaveBounds()
    {
        try
        {
            var bounds = WindowState == WindowState.Maximized
                ? _restoreBounds ?? new Rect(Left, Top, Width, Height)
                : new Rect(Left, Top, Width, Height);
            var payload = JsonSerializer.Serialize(new
            {
                x = bounds.Left,
                y = bounds.Top,
                width = bounds.Width,
                height = bounds.Height,
                maximized = WindowState == WindowState.Maximized,
            });
            Directory.CreateDirectory(Path.GetDirectoryName(_boundsPath)!);
            File.WriteAllText(_boundsPath, payload);
        }
        catch
        {
            /* bounds are a convenience, never a failure */
        }
    }

    // ---- DWM attributes ---------------------------------------------------------------------

    private const int DwmwaUseImmersiveDarkMode = 20;
    private const int DwmwaWindowCornerPreference = 33;
    private const int DwmwaBorderColor = 34;
    private const int DwmwtcpRound = 2;
    private const uint WmNcLButtonDown = 0x00A1;
    private const IntPtr HtCaption = (IntPtr)2;

    [DllImport("dwmapi.dll")]
    private static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int value, int size);

    [DllImport("user32.dll")]
    private static extern bool ReleaseCapture();

    [DllImport("user32.dll")]
    private static extern IntPtr SendMessage(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);
}

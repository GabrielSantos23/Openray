// The Notes window.
//
// Raycast's notes live in their own always-on-top OS window opened through
// `host.raycast.showNotesWindow` (`notes-window-*.js` + `notes-window.html`), not inside the
// launcher. Same split here: this borderless WPF window hosts WebView2 with
// `frontend/dist/notes.html`, which paints its own Raycast-style title bar (icons, centred title,
// close button) and drives dragging through the `notes:drag` web message. The window keeps the
// confirmed window behaviours — auto-sizing from the page's `notes.setSize` reports (clamped
// 128–860, minimum 442 while the action panel is open), a manual resize disabling auto-sizing,
// and Escape handled inside the page per the `escapeKeyBehavior` preference.
//
// Renderer contract:
//   page -> host (IpcHostObject): `notes.setSize` {height, panelOpen}, `window.hideNotes`,
//          `window.openSettings`, `window.showQuicklinkCreate` {link, name}; backend requests are
//          forwarded over the named pipe like the launcher's own.
//   page -> host (web message): `notes:ready`, `notes:drag` (mousedown in the title bar).
//   host -> page: `{"module":"frontend","method":"notes.openNote","data":{noteId?|create?,text?}}`
//          posted once the page reports `notes:ready` (a pending open is held until then).

using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Windows;
using System.Windows.Interop;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;

namespace RaycastMini.Launcher;

public sealed class NotesWindow : Window
{
    private const double DefaultWidth = 560;
    private const double DefaultHeight = 440;
    private const double MinAutoHeight = 128;
    private const double MaxAutoHeight = 860;
    private const double MinPanelOpenHeight = 442;

    private readonly WebView2 _webView = new();
    private readonly Func<string> _frontendRoot;
    private IpcHostObject? _hostObject;
    private int _initState; // 0 = not started, 1 = in flight, 2 = done
    private bool _messageHandlerRegistered;
    private bool _pageReady;
    private JsonElement? _pendingOpen;
    private bool _reallyClosing;
    // A user drag (WM_SIZING) switches the window to manual sizing for its lifetime, exactly like
    // the confirmed "manual resize disables auto-sizing" behavior. Programmatic height changes
    // never raise WM_SIZING, so the flag only flips on real user input.
    private bool _userResized;
    // A title-bar drag stops the window from re-docking to the bottom-right on the next show.
    private bool _userMoved;

    public NotesWindow(Func<string> frontendRoot)
    {
        _frontendRoot = frontendRoot;

        Title = "Notes";
        Width = DefaultWidth;
        Height = DefaultHeight;
        MinWidth = 380;
        MinHeight = 200;
        WindowStartupLocation = WindowStartupLocation.Manual;
        ResizeMode = ResizeMode.CanResize;
        ShowInTaskbar = true;
        Topmost = true;
        UseLayoutRounding = true;

        // Borderless exactly like the launcher (borderless, transparent, opaque rounded WPF root):
        // a fully transparent WPF surface is click-through for a layered window — the OS alpha
        // test runs before the WebView2 child ever sees input — so the WPF border must paint the
        // window's pixels. The WebView is inset by FrameThickness so an opaque ring stays
        // WPF-owned, and WndProc turns that ring into native resize borders.
        WindowStyle = WindowStyle.None;
        AllowsTransparency = true;
        Background = System.Windows.Media.Brushes.Transparent;

        var frame = new System.Windows.Controls.Grid { Margin = new Thickness(FrameThickness) };
        frame.Children.Add(_webView);
        var root = new System.Windows.Controls.Border
        {
            Background = new System.Windows.Media.SolidColorBrush(System.Windows.Media.Color.FromRgb(0x1C, 0x1C, 0x1E)),
            CornerRadius = new CornerRadius(8),
            SnapsToDevicePixels = true,
            Child = frame,
        };
        root.Effect = new System.Windows.Media.Effects.DropShadowEffect
        {
            BlurRadius = 34,
            Direction = -90,
            ShadowDepth = 10,
            Opacity = 0.55,
            Color = System.Windows.Media.Colors.Black,
        };
        Content = root;

        _webView.DefaultBackgroundColor = System.Drawing.Color.Transparent;

        Loaded += OnLoaded;
        SourceInitialized += OnSourceInitialized;
        Closing += OnClosing;
    }

    /// <summary>The transparent ring around the WebView that acts as the resize border (DIPs).</summary>
    private const double FrameThickness = 6;

    public static NotesWindow? Current { get; private set; }

    public static NotesWindow GetOrCreate(Func<string> frontendRoot)
    {
        // A closed window can never be shown again (WPF throws on Visibility after Close), so a
        // closed instance is replaced — this is what made the window unopenable after the user
        // closed it from the taskbar or Alt+F4.
        if (Current is null || !Current.IsLoaded)
        {
            Current?.ShutdownForReal();
            Current = new NotesWindow(frontendRoot);
        }
        return Current;
    }

    /// <summary>Renderer -> host entry point (`window.showNotes`). Must run on the UI thread.</summary>
    public async void ShowNotes(JsonElement payload)
    {
        try
        {
            App.Log.Write($"[notes] show requested (IsVisible={IsVisible}, loaded={IsLoaded})");
            if (!IsVisible)
            {
                DockBottomRight();
                Show();
            }
            if (WindowState == WindowState.Minimized) WindowState = WindowState.Normal;
            Activate();
            Topmost = true;
            await EnsureInitializedAsync();
            if (_pageReady)
            {
                PostOpenNote(payload);
            }
            else
            {
                _pendingOpen = payload.Clone();
            }
        }
        catch (Exception error)
        {
            App.Log.Write($"[notes] show failed: {error}");
        }
    }

    private void PostOpenNote(JsonElement payload)
    {
        var json = JsonSerializer.Serialize(new
        {
            module = "frontend",
            method = "notes.openNote",
            data = payload,
        });
        _webView.CoreWebView2.PostWebMessageAsJson(json);
    }

    private void OnSourceInitialized(object? sender, EventArgs e)
    {
        var handle = new WindowInteropHelper(this).Handle;
        HwndSource.FromHwnd(handle)?.AddHook(WndProc);
    }

    private void OnClosing(object? sender, System.ComponentModel.CancelEventArgs e)
    {
        // Closing the window hides it (the same contract the launcher uses); only shutdown closes
        // for real. Without this, a taskbar/Alt+F4 close killed the window for good.
        if (!_reallyClosing)
        {
            e.Cancel = true;
            Hide();
        }
    }

    private IntPtr WndProc(IntPtr hwnd, int message, IntPtr wParam, IntPtr lParam, ref bool handled)
    {
        const int WmSizing = 0x0214;
        if (message == WmSizing)
        {
            _userResized = true;
            return IntPtr.Zero;
        }
        // Native resize borders over the transparent ring: the WebView child never sees these
        // points because the ring is WPF-owned (the WebView is inset by FrameThickness).
        const int WmNcHitTest = 0x0084;
        if (message == WmNcHitTest && WindowState == WindowState.Normal)
        {
            var result = HitTestFrameEdges(lParam);
            if (result != IntPtr.Zero)
            {
                handled = true;
                return result;
            }
        }
        return IntPtr.Zero;
    }

    private IntPtr HitTestFrameEdges(IntPtr lParam)
    {
        if (!GetWindowRect(hwnd: new WindowInteropHelper(this).Handle, out var rect)) return IntPtr.Zero;
        var x = (short)((long)lParam & 0xFFFF);
        var y = (short)(((long)lParam >> 16) & 0xFFFF);
        var scale = PresentationSource.FromVisual(this)?.CompositionTarget?.TransformToDevice.M11 ?? 1.0;
        if (scale <= 0 || double.IsNaN(scale)) scale = 1.0;
        var border = (int)Math.Round(FrameThickness * scale);
        var onLeft = x - rect.Left < border;
        var onRight = rect.Right - x < border;
        var onTop = y - rect.Top < border;
        var onBottom = rect.Bottom - y < border;
        if (onTop && onLeft) return (IntPtr)HtTopLeft;
        if (onTop && onRight) return (IntPtr)HtTopRight;
        if (onBottom && onLeft) return (IntPtr)HtBottomLeft;
        if (onBottom && onRight) return (IntPtr)HtBottomRight;
        if (onTop) return (IntPtr)HtTop;
        if (onBottom) return (IntPtr)HtBottom;
        if (onLeft) return (IntPtr)HtLeft;
        if (onRight) return (IntPtr)HtRight;
        return IntPtr.Zero;
    }

    /// <summary>Docks the window to the bottom-right of the work area, like the shipped window.</summary>
    private void DockBottomRight()
    {
        if (_userMoved || _userResized) return;
        var workArea = SystemParameters.WorkArea;
        Left = workArea.Right - Width - 24;
        Top = workArea.Bottom - Height - 24;
    }

    private async void OnLoaded(object sender, RoutedEventArgs e)
    {
        try
        {
            await EnsureInitializedAsync();
        }
        catch (Exception error)
        {
            App.Log.Write($"[notes] webview initialisation failed: {error}");
        }
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
                    App.Log.Write($"[notes] webview initialisation failed: {error}");
                    throw;
                }
            }
            while (System.Threading.Volatile.Read(ref _initState) == 1)
            {
                await System.Threading.Tasks.Task.Delay(50);
            }
        }
    }

    private async System.Threading.Tasks.Task InitializeCoreAsync()
    {
        // Its own user-data folder: two WebView2 instances sharing one folder fail (0x800700AA).
        var udir = MainWindow.GetSafeUserDataFolder("WebView2-Notes");
        var environment = await CoreWebView2Environment.CreateAsync(userDataFolder: udir);
        await _webView.EnsureCoreWebView2Async(environment);

        var core = _webView.CoreWebView2;
        core.Settings.AreDevToolsEnabled = false;
        core.Settings.AreDefaultContextMenusEnabled = false;
        core.Settings.IsStatusBarEnabled = false;
        core.Settings.IsZoomControlEnabled = false;
        core.Settings.IsWebMessageEnabled = true;

        var mainWindow = System.Windows.Application.Current?.MainWindow as MainWindow;
        _hostObject = new IpcHostObject((method, _, data, isBackend) => DispatchForPageAsync(method, data, isBackend, mainWindow));
        core.AddHostObjectToScript("ipc", _hostObject);

        var frontend = _frontendRoot();
        core.SetVirtualHostNameToFolderMapping(
            "raycast.mini", frontend, CoreWebView2HostResourceAccessKind.Allow);
        var html = Path.Combine(frontend, "dist", "notes.html");

        if (!_messageHandlerRegistered)
        {
            core.WebMessageReceived += OnWebMessageReceived;
            _messageHandlerRegistered = true;
        }
        _pageReady = false;
        // Cache-busted like the launcher window: a stale notes page would never report readiness.
        core.Navigate(File.Exists(html) ? $"https://raycast.mini/dist/notes.html?v={DateTime.UtcNow.Ticks}" : $"file:///{html}");
    }

    private static async System.Threading.Tasks.Task<JsonElement?> DispatchForPageAsync(
        string method, JsonElement? data, bool isBackend, MainWindow? mainWindow)
    {
        switch (method)
        {
            case "window.hideNotes":
                Current?.Dispatcher.Invoke(HideNow);
                return null;
            case "notes.setSize":
                if (data is { ValueKind: JsonValueKind.Object })
                {
                    Current?.Dispatcher.Invoke(() => ApplyAutoHeight(data.Value));
                }
                return null;
            case "window.openSettings":
                mainWindow?.Dispatcher.Invoke(() => mainWindow.OpenSettings());
                return null;
            case "window.showQuicklinkCreate":
                var link = data?.TryGetProperty("link", out var linkElement) == true ? linkElement.GetString() : null;
                var name = data?.TryGetProperty("name", out var nameElement) == true ? nameElement.GetString() : null;
                if (!string.IsNullOrEmpty(link))
                {
                    mainWindow?.Dispatcher.Invoke(() => mainWindow.ShowQuicklinkCreate(link, name));
                }
                return null;
        }
        if (isBackend)
        {
            if (mainWindow is null) throw new InvalidOperationException("launcher window unavailable");
            return await mainWindow.RequestBackendAsync(method, data?.Clone());
        }
        if (mainWindow is null) throw new InvalidOperationException("launcher window unavailable");
        // Everything else (fileSystem dialogs, clipboard writes, the HUD fallback) follows the
        // launcher's own frontend dispatch, which owns those routes.
        return await mainWindow.DispatchForNotesPageAsync(method, data);
    }

    private static void HideNow()
    {
        if (Current is { IsVisible: true }) Current.Hide();
    }

    /// <summary>
    /// The confirmed auto-sizing clamps: minHeight 128, maxHeight 860, and a 442 floor while the
    /// action panel is open. Disabled once the user has resized the window by hand. The reported
    /// height is the page's; the transparent resize ring around the WebView adds to the window.
    /// </summary>
    private static void ApplyAutoHeight(JsonElement data)
    {
        var window = Current;
        if (window is null || window._userResized || !window.IsVisible) return;
        if (window.WindowState != WindowState.Normal) return;
        var height = data.TryGetProperty("height", out var heightElement) && heightElement.ValueKind == JsonValueKind.Number
            ? heightElement.GetDouble()
            : 0;
        var panelOpen = data.TryGetProperty("panelOpen", out var panelElement) && panelElement.ValueKind == JsonValueKind.True;
        if (height <= 0) return;
        var clamped = Math.Clamp(height, panelOpen ? Math.Max(MinAutoHeight, MinPanelOpenHeight) : MinAutoHeight, MaxAutoHeight);
        clamped += 2 * FrameThickness;
        var workArea = SystemParameters.WorkArea;
        clamped = Math.Min(clamped, workArea.Height - 40);
        if (Math.Abs(window.Height - clamped) > 0.5)
        {
            window.Height = clamped;
            window.DockBottomRight();
        }
    }

    private void OnWebMessageReceived(object? sender, CoreWebView2WebMessageReceivedEventArgs args)
    {
        try
        {
            using var document = JsonDocument.Parse(args.WebMessageAsJson);
            var root = document.RootElement;
            if (root.ValueKind == JsonValueKind.String)
            {
                var inner = root.GetString();
                if (inner is null) return;
                using var innerDoc = JsonDocument.Parse(inner);
                HandlePageMessage(innerDoc.RootElement);
            }
            else
            {
                HandlePageMessage(root);
            }
        }
        catch (Exception error)
        {
            App.Log.Write($"[notes] message handling failed: {error.Message}");
        }
    }

    private void HandlePageMessage(JsonElement root)
    {
        var type = root.TryGetProperty("type", out var t) ? t.GetString() : null;
        if (type == "notes:ready")
        {
            _pageReady = true;
            App.Log.Write("[notes] page ready");
            if (_pendingOpen is not null && _webView.CoreWebView2 is not null)
            {
                PostOpenNote(_pendingOpen.Value);
                App.Log.Write("[notes] delivered pending open");
                _pendingOpen = null;
            }
        }
        else if (type == "notes:drag")
        {
            _userMoved = true;
            BeginWindowDrag();
        }
    }

    /// <summary>
    /// Title-bar drag: the page reports the mousedown, the host hands the window to the OS move
    /// loop (ReleaseCapture + HTCAPTION), the standard borderless-window technique.
    /// </summary>
    private void BeginWindowDrag()
    {
        try
        {
            if (WindowState == WindowState.Maximized) return;
            var handle = new WindowInteropHelper(this).Handle;
            if (handle == IntPtr.Zero) return;
            if (!ReleaseCapture()) return;
            _ = SendMessage(handle, WmNclButtonDown, (IntPtr)HtCaption, IntPtr.Zero);
        }
        catch (Exception error)
        {
            App.Log.Write($"[notes] drag failed: {error.Message}");
        }
    }

    /// <summary>Actually close on shutdown, so the process is never kept alive by this window.</summary>
    public void ShutdownForReal()
    {
        _reallyClosing = true;
        Close();
    }

    private const uint WmNclButtonDown = 0xA1;
    private const IntPtr HtCaption = (IntPtr)2;
    private const long HtLeft = 10;
    private const long HtRight = 11;
    private const long HtTop = 12;
    private const long HtTopLeft = 13;
    private const long HtTopRight = 14;
    private const long HtBottom = 15;
    private const long HtBottomLeft = 16;
    private const long HtBottomRight = 17;

    [StructLayout(LayoutKind.Sequential)]
    private struct NativeRect
    {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool ReleaseCapture();

    [DllImport("user32.dll")]
    private static extern IntPtr SendMessage(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetWindowRect(IntPtr hwnd, out NativeRect rect);
}

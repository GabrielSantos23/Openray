// The onboarding window (docs: onboarding 3-step first-run flow). A separate, larger screen
// instead of an overlay on the launcher: borderless like the Settings window, fixed size,
// centered, always on top of the launcher while open. It shares the launcher's WebView2 user
// data folder, so the feature flags the flow saves land in the launcher's localStorage; the
// finish/skip message closes the window and the launcher learns about it via the
// `onboarding.finished` push (App re-reads the flags from localStorage).

using System.IO;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Interop;
using System.Windows.Media;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;

namespace Openray.Launcher;

public sealed class OnboardingWindow : Window
{
    private const string FinishMessage = "openray:onboarding-finish";

    private readonly WebView2 _webView;
    private readonly string _frontendRoot;
    private readonly MainWindow _mainWindow;

    public OnboardingWindow(string frontendRoot, MainWindow mainWindow)
    {
        _frontendRoot = frontendRoot;
        _mainWindow = mainWindow;

        Title = "Openray Onboarding";
        Width = 980;
        Height = 680;
        MinWidth = 860;
        MinHeight = 600;
        WindowStartupLocation = WindowStartupLocation.CenterScreen;
        ResizeMode = ResizeMode.CanResize;
        ShowInTaskbar = false;
        Topmost = true;
        UseLayoutRounding = true;
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
        Background = new SolidColorBrush(Color.FromRgb(0x11, 0x11, 0x12));

        _webView = new WebView2 { DefaultBackgroundColor = Transparency };
        // Drag handle: the page's top strip (the onboarding canvas owns the rest).
        Content = _webView;
        Loaded += OnLoaded;
    }

    private static System.Drawing.Color Transparency => System.Drawing.Color.Transparent;

    private async void OnLoaded(object sender, RoutedEventArgs e)
    {
        // Same profile as the launcher: localStorage (feature flags + completion flag) is shared.
        var udir = MainWindow.GetSafeUserDataFolder("WebView2");
        var environment = await CoreWebView2Environment.CreateAsync(userDataFolder: udir);
        await _webView.EnsureCoreWebView2Async(environment);
        _webView.CoreWebView2.SetVirtualHostNameToFolderMapping(
            "raycast.mini", _frontendRoot, CoreWebView2HostResourceAccessKind.Allow);

        _webView.CoreWebView2.WebMessageReceived += (_, args) =>
        {
            if (args.TryGetWebMessageAsString() != FinishMessage) return;
            _mainWindow.OnboardingFinished();
            Close();
        };

        var html = Path.Combine(_frontendRoot, "dist", "onboarding.html");
        _webView.CoreWebView2.Navigate(
            File.Exists(html) ? "https://raycast.mini/dist/onboarding.html" : $"file:///{html}");
    }

    /// <summary>Host → onboarding renderer pushes (unused today, kept for parity with Settings).</summary>
    public void PostToRenderer(string method, System.Text.Json.JsonElement? data)
    {
        var payload = System.Text.Json.JsonSerializer.Serialize(new { module = "frontend", method, data });
        Dispatcher.Invoke(() => _webView.CoreWebView2?.PostWebMessageAsJson(payload));
    }

    protected override void OnSourceInitialized(EventArgs e)
    {
        base.OnSourceInitialized(e);
        // No taskbar presence and not alt-tabbable: it belongs to the launcher flow.
        var handle = new WindowInteropHelper(this).Handle;
        int exStyle = NativeWindowStyles.GetWindowLong(handle, NativeWindowStyles.GwlExStyle);
        _ = NativeWindowStyles.SetWindowLong(handle, NativeWindowStyles.GwlExStyle, exStyle | NativeWindowStyles.WsExToolWindow);
    }
}

internal static class NativeWindowStyles
{
    public const int GwlExStyle = -20;
    public const int WsExToolWindow = 0x00000080;

    [System.Runtime.InteropServices.DllImport("user32.dll")]
    public static extern int GetWindowLong(nint hWnd, int nIndex);

    [System.Runtime.InteropServices.DllImport("user32.dll")]
    public static extern int SetWindowLong(nint hWnd, int nIndex, int dwNewLong);
}

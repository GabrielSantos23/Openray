// Windows Taskbar host surface (`taskbar.*`), docs/focus-games-taskbar-spec.md §C.
//
// The shipped taskbar is a portal window re-parented on a screen edge (`windowsTaskbar.setEdge`).
// The clone keeps the minimal real strip from the spec decisions: an edge-anchored topmost window
// registered as an application desktop bar (SHAppBarMessage ABM_NEW/ABM_SETPOS) so maximized
// windows respect the reserved edge, with two widgets — a clock and a Raycast button that opens
// the launcher. Widgets beyond those two are pending, not mocked.

using System.Runtime.InteropServices;
using System.Text.Json;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Threading;

namespace Openray.Launcher;

public static class Taskbar
{
    private static TaskbarWindow? _window;

    public static Task<object?> DispatchAsync(string method, JsonElement? data)
    {
        var name = method["taskbar.".Length..];
        return name switch
        {
            "show" => Task.FromResult(Show()),
            "hide" => Task.FromResult(Hide()),
            "setPosition" => Task.FromResult(SetPosition(data)),
            _ => Task.FromException<object?>(new InvalidOperationException($"no taskbar handler for {name}")),
        };
    }

    private static object Show()
    {
        Application.Current.Dispatcher.Invoke(() => Window("bottom").ShowBar());
        return new { visible = true };
    }

    private static object Hide()
    {
        Application.Current.Dispatcher.Invoke(() => _window?.HideBar());
        return new { visible = false };
    }

    private static object SetPosition(JsonElement? data)
    {
        var position = data?.TryGetProperty("position", out var element) == true ? element.GetString() : null;
        if (position is not ("top" or "bottom" or "left" or "right"))
            throw new InvalidOperationException("position must be top, bottom, left or right");
        Application.Current.Dispatcher.Invoke(() => Window(position).MoveToEdge(position));
        return new { position };
    }

    private static TaskbarWindow Window(string defaultEdge)
    {
        if (_window is null) _window = new TaskbarWindow(defaultEdge);
        return _window;
    }
}

public sealed class TaskbarWindow : Window
{
    private readonly System.Windows.Threading.DispatcherTimer _clockTimer;
    private readonly TextBlock _clock = new();
    private string _edge;
    private AppBarInfo _appBar;

    public TaskbarWindow(string edge)
    {
        _edge = edge;
        WindowStyle = WindowStyle.None;
        ResizeMode = ResizeMode.NoResize;
        ShowInTaskbar = false;
        ShowActivated = false;
        Topmost = true;
        Background = new SolidColorBrush(Color.FromRgb(0x1c, 0x1c, 0x1e));

        Content = BuildContent();
        _clockTimer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(1) };
        _clockTimer.Tick += (_, _) => RenderClock();
        _clockTimer.Start();
        RenderClock();
    }

    private UIElement BuildContent()
    {
        var root = new DockPanel { LastChildFill = false };
        var openrayButton = new Button
        {
            Content = new TextBlock
            {
                Text = "Openray",
                Foreground = Brushes.White,
                FontWeight = FontWeights.SemiBold,
                FontSize = 12,
            },
            Background = new SolidColorBrush(Color.FromRgb(0xff, 0x63, 0x63)),
            BorderThickness = new Thickness(0),
            Padding = new Thickness(10, 3, 10, 4),
            Margin = new Thickness(6),
            Cursor = System.Windows.Input.Cursors.Hand,
        };
        openrayButton.Click += (_, _) => (Application.Current.MainWindow as MainWindow)?.ShowMainWindow();
        DockPanel.SetDock(openrayButton, Dock.Left);

        _clock.Foreground = new SolidColorBrush(Color.FromRgb(0xd9, 0xd9, 0xdc));
        _clock.FontSize = 12;
        _clock.VerticalAlignment = VerticalAlignment.Center;
        _clock.Margin = new Thickness(0, 0, 10, 0);
        DockPanel.SetDock(_clock, Dock.Right);

        root.Children.Add(openrayButton);
        root.Children.Add(_clock);
        return root;
    }

    private void RenderClock()
    {
        _clock.Text = DateTime.Now.ToString("t", System.Globalization.CultureInfo.CurrentCulture);
    }

    /// <summary>Bar thickness for the `regular` size (confirmed bar scale 32/40/48/56/64).</summary>
    private double ThicknessForEdge() => _edge is "left" or "right" ? 64 : 48;

    protected override void OnSourceInitialized(EventArgs e)
    {
        base.OnSourceInitialized(e);
        var handle = new WindowInteropHelper(this).Handle;
        var exStyle = GetWindowLong(handle, GWL_EXSTYLE);
        SetWindowLong(handle, GWL_EXSTYLE, exStyle | WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW);
        RegisterAppBar(handle);
        AnchorToEdge(_edge);
    }

    public void ShowBar()
    {
        AnchorToEdge(_edge);
        Show();
    }

    public void HideBar()
    {
        Hide();
    }

    public void MoveToEdge(string edge)
    {
        _edge = edge;
        if (IsVisible) AnchorToEdge(edge);
    }

    // -----------------------------------------------------------------------------------------
    // AppBar registration (SHAppBarMessage ABM_NEW + ABM_SETPOS) so maximized windows respect
    // the reserved edge, mirroring the native-taskbar interplay of the shipped strip.
    // -----------------------------------------------------------------------------------------

    [StructLayout(LayoutKind.Sequential)]
    private struct RECT
    {
        public int Left, Top, Right, Bottom;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct APPBARDATA
    {
        public int cbSize;
        public IntPtr hWnd;
        public uint uCallbackMessage;
        public uint uEdge;
        public RECT rc;
        public IntPtr lParam;
    }

    private sealed record AppBarInfo(IntPtr Handle, uint CallbackMessage);

    private const uint AbeLeft = 0;
    private const uint AbeTop = 1;
    private const uint AbeRight = 2;
    private const uint AbeBottom = 3;
    private const uint AbmNew = 0x0;
    private const uint AbmRemove = 0x1;
    private const uint AbmSetpos = 0x3;

    private void RegisterAppBar(IntPtr handle)
    {
        if (_appBar.Handle != IntPtr.Zero) return;
        var data = new APPBARDATA
        {
            cbSize = Marshal.SizeOf<APPBARDATA>(),
            hWnd = handle,
            uCallbackMessage = CallbackMessageId,
        };
        SHAppBarMessage(AbmNew, ref data);
        _appBar = new AppBarInfo(handle, CallbackMessageId);
    }

    private void UnregisterAppBar()
    {
        if (_appBar.Handle == IntPtr.Zero) return;
        var data = new APPBARDATA
        {
            cbSize = Marshal.SizeOf<APPBARDATA>(),
            hWnd = _appBar.Handle,
        };
        SHAppBarMessage(AbmRemove, ref data);
        _appBar = new AppBarInfo(IntPtr.Zero, 0);
    }

    private const uint CallbackMessageId = 0x8AF4;

    private void AnchorToEdge(string edge)
    {
        var handle = new WindowInteropHelper(this).Handle;
        var area = SystemParameters.WorkArea;
        // WPF DIPs → physical pixels via the composition transform (PerMonitorV2 process).
        var scale = PresentationSource.FromVisual(this)?.CompositionTarget?.TransformToDevice.M11 ?? 1.0;
        if (scale <= 0 || double.IsNaN(scale)) scale = 1.0;
        var thickness = (int)Math.Round(ThicknessForEdge() * scale);

        uint abe;
        var rect = new RECT();
        if (edge == "top")
        {
            abe = AbeTop;
            rect.Left = (int)(area.Left * scale);
            rect.Top = (int)(area.Top * scale);
            rect.Right = (int)((area.Left + area.Width) * scale);
            rect.Bottom = rect.Top + thickness;
        }
        else if (edge == "left")
        {
            abe = AbeLeft;
            rect.Left = (int)(area.Left * scale);
            rect.Top = (int)(area.Top * scale);
            rect.Right = rect.Left + thickness;
            rect.Bottom = (int)((area.Top + area.Height) * scale);
        }
        else if (edge == "right")
        {
            abe = AbeRight;
            rect.Right = (int)((area.Left + area.Width) * scale);
            rect.Left = rect.Right - thickness;
            rect.Top = (int)(area.Top * scale);
            rect.Bottom = (int)((area.Top + area.Height) * scale);
        }
        else
        {
            abe = AbeBottom;
            rect.Left = (int)(area.Left * scale);
            rect.Bottom = (int)((area.Top + area.Height) * scale);
            rect.Right = (int)((area.Left + area.Width) * scale);
            rect.Top = rect.Bottom - thickness;
        }

        var data = new APPBARDATA
        {
            cbSize = Marshal.SizeOf<APPBARDATA>(),
            hWnd = handle,
            uCallbackMessage = CallbackMessageId,
            uEdge = abe,
            rc = rect,
        };
        // ABM_SETPOS proposes the rect; the shell answers with the reserved one, which is where
        // the window must end up.
        var proposed = SHAppBarMessage(AbmSetpos, ref data);
        rect = data.rc;

        Width = (rect.Right - rect.Left) / scale;
        Height = (rect.Bottom - rect.Top) / scale;
        Left = rect.Left / scale;
        Top = rect.Top / scale;
        App.Log.Write($"[taskbar] anchored {edge} (accepted={proposed != 0})");
    }

    [DllImport("shell32.dll")]
    private static extern uint SHAppBarMessage(uint message, ref APPBARDATA data);

    private const int GWL_EXSTYLE = -20;
    private const int WS_EX_NOACTIVATE = unchecked((int)0x08000000);
    private const int WS_EX_TOOLWINDOW = 0x00000080;

    [DllImport("user32.dll", EntryPoint = "GetWindowLongW")]
    private static extern int GetWindowLong(IntPtr hwnd, int index);

    [DllImport("user32.dll", EntryPoint = "SetWindowLongW")]
    private static extern int SetWindowLong(IntPtr hwnd, int index, int newStyle);
}

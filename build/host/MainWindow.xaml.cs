// The launcher window.
//
// A borderless, topmost, centred window that shows/hides on a global hotkey — the shape of
// Raycast's `Raycast.WebView.MainWindow` / `Raycast.WebView.Window`. WebView2 hosts the TypeScript
// frontend from a virtual host mapping, exactly like Raycast's `Raycast.WebView.ResourceHandler` +
// `<HandleWebResourceRequest>` serve `frontend/main-window.html` over a custom scheme.

using System;
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
    private const int HotkeyIdFallback = 0x1002;
    private const int StartMenuHotkeyId = 0x1003;
    private bool _startMenuReplaced;
    private const uint ModAlt = 0x0001;
    private const uint ModWin = 0x0008;
    private const uint VkLWin = 0x5B;
    private const uint VkRWin = 0x5C;
    private const uint ModControl = 0x0002;
    private const uint ModShift = 0x0004;
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
        CenterOnScreen();

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
                if (_webViewInitState != 2) return;
                Hide();
            };
        }

        // Remember which window had focus before the launcher took over, so Paste can hand it back.
        // Raycast keeps the same handle (`paste: no last foreground window available` when it is gone).
        Deactivated += (_, _) => ClipboardHistory.RecordForegroundWindow();
    }

    public static string GetSafeUserDataFolder(string baseName)
    {
        var baseDir = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "RaycastMini",
            baseName);

        var lockFiles = new[]
        {
            Path.Combine(baseDir, "EBWebView", "Default", "LOCK"),
            Path.Combine(baseDir, "EBWebView", "lockfile")
        };

        foreach (var lockFile in lockFiles)
        {
            if (File.Exists(lockFile))
            {
                try
                {
                    using var stream = File.Open(lockFile, FileMode.Open, FileAccess.ReadWrite, FileShare.None);
                }
                catch
                {
                    App.Log.Write($"[webview2] lock file '{lockFile}' is in use; using process-isolated folder");
                    return Path.Combine(
                        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                        "RaycastMini",
                        $"{baseName}-{Environment.ProcessId}");
                }
            }
        }

        return baseDir;
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
            if (!IsVisible)
            {
                Show();
            }
            var udir = GetSafeUserDataFolder("WebView2");
            var environment = await CoreWebView2Environment.CreateAsync(userDataFolder: udir);
            await _webView.EnsureCoreWebView2Async(environment);
            _webViewInitState = 2;
            WebView2Permissions.AllowClipboardRead(_webView.CoreWebView2);
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

        // The backend's image.fetch keeps artwork bytes in the shared cache folder; mapping it
        // onto a second virtual host lets extensions hand the renderer plain URLs instead of
        // shipping every image through the render tree as a data: URI (which OOMs the worker on
        // library-sized artwork sets).
        var imageCacheDir = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "RaycastMini", "oauth", "image-cache");
        Directory.CreateDirectory(imageCacheDir);
        _webView.CoreWebView2.SetVirtualHostNameToFolderMapping(
            "raycastmini-img", imageCacheDir, CoreWebView2HostResourceAccessKind.Allow);

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

        if (method == "window.openSettings")
        {
            _webView.Dispatcher.Invoke(OpenSettings);
            return null;
        }

        // Settings window rows that reach the host directly (General page). Failures throw so the
        // renderer can roll the switch back, matching Raycast's openAtLogin flow.
        if (method == "settings.openAtLogin")
        {
            var enabled = data is { ValueKind: System.Text.Json.JsonValueKind.Object } loginPayload
                && loginPayload.TryGetProperty("enabled", out var loginEnabled) && loginEnabled.GetBoolean();
            SetOpenAtLogin(enabled);
            return null;
        }
        if (method == "settings.trayIcon")
        {
            var enabled = data is { ValueKind: System.Text.Json.JsonValueKind.Object } trayPayload
                && trayPayload.TryGetProperty("enabled", out var trayEnabled) && trayEnabled.GetBoolean();
            _webView.Dispatcher.Invoke(() =>
            {
                if (enabled) InitTrayIcon();
                else RemoveTrayIcon();
            });
            return null;
        }
        if (method == "settings.systemAccent")
        {
            return System.Text.Json.JsonSerializer.SerializeToElement(new { color = GetSystemAccentHex() });
        }
        // Compact window mode: the renderer reports whether the launcher should show the search
        // bar only (Raycast's compact window shrinks to the search bar while the list is empty).
        if (method == "window.setLauncherHeight")
        {
            var compact = false;
            var visible = true;
            if (data is { ValueKind: System.Text.Json.JsonValueKind.Object } heightPayload)
            {
                if (heightPayload.TryGetProperty("compact", out var compactValue)) compact = compactValue.GetBoolean();
                if (heightPayload.TryGetProperty("visible", out var visibleValue)) visible = visibleValue.GetBoolean();
            }
            _webView.Dispatcher.Invoke(() =>
            {
                if (WindowState == WindowState.Minimized) WindowState = WindowState.Normal;
                _launcherHeight = compact && !visible ? CompactLauncherHeight : ExpandedLauncherHeight;
                Height = _launcherHeight;
            });
            return null;
        }
        // Replace Start Menu: register the bare Win key (left and right) as launcher hotkeys.
        if (method == "settings.replaceStartMenu")
        {
            var enabled = data is { ValueKind: System.Text.Json.JsonValueKind.Object } startPayload
                && startPayload.TryGetProperty("enabled", out var startEnabled) && startEnabled.GetBoolean();
            _webView.Dispatcher.Invoke(() => SetStartMenuReplaced(enabled));
            return null;
        }
        // Themes drive the native chrome behind the WebView (backdrop border, settings strips).
        if (method == "settings.setChromeAppearance")
        {
            var light = data is { ValueKind: System.Text.Json.JsonValueKind.Object } chromePayload
                && chromePayload.TryGetProperty("light", out var chromeLight) && chromeLight.GetBoolean();
            _webView.Dispatcher.Invoke(() =>
            {
                Root.Background = new System.Windows.Media.SolidColorBrush(
                    light ? System.Windows.Media.Color.FromRgb(0xFF, 0xFF, 0xFF)
                          : System.Windows.Media.Color.FromRgb(0x33, 0x33, 0x33));
                _settingsWindow?.SetChromeLight(light);
            });
            return null;
        }
        if (method == "settings.setGlobalHotkey")
        {
            var hotkey = data is { ValueKind: System.Text.Json.JsonValueKind.Object } hotkeyPayload
                && hotkeyPayload.TryGetProperty("hotkey", out var hotkeyValue) ? hotkeyValue.GetString() : null;
            if (hotkey is null) throw new InvalidOperationException("Missing hotkey");
            _webView.Dispatcher.Invoke(() => ApplyGlobalHotkey(hotkey));
            return null;
        }

        // Raycast Notes (`host.raycast.showNotesWindow`): `open`/`create` close the launcher and
        // open the dedicated notes window; the payload carries {noteId?} or {create, text?}.
        if (method == "window.showNotes")
        {
            if (data is { ValueKind: System.Text.Json.JsonValueKind.Object } notesPayload)
            {
                _webView.Dispatcher.Invoke(() =>
                    NotesWindow.GetOrCreate(() => _backend.FrontendRoot).ShowNotes(notesPayload));
            }
            else
            {
                _webView.Dispatcher.Invoke(() =>
                    NotesWindow.GetOrCreate(() => _backend.FrontendRoot).ShowNotes(System.Text.Json.JsonDocument.Parse("{}").RootElement.Clone()));
            }
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

    /// <summary>
    /// Frontend-module dispatch for a window other than the launcher (the Notes window's page).
    /// The same routes answer: `window.*` handlers, `fileSystem.*`/`clipboard.*` native routes.
    /// </summary>
    internal Task<System.Text.Json.JsonElement?> DispatchForNotesPageAsync(string method, System.Text.Json.JsonElement? data)
        => DispatchIpcAsync(method, string.Empty, data, isBackend: false);

    /// <summary>
    /// The Notes window's `Create Quicklink` action: reveal the launcher already on the Quicklinks
    /// create form, prefilled with the note deeplink and title (the confirmed cross-window action).
    /// </summary>
    internal void ShowQuicklinkCreate(string link, string? name)
    {
        ShowMainWindow();
        PostToRenderer("quicklink.createSeed",
            System.Text.Json.JsonSerializer.SerializeToElement(new { link, name = name ?? string.Empty }));
    }

    /// <summary>Deliver a host-originated message to the Settings window's renderer, if open.</summary>
    public void PostToSettingsRenderer(string method, System.Text.Json.JsonElement? data)
    {
        _settingsWindow?.PostToRenderer(method, data);
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

    /// <summary>Send a request directly from host to Node backend over the named pipe.</summary>
    public async Task<System.Text.Json.JsonElement?> RequestBackendAsync(string method, object? data)
    {
        if (!_backend.IsRunning) _ = Task.Run(() => _backend.EnsureRunning());
        return await _pipe.RequestAsync("backend", method, data);
    }

    // -----------------------------------------------------------------------------------------
    // Global hotkey + show/hide
    // -----------------------------------------------------------------------------------------

    private HwndSource? _source;

    private const int ClipboardHotkeyId = 0x1001;

    /// <summary>
    /// Whenever the launcher loses activation, the OS is handing focus to the next window —
    /// usually the app the user will want Window Management commands to target. The delayed
    /// capture runs once that activation landed. This covers shows that bypass the hotkey
    /// (the launcher auto-showing at boot) and re-captures after every command.
    /// </summary>
    protected override void OnDeactivated(EventArgs e)
    {
        base.OnDeactivated(e);
        Dispatcher.BeginInvoke(
            new Action(WindowManagementNative.CaptureForeground),
            System.Windows.Threading.DispatcherPriority.Background);
    }

    protected override void OnSourceInitialized(EventArgs e)
    {
        base.OnSourceInitialized(e);
        var handle = new WindowInteropHelper(this).Handle;
        _source = HwndSource.FromHwnd(handle);
        _source?.AddHook(WndProc);
        var ok1 = RegisterHotKey(handle, HotkeyId, ModAlt | ModControl, VkSpace);
        var ok2 = RegisterHotKey(handle, HotkeyIdFallback, ModControl | ModShift, VkSpace);
        App.Log.Write($"[hotkey] RegisterHotKey Ctrl+Alt+Space: ok={ok1} (err={Marshal.GetLastWin32Error()}), Ctrl+Shift+Space: ok={ok2}");

        // Seed the dynamic settings (Raycast Hotkey, tray, Open at Login) from the settings store.
        var storedHotkey = ReadStoredSetting("raycast-hotkey") as string;
        if (!string.IsNullOrWhiteSpace(storedHotkey) && TryParseHotkey(storedHotkey, out var storedMods, out var storedKey))
        {
            UnregisterHotKey(handle, HotkeyId);
            if (RegisterHotKey(handle, HotkeyId, storedMods, storedKey)) _globalHotkeyText = storedHotkey;
            else RegisterHotKey(handle, HotkeyId, ModAlt | ModControl, VkSpace);
        }
        if (ReadStoredSetting("show-in-menu-bar") is false) RemoveTrayIcon();
        else InitTrayIcon();
        if (ReadStoredSetting("open-at-login") is true) SetOpenAtLogin(true);
        if (ReadStoredSetting("replace-start-menu") is true) SetStartMenuReplaced(true);

        // The Windows accent drives every toggle/link color; re-push when the user changes it.
        try
        {
            var uiSettings = new Windows.UI.ViewManagement.UISettings();
            uiSettings.ColorValuesChanged += (_, _) => Dispatcher.BeginInvoke(() =>
                PostAccent(GetSystemAccentHex(), "settings.systemAccentChanged"));
            PostAccent(GetSystemAccentHex(), "settings.systemAccentChanged");
        }
        catch (Exception error)
        {
            App.Log.Write($"[accent] unavailable: {error.Message}");
        }
    }

    internal static string GetSystemAccentHex()
    {
        try
        {
            var uiSettings = new Windows.UI.ViewManagement.UISettings();
            var color = uiSettings.GetColorValue(Windows.UI.ViewManagement.UIColorType.Accent);
            return $"#{color.R:X2}{color.G:X2}{color.B:X2}";
        }
        catch
        {
            return "#0078D4";
        }
    }

    private void PostAccent(string hex, string method)
    {
        PostToRenderer(method, System.Text.Json.JsonSerializer.SerializeToElement(new { color = hex }));
        PostToSettingsRenderer(method, System.Text.Json.JsonSerializer.SerializeToElement(new { color = hex }));
    }

    /// <summary>Reads one value from the settings store JSON (`store/settings.json`).</summary>
    internal static object? ReadStoredSetting(string key)
    {
        try
        {
            var dataDir = System.Environment.GetEnvironmentVariable("RAYCAST_MINI_DATA_DIR");
            var path = string.IsNullOrEmpty(dataDir)
                ? System.IO.Path.Combine(
                    System.Environment.GetFolderPath(System.Environment.SpecialFolder.LocalApplicationData),
                    "RaycastMini", "store", "settings.json")
                : System.IO.Path.Combine(dataDir, "store", "settings.json");
            if (!System.IO.File.Exists(path)) return null;
            using var document = System.Text.Json.JsonDocument.Parse(System.IO.File.ReadAllText(path));
            if (!document.RootElement.TryGetProperty(key, out var value)) return null;
            return value.ValueKind switch
            {
                System.Text.Json.JsonValueKind.True => true,
                System.Text.Json.JsonValueKind.False => false,
                System.Text.Json.JsonValueKind.String => value.GetString(),
                System.Text.Json.JsonValueKind.Number => value.GetDouble(),
                _ => null,
            };
        }
        catch
        {
            return null;
        }
    }

    /// <summary>
    /// Replace Start Menu: a low-level keyboard hook that swallows the bare Win keyUP (the Start
    /// Menu opens on up) and toggles the launcher instead. Win down and every Win+key combination
    /// pass through untouched, so shortcuts like Win+E keep working.
    /// </summary>
    private void SetStartMenuReplaced(bool enabled)
    {
        if (enabled == _startMenuReplaced) return;
        if (enabled)
        {
            _winKeyHook = SetWindowsHookEx(WhKeyboardLl, WinKeyHookProc, GetModuleHandle(null), 0);
            if (_winKeyHook == IntPtr.Zero)
            {
                App.Log.Write($"[hotkey] win hook failed (err={Marshal.GetLastWin32Error()})");
                throw new InvalidOperationException("The Win key could not be intercepted");
            }
            _startMenuReplaced = true;
        }
        else
        {
            if (_winKeyHook != IntPtr.Zero) UnhookWindowsHookEx(_winKeyHook);
            _winKeyHook = IntPtr.Zero;
            _startMenuReplaced = false;
        }
    }

    private IntPtr _winKeyHook;
    private bool _winDownSwallowed;

    private IntPtr WinKeyHookProc(int code, IntPtr wParam, IntPtr lParam)
    {
        if (code >= 0 && _startMenuReplaced)
        {
            const int wmKeyDown = 0x0100;
            const int wmKeyUp = 0x0101;
            const int wmSysKeyDown = 0x0104;
            const int wmSysKeyUp = 0x0105;
            const uint llkhfInjected = 0x10;
            var vk = (uint)Marshal.ReadInt32(lParam, 0) & 0xFFFF;
            var flags = (uint)Marshal.ReadInt32(lParam, 8);
            var message = wParam.ToInt64();
            var isWin = vk is VkLWin or VkRWin;
            if ((flags & llkhfInjected) == 0)
            {
                if (message is wmKeyDown or wmSysKeyDown)
                {
                    if (isWin)
                    {
                        // Hold the bare Win down; if a combo key follows it is re-injected so
                        // Win+E etc. reach the shell, otherwise the up below is swallowed and
                        // the Start Menu never triggers.
                        _winDownSwallowed = true;
                        return (IntPtr)1;
                    }
                    if (_winDownSwallowed && !isWin)
                    {
                        _winDownSwallowed = false;
                        InjectWinDown();
                    }
                }
                else if (message is wmKeyUp or wmSysKeyUp && isWin && _winDownSwallowed)
                {
                    _winDownSwallowed = false;
                    Dispatcher.BeginInvoke(() => { try { Toggle(); } catch { /* shutting down */ } });
                    return (IntPtr)1;
                }
            }
        }
        return CallNextHookEx(_winKeyHook, code, wParam, lParam);
    }

    private void InjectWinDown()
    {
        var input = new NativeInput[]
        {
            new()
            {
                type = 1, // INPUT_KEYBOARD
                u = new InputUnion { ki = new KeyboardInput { wVk = (ushort)VkLWin } },
            },
        };
        _ = SendInput((uint)input.Length, input, Marshal.SizeOf<NativeInput>());
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct NativeInput
    {
        public int type;
        public InputUnion u;
    }

    [StructLayout(LayoutKind.Explicit)]
    private struct InputUnion
    {
        [FieldOffset(0)] public KeyboardInput ki;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct KeyboardInput
    {
        public ushort wVk;
        public ushort wScan;
        public uint dwFlags;
        public uint time;
        public IntPtr dwExtraInfo;
    }

    [DllImport("user32.dll")]
    private static extern uint SendInput(uint count, NativeInput[] inputs, int size);

    private const int WhKeyboardLl = 13;

    [DllImport("user32.dll")]
    private static extern IntPtr SetWindowsHookEx(int idHook, LowLevelKeyboardProc proc, IntPtr module, uint threadId);

    [DllImport("user32.dll")]
    private static extern bool UnhookWindowsHookEx(IntPtr hook);

    [DllImport("user32.dll")]
    private static extern IntPtr CallNextHookEx(IntPtr hook, int code, IntPtr wParam, IntPtr lParam);

    [DllImport("kernel32.dll")]
    private static extern IntPtr GetModuleHandle(string? name);

    private delegate IntPtr LowLevelKeyboardProc(int code, IntPtr wParam, IntPtr lParam);

    /// <summary>Open at Login: a Run-key entry pointing at this executable, like Raycast's login item.</summary>
    private static void SetOpenAtLogin(bool enabled)
    {
        const string runKey = @"Software\Microsoft\Windows\CurrentVersion\Run";
        const string valueName = "RaycastMini";
        using var key = Microsoft.Win32.Registry.CurrentUser.OpenSubKey(runKey, writable: true)
            ?? Microsoft.Win32.Registry.CurrentUser.CreateSubKey(runKey);
        if (enabled)
        {
            var exe = System.Environment.ProcessPath;
            if (string.IsNullOrEmpty(exe)) exe = System.Reflection.Assembly.GetExecutingAssembly().Location;
            key.SetValue(valueName, '"' + exe + '"');
        }
        else if (key.GetValue(valueName) is not null)
        {
            key.DeleteValue(valueName);
        }
    }

    private bool _clipboardHotkeyRegistered;
    private string? _clipboardHotkeyText;
    private bool _launcherHotkeysSuppressed;
    // The launcher hotkey from the settings store; "Ctrl + Alt + Space" until the store says otherwise.
    private string _globalHotkeyText = "Ctrl + Alt + Space";

    /// <summary>
    /// Applies the settings store's Raycast Hotkey: unregisters the current launcher combination
    /// and registers the new one. Throws when the combination is taken by one of this app's other
    /// registrations or Windows rejects it, so the caller can roll the setting back (Raycast's
    /// hotkey conflict flow).
    /// </summary>
    internal void ApplyGlobalHotkey(string hotkey)
    {
        if (string.IsNullOrWhiteSpace(hotkey))
            throw new InvalidOperationException("Enter a hotkey combination");
        var handle = new WindowInteropHelper(this).Handle;
        if (!TryParseHotkey(hotkey, out var modifiers, out var key))
            throw new InvalidOperationException($"The hotkey {hotkey} could not be registered");
        if ((modifiers, key) == ((uint)(ModControl | ModShift), VkSpace) ||
            (_clipboardHotkeyRegistered && _clipboardHotkeyText is not null &&
             TryParseHotkey(_clipboardHotkeyText, out var clipMods, out var clipKey) &&
             (modifiers, key) == (clipMods, clipKey)))
        {
            throw new InvalidOperationException($"The hotkey {hotkey} is already used by Raycast");
        }
        var previous = _globalHotkeyText;
        UnregisterHotKey(handle, HotkeyId);
        if (!RegisterHotKey(handle, HotkeyId, modifiers, key))
        {
            // Restore whatever worked before so the launcher stays reachable.
            if (TryParseHotkey(previous, out var prevMods, out var prevKey))
                RegisterHotKey(handle, HotkeyId, prevMods, prevKey);
            else
                RegisterHotKey(handle, HotkeyId, ModAlt | ModControl, VkSpace);
            throw new InvalidOperationException($"The hotkey {hotkey} could not be registered");
        }
        _globalHotkeyText = hotkey;
    }

    /// <summary>
    /// Game Mode (docs/focus-games-taskbar-spec.md §B): unregister the launcher + Clipboard History
    /// hotkeys while a game is fullscreen, re-registering the identical combinations afterwards.
    /// </summary>
    internal bool SetLauncherHotkeysSuppressed(bool suppressed)
    {
        if (_launcherHotkeysSuppressed == suppressed) return true;
        var handle = new WindowInteropHelper(this).Handle;
        if (suppressed)
        {
            var ok = UnregisterHotKey(handle, HotkeyId);
            UnregisterHotKey(handle, HotkeyIdFallback);
            if (_clipboardHotkeyRegistered) ok &= UnregisterHotKey(handle, ClipboardHotkeyId);
            if (!ok) return false;
            _launcherHotkeysSuppressed = true;
            return true;
        }
        var restored = false;
        if (TryParseHotkey(_globalHotkeyText, out var launcherMods, out var launcherKey))
            restored = RegisterHotKey(handle, HotkeyId, launcherMods, launcherKey);
        else
            restored = RegisterHotKey(handle, HotkeyId, ModAlt | ModControl, VkSpace);
        RegisterHotKey(handle, HotkeyIdFallback, ModControl | ModShift, VkSpace);
        if (_clipboardHotkeyRegistered && _clipboardHotkeyText is not null && TryParseHotkey(_clipboardHotkeyText, out var modifiers, out var key))
        {
            restored &= RegisterHotKey(handle, ClipboardHotkeyId, modifiers, key);
        }
        if (restored) _launcherHotkeysSuppressed = false;
        return restored;
    }

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
            if (part.Length >= 3 && char.ToUpperInvariant(part[0]) == 'F'
                && int.TryParse(part.AsSpan(1), out var functionKey) && functionKey is >= 1 and <= 24)
            {
                return (uint)(0x70 + functionKey - 1);
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
            "arrowleft" => 0x25,
            "up" => 0x26,
            "arrowup" => 0x26,
            "right" => 0x27,
            "arrowright" => 0x27,
            "down" => 0x28,
            "arrowdown" => 0x28,
            ";" => 0xBA,
            "=" => 0xBB,
            "," => 0xBC,
            "-" => 0xBD,
            "." => 0xBE,
            "/" => 0xBF,
            "`" => 0xC0,
            "[" => 0xDB,
            "\\" => 0xDC,
            "]" => 0xDD,
            "'" => 0xDE,
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
        if (message == (int)WM_TRAYICON)
        {
            var mouse = (int)lParam & 0xFFFF;
            if (mouse == WM_LBUTTONUP)
            {
                Dispatcher.BeginInvoke(Toggle);
                handled = true;
            }
            else if (mouse == WM_RBUTTONUP)
            {
                Dispatcher.BeginInvoke(OpenTrayContextMenu);
                handled = true;
            }
        }
        else if (message == WmHotkey)
        {
            if (wParam.ToInt32() == HotkeyId || wParam.ToInt32() == HotkeyIdFallback || wParam.ToInt32() == StartMenuHotkeyId)
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
            else
            {
                var commandKey = WindowManagementNative.MapHotkey(wParam.ToInt32());
                if (commandKey != null)
                {
                    PostToRenderer("windowManagement.hotkey",
                        System.Text.Json.JsonSerializer.SerializeToElement(new { commandKey }));
                    handled = true;
                }
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
        WindowManagementNative.CaptureForeground();
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
            WindowManagementNative.CaptureForeground();
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
        App.Log.Write($"[window] ShowMainWindow called (IsVisible={IsVisible}, WindowState={WindowState})");
        WindowManagementNative.CaptureForeground();
        if (WindowState == WindowState.Minimized) WindowState = WindowState.Normal;
        if (!IsVisible)
        {
            PositionOnStoredScreen();
            Show();
        }
        Activate();
        Topmost = true;
        // Re-assert the pending size now that the window is visible: the WebView child keeps the
        // stale viewport otherwise (the page then lays out taller than the visible strip). When
        // the height already matches, force a real arrange pass with a 1px round-trip — the
        // HwndHost child only re-homes on an actual size change.
        if (Math.Abs(Height - _launcherHeight) > 0.5)
        {
            Height = _launcherHeight;
        }
        else
        {
            Height = _launcherHeight + 1;
            UpdateLayout();
            Height = _launcherHeight;
        }
        _webView.InvalidateMeasure();
        UpdateLayout();
        PostVisibility(true);
        _webView.Focus();
    }

    // Launcher sizes for the Window Mode setting (compact = search bar only until typing).
    internal const double CompactLauncherHeight = 84;
    internal const double ExpandedLauncherHeight = 480;
    // The last height the renderer asked for; re-applied on show because the WebView child does
    // not re-layout a size change that happened while the window was hidden.
    private double _launcherHeight = ExpandedLauncherHeight;

    /// <summary>
    /// "Show Raycast On" (General page): place the launcher on the screen containing the mouse,
    /// the screen with the active window, or the primary screen.
    /// </summary>
    private void PositionOnStoredScreen()
    {
        var choice = ReadStoredSetting("show-raycast-on") as string ?? "Screen containing mouse";
        try
        {
            var point = choice switch
            {
                "Screen with active window" => CenterOf(WindowManagementNative.CapturedTargetHandle()),
                "Primary screen" => new NativePoint(0, 0),
                _ => GetCursorPos(out var cursor) ? new NativePoint(cursor.X, cursor.Y) : new NativePoint(0, 0),
            };
            var monitor = MonitorFromPoint(point, 2); // MONITOR_DEFAULTTONEAREST
            if (monitor == IntPtr.Zero)
            {
                CenterOnScreen();
                return;
            }
            var info = new MonitorInfo { cbSize = Marshal.SizeOf<MonitorInfo>() };
            if (!GetMonitorInfo(monitor, ref info)) { CenterOnScreen(); return; }
            Left = info.rcWork.Left + Math.Max(0, (info.rcWork.Width - Width) / 2);
            Top = info.rcWork.Top + Math.Max(0, (int)((info.rcWork.Height - Height) / 3.0));
        }
        catch
        {
            CenterOnScreen();
        }
    }

    private static NativePoint CenterOf(IntPtr window)
    {
        if (window == IntPtr.Zero || !GetWindowRect(window, out var rect)) return new NativePoint(0, 0);
        return new NativePoint((rect.Left + rect.Right) / 2, (rect.Top + rect.Bottom) / 2);
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct NativePoint { public NativePoint(int x, int y) { X = x; Y = y; } public int X; public int Y; }

    [StructLayout(LayoutKind.Sequential)]
    private struct NativeRect { public int Left, Top, Right, Bottom; public int Width => Right - Left; public int Height => Bottom - Top; }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Auto)]
    private struct MonitorInfo
    {
        public int cbSize;
        public NativeRect rcMonitor;
        public NativeRect rcWork;
        public int dwFlags;
    }

    [DllImport("user32.dll")]
    private static extern IntPtr MonitorFromPoint(NativePoint point, uint flags);

    [DllImport("user32.dll", CharSet = CharSet.Auto)]
    private static extern bool GetMonitorInfo(IntPtr monitor, ref MonitorInfo info);

    [DllImport("user32.dll")]
    private static extern bool GetWindowRect(IntPtr hWnd, out NativeRect rect);

    [DllImport("user32.dll")]
    private static extern bool GetCursorPos(out NativePoint point);

    /// <summary>Tells the renderer the window was hidden/shown so it can run pop-to-root timers.</summary>
    private void PostVisibility(bool visible)
    {
        // Expansion is paused while the launcher is on screen (Raycast pauses while its editor is
        // open; the launcher window is the clone's whole UI, so this covers the editor case too).
        SnippetHook.SetLauncherVisible(visible);
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
        RemoveTrayIcon();
        // The settings window hides itself on close; shutdown must bypass that.
        _settingsWindow?.ShutdownForReal();
        HudWindow.Current?.Close();
        NotesWindow.Current?.ShutdownForReal();
        Close();
    }

    internal void OpenSettings()
    {
        if (_settingsWindow is { IsLoaded: true })
        {
            // The settings window hides itself when closed, so a "second instance" just re-shows it.
            if (!_settingsWindow.IsVisible) _settingsWindow.Show();
            if (_settingsWindow.WindowState == WindowState.Minimized) _settingsWindow.WindowState = WindowState.Normal;
            _settingsWindow.Activate();
            return;
        }
        _settingsWindow = new SettingsWindow(
            _backend.FrontendRoot,
            (method, data) => ((App)System.Windows.Application.Current).RequestBackendAsync(method, data),
            (method, data) => DispatchIpcAsync(method, string.Empty, data, isBackend: false));
        _settingsWindow.Show();
    }

    private const uint WM_TRAYICON = 0x8001;
    private const uint NIM_ADD = 0;
    private const uint NIM_MODIFY = 1;
    private const uint NIM_DELETE = 2;
    private const uint NIF_MESSAGE = 1;
    private const uint NIF_ICON = 2;
    private const uint NIF_TIP = 4;
    private const uint WM_LBUTTONUP = 0x0202;
    private const uint WM_RBUTTONUP = 0x0205;

    private bool _trayAdded;
    private ContextMenu? _trayContextMenu;
    private System.Drawing.Icon? _trayIconInstance;

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

    [DllImport("user32.dll")]
    private static extern bool SetForegroundWindow(IntPtr hWnd);

    private void InitTrayIcon()
    {
        try
        {
            var handle = new WindowInteropHelper(this).Handle;
            if (handle == IntPtr.Zero) return;

            if (_trayIconInstance == null)
            {
                using var bitmap = new System.Drawing.Bitmap(32, 32);
                using (var graphics = System.Drawing.Graphics.FromImage(bitmap))
                {
                    graphics.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.AntiAlias;
                    using var fill = new System.Drawing.SolidBrush(System.Drawing.Color.FromArgb(0xFF, 0x63, 0x63));
                    graphics.FillEllipse(fill, 4, 4, 24, 24);
                    using var text = new System.Drawing.SolidBrush(System.Drawing.Color.White);
                    using var font = new System.Drawing.Font("Segoe UI", 12f, System.Drawing.FontStyle.Bold, System.Drawing.GraphicsUnit.Pixel);
                    graphics.DrawString("R", font, text, 10f, 8f);
                }
                _trayIconInstance = System.Drawing.Icon.FromHandle(bitmap.GetHicon());
            }

            var data = new NOTIFYICONDATA
            {
                cbSize = Marshal.SizeOf<NOTIFYICONDATA>(),
                hWnd = handle,
                uID = 100,
                uFlags = NIF_MESSAGE | NIF_ICON | NIF_TIP,
                uCallbackMessage = WM_TRAYICON,
                hIcon = _trayIconInstance.Handle,
                szTip = "Raycast Mini",
            };

            if (Shell_NotifyIcon(NIM_ADD, ref data))
            {
                _trayAdded = true;
                App.Log.Write("[tray] launcher tray icon added successfully");
            }
            else
            {
                App.Log.Write($"[tray] Shell_NotifyIcon failed (err={Marshal.GetLastWin32Error()})");
            }
        }
        catch (Exception ex)
        {
            App.Log.Write($"[tray] failed to initialize tray icon: {ex.Message}");
        }
    }

    private void RemoveTrayIcon()
    {
        if (!_trayAdded) return;
        var handle = new WindowInteropHelper(this).Handle;
        if (handle == IntPtr.Zero) return;
        var data = new NOTIFYICONDATA
        {
            cbSize = Marshal.SizeOf<NOTIFYICONDATA>(),
            hWnd = handle,
            uID = 100,
        };
        Shell_NotifyIcon(NIM_DELETE, ref data);
        _trayAdded = false;
        App.Log.Write("[tray] launcher tray icon removed");
    }

    private void OpenTrayContextMenu()
    {
        _trayContextMenu = new ContextMenu();
        var showItem = new MenuItem { Header = "Show Raycast Mini" };
        showItem.Click += (_, _) => ShowMainWindow();

        var clipboardItem = new MenuItem { Header = "Clipboard History" };
        clipboardItem.Click += (_, _) => OpenClipboardHistory();

        var settingsItem = new MenuItem { Header = "Settings..." };
        settingsItem.Click += (_, _) => OpenSettings();

        var exitItem = new MenuItem { Header = "Exit" };
        exitItem.Click += (_, _) =>
        {
            RemoveTrayIcon();
            System.Windows.Application.Current.Shutdown(0);
        };

        _trayContextMenu.Items.Add(showItem);
        _trayContextMenu.Items.Add(clipboardItem);
        _trayContextMenu.Items.Add(settingsItem);
        _trayContextMenu.Items.Add(new Separator());
        _trayContextMenu.Items.Add(exitItem);

        var handle = new WindowInteropHelper(this).Handle;
        SetForegroundWindow(handle);
        _trayContextMenu.Placement = System.Windows.Controls.Primitives.PlacementMode.MousePoint;
        _trayContextMenu.IsOpen = true;
    }

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool RegisterHotKey(IntPtr hWnd, int id, uint fsModifiers, uint vk);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool UnregisterHotKey(IntPtr hWnd, int id);
}

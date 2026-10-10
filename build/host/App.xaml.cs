using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Windows;
using System.Windows.Threading;

namespace RaycastMini.Launcher;

public partial class App : Application
{
    private const string DefaultPipeName = "raycast-mini-ipc";
    // Overridable so a second instance (or a leftover zombie holding the default pipe) does not
    // break IPC: `RAYCAST_MINI_PIPE=xyz RaycastMini.exe` selects a different pipe end to end.
    // The default name is per-process. A single global name lets two launchers (or a leftover
    // backend from a previous run) race for the same pipe, leaving one of them waiting forever on
    // responses that go to the other end and the UI empty.
    private static readonly string PipeName =
        Environment.GetEnvironmentVariable("RAYCAST_MINI_PIPE") ?? $"{DefaultPipeName}-{Environment.ProcessId}";

    private static readonly string LogPath = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "RaycastMini",
        "launcher.log");

    /// <summary>Shared file logger used by every component in the launcher.</summary>
    public static class Log
    {
        public static readonly string Path =
            System.IO.Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "RaycastMini",
                "launcher.log");

        public static void Write(string message)
        {
            try
            {
                System.IO.Directory.CreateDirectory(System.IO.Path.GetDirectoryName(Path)!);
                System.IO.File.AppendAllText(Path, $"{DateTime.Now:HH:mm:ss.fff} {message}{Environment.NewLine}");
            }
            catch (Exception error)
            {
                // A silent logger once made a broken startup look like a blank black window: every
                // hint disappeared into this catch. When the AppData write fails, the reason goes
                // to a fallback next to the exe (and to a message box as the last resort).
                try
                {
                    var fallback = System.IO.Path.Combine(AppContext.BaseDirectory, "launcher-fallback.log");
                    System.IO.File.AppendAllText(fallback,
                        $"{DateTime.Now:HH:mm:ss.fff} [log write failed: {error.Message}] {message}{Environment.NewLine}");
                }
                catch
                {
                    Debug.WriteLine($"[raycast-mini log] {message} (log write failed: {error.Message})");
                }
            }
        }
    }

    private static void LogLine(string message) => Log.Write(message);

private MainWindow? _window;
    private BackendProcess? _backend;
    private NamedPipeBridge? _pipe;
    private ClipboardMonitor? _clipboard;

    protected override async void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);
        Log.Write("OnStartup");

        // Low-integrity launches (sandboxed terminals, some automation hosts) hand the process a
        // token that cannot write to %LOCALAPPDATA% — the log, the WebView2 profile and the
        // clipboard store all fail and the window stays black. Explorer starts children at the
        // user's real integrity, so hop through it once.
        var integrityRid = Native.CurrentIntegrityRid();
        if (integrityRid is > 0 and < 0x2000 && Environment.GetEnvironmentVariable("RAYCAST_MINI_NO_RELAUNCH") != "1")
        {
            Log.Write($"process integrity is low (0x{integrityRid:X}); relaunching via Explorer");
            System.Diagnostics.Process.Start("explorer.exe", Environment.ProcessPath ?? "RaycastMini.exe");
            Shutdown(0);
            return;
        }

        // Two instances share one WebView2 user-data folder, and the second always fails with
        // 0x800700AA ("resource in use") — usually a leftover instance that only hid itself.
        // Enforce one instance unless a test explicitly opts out.
        if (Environment.GetEnvironmentVariable("RAYCAST_MINI_ALLOW_MULTI") != "1")
        {
            _singleInstanceMutex = new System.Threading.Mutex(true, @"Local\raycast-mini-singleton", out var createdNew);
            if (!createdNew)
            {
                Log.Write("another instance is already running; exiting");
                _singleInstanceMutex.Dispose();
                _singleInstanceMutex = null;
                Shutdown(0);
                return;
            }
        }

        await StartLauncherAsyncCore();
    }

    private System.Threading.Mutex? _singleInstanceMutex;

    private async Task StartLauncherAsyncCore()
    {
        // `ShutdownMode="OnExplicitShutdown"` keeps a half-initialised process alive forever when
        // startup throws (a zombie that also holds the pipe name), so any startup failure must
        // bring the process down explicitly.
        try
        {
            await StartLauncherAsync();
        }
        catch (Exception error)
        {
            Log.Write($"startup failed: {error}");
            MessageBox.Show($"Raycast Mini failed to start:\n{error.Message}", "Raycast Mini",
                MessageBoxButton.OK, MessageBoxImage.Error);
            Shutdown(1);
        }
    }

    private async Task StartLauncherAsync()
    {
        DispatcherUnhandledException += (_, args) =>
        {
            Log.Write($"unhandled: {args.Exception}");
            args.Handled = true;
        };

        Log.Write($"pipe name: {PipeName}");

        // <build>/host/bin/<config>/<tfm>/ -> four levels up lands on <build>/.
        var repoRoot = Environment.GetEnvironmentVariable("RAYCAST_MINI_ROOT") ??
            Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", ".."));
        Log.Write($"repoRoot={repoRoot} (exists={Directory.Exists(repoRoot)})");

        _pipe = new NamedPipeBridge(PipeName);
        Log.Write("pipe server created");

        _backend = new BackendProcess(PipeName, repoRoot);
        Log.Write($"backend entry={Path.Combine(repoRoot, "backend", "src", "index.js")}");

        // The Node backend connects *to* us; start it before waiting for the connection so the
        // ordering matches Raycast (host owns the pipe, backend dials in).
        _backend.Start();
        Log.Write("node backend started");

        // Extension-initiated traffic that must be pushed into the renderer.
        _pipe.RequestReceived += OnBackendRequestAsync;

        Log.Write("waiting for pipe connection");
        _ = _pipe.RunAsync();
        await _pipe.WaitForFirstConnectionAsync();
        Log.Write("pipe connected");

        // Watchdog: if the Node backend ever dies (crash, killed externally), bring it back. The pipe
        // bridge reconnects automatically, so the UI recovers instead of staying empty until restart.
        var watchdog = new System.Windows.Threading.DispatcherTimer(TimeSpan.FromSeconds(3),
            System.Windows.Threading.DispatcherPriority.Background, (_, _) =>
            {
                if (_backend is { IsRunning: false }) _ = Task.Run(() => _backend.EnsureRunning());
            }, Dispatcher);
        watchdog.Start();


_window = new MainWindow(_pipe, _backend);
        _window.Show();
        MainWindow = _window;
        Log.Write("main window shown");

        // Clipboard history listener. Attached last so an early capture cannot race the backend.
        _clipboard = new ClipboardMonitor();
        _clipboard.EntryCaptured += OnClipboardEntryCaptured;
        _ = Dispatcher.InvokeAsync(() =>
        {
            try
            {
                _clipboard.Start();
            }
            catch (Exception error)
            {
                Log.Write($"[clipboard] failed to enable clipboard listener: {error.Message}");
            }
        });
        Log.Write("clipboard listener starting");
    }

    /// <summary>
    /// Handles the two module kinds the backend can ask for:
    ///   module "frontend" -> forward into WebView2 (`z.frontend.*`)
    ///   module "backend"  -> answer here (native OS operations)
    /// </summary>
    private async Task<object?> OnBackendRequestAsync(PipeMessage message)
    {
        if (message.Module == "frontend")
        {
            if (_window is null) return null;
            _window.Dispatcher.Invoke(() =>
                _window.PostToRenderer(message.Method, message.Data));
            return null;
        }

        if (message.Module == "backend")
        {
            // The Node backend asks the native host to do something. Its IPC bridge passes the real
            // method through a `native` envelope so it can keep one pipe-level request/response pair.
            if (message.Method == "native" && message.Data is { ValueKind: System.Text.Json.JsonValueKind.Object } envelope
                && envelope.TryGetProperty("method", out var nativeMethod)
                && envelope.TryGetProperty("data", out var nativeData))
            {
                var nativeResult = await DispatchNativeAsync(nativeMethod.GetString() ?? "", nativeData);
                Log.Write($"[native hop] {nativeMethod.GetString()} result type={nativeResult?.GetType().FullName ?? "null"}");
                return nativeResult;
            }

            return await DispatchNativeAsync(message.Method, message.Data);
        }

        return null;
    }

    private static async Task<object?> DispatchNativeAsync(string method, System.Text.Json.JsonElement? data)
    {
        Debug.WriteLine($"[native] dispatch {method}");
        // Native operations touch the clipboard and must run on the UI thread. Awaiting
        // `InvokeAsync(() => TaskReturningMethod())` yields the inner `Task<T>`, not `T` — a wrapped
        // task serialises as {"Result": …} on the pipe, so flatten it before awaiting.
        if (Current?.Dispatcher is { } dispatcher)
        {
            return await dispatcher.InvokeAsync(() => NativeHost.DispatchAsync(method, data)).Task.Unwrap();
        }
        return await NativeHost.DispatchAsync(method, data);
    }

/// <summary>
    /// A captured clipboard entry goes straight to the Node backend, which owns the store — the same
    /// split as Raycast (`native.dll` captures, `backend/index.mjs` persists).
    /// </summary>
    private async void OnClipboardEntryCaptured(ClipboardEntry entry, string observationId)
    {
        if (_pipe is null) return;
        try
        {
            var payload = JsonSerializer.SerializeToElement(new
            {
                items = entry.Items.Select(item => new
                {
                    representations = item.Representations.Select(representation => new
                    {
                        mimeType = representation.MimeType,
                        contentType = representation.ContentType,
                        content = representation.Content,
                        size = representation.Size,
                        width = representation.Width,
                        height = representation.Height,
                    }),
                }),
                source = entry.Source,
                observationId,
            });
            await _pipe.RequestAsync("backend", "clipboardHistory.capture", payload);
        }
        catch (Exception error)
        {
            Log.Write($"[clipboard] failed to hand entry to the backend: {error.Message}");
        }
    }

    /// <summary>Hide the launcher window from the paste path once the keystroke has been delivered.</summary>
    public static void RequestHideMainWindow()
    {
        Current?.Dispatcher.InvokeAsync(() => (Current.MainWindow as MainWindow)?.Hide());
    }

    /// <summary>
    /// The Clipboard History global hotkey: reveal the launcher already pointing at that command, which
    /// is what Raycast's `hotkey.register` for a command does.
    /// </summary>
    public static void OpenClipboardHistory()
    {
        Current?.Dispatcher.InvokeAsync(() => (Current.MainWindow as MainWindow)?.OpenClipboardHistory());
    }

    protected override void OnExit(ExitEventArgs e)
    {
        _singleInstanceMutex?.ReleaseMutex();
        _singleInstanceMutex?.Dispose();
        if (_clipboard is not null)
        {
            _clipboard.EntryCaptured -= OnClipboardEntryCaptured;
            _clipboard.Dispose();
        }
        _window?.ShutdownForReal();
        _pipe?.DisposeAsync().AsTask().Wait(TimeSpan.FromSeconds(2));
        _backend?.DisposeAsync().AsTask().Wait(TimeSpan.FromSeconds(5));
        base.OnExit(e);
    }
}

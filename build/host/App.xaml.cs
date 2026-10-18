using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Windows;
using System.Windows.Threading;

namespace Openray.Launcher;

public partial class App : Application
{
    private const string DefaultPipeName = "openray-ipc";
    // Overridable so a second instance (or a leftover zombie holding the default pipe) does not
    // break IPC: `OPENRAY_PIPE=xyz Openray.exe` selects a different pipe end to end.
    // The default name is per-process. A single global name lets two launchers (or a leftover
    // backend from a previous run) race for the same pipe, leaving one of them waiting forever on
    // responses that go to the other end and the UI empty.
    private static readonly string PipeName =
        Environment.GetEnvironmentVariable("OPENRAY_PIPE") ?? $"{DefaultPipeName}-{Environment.ProcessId}";

    private static readonly string LogPath = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "Openray",
        "launcher.log");

    /// <summary>Shared file logger used by every component in the launcher.</summary>
    public static class Log
    {
        public static readonly string Path =
            System.IO.Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "Openray",
                "launcher.log");

        public static void Write(string message)
        {
            try
            {
                var dir = System.IO.Path.GetDirectoryName(Path)!;
                System.IO.Directory.CreateDirectory(dir);
                using var fs = new System.IO.FileStream(Path, System.IO.FileMode.Append, System.IO.FileAccess.Write, System.IO.FileShare.ReadWrite);
                using var writer = new System.IO.StreamWriter(fs);
                writer.WriteLine($"{DateTime.Now:HH:mm:ss.fff} {message}");
            }
            catch (Exception error)
            {
                try
                {
                    var fallback = System.IO.Path.Combine(AppContext.BaseDirectory, "launcher-fallback.log");
                    using var fs = new System.IO.FileStream(fallback, System.IO.FileMode.Append, System.IO.FileAccess.Write, System.IO.FileShare.ReadWrite);
                    using var writer = new System.IO.StreamWriter(fs);
                    writer.WriteLine($"{DateTime.Now:HH:mm:ss.fff} [log write failed: {error.Message}] {message}");
                }
                catch
                {
                    Debug.WriteLine($"[openray log] {message} (log write failed: {error.Message})");
                }
            }
        }
    }

    private static void LogLine(string message) => Log.Write(message);

private MainWindow? _window;
    private BackendProcess? _backend;
    private NamedPipeBridge? _pipe;
    private ClipboardMonitor? _clipboard;

    /// <summary>Secondary windows (Settings) forward their renderer's backend requests here.</summary>
    public async Task<System.Text.Json.JsonElement?> RequestBackendAsync(string method, System.Text.Json.JsonElement? data)
    {
        if (_pipe is null) return null;
        return await _pipe.RequestAsync("backend", method, data);
    }

    /// <summary>`--dev-extensions` / OPENRAY_DEV_EXTENSIONS=1: reveal internal test extensions.</summary>
    public static bool DevExtensions { get; set; }

    /// <summary>
    /// One-time carry-over from the pre-rebrand layout: `%LOCALAPPDATA%\RaycastMini` holds the
    /// extensions, the store, settings.json, the clipboard DB, the WebView2 profile and the logs.
    /// Runs before anything creates the new directory (the log writer included) so the move can
    /// succeed. A locked directory (old instance still running) is skipped; the next launch retries.
    /// </summary>
    private static void MigrateLegacyDataDirectories()
    {
        var localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        var targets = new List<string> { Path.Combine(localAppData, "Openray") };
        var dataDir = Environment.GetEnvironmentVariable("OPENRAY_DATA_DIR");
        if (!string.IsNullOrWhiteSpace(dataDir)) targets.Add(dataDir);
        foreach (var target in targets)
        {
            try
            {
                if (string.IsNullOrWhiteSpace(target)) continue;
                var fullTarget = Path.GetFullPath(target);
                if (Directory.Exists(fullTarget)) continue;
                var legacyName = Path.GetFileName(fullTarget.TrimEnd(Path.DirectorySeparatorChar));
                var openrayIndex = legacyName.IndexOf("Openray", System.StringComparison.OrdinalIgnoreCase);
                if (openrayIndex < 0) continue;
                var legacyNameCandidate = string.Concat(legacyName.AsSpan(0, openrayIndex), "RaycastMini", legacyName.AsSpan(openrayIndex + "Openray".Length));
                var legacy = Path.Combine(Path.GetDirectoryName(fullTarget)!, legacyNameCandidate);
                if (!Directory.Exists(legacy)) continue;
                Directory.Move(legacy, fullTarget);
                Debug.WriteLine($"[openray] migrated data directory {legacy} -> {fullTarget}");
            }
            catch (Exception error)
            {
                Debug.WriteLine($"[openray] data-directory migration skipped: {error.Message}");
            }
        }
    }

    protected override async void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);
        MigrateLegacyDataDirectories();
        Log.Write("OnStartup");

        // Low-integrity launches (sandboxed terminals, some automation hosts) hand the process a
        // token that cannot write to %LOCALAPPDATA% — the log, the WebView2 profile and the
        // clipboard store all fail and the window stays black.
        var integrityRid = Native.CurrentIntegrityRid();
        Log.Write($"OnStartup integrityRid=0x{integrityRid:X}");

        // Two instances share one WebView2 user-data folder, and the second always fails with
        // 0x800700AA ("resource in use") — usually a leftover instance that only hid itself.
        // Enforce one instance unless a test explicitly opts out.
        if (Environment.GetEnvironmentVariable("OPENRAY_ALLOW_MULTI") != "1")
        {
            bool createdNew = false;
            try
            {
                _singleInstanceMutex = new System.Threading.Mutex(true, @"Local\openray-singleton", out createdNew);
            }
            catch (System.Threading.AbandonedMutexException)
            {
                // Previous instance crashed without releasing the mutex — we now own it.
                Log.Write("previous instance abandoned the mutex; taking ownership");
                createdNew = true;
            }

            if (!createdNew)
            {
                Log.Write("another instance is already running; signalling existing instance to show");
                SignalRunningInstance();
                _singleInstanceMutex?.Dispose();
                _singleInstanceMutex = null;
                Shutdown(0);
                return;
            }

            StartSingleInstanceServer();
        }

        await StartLauncherAsyncCore();
    }

    private static void SignalRunningInstance()
    {
        try
        {
            using var client = new System.IO.Pipes.NamedPipeClientStream(".", "openray-instance-activation", System.IO.Pipes.PipeDirection.Out);
            client.Connect(1500);
            using var writer = new StreamWriter(client);
            writer.WriteLine("show");
            writer.Flush();
        }
        catch (Exception ex)
        {
            Log.Write($"failed to signal existing instance: {ex.Message}");
        }
    }

    private void StartSingleInstanceServer()
    {
        Task.Run(async () =>
        {
            while (!_isShuttingDown)
            {
                try
                {
                    using var server = new System.IO.Pipes.NamedPipeServerStream(
                        "openray-instance-activation",
                        System.IO.Pipes.PipeDirection.In,
                        1,
                        System.IO.Pipes.PipeTransmissionMode.Byte,
                        System.IO.Pipes.PipeOptions.Asynchronous);

                    await server.WaitForConnectionAsync();
                    using var reader = new StreamReader(server);
                    var line = await reader.ReadLineAsync();
                    Log.Write($"[activation] received command '{line}' from second instance");
                    if (line == "show")
                    {
                        Dispatcher.Invoke(() =>
                        {
                            if (_window != null)
                            {
                                _window.ShowMainWindow();
                            }
                        });
                    }
                }
                catch (Exception ex)
                {
                    if (_isShuttingDown) break;
                    Log.Write($"activation pipe error: {ex.Message}");
                    await Task.Delay(1000);
                }
            }
        });
    }

    private volatile bool _isShuttingDown;
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
            MessageBox.Show($"Openray failed to start:\n{error.Message}", "Openray",
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

        // The app root is the directory holding `backend/` + `frontend/`: the dev tree
        // (<build>/host/bin/<config>/<tfm>/ -> four levels up) or an installed layout
        // ({localappdata}\Programs\Openray where the exe sits directly in it).
        static string FindAppRoot(string start)
        {
            var dir = Path.GetFullPath(start);
            for (var i = 0; i < 6 && dir is not null; i++)
            {
                if (Directory.Exists(Path.Combine(dir, "backend")) && Directory.Exists(Path.Combine(dir, "frontend")))
                {
                    return dir;
                }
                dir = Path.GetDirectoryName(dir)?.Length > 3 ? Path.GetDirectoryName(dir) : null;
            }
            return null;
        }

        var repoRoot = FindAppRoot(Environment.GetEnvironmentVariable("OPENRAY_ROOT")
            ?? AppContext.BaseDirectory)
            ?? Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", ".."));
        Log.Write($"repoRoot={repoRoot} (exists={Directory.Exists(repoRoot)})");

        _backend = new BackendProcess(PipeName, repoRoot);
        Log.Write($"backend entry={Path.Combine(repoRoot, "backend", "src", "index.js")}");

        _pipe = new NamedPipeBridge(PipeName);
        _pipe.SetPrimaryToken(_backend.ConnectionToken);
        Log.Write("pipe server created");

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

        // Snippet auto-expansion installs the low-level keyboard hook on this thread (its pump
        // delivers the callbacks). The backend pushes the keyword set and expansion config as soon
        // as it connects; they are buffered until the hook exists.
        SnippetHook.Install(_pipe);
        Log.Write("snippet hook installed");

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
            // Control-channel round trips (get_state, send_input, screenshot) need the renderer's
            // or the window's answer back over the pipe, not a fire-and-forget push.
            if (message.Method is "window.controlState" or "window.controlInput" or "window.capture")
            {
                if (_window is not MainWindow controlWindow) return null;
                return await controlWindow.Dispatcher.InvokeAsync(() =>
                    controlWindow.DispatchFromBackendAsync(message.Method, message.Data)).Task.Unwrap();
            }
            _window.Dispatcher.Invoke(() =>
            {
                _window.PostToRenderer(message.Method, message.Data);
                // Settings pushes (e.g. `settings.changed`) must reach the Settings window too.
                if (_window is MainWindow main) main.PostToSettingsRenderer(message.Method, message.Data);
            });
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
        _isShuttingDown = true;
        SnippetHook.Uninstall();
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

// Spawns and supervises the Node backend: `Raycast.exe` runs `backend/node.exe backend/index.mjs`
// and connects it to a named pipe. `Raycast.Backend.NodeEnvironment` / `Raycast.Backend.XrayBackend`
// / `Raycast.App+<StartFrontendDevServerAsync>` are the Raycast counterparts.

using System.Diagnostics;
using System.IO;
using System.Text.Json;

namespace RaycastMini.Launcher;

public sealed class BackendProcess : IAsyncDisposable
{
    private readonly string _pipeName;
    private Process? _process;
    private readonly object _gate = new();
    private int _startCount;
    private bool _stopping;
    private bool _restarting;

    public BackendProcess(string pipeName, string repoRoot)
    {
        _pipeName = pipeName;
        RepoRoot = repoRoot;
        BackendRoot = System.IO.Path.Combine(repoRoot, "backend");
        FrontendRoot = System.IO.Path.Combine(repoRoot, "frontend");
        ApiRoot = System.IO.Path.Combine(repoRoot, "api");
        ExtensionsRoot = System.IO.Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "RaycastMini",
            "extensions");
    }

    public string RepoRoot { get; }
    public string BackendRoot { get; }
    public string FrontendRoot { get; }
    public string ApiRoot { get; }
    public string ExtensionsRoot { get; }
    /// <summary>
    /// Per-launch token the backend presents on the pipe (`hello`). A zombie backend left over from
    /// a killed host carries a stale token and is rejected by the bridge instead of becoming primary.
    /// </summary>
    public string ConnectionToken { get; } = Guid.NewGuid().ToString("N");
    public bool IsRunning
    {
        get
        {
            try { return _process is { HasExited: false }; }
            catch { return false; }
        }
    }

    public void Start()
    {
        Directory.CreateDirectory(ExtensionsRoot);

        var entry = System.IO.Path.Combine(BackendRoot, "src", "index.js");
        var startInfo = new ProcessStartInfo
        {
            FileName = "node",
            ArgumentList = { entry },
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            WorkingDirectory = BackendRoot,
            CreateNoWindow = true,
        };

        startInfo.EnvironmentVariables["RAYCAST_MINI_PIPE"] = _pipeName;
        startInfo.EnvironmentVariables["RAYCAST_MINI_PIPE_TOKEN"] = ConnectionToken;
        _startCount++;
        startInfo.EnvironmentVariables["RAYCAST_MINI_API_ROOT"] = ApiRoot;
        startInfo.EnvironmentVariables["RAYCAST_MINI_FRONTEND_ROOT"] = FrontendRoot;
        startInfo.EnvironmentVariables["RAYCAST_MINI_EXTENSIONS_ROOT"] = ExtensionsRoot;

        _process = new Process { StartInfo = startInfo, EnableRaisingEvents = true };

        _process.OutputDataReceived += (_, args) =>
        {
            if (string.IsNullOrWhiteSpace(args.Data)) return;
            Log($"stdout: {args.Data}");
            try
            {
                var payload = JsonDocument.Parse(args.Data).RootElement;
                if (payload.TryGetProperty("ready", out var ready) && ready.GetBoolean()) return;
            }
            catch
            {
                /* not a protocol line */
            }
        };
        _process.ErrorDataReceived += (_, args) =>
        {
            if (!string.IsNullOrWhiteSpace(args.Data)) Log($"stderr: {args.Data}");
        };

        if (!_process.Start()) throw new InvalidOperationException("could not start node");
        Log($"node pid={_process.Id} attempt={_startCount}");
        _process.BeginOutputReadLine();
        _process.BeginErrorReadLine();

        // Supervise the backend. Raycast's `Raycast.Backend.XrayBackend` watches its Node process and
        // restarts it; without this, killing node leaves the launcher with an empty UI and no way to
        // recover except a manual restart.
        _process.Exited += OnBackendExited;
    }

    private void OnBackendExited(object? sender, EventArgs e)
    {
        lock (_gate)
        {
            if (_stopping) return;
            if (_process is { HasExited: true }) _process = null;
            var attempt = _startCount + 1;
            Log($"node backend exited (run #{attempt}) - restarting");
        }
        Restart();
    }

    private void Restart()
    {
        lock (_gate)
        {
            if (_stopping || _restarting) return;
            _restarting = true;
            _process?.Dispose();
            _process = null;
        }
        // Small backoff so a crash loop does not spin the CPU.
        Thread.Sleep(750);
        try
        {
            Start();
        }
        catch (Exception error)
        {
            Log($"restart failed: {error.Message}");
        }
        finally
        {
            lock (_gate) _restarting = false;
        }
    }

    /// <summary>Restarts the backend if it died without the `Exited` event having been delivered.</summary>
    public void EnsureRunning()
    {
        lock (_gate)
        {
            if (_stopping) return;
            if (_process is { HasExited: false }) return;
        }
        Restart();
    }

    private static void Log(string message)
    {
        try
        {
            var logPath = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "RaycastMini",
                "backend.log");
            Directory.CreateDirectory(Path.GetDirectoryName(logPath)!);
            File.AppendAllText(logPath, $"{DateTime.Now:HH:mm:ss.fff} {message}{Environment.NewLine}");
        }
        catch
        {
            /* logging must never take the launcher down */
        }
    }

    public async ValueTask DisposeAsync()
    {
        if (_process is null) return;
        try
        {
            if (!_process.HasExited)
            {
                _process.Kill(entireProcessTree: true);
        var finished = _process.WaitForExitAsync();
        var timedOut = await Task.WhenAny(finished, Task.Delay(5000)) != finished;
        if (!timedOut) await finished;
            }
        }
        catch
        {
            /* already gone */
        }
        _process.Dispose();
    }
}

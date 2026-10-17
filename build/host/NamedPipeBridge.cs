// Named-pipe bridge between the .NET launcher and the Node backend.
//
// Raycast's equivalent is `Raycast.IPC.Client` + `Raycast.InterRaycastPipe` +
// `System.IO.Pipes.NamedPipeClientStream/NamedPipeServerStream`. The C# side *is* the pipe server;
// the Node backend connects to it.
//
// Protocol (newline-delimited JSON):
//   backend -> host : { type:"hello", token }   (first message; proves the client was spawned by this host)
//   backend -> host : { type:"request", id, module:"frontend"|"backend", method, data }
//   host -> backend : { type:"response", id, ok, data | error }
//   host -> backend : { type:"push",    module:"frontend", method, data }
//
//   module "frontend" == deliver to the WebView2 renderer (Raycast's `z.frontend.*`)
//   module "backend"  == ask the Node host to do something  (Raycast's `dispatchRequest("backend", …)`)
//
// The authenticated client is the backend ("primary"): only its responses resolve host-side
// `RequestAsync` waiters, and its disconnect fails them. Additional clients (session drivers) may
// send requests and get answers on their own connection without ever touching backend traffic.
// The hello token keeps a zombie backend from a killed host from claiming the primary slot and
// silently stranding every backend request.

using System.IO;
using System.IO.Pipes;
using System.Text;
using System.Text.Json;

namespace Openray.Launcher;

public sealed class PipeMessage
{
    public string Type { get; set; } = "request";
    public long Id { get; set; }
    public string Module { get; set; } = string.Empty;
    public string Method { get; set; } = string.Empty;
    public JsonElement? Data { get; set; }
    public bool Ok { get; set; }
    public string? Error { get; set; }
    public string? Token { get; set; }
}

/// <summary>
/// camelCase naming for the wire protocol. The Node backend reads `message.type` / `message.method`
/// (camelCase), so the C# side must not emit .NET's default PascalCase property names.
/// </summary>
internal static class PipeJson
{
    public static readonly JsonSerializerOptions Options = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true,
    };
}

public sealed class NamedPipeBridge : IAsyncDisposable
{
    private sealed class PipeClient
    {
        public required NamedPipeServerStream Pipe;
        public StreamReader? Reader;
        public bool IsPrimary;
    }

    private readonly string _pipeName;
    private readonly SemaphoreSlim _writeLock = new(1, 1);
    private readonly object _stateGate = new();
    private readonly Dictionary<long, TaskCompletionSource<JsonElement?>> _waiters = new();
    private readonly List<PipeClient> _clients = new();
    private NamedPipeServerStream? _listening;
    private string? _primaryToken;
    private long _nextId = 1;
    private bool _disposed;

    private readonly TaskCompletionSource _firstConnection =
        new(TaskCreationOptions.RunContinuationsAsynchronously);

    /// <summary>Raised for every <c>type:"request"</c> arriving from any connected client.</summary>
    public event Func<PipeMessage, Task<object?>>? RequestReceived;

    public NamedPipeBridge(string pipeName)
    {
        _pipeName = pipeName;
        // The reader/writer are created only after a client is connected: a StreamWriter backed by
        // an unconnected pipe flushes in its constructor and throws.
        _listening = CreateServer();
    }

    /// <summary>
    /// The connection token the real backend must present in its `hello`. Until set, the bridge
    /// falls back to the legacy first-client-is-primary behavior.
    /// </summary>
    public void SetPrimaryToken(string token)
    {
        lock (_stateGate) _primaryToken = token;
    }

    public bool IsConnected
    {
        get { lock (_stateGate) return _clients.Count > 0; }
    }

    private NamedPipeServerStream CreateServer() => new(
        _pipeName,
        PipeDirection.InOut,
        NamedPipeServerStream.MaxAllowedServerInstances,
        PipeTransmissionMode.Byte,
        PipeOptions.Asynchronous);

    /// <summary>
    /// Accept loop that runs for the lifetime of the bridge. The backend connects and is served
    /// until it disconnects; every accepted client gets a fresh listening instance behind it so a
    /// restarted backend (or a session driver) can dial in — the same survival property Raycast's
    /// `Raycast.IPC` host has. Without this, a backend restart (or a second launcher stealing the
    /// pipe) left the UI permanently empty.
    /// </summary>
    public async Task RunAsync(CancellationToken cancellationToken = default)
    {
        while (!cancellationToken.IsCancellationRequested && !_disposed)
        {
            NamedPipeServerStream? server;
            lock (_stateGate) server = _listening;
            if (server is null) break;
            try
            {
                await server.WaitForConnectionAsync(cancellationToken);
            }
            catch (OperationCanceledException)
            {
                break;
            }
            catch (Exception error)
            {
                App.Log.Write($"[pipe] accept failed: {error.Message}");
                if (!cancellationToken.IsCancellationRequested) await Task.Delay(200, cancellationToken);
                continue;
            }

            var client = new PipeClient
            {
                Pipe = server,
                Reader = new StreamReader(server, new UTF8Encoding(false), false, 1024, leaveOpen: true),
            };
            // A crashed backend (or leftover zombie from a killed host) reconnects in a loop; cap
            // the parked non-primary clients so the list cannot grow without bound.
            if (CountClients() >= 8)
            {
                App.Log.Write("[pipe] rejecting extra client (cap reached)");
                try { client.Pipe.Dispose(); } catch { /* already gone */ }
                lock (_stateGate)
                {
                    if (!_disposed) _listening = CreateServer();
                }
                // A reconnecting zombie retries instantly; slow the accept loop so the log and
                // the CPU do not spin while it churns.
                await Task.Delay(500, cancellationToken).ContinueWith(_ => { });
                continue;
            }
            bool isPrimary;
            lock (_stateGate)
            {
                isPrimary = _primaryToken is null && _clients.Count == 0;
                client.IsPrimary = isPrimary;
                _clients.Add(client);
                if (!_disposed) _listening = CreateServer();
            }
            App.Log.Write($"[pipe] client connected (primary={isPrimary}, total={CountClients()})");
            if (isPrimary) _firstConnection.TrySetResult();
            _ = Task.Run(() => ReadClientAsync(client, cancellationToken));
        }
    }

    private int CountClients()
    {
        lock (_stateGate) return _clients.Count;
    }

    /// <summary>Completes once the first backend has connected (used to show the window in order).</summary>
    public Task WaitForFirstConnectionAsync() => _firstConnection.Task;

    private void FailPendingWaiters(string reason)
    {
        List<TaskCompletionSource<JsonElement?>> pending;
        lock (_waiters)
        {
            pending = _waiters.Values.ToList();
            _waiters.Clear();
        }
        foreach (var waiter in pending)
        {
            waiter.TrySetException(new IOException(reason));
        }
    }

    private async Task ReadClientAsync(PipeClient client, CancellationToken cancellationToken)
    {
        try
        {
            while (!cancellationToken.IsCancellationRequested && client.Pipe.IsConnected)
            {
                var line = await client.Reader!.ReadLineAsync();
                if (line is null) break;
                if (line.Length == 0) continue;
                if (line[0] == '\uFEFF') line = line.Substring(1);
                App.Log.Write($"[pipe raw<] {line.Length} chars");

                PipeMessage? message;
                try
                {
                    message = JsonSerializer.Deserialize<PipeMessage>(line, PipeJson.Options);
                }
                catch
                {
                    continue;
                }
                if (message is null) continue;
                App.Log.Write($"[pipe<] {message.Type} {message.Module}.{message.Method} id={message.Id}");

                if (message.Type == "hello")
                {
                    string? expected;
                    lock (_stateGate) expected = _primaryToken;
                    if (expected is not null)
                    {
                        if (message.Token != expected)
                        {
                            // A backend left over from a killed host: it can never answer for this
                            // host, so drop it instead of letting it park a client slot forever.
                            App.Log.Write("[pipe] rejecting client with stale pipe token");
                            break;
                        }
                        bool promoted;
                        lock (_stateGate)
                        {
                            promoted = !client.IsPrimary;
                            client.IsPrimary = true;
                            _clients.Remove(client);
                            _clients.Insert(0, client);
                        }
                        if (promoted)
                        {
                            App.Log.Write("[pipe] backend authenticated (primary)");
                            _firstConnection.TrySetResult();
                        }
                    }
                    continue;
                }

                if (message.Type == "response")
                {
                    // Only the primary client (the Node backend) answers host-side requests.
                    if (!client.IsPrimary) continue;
                    lock (_waiters)
                    {
                        if (_waiters.TryGetValue(message.Id, out var waiter))
                        {
                            _waiters.Remove(message.Id);
                            if (message.Ok) waiter.TrySetResult(message.Data);
                            else waiter.TrySetException(new InvalidOperationException(message.Error ?? "backend error"));
                        }
                    }
                    continue;
                }

                // A request from the backend or a session driver.
                if (RequestReceived is null) continue;
                try
                {
                    var result = await RequestReceived.Invoke(message);
                    await WriteToClientAsync(client, new PipeMessage
                    {
                        Type = "response",
                        Id = message.Id,
                        Ok = true,
                        Data = result is null ? null : JsonSerializer.SerializeToElement(result),
                    });
                }
                catch (Exception error)
                {
                    await WriteToClientAsync(client, new PipeMessage { Type = "response", Id = message.Id, Ok = false, Error = error.Message });
                }
            }
        }
        catch (Exception error)
        {
            App.Log.Write($"[pipe] read loop ended: {error.Message}");
        }
        finally
        {
            lock (_stateGate) _clients.Remove(client);
            if (client.IsPrimary) FailPendingWaiters("backend disconnected");
            try { client.Pipe.Dispose(); } catch { /* already gone */ }
            App.Log.Write($"[pipe] client disconnected (primary={client.IsPrimary}, total={CountClients()})");
        }
    }

    /// <summary>Send a request to the Node backend and await its response.</summary>
    public async Task<JsonElement?> RequestAsync(
        string module,
        string method,
        object? data,
        CancellationToken cancellationToken = default)
    {
        // A restarting backend needs a moment; wait briefly for it to dial back in instead of failing
        // the caller (and leaving a blank UI) the instant the pipe is down.
        var deadline = DateTime.UtcNow.AddSeconds(10);
        while (PrimaryClient is null && !_disposed && DateTime.UtcNow < deadline)
        {
            await Task.Delay(50, cancellationToken);
        }
        if (PrimaryClient is null) throw new InvalidOperationException($"pipe \"{_pipeName}\" is not connected");

        var id = Interlocked.Increment(ref _nextId);
        var completion = new TaskCompletionSource<JsonElement?>(TaskCreationOptions.RunContinuationsAsynchronously);
        lock (_waiters) _waiters[id] = completion;

        await WriteToPrimaryAsync(new PipeMessage
        {
            Type = "request",
            Id = id,
            Module = module,
            Method = method,
            Data = data is null ? null : JsonSerializer.SerializeToElement(data),
        });

        return await completion.Task.WaitAsync(cancellationToken);
    }

    /// <summary>Deliver a host-originated message to the renderer via the Node backend.</summary>
    public Task<JsonElement?> PushToRendererAsync(string method, object? data, CancellationToken cancellationToken = default)
        => RequestAsync("frontend", method, data, cancellationToken);

    private PipeClient? PrimaryClient
    {
        get
        {
            lock (_stateGate)
            {
                if (_primaryToken is not null)
                {
                    // Requests go only to an authenticated backend; driver connections never see them.
                    return _clients.FirstOrDefault(client => client.IsPrimary);
                }
                return _clients.Count > 0 ? _clients[0] : null;
            }
        }
    }

    private async Task WriteToPrimaryAsync(PipeMessage message)
    {
        var primary = PrimaryClient;
        if (primary is null) return;
        await WriteToClientAsync(primary, message);
    }

    private async Task WriteToClientAsync(PipeClient client, PipeMessage message)
    {
        // Raw bytes on purpose: `StreamWriter` prefixes a UTF-8 preamble (BOM) that corrupts the
        // first line, and its buffered `WriteAsync('\n')` never reached the pipe.
        var line = JsonSerializer.Serialize(message, PipeJson.Options);
        var bytes = Encoding.UTF8.GetBytes($"{line}\n");
        await _writeLock.WaitAsync();
        try
        {
            if (!client.Pipe.IsConnected) return;
            await client.Pipe.WriteAsync(bytes);
            await client.Pipe.FlushAsync();
        }
        catch (Exception error) when (error is IOException or ObjectDisposedException or InvalidOperationException)
        {
            App.Log.Write($"[pipe] write failed: {error.Message}");
        }
        finally
        {
            _writeLock.Release();
        }
    }

    public async ValueTask DisposeAsync()
    {
        _disposed = true;
        FailPendingWaiters("pipe disposed");
        _writeLock.Dispose();
        List<PipeClient> clients;
        NamedPipeServerStream? listening;
        lock (_stateGate)
        {
            clients = _clients.ToList();
            _clients.Clear();
            listening = _listening;
            _listening = null;
        }
        foreach (var client in clients)
        {
            try { client.Pipe.Dispose(); } catch { /* already gone */ }
        }
        try { listening?.Dispose(); } catch { /* already gone */ }
        await Task.CompletedTask;
    }
}

// Named-pipe bridge between the .NET launcher and the Node backend.
//
// Raycast's equivalent is `Raycast.IPC.Client` + `Raycast.InterRaycastPipe` +
// `System.IO.Pipes.NamedPipeClientStream/NamedPipeServerStream`. The C# side *is* the pipe server;
// the Node backend connects to it.
//
// Protocol (newline-delimited JSON):
//   backend -> host : { type:"request", id, module:"frontend"|"backend", method, data }
//   host -> backend : { type:"response", id, ok, data | error }
//   host -> backend : { type:"push",    module:"frontend", method, data }
//
//   module "frontend" == deliver to the WebView2 renderer (Raycast's `z.frontend.*`)
//   module "backend"  == ask the Node host to do something  (Raycast's `dispatchRequest("backend", …)`)

using System.IO;
using System.IO.Pipes;
using System.Text;
using System.Text.Json;

namespace RaycastMini.Launcher;

public sealed class PipeMessage
{
    public string Type { get; set; } = "request";
    public long Id { get; set; }
    public string Module { get; set; } = string.Empty;
    public string Method { get; set; } = string.Empty;
    public JsonElement? Data { get; set; }
    public bool Ok { get; set; }
    public string? Error { get; set; }
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
    private readonly string _pipeName;
    private readonly SemaphoreSlim _writeLock = new(1, 1);
    private readonly object _pipeGate = new();
    private readonly Dictionary<long, TaskCompletionSource<JsonElement?>> _waiters = new();

    private NamedPipeServerStream _pipe;
    private StreamReader? _reader;
    private long _nextId = 1;
    private volatile bool _connected;
    private bool _disposed;

    private readonly TaskCompletionSource _firstConnection =
        new(TaskCreationOptions.RunContinuationsAsynchronously);

    /// <summary>Raised for every <c>type:"request"</c> arriving from the Node backend.</summary>
    public event Func<PipeMessage, Task<object?>>? RequestReceived;

    public NamedPipeBridge(string pipeName)
    {
        _pipeName = pipeName;
        // The reader/writer are created only after a client is connected: a StreamWriter backed by
        // an unconnected pipe flushes in its constructor and throws.
        _pipe = CreateServer();
    }

    public bool IsConnected => _connected;

    private NamedPipeServerStream CreateServer() => new(
        _pipeName,
        PipeDirection.InOut,
        NamedPipeServerStream.MaxAllowedServerInstances,
        PipeTransmissionMode.Byte,
        PipeOptions.Asynchronous);

    /// <summary>
    /// Accept loop that runs for the lifetime of the bridge. The backend connects, is served until it
    /// disconnects, and then the server is recreated so a restarted backend can dial back in — the
    /// same survival property Raycast's `Raycast.IPC` host has. Without this, a backend restart (or a
    /// second launcher stealing the pipe) left the UI permanently empty.
    /// </summary>
    public async Task RunAsync(CancellationToken cancellationToken = default)
    {
        while (!cancellationToken.IsCancellationRequested && !_disposed)
        {
            try
            {
                await _pipe.WaitForConnectionAsync(cancellationToken);
                _reader = new StreamReader(_pipe, new UTF8Encoding(false), false, 1024, leaveOpen: true);
                _connected = true;
                _firstConnection.TrySetResult();
            }
            catch (OperationCanceledException)
            {
                break;
            }
            catch (Exception error)
            {
                App.Log.Write($"[pipe] accept failed: {error.Message}");
            }

            await ReadLoopAsync(cancellationToken);

            _connected = false;
            FailPendingWaiters("backend disconnected");
            _reader = null;

            try { _pipe.Dispose(); } catch { /* already gone */ }

            await _writeLock.WaitAsync();
            try
            {
                if (!_disposed) _pipe = CreateServer();
            }
            finally
            {
                _writeLock.Release();
            }
        }
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

    private async Task ReadLoopAsync(CancellationToken cancellationToken)
    {
        try
        {
            while (!cancellationToken.IsCancellationRequested && _pipe.IsConnected)
            {
                var line = await _reader!.ReadLineAsync();
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

                if (message.Type == "response")
                {
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

                // A request from the backend.
                if (RequestReceived is null) continue;
                try
                {
                    var result = await RequestReceived.Invoke(message);
                    await WriteAsync(new PipeMessage
                    {
                        Type = "response",
                        Id = message.Id,
                        Ok = true,
                        Data = result is null ? null : JsonSerializer.SerializeToElement(result),
                    });
                }
                catch (Exception error)
                {
                    await WriteAsync(new PipeMessage { Type = "response", Id = message.Id, Ok = false, Error = error.Message });
                }
            }
        }
        catch (Exception error)
        {
            App.Log.Write($"[pipe] read loop ended: {error.Message}");
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
        while (!_connected && !_disposed && DateTime.UtcNow < deadline)
        {
            await Task.Delay(50, cancellationToken);
        }
        if (!_connected) throw new InvalidOperationException($"pipe \"{_pipeName}\" is not connected");

        var id = Interlocked.Increment(ref _nextId);
        var completion = new TaskCompletionSource<JsonElement?>(TaskCreationOptions.RunContinuationsAsynchronously);
        lock (_waiters) _waiters[id] = completion;

        await WriteAsync(new PipeMessage
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

    private async Task WriteAsync(PipeMessage message)
    {
        if (!_connected) return;
        // Raw bytes on purpose: `StreamWriter` prefixes a UTF-8 preamble (BOM) that corrupts the
        // first line, and its buffered `WriteAsync('\n')` never reached the pipe.
        var line = JsonSerializer.Serialize(message, PipeJson.Options);
        var bytes = Encoding.UTF8.GetBytes($"{line}\n");
        await _writeLock.WaitAsync();
        try
        {
            if (!_connected) return;
            await _pipe.WriteAsync(bytes);
            await _pipe.FlushAsync();
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
        _connected = false;
        FailPendingWaiters("pipe disposed");
        _writeLock.Dispose();
        try { if (_pipe.IsConnected) await _pipe.DisposeAsync(); } catch { /* already gone */ }
    }
}

// WebView2 host object exposed to the renderer.
//
// Raycast's frontend calls:
//
//   window.chrome.webview.hostObjects.ipcRequest.postMessage(
//       method, jsonParams, isBackendRequest, timeoutMs, traceId, baggage)
//
// and receives host->renderer messages via
// `window.chrome.webview.addEventListener("message", …)` (backed by
// `CoreWebView2.PostWebMessageAsJson`).
//
// `Raycast.WebView.Bridge+<SendRequestAsync>` and
// `Raycast.WebView.Window+<SendForwardedIPCNotification>` are the C# counterparts.

using System.Linq;
using System.Runtime.InteropServices;
using System.Text.Json;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;

namespace RaycastMini.Launcher;

/// <summary>
/// Grants WebView2 permissions the launcher needs without surfacing the browser prompt: the
/// launcher reads the clipboard itself (quicklink prefill from the copied URL, paste actions),
/// which Chromium gates behind a per-origin clipboard-read permission.
/// </summary>
internal static class WebView2Permissions
{
    public static void AllowClipboardRead(Microsoft.Web.WebView2.Core.CoreWebView2 core)
    {
        core.PermissionRequested += (_, args) =>
        {
            if (args.PermissionKind == Microsoft.Web.WebView2.Core.CoreWebView2PermissionKind.ClipboardRead)
            {
                args.Handled = true;
                args.State = Microsoft.Web.WebView2.Core.CoreWebView2PermissionState.Allow;
            }
        };
    }
}

/// <summary>
/// Object projected into the renderer as `window.chrome.webview.hostObjects.ipc`.
/// The method signature deliberately mirrors Raycast's `ipcRequest`.
/// </summary>
[ClassInterface(ClassInterfaceType.AutoDual)]
[ComVisible(true)]
public sealed class IpcHostObject
{
    private readonly Func<string, string, JsonElement?, bool, Task<JsonElement?>> _dispatch;

    public IpcHostObject(Func<string, string, JsonElement?, bool, Task<JsonElement?>> dispatch)
    {
        _dispatch = dispatch;
    }

    /// <summary>
    /// `postMessage(method, jsonParams, isBackend, timeoutMs, traceId, baggage)` — the exact shape
    /// Raycast exposes. Returns the JSON-encoded response payload.
    /// </summary>
    public async Task<string> postMessage(
        string method,
        string jsonParams,
        bool isBackend,
        double timeoutMs = -1,
        string traceId = "",
        string baggage = "")
    {
        JsonElement? parsedParams = null;
        if (!string.IsNullOrEmpty(jsonParams))
        {
            try
            {
                parsedParams = JsonDocument.Parse(jsonParams).RootElement.Clone();
            }
            catch
            {
                /* the renderer already validated the envelope */
            }
        }

        JsonElement? result;
        try
        {
            var call = _dispatch(method, jsonParams, parsedParams, isBackend);
            result = timeoutMs > 0 ? await call.WaitAsync(TimeSpan.FromMilliseconds(timeoutMs)) : await call;
        }
        catch (Exception error)
        {
            RaycastMini.Launcher.App.Log.Write($"[renderer->host] {method} failed: {error}");
            return JsonSerializer.Serialize(new { id = 0, error = new { message = error.Message, code = 500 } });
        }
        finally
        {
            RaycastMini.Launcher.App.Log.Write($"[renderer->host] {method} isBackend={isBackend}");
        }

        return result is null
            ? "null"
            : JsonSerializer.Serialize(new { id = 0, data = result.Value });
    }
}

/// <summary>
/// Wires the renderer's host object and pushes host-originated messages into the WebView.
/// </summary>
public sealed class WebViewBridge
{
    private readonly WebView2 _webView;
    private IpcHostObject? _hostObject;

    public WebViewBridge(WebView2 webView)
    {
        _webView = webView;
    }

    public void Install(Func<string, string, JsonElement?, bool, Task<JsonElement?>> dispatch)
    {
        _hostObject = new IpcHostObject(dispatch);

        _webView.CoreWebView2InitializationCompleted += (_, args) =>
        {
            if (!args.IsSuccess) return;
            var core = _webView.CoreWebView2;

            // Mirror Raycast: the renderer reaches the host through host objects; the host reaches the
            // renderer through web messages (delivered to `chrome.webview` message listeners).
            core.AddHostObjectToScript("ipc", _hostObject);

            core.Settings.AreDevToolsEnabled = true;
            core.Settings.AreDefaultContextMenusEnabled = false;
            core.Settings.IsStatusBarEnabled = false;
            core.Settings.IsZoomControlEnabled = false;
            core.Settings.AreHostObjectsAllowed = true;
            // Required for `chrome.webview.addEventListener("message", …)` on the renderer side.
            core.Settings.IsWebMessageEnabled = true;
            // Match the rounded window frame: WebView2 must paint transparent, not white.
            _webView.DefaultBackgroundColor = System.Drawing.Color.Transparent;

            core.WebMessageReceived += (_, message) =>
            {
                // Renderer -> host messages that did not need a return value.
                var json = message.TryGetWebMessageAsString();
                if (string.IsNullOrEmpty(json)) return;
                _ = Task.Run(async () =>
                {
                    try
                    {
                        using var document = JsonDocument.Parse(json);
                        var root = document.RootElement;
                        var module = root.TryGetProperty("module", out var m) ? m.GetString() ?? "frontend" : "frontend";
                        var method = root.TryGetProperty("method", out var mm) ? mm.GetString() ?? "" : "";
                        var data = root.TryGetProperty("data", out var d) ? d.Clone() : (JsonElement?)null;
                        await dispatch(method, string.Empty, data, module == "backend");
                    }
                    catch
                    {
                        /* ignore malformed envelope */
                    }
                });
            };
        };
    }

    /// <summary>`CoreWebView2.PostWebMessageAsJson` — how `z.frontend.*` reaches the renderer.</summary>
    public void PostMessage(string json)
    {
        if (_webView.CoreWebView2 is null) return;
        _webView.Dispatcher.Invoke(() => _webView.CoreWebView2.PostWebMessageAsJson(json));
    }
}

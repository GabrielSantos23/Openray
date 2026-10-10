// Native OS operations that stay inside the .NET process.
//
// In Raycast these live in the `Raycast.Handlers.*` namespace (a very long list of
// `…RequestHandler` types reachable from `Raycast.IPC.Types.*`). The launcher keeps only what the
// bundled sample extensions exercise.

using System.Runtime.InteropServices;
using System.Text.Json;
using System.Windows;

namespace RaycastMini.Launcher;

public static class NativeHost
{
    public static Task<object?> DispatchAsync(string method, JsonElement? data)
        => method.StartsWith("applications.", StringComparison.Ordinal)
            ? Applications.DispatchAsync(method, data)
            : method.StartsWith("clipboardHistory.", StringComparison.Ordinal)
                ? ClipboardNative.DispatchAsync(method, data)
                : DispatchCoreAsync(method, data);

    private static Task<object?> DispatchCoreAsync(string method, JsonElement? data) => method switch
    {
        "clipboard.write" => Task.FromResult(WriteClipboard(data)),
        "clipboard.read" => Task.FromResult(ReadClipboard()),
        "clipboard.clear" => Task.FromResult(ClearClipboard()),
        "shell.getFrontmostApplication" => Task.FromResult<object?>(new { name = "Raycast Mini", path = "RaycastMini.exe" }),
        "shell.getSelectedText" => Task.FromResult<object?>(new { value = (string?)null }),
        _ => Task.FromException<object?>(new InvalidOperationException($"no native handler for {method}")),
    };

    private static object WriteClipboard(JsonElement? data)
    {
        var content = data?.TryGetProperty("content", out var element) == true ? element.ToString() : string.Empty;
        RetryOnBusy(() => Clipboard.SetText(content ?? string.Empty));
        return new { ok = true };
    }

    private static object ReadClipboard()
    {
        string? value = null;
        RetryOnBusy(() =>
        {
            if (Clipboard.ContainsText()) value = Clipboard.GetText();
        });
        return new { value };
    }

    private static object ClearClipboard()
    {
        RetryOnBusy(Clipboard.Clear);
        return new { ok = true };
    }

    private static void RetryOnBusy(Action action)
    {
        for (var attempt = 0; attempt < 8; attempt++)
        {
            try
            {
                action();
                return;
            }
            catch (COMException)
            {
                Thread.Sleep(25);
            }
            catch (ExternalException)
            {
                Thread.Sleep(25);
            }
        }
        throw new InvalidOperationException("clipboard is busy");
    }
}

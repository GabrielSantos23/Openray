// Native OS operations that stay inside the .NET process.
//
// In Raycast these live in the `Raycast.Handlers.*` namespace (a very long list of
// `…RequestHandler` types reachable from `Raycast.IPC.Types.*`). The launcher keeps only what the
// bundled sample extensions and internal extensions exercise.

using System.Diagnostics;
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
        "shell.openUrl" => Task.FromResult(OpenUrl(data)),
        "shell.openWith" => Task.FromResult(OpenWith(data)),
        "shell.revealFile" => Task.FromResult(RevealFile(data)),
        "fileSystem.showOpenFileDialog" => Task.FromResult(ShowOpenFileDialog(data)),
        "fileSystem.showSaveFileDialog" => Task.FromResult(ShowSaveFileDialog(data)),
        "fileSystem.writeFile" => Task.FromResult(WriteFile(data)),
        "fileSystem.readFile" => Task.FromResult(ReadFile(data)),
        "snippets.register" => Task.FromResult(SnippetHook.RegisterKeywords(data)),
        "snippets.remove" => Task.FromResult(SnippetHook.RemoveKeywords(data)),
        "snippets.setConfig" => Task.FromResult(SnippetHook.ApplyConfig(data)),
        _ => Task.FromException<object?>(new InvalidOperationException($"no native handler for {method}")),
    };

    private static string RequireString(JsonElement? data, string property)
    {
        if (data?.TryGetProperty(property, out var element) == true && element.ValueKind == JsonValueKind.String)
        {
            var value = element.GetString();
            if (!string.IsNullOrWhiteSpace(value)) return value;
        }
        throw new InvalidOperationException($"missing \"{property}\"");
    }

    private static object OpenUrl(JsonElement? data)
    {
        var url = RequireString(data, "url");
        Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });
        return new { ok = true };
    }

    private static object OpenWith(JsonElement? data)
    {
        var path = RequireString(data, "path");
        var app = RequireString(data, "app");
        Process.Start(new ProcessStartInfo(app) { Arguments = $"\"{path}\"", UseShellExecute = true });
        return new { ok = true };
    }

    private static object RevealFile(JsonElement? data)
    {
        var path = RequireString(data, "path");
        Process.Start("explorer.exe", $"/select,\"{path}\"");
        return new { ok = true };
    }

    private static object ShowOpenFileDialog(JsonElement? data)
    {
        var dialog = new Microsoft.Win32.OpenFileDialog
        {
            Title = data?.TryGetProperty("title", out var title) == true && title.ValueKind == JsonValueKind.String
                ? title.GetString()
                : "Select file",
        };
        if (data?.TryGetProperty("allowedTypes", out var types) == true && types.ValueKind == JsonValueKind.Array)
        {
            var patterns = types.EnumerateArray().Where(t => t.ValueKind == JsonValueKind.String)
                .Select(t => $"*.{t.GetString()}").ToArray();
            if (patterns.Length > 0) dialog.Filter = string.Join("|", patterns.Select(p => $"{p.TrimStart('*', '.')}|{p}"));
        }
        var selected = dialog.ShowDialog() == true ? dialog.FileName : null;
        return new { path = selected };
    }

    private static object ShowSaveFileDialog(JsonElement? data)
    {
        var dialog = new Microsoft.Win32.SaveFileDialog
        {
            Title = data?.TryGetProperty("title", out var title) == true && title.ValueKind == JsonValueKind.String
                ? title.GetString()
                : "Save file",
        };
        if (data?.TryGetProperty("fileName", out var fileName) == true && fileName.ValueKind == JsonValueKind.String)
        {
            dialog.FileName = fileName.GetString();
        }
        var selected = dialog.ShowDialog() == true ? dialog.FileName : null;
        return new { path = selected };
    }

    private static object WriteFile(JsonElement? data)
    {
        var path = RequireString(data, "path");
        var content = data?.TryGetProperty("content", out var contentElement) == true && contentElement.ValueKind == JsonValueKind.String
            ? contentElement.GetString() ?? string.Empty
            : string.Empty;
        System.IO.File.WriteAllText(path, content, System.Text.Encoding.UTF8);
        return new { ok = true };
    }

    private static object ReadFile(JsonElement? data)
    {
        var path = RequireString(data, "path");
        return new { content = System.IO.File.ReadAllText(path) };
    }

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
        // Never log clipboard content — the length only says whether the route delivered anything.
        App.Log.Write($"[clipboard] read route hit (text={(value is null ? "none" : $"{value.Length} chars")})");
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

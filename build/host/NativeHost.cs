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
                : method.StartsWith("windowManagement.", StringComparison.Ordinal)
                    ? WindowManagementNative.DispatchAsync(method, data)
                    : method.StartsWith("focus.", StringComparison.Ordinal)
                        ? FocusSession.DispatchAsync(method, data)
                        : method.StartsWith("games.", StringComparison.Ordinal)
                            ? GameMode.DispatchAsync(method, data)
                        : method.StartsWith("taskbar.", StringComparison.Ordinal)
                            ? Taskbar.DispatchAsync(method, data)
                            : method.StartsWith("media.", StringComparison.Ordinal)
                                ? MediaControl.DispatchAsync(method, data)
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
        "shell.setOpenUrlPreferences" => Task.FromResult(SetOpenUrlPreferences(data)),
        "system.powerStatus" => Task.FromResult(PowerStatus()),
        "fileSystem.openFile" => Task.FromResult(OpenFile(data)),
        "fileSystem.moveToTrash" => Task.FromResult(MoveToTrash(data)),
        "fileSystem.showOpenFileDialog" => Task.FromResult(ShowOpenFileDialog(data)),
        "fileSystem.showSaveFileDialog" => Task.FromResult(ShowSaveFileDialog(data)),
        "fileSystem.showSelectFolderDialog" => Task.FromResult(ShowSelectFolderDialog(data)),
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

    // ---- Quicklinks > Prefer Existing Tabs ----------------------------------------------------
    // When enabled, opening a URL first looks for a visible window whose title contains the URL's
    // host and activates it instead of spawning a new browser window/tab.
    private static bool _preferExistingTabs;

    private static object SetOpenUrlPreferences(JsonElement? data)
    {
        _preferExistingTabs = data is { ValueKind: JsonValueKind.Object } payload
            && payload.TryGetProperty("preferExistingTabs", out var value)
            && value.GetBoolean();
        return new { ok = true };
    }

    private static object PowerStatus()
    {
        if (!GetSystemPowerStatus(out var status)) return new { onBattery = false };
        // ACLineStatus: 0 = offline (on battery), 1 = online, 255 = unknown.
        return new { onBattery = status.ACLineStatus == 0 };
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct SYSTEM_POWER_STATUS
    {
        public byte ACLineStatus;
        public byte BatteryFlag;
        public byte BatteryLifePercent;
        public byte Reserved1;
        public int BatteryLifeTime;
        public int BatteryFullLifeTime;
    }

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GetSystemPowerStatus(out SYSTEM_POWER_STATUS status);

    private const int SwRestore = 9;

    [DllImport("user32.dll")]
    private static extern bool SetForegroundWindow(IntPtr window);

    [DllImport("user32.dll")]
    private static extern bool ShowWindow(IntPtr window, int command);

    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();

    /// <summary>Foreground window handle, shared with the application activation path.</summary>
    public static IntPtr ForegroundWindow() => GetForegroundWindow();

    /// <summary>Focus a top-level window (used by Window Activation Behavior and quicklinks).</summary>
    public static void SetForeground(IntPtr window) => SetForegroundWindow(window);

    private static object OpenUrl(JsonElement? data)
    {
        var url = RequireString(data, "url");
        if (_preferExistingTabs && TryActivateWindowForUrl(url)) return new { ok = true, activated = true };
        Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });
        return new { ok = true };
    }

    /// <summary>Activates an existing top-level window whose title contains the URL's host.</summary>
    private static bool TryActivateWindowForUrl(string url)
    {
        string? host = null;
        if (Uri.TryCreate(url, UriKind.Absolute, out var uri) && (uri.Scheme == "http" || uri.Scheme == "https"))
        {
            host = uri.Host.StartsWith("www.", StringComparison.OrdinalIgnoreCase) ? uri.Host[4..] : uri.Host;
        }
        if (string.IsNullOrEmpty(host)) return false;
        foreach (var process in Process.GetProcesses())
        {
            try
            {
                if (string.IsNullOrEmpty(process.MainWindowTitle)) continue;
                if (process.MainWindowTitle.IndexOf(host, StringComparison.OrdinalIgnoreCase) < 0) continue;
                if (process.MainWindowHandle == IntPtr.Zero) continue;
                ShowWindow(process.MainWindowHandle, SwRestore);
                if (SetForegroundWindow(process.MainWindowHandle)) return true;
            }
            catch
            {
                /* access denied — keep scanning */
            }
            finally
            {
                process.Dispose();
            }
        }
        return false;
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

    private static object OpenFile(JsonElement? data)
    {
        var path = RequireString(data, "path");
        if (!System.IO.File.Exists(path) && !System.IO.Directory.Exists(path))
            throw new InvalidOperationException("no such file");
        Process.Start(new ProcessStartInfo(path) { UseShellExecute = true });
        return new { ok = true };
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct SHFILEOPSTRUCTW
    {
        public IntPtr hwnd;
        public uint wFunc;
        public string pFrom;
        public ushort fFlags;
        public int fAnyOperationsAborted;
        public IntPtr hNameMappings;
        public string lpszProgressTitle;
    }

    private const uint FO_DELETE = 3;
    private const ushort FOF_ALLOWUNDO = 0x40;
    private const ushort FOF_NOCONFIRMATION = 0x10;
    private const ushort FOF_SILENT = 0x04;
    private const ushort FOF_NOERRORUI = 0x400;

    [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
    private static extern int SHFileOperationW(ref SHFILEOPSTRUCTW op);

    /// <summary>
    /// Raycast's `fileSystem.moveToTrash`: recycle instead of erasing, so `Deleted file` is
    /// recoverable from the Recycle Bin (FOF_ALLOWUNDO). `pFrom` must be double-null-terminated,
    /// which the marshaler's single terminator does not provide.
    /// </summary>
    private static object MoveToTrash(JsonElement? data)
    {
        var path = RequireString(data, "path");
        if (!System.IO.File.Exists(path) && !System.IO.Directory.Exists(path))
            throw new InvalidOperationException("no such file");
        var op = new SHFILEOPSTRUCTW
        {
            wFunc = FO_DELETE,
            pFrom = path + "\0",
            fFlags = FOF_ALLOWUNDO | FOF_NOCONFIRMATION | FOF_SILENT | FOF_NOERRORUI,
        };
        var result = SHFileOperationW(ref op);
        if (result != 0 || op.fAnyOperationsAborted != 0)
            throw new InvalidOperationException($"move to trash failed ({result})");
        return new { ok = true };
    }

    private static object ShowSelectFolderDialog(JsonElement? data)
    {
        // `OpenFolderDialog` is the WPF counterpart of Raycast's directory scope picker.
        var dialog = new Microsoft.Win32.OpenFolderDialog
        {
            Title = data?.TryGetProperty("title", out var title) == true && title.ValueKind == JsonValueKind.String
                ? title.GetString()
                : "Select folder",
        };
        var selected = dialog.ShowDialog() == true ? dialog.FolderName : null;
        return new { path = selected };
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

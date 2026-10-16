// Putting entries back on the clipboard, and pasting them into the app you came from.
//
// Raycast's paste path (`native.dll`): backup the current clipboard, write the entry's
// representations, restore focus to the previously foreground window, send the paste keystroke, then
// restore the backup. Two failures are distinct in Raycast and stay distinct here:
// `paste: no last foreground window available` and a target that refuses the keystroke. Both surface
// as a clear message instead of a silent no-op.

using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using System.Windows;
using System.Windows.Input;

namespace RaycastMini.Launcher;

public static class ClipboardHistory
{
    private const int InputKeyControl = 0x11;
    private const int InputKeyV = 0x56;
    private const uint InputKeyboard = 1;
    private const uint KeyEventKeyUp = 0x0002;

    /// <summary>Window that had focus before the launcher appeared; Raycast's `last foreground window`.</summary>
    private static IntPtr _lastForegroundWindow;

    /// <summary>
    /// Called when the launcher is about to hide, so the next paste returns to the right window even
    /// if the launcher itself currently owns focus.
    /// </summary>
    public static void RecordForegroundWindow()
    {
        var current = GetForegroundWindow();
        if (current == IntPtr.Zero) return;
        var processId = (uint)Environment.ProcessId;
        _ = GetWindowThreadProcessId(current, out var owner);
        if (owner == processId) return;
        _lastForegroundWindow = current;
    }

    /// <summary>
    /// Clipboard verbs that must run on this thread and keep the launcher's own focus state. The
    /// verbs that need no WPF focus handling — OCR, QR pixel reads, `Open in App`, `Save as File` — are
    /// routed by `ClipboardNative` instead.
    /// </summary>
    public static Task<object?> DispatchAsync(string method, JsonElement? data) => method switch
    {
        "clipboardHistory.placeInClipboard" => Task.FromResult<object?>(PlaceInClipboard(data)),
        "clipboardHistory.openUrl" => Task.FromResult<object?>(OpenUrl(data)),
        "clipboardHistory.performOcr" => PerformOcr(data),
        _ => Task.FromException<object?>(new InvalidOperationException($"no clipboard history handler for {method}")),
    };

    private static Task<object?> PerformOcr(JsonElement? data)
    {
        var path = ReadString(data, "path");
        var level = ReadString(data, "level") ?? "fast";
        return ClipboardOcr.RecognizeAsync(path ?? string.Empty, level)
            .ContinueWith<object?>(
                task => task.IsFaulted
                    ? new { text = string.Empty, error = Unwrap(task.Exception)?.Message }
                    : new { text = task.Result, error = (string?)null },
                TaskScheduler.Default);
    }

    private static Exception? Unwrap(AggregateException? error) =>
        error?.InnerException ?? error;

    private static object OpenUrl(JsonElement? data)
    {
        var url = ReadString(data, "url");
        if (string.IsNullOrWhiteSpace(url) || !Uri.TryCreate(url, UriKind.Absolute, out var uri))
        {
            throw new InvalidOperationException("openUrl: a valid absolute url is required");
        }
        if (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps)
        {
            throw new InvalidOperationException($"openUrl: refusing to open a {uri.Scheme} url");
        }
        using var process = Process.Start(new ProcessStartInfo(uri.AbsoluteUri) { UseShellExecute = true });
        return new { ok = true, url = uri.AbsoluteUri };
    }

    // `Paste Sequentially` state lives in the backend, not here: REA shows Raycast keeps it as an
    // in-memory `{ offset, lastInvocation, topItemId }` triple next to the handler, and the host only
    // ever sees one `placeInClipboard` call per step.

    private static object PlaceInClipboard(JsonElement? data)
    {
        var target = ReadString(data, "target") ?? "pasteboard";
        var shouldCloseWindow = ReadBool(data, "shouldCloseWindow") ?? true;
        var overridePasteboard = ReadBool(data, "overridePasteboard") ?? true;
        var representations = ReadRepresentations(data);

        if (representations.Count == 0)
        {
            throw new InvalidOperationException("nothing to put on the clipboard: the entry has no representations");
        }

        var backup = overridePasteboard ? BackupClipboard() : null;

        // Every representation goes onto one clipboard publication. Clearing between formats would
        // leave only the last one on the clipboard, so a rich entry would arrive as plain text.
        ApplyRepresentations(representations);

        if (target != "frontmost") return new { ok = true };

        var destination = _lastForegroundWindow;
        if (destination == IntPtr.Zero || !IsWindow(destination))
        {
            RestoreClipboard(backup);
            throw new InvalidOperationException("paste: no last foreground window available");
        }

        try
        {
            SetForegroundWindow(destination);
            // Raycast waits for the target to actually own focus before synthesising the keystroke.
            if (!WaitForForeground(destination))
            {
                RestoreClipboard(backup);
                throw new InvalidOperationException(
                    $"paste: could not give focus back to {DescribeWindow(destination)}");
            }
            SendPaste();
        }
        catch
        {
            RestoreClipboard(backup);
            throw;
        }

        // `Paste and Keep Window Open` sends shouldCloseWindow:false, so the launcher stays up.
        if (shouldCloseWindow) App.RequestHideMainWindow();

        // Raycast restores the user's previous clipboard contents once the paste has been delivered.
        RestoreClipboardAfterPasteRead(destination, backup);
        return new { ok = true };
    }

    /// <summary>
    /// The target reads the clipboard when it processes the Ctrl+V — on its own message loop,
    /// strictly after this call returns. Restoring the backup right away would put the previous
    /// item back before the read, so every paste delivered the last copied item instead of the
    /// selected entry. Wait until a window of the target's process is seen holding the clipboard
    /// open (the read), then restore once it is done; if it never opens (some readers go through
    /// OLE's own window), the timeout falls back to a fixed grace period.
    /// </summary>
    private static void RestoreClipboardAfterPasteRead(IntPtr destination, ClipboardBackup? backup)
    {
        _ = GetWindowThreadProcessId(destination, out var targetPid);
        var deadline = Environment.TickCount64 + 2000;
        var sawRead = false;
        while (Environment.TickCount64 < deadline)
        {
            var open = GetOpenClipboardWindow();
            if (open != IntPtr.Zero)
            {
                _ = GetWindowThreadProcessId(open, out var openPid);
                if (openPid == targetPid)
                {
                    sawRead = true;
                    var settle = Environment.TickCount64 + 100;
                    while (Environment.TickCount64 < settle)
                    {
                        var stillOpen = GetOpenClipboardWindow();
                        if (stillOpen == IntPtr.Zero) break;
                        _ = GetWindowThreadProcessId(stillOpen, out var stillPid);
                        if (stillPid != targetPid) break;
                        Thread.Sleep(10);
                    }
                    break;
                }
            }
            Thread.Sleep(15);
        }
        if (!sawRead) Thread.Sleep(400);
        RestoreClipboard(backup);
    }

    private sealed record ClipboardRepresentationPayload(string MimeType, string? Text, string? Path, string? Base64);

    /// <summary>
    /// Publishes all of an entry's representations at once. Text formats are merged into a single
    /// `DataObject` so the target app sees `text/plain`, `text/html` and `text/rtf` together; images
    /// are written as a bitmap and files as a file drop list.
    /// </summary>
    private static void ApplyRepresentations(List<ClipboardRepresentationPayload> representations)
    {
        var filePaths = new List<string>();
        var texts = new List<ClipboardRepresentationPayload>();
        System.Drawing.Image? image = null;

        foreach (var representation in representations)
        {
            if (representation.Path is not null && File.Exists(representation.Path))
            {
                filePaths.Add(representation.Path);
                continue;
            }
            if (representation.Base64 is not null)
            {
                try
                {
                    using var stream = new MemoryStream(Convert.FromBase64String(representation.Base64));
                    var decoded = System.Drawing.Image.FromStream(stream);
                    image?.Dispose();
                    image = decoded;
                }
                catch (Exception error)
                {
                    App.Log.Write($"[clipboard] could not decode an image representation: {error.Message}");
                }
                continue;
            }
            if (representation.Text is not null) texts.Add(representation);
        }

        string? plain = null;
        string? html = null;
        string? rtf = null;
        if (texts.Count > 0)
        {
            foreach (var text in texts)
            {
                switch (text.MimeType)
                {
                    case "text/html":
                        html = text.Text;
                        break;
                    case "text/rtf":
                        rtf = text.Text;
                        break;
                    default:
                        plain ??= text.Text;
                        break;
                }
            }
            // Derive the missing fallbacks so a target that only understands `CF_UNICODETEXT` still
            // receives something sensible from a rich entry.
            plain ??= html is not null ? StripHtml(html) : rtf is not null ? PlainFromRtf(rtf) : null;
            if (html is not null && plain is null) plain = StripHtml(html);
            if (rtf is not null && plain is null) plain = PlainFromRtf(rtf);
        }

        if (texts.Count == 0 && filePaths.Count == 0 && image is null)
        {
            throw new InvalidOperationException("nothing to put on the clipboard: no representation could be applied");
        }

        try
        {
            WriteClipboardRaw(() =>
            {
                if (plain is not null) SetClipboardData(CfUnicodeText, AllocGlobal(TextBytes(plain)));
                if (html is not null) SetClipboardData(HtmlFormat, AllocGlobal(Encoding.UTF8.GetBytes(html)));
                if (rtf is not null) SetClipboardData(RtfFormat, AllocGlobal(Encoding.ASCII.GetBytes(rtf)));
                if (filePaths.Count > 0) SetClipboardData(CfHdrop, AllocGlobal(DropListBytes(filePaths)));
                if (image is not null)
                {
                    using var bitmap = new System.Drawing.Bitmap(image);
                    SetClipboardData(CfBitmap, bitmap.GetHbitmap());
                }
            });
        }
        finally
        {
            image?.Dispose();
        }
    }

    private static string StripHtml(string html)
    {
        var builder = new StringBuilder(html.Length);
        var inTag = false;
        foreach (var character in html)
        {
            if (character == '<') { inTag = true; continue; }
            if (character == '>') { inTag = false; builder.Append(' '); continue; }
            if (!inTag) builder.Append(character);
        }
        return System.Net.WebUtility.HtmlDecode(builder.ToString()).Trim();
    }

    /// <summary>Crude RTF to text: Raycast keeps the original formats for the target app, so this only
    /// supplies the `text/plain` fallback every Windows text target expects.</summary>
    private static string PlainFromRtf(string rtf)
    {
        var builder = new StringBuilder();
        var skip = false;
        foreach (var character in rtf)
        {
            if (character == '\\' && !skip) { skip = true; continue; }
            if (character == '{' || character == '}') continue;
            if (skip && !char.IsLetter(character))
            {
                if (character == '\n' || character == '\r') builder.Append(' ');
                skip = false;
                continue;
            }
            if (skip && char.IsLetter(character))
            {
                skip = false;
                if (character == 'u') break;
                continue;
            }
            builder.Append(character);
        }
        return builder.ToString().Trim();
    }

    private static List<ClipboardRepresentationPayload> ReadRepresentations(JsonElement? data)
    {
        var payloads = new List<ClipboardRepresentationPayload>();
        if (data is null || data.Value.ValueKind != JsonValueKind.Object) return payloads;
        if (!data.Value.TryGetProperty("items", out var items) || items.ValueKind != JsonValueKind.Array)
        {
            return payloads;
        }
        foreach (var item in items.EnumerateArray())
        {
            if (!item.TryGetProperty("representations", out var representations)) continue;
            foreach (var representation in representations.EnumerateArray())
            {
                if (!representation.TryGetProperty("mimeType", out var mimeType)) continue;
                payloads.Add(new ClipboardRepresentationPayload(
                    mimeType.GetString() ?? "text/plain",
                    representation.TryGetProperty("text", out var text) ? text.GetString() : null,
                    representation.TryGetProperty("path", out var path) ? path.GetString() : null,
                    representation.TryGetProperty("base64", out var base64) ? base64.GetString() : null));
            }
        }
        return payloads;
    }

    private static string? ReadString(JsonElement? data, string property) =>
        data is not null && data.Value.TryGetProperty(property, out var element) ? element.GetString() : null;

    private static bool? ReadBool(JsonElement? data, string property)
    {
        if (data is null || !data.Value.TryGetProperty(property, out var element)) return null;
        return element.ValueKind switch
        {
            JsonValueKind.True => true,
            JsonValueKind.False => false,
            _ => null,
        };
    }

    // --- clipboard backup / restore ------------------------------------------------------------

    /**
     * Raycast backs up the clipboard before a paste and puts the user's own content back afterwards, so
     * the paste is invisible in the clipboard history. The backup keeps every representation the entry
     * formats use, not only plain text, otherwise a rich or image paste would destroy the user's
     * original clipboard.
     */
    private static ClipboardBackup? BackupClipboard()
    {
        try
        {
            var plain = Clipboard.ContainsText() ? Clipboard.GetText() : null;
            var paths = Clipboard.ContainsFileDropList() ? Clipboard.GetFileDropList() : null;
            var html = TryReadStringFormat(DataFormats.Html);
            var rtf = TryReadStringFormat(DataFormats.Rtf);
            var bitmap = TryReadBitmapBytes();
            if (plain is null && paths is null && html is null && rtf is null && bitmap is null) return null;
            return new ClipboardBackup(plain, paths?.Cast<string>().ToArray(), html, rtf, bitmap);
        }
        catch (Exception error)
        {
            App.Log.Write($"[clipboard] failed to backup clipboard contents: {error.Message}");
            return null;
        }
    }

    private static string? TryReadStringFormat(string format)
    {
        try
        {
            return Clipboard.ContainsData(format) ? Clipboard.GetData(format) as string : null;
        }
        catch (Exception error)
        {
            App.Log.Write($"[clipboard] could not read {format} from the clipboard: {error.Message}");
            return null;
        }
    }

    /// <summary>
    /// `Clipboard.GetImage` hands back a WPF `BitmapSource`, which has no encoder of its own, so the
    /// backup is re-encoded through a `PngBitmapEncoder` to keep the bytes restorable.
    /// </summary>
    private static byte[]? TryReadBitmapBytes()
    {
        try
        {
            if (!Clipboard.ContainsImage()) return null;
            var image = Clipboard.GetImage();
            if (image is null) return null;
            var encoder = new System.Windows.Media.Imaging.PngBitmapEncoder();
            encoder.Frames.Add(System.Windows.Media.Imaging.BitmapFrame.Create(image));
            using var stream = new MemoryStream();
            encoder.Save(stream);
            return stream.ToArray();
        }
        catch (Exception error)
        {
            App.Log.Write($"[clipboard] could not read an image off the clipboard: {error.Message}");
            return null;
        }
    }

    private static void RestoreClipboard(ClipboardBackup? backup)
    {
        if (backup is null) return;
        if (backup.Text is null && backup.Html is null && backup.Rtf is null
            && backup.Bitmap is null && (backup.Paths is null || backup.Paths.Length == 0))
        {
            return;
        }
        try
        {
            WriteClipboardRaw(() =>
            {
                if (backup.Paths is { Length: > 0 }) SetClipboardData(CfHdrop, AllocGlobal(DropListBytes(backup.Paths.ToList())));
                if (backup.Text is not null) SetClipboardData(CfUnicodeText, AllocGlobal(TextBytes(backup.Text)));
                if (backup.Html is not null) SetClipboardData(HtmlFormat, AllocGlobal(Encoding.UTF8.GetBytes(backup.Html)));
                if (backup.Rtf is not null) SetClipboardData(RtfFormat, AllocGlobal(Encoding.ASCII.GetBytes(backup.Rtf)));
                if (backup.Bitmap is not null)
                {
                    using var stream = new MemoryStream(backup.Bitmap);
                    using var decoded = System.Drawing.Image.FromStream(stream);
                    using var bitmap = new System.Drawing.Bitmap(decoded);
                    SetClipboardData(CfBitmap, bitmap.GetHbitmap());
                }
            });
        }
        catch (Exception error)
        {
            App.Log.Write($"[clipboard] could not restore the clipboard: {error.Message}");
        }
    }

    private sealed record ClipboardBackup(
        string? Text,
        string[]? Paths,
        string? Html,
        string? Rtf,
        byte[]? Bitmap);

    private static void SendPaste()
    {
        var inputs = new[]
        {
            new INPUT { type = InputKeyboard, ki = new KEYBDINPUT { wVk = InputKeyControl } },
            new INPUT { type = InputKeyboard, ki = new KEYBDINPUT { wVk = InputKeyV } },
            new INPUT { type = InputKeyboard, ki = new KEYBDINPUT { wVk = InputKeyV, dwFlags = KeyEventKeyUp } },
            new INPUT { type = InputKeyboard, ki = new KEYBDINPUT { wVk = InputKeyControl, dwFlags = KeyEventKeyUp } },
        };
        var sent = SendInput((uint)inputs.Length, inputs, Marshal.SizeOf<INPUT>());
        if (sent != inputs.Length)
        {
            var target = GetForegroundWindow();
            _ = GetWindowThreadProcessId(target, out var targetPid);
            var targetName = "unknown";
            try { targetName = Process.GetProcessById((int)targetPid).ProcessName; } catch { }
            App.Log.Write($"[clipboard] SendInput delivered {sent}/{inputs.Length} events (foreground pid {targetPid} {targetName})");
        }
    }

    private static bool WaitForForeground(IntPtr window)
    {
        for (var attempt = 0; attempt < 20; attempt++)
        {
            if (GetForegroundWindow() == window) return true;
            Thread.Sleep(25);
        }
        return GetForegroundWindow() == window;
    }

    private static string DescribeWindow(IntPtr window)
    {
        var length = GetWindowTextLength(window);
        if (length <= 0) return $"0x{window.ToInt64():X}";
        var builder = new StringBuilder(length + 1);
        _ = GetWindowText(window, builder, builder.Capacity);
        return builder.ToString();
    }

    private static object BitmapImageFromBytes(byte[] bytes)
    {
        var bitmap = new System.Windows.Media.Imaging.BitmapImage();
        bitmap.BeginInit();
        bitmap.CacheOption = System.Windows.Media.Imaging.BitmapCacheOption.OnLoad;
        bitmap.StreamSource = new MemoryStream(bytes);
        bitmap.EndInit();
        bitmap.Freeze();
        return bitmap;
    }

    // --- raw Win32 clipboard writer ------------------------------------------------------------

    // `Clipboard.SetDataObject` goes through `OleSetClipboard`, which fails with CLIPBRD_E_CANT_OPEN
    // on some machines even when nothing holds the clipboard — observed here while raw
    // `OpenClipboard`/`SetClipboardData` kept succeeding for every other process. Every clipboard
    // write therefore goes through the raw path below; the data is rendered eagerly, which is also
    // what `copy: true` used to guarantee.

    private const uint CfBitmap = 2;
    private const uint CfUnicodeText = 13;
    private const uint CfHdrop = 15;
    private const uint GmemMoveable = 0x0002;

    private static uint _htmlFormat;
    private static uint HtmlFormat => _htmlFormat != 0 ? _htmlFormat : _htmlFormat = RegisterClipboardFormat("HTML Format");

    private static uint _rtfFormat;
    private static uint RtfFormat => _rtfFormat != 0 ? _rtfFormat : _rtfFormat = RegisterClipboardFormat("Rich Text Format");

    /// <summary>Clears the clipboard and runs `write` inside one open/close session, retrying while
    /// other processes hold the clipboard. The launcher window is the owner so `SetClipboardData`
    /// accepts the handles.</summary>
    internal static void WriteClipboardRaw(Action write)
    {
        var owner = Application.Current?.MainWindow is Window window
            ? new System.Windows.Interop.WindowInteropHelper(window).Handle
            : IntPtr.Zero;
        var lastError = "OpenClipboard never succeeded";
        for (var attempt = 0; attempt < 60; attempt++)
        {
            if (OpenClipboard(owner))
            {
                try
                {
                    EmptyClipboard();
                    write();
                    return;
                }
                finally
                {
                    CloseClipboard();
                }
            }
            lastError = new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error()).Message;
            Thread.Sleep(50);
        }
        throw new InvalidOperationException($"clipboard never opened for writing: {lastError}");
    }

    /// <summary>The raw clipboard helper the launcher's own `clipboard.write` verb uses.</summary>
    internal static void WriteTextToClipboard(string text)
    {
        WriteClipboardRaw(() => SetClipboardData(CfUnicodeText, AllocGlobal(TextBytes(text))));
    }

    internal static void ClearClipboardRaw()
    {
        WriteClipboardRaw(() => { });
    }

    private static byte[] TextBytes(string text) => Encoding.Unicode.GetBytes(text + "\0");

    private static IntPtr AllocGlobal(byte[] bytes)
    {
        var handle = GlobalAlloc(GmemMoveable, (UIntPtr)bytes.Length);
        var pointer = GlobalLock(handle);
        try
        {
            Marshal.Copy(bytes, 0, pointer, bytes.Length);
        }
        finally
        {
            GlobalUnlock(handle);
        }
        return handle;
    }

    /// <summary>`DROPFILES` header (20 bytes) + double-null-terminated wide path list.</summary>
    private static byte[] DropListBytes(List<string> paths)
    {
        var names = string.Join("\0", paths) + "\0\0";
        var nameBytes = Encoding.Unicode.GetBytes(names);
        var payload = new byte[20 + nameBytes.Length];
        BitConverter.GetBytes(20).CopyTo(payload, 0);
        BitConverter.GetBytes((short)1).CopyTo(payload, 18);
        nameBytes.CopyTo(payload, 20);
        return payload;
    }


    [StructLayout(LayoutKind.Sequential)]
    private struct INPUT
    {
        public uint type;
        public KEYBDINPUT ki;
        // The real `INPUT` union also holds `MOUSEINPUT` (32 bytes on x64); without the padding
        // `Marshal.SizeOf` hands SendInput a cbSize of 32 instead of 40 and every batch is rejected.
        public ulong padding;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct KEYBDINPUT
    {
        public ushort wVk;
        public ushort wScan;
        public uint dwFlags;
        public uint time;
        public IntPtr dwExtraInfo;
    }

    [DllImport("user32.dll", SetLastError = true)]
    private static extern uint SendInput(uint numberOfInputs, INPUT[] inputs, int sizeOfInput);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool OpenClipboard(IntPtr newOwner);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool CloseClipboard();

    [DllImport("user32.dll")]
    private static extern bool EmptyClipboard();

    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr SetClipboardData(uint format, IntPtr memory);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern uint RegisterClipboardFormat(string name);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr GlobalAlloc(uint flags, UIntPtr bytes);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr GlobalLock(IntPtr memory);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GlobalUnlock(IntPtr memory);

    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    private static extern IntPtr GetOpenClipboardWindow();

    [DllImport("user32.dll")]
    private static extern bool SetForegroundWindow(IntPtr window);

    [DllImport("user32.dll")]
    private static extern bool IsWindow(IntPtr window);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);

    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern int GetWindowText(IntPtr window, StringBuilder text, int maxCount);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern int GetWindowTextLength(IntPtr window);
}
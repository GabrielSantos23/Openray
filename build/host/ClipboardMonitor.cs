// Clipboard monitoring: the native half of Raycast's Clipboard History.
//
// Mirrors Raycast's `RaycastClipboardListener` in `native.dll`: a hidden helper window registered
// with `AddClipboardFormatListener` so Windows pushes `WM_CLIPBOARDUPDATE` instead of the app polling
// the clipboard. Every capture is therefore event-driven; nothing in here loops on a timer.
//
// Three pieces of Raycast's listener behavior are reproduced verbatim because they are observable
// from the shipped binary:
//
//   * concealment formats `ExcludeClipboardContentFromMonitorProcessing` (drop) and
//     `CanIncludeInClipboardHistory` (0 = drop, 1 = force include);
//   * retry-while-held: Windows hands out `CLIPBRD_E_CANT_OPEN` while another app owns the
//     clipboard, so capture is retried on a delay and abandoned after a bounded number of attempts
//     (`Couldn't capture clipboard change (held by …), scheduling retry …`);
//   * per-process debounce, extended for apps that publish the clipboard in bursts
//     (`Clipboard change detected from process requiring extended debounce: …`).
//
// Captured entries are handed to the Node backend, which owns the store — the same split Raycast uses
// (`native.dll` produces entries, `backend/index.mjs` persists them).

using System.Diagnostics;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using System.Windows;
using System.Windows.Interop;

namespace RaycastMini.Launcher;

public sealed class ClipboardRepresentation
{
    public string MimeType { get; init; } = "text/plain";
    public string ContentType { get; init; } = "text";
    /// <summary>Inline text, or an absolute path when <see cref="ContentType"/> is <c>url</c>.</summary>
    public string Content { get; init; } = string.Empty;
    public long? Size { get; init; }
    public int? Width { get; init; }
    public int? Height { get; init; }
}

public sealed class ClipboardItem
{
    public List<ClipboardRepresentation> Representations { get; init; } = new();
}

public sealed class ClipboardEntry
{
    public List<ClipboardItem> Items { get; init; } = new();
    public ClipboardSource? Source { get; init; }
    /// <summary>Process path that published the change; used for the debounce decision.</summary>
    public string? ProcessPath { get; init; }
}

public sealed class ClipboardSource
{
    public string Host { get; init; } = "Windows";
    /// <summary>Executable file name including extension, as shown in Raycast's source column.</summary>
    public string Name { get; init; } = "Raycast Mini";
    public string Url { get; init; } = string.Empty;
    /// <summary>Foreground window class, matched by Raycast's `IgnoredClassNames` list.</summary>
    public string? ClassName { get; init; }
}

/// <summary>
/// Event-driven clipboard listener. Owns a message-only window and never polls.
/// </summary>
public sealed class ClipboardMonitor : IDisposable
{
    /// <summary>
    /// Apps that publish the clipboard in bursts. Raycast widens the debounce for these
    /// (`firefox.exe`, `zen.exe` and friends) instead of recording every intermediate state.
    /// </summary>
    private static readonly HashSet<string> ExtendedDebounceProcesses = new(StringComparer.OrdinalIgnoreCase)
    {
        "firefox.exe",
        "firefox beta.exe",
        "zen.exe",
        "chrome.exe",
        "msedge.exe",
        "brave.exe",
        "opera.exe",
        "thunderbird.exe",
        "outlook.exe",
    };

    private const int WmClipboardUpdate = 0x031D;
    private const int ClipboardRetryLimit = 5;
    private const int ClipboardRetryDelayMs = 40;
    private const int BaseDebounceMs = 60;
    private const int ExtendedDebounceMs = 320;

    private static readonly IntPtr HwndMessage = new(-3);

    private readonly object _gate = new();
    private HwndSource? _source;
    private IntPtr _handle;
    private bool _disposed;
    private ForegroundSnapshot? _pendingForeground;
    private Timer? _debounceTimer;

    // Monotonic counter sent with every entry as `<host>:<seq>`, so the backend can discard
    // observations that arrive out of order. Raycast carries the same id from its native listener.
    private long _observationSequence;
    private static readonly string ObservationHost = "windows";

    /// <summary>Raised on a background thread for every captured entry, with its observation id.</summary>
    public event Action<ClipboardEntry, string>? EntryCaptured;

    /// <summary>Set when the listener could not be installed.</summary>
    public string? LastError { get; private set; }

    public bool IsListening => _handle != IntPtr.Zero;

    public ClipboardMonitor()
    {
    }

    public void Start()
    {
        if (_handle != IntPtr.Zero) return;
        var parameters = new HwndSourceParameters("RaycastMiniClipboardListener")
        {
            ParentWindow = HwndMessage,
            WindowStyle = 0,
        };
        _source = new HwndSource(parameters);
        _handle = _source.Handle;
        _source.AddHook(WndProc);
        // Raycast registers with the clipboard rather than polling: `AddClipboardFormatListener` makes
        // Windows post `WM_CLIPBOARDUPDATE` to this hidden window. Without this call the hook never
        // fires and nothing is ever captured.
        if (!AddClipboardFormatListener(_handle))
        {
            LastError = $"could not add this window to the clipboard listener list (error {Marshal.GetLastWin32Error()})";
            App.Log.Write($"[clipboard] AddClipboardFormatListener failed: {LastError}");
        }
        App.Log.Write($"[clipboard] listener attached to hwnd=0x{_handle.ToInt64():X}, registered={LastError is null}");
    }

    private IntPtr WndProc(IntPtr hwnd, int message, IntPtr wParam, IntPtr lParam, ref bool handled)
    {
        if (message != WmClipboardUpdate) return IntPtr.Zero;
        handled = true;
        // The WM_CLIPBOARDUPDATE pump lives on the UI thread; the debounce timer and the capture
        // itself are cheap and must never block it. The foreground window is sampled now, at event
        // time, because by the time the debounce elapses focus may already have moved.
        _pendingForeground = SampleForeground();
        ScheduleCapture(_pendingForeground);
        return IntPtr.Zero;
    }

    /// <summary>Foreground window state sampled at `WM_CLIPBOARDUPDATE` time, not at capture time.</summary>
    public sealed record ForegroundSnapshot(string? ProcessPath, string? ClassName);

    private static ForegroundSnapshot SampleForeground()
    {
        var window = GetForegroundWindow();
        if (window == IntPtr.Zero) return new ForegroundSnapshot(null, null);
        string? processPath = null;
        _ = GetWindowThreadProcessId(window, out var processId);
        if (processId != 0)
        {
            try
            {
                using var process = Process.GetProcessById((int)processId);
                processPath = process.MainModule?.FileName;
            }
            catch
            {
                processPath = null;
            }
        }
        return new ForegroundSnapshot(processPath, WindowClassName(window));
    }

    private static string? WindowClassName(IntPtr window)
    {
        var builder = new StringBuilder(256);
        var length = GetClassName(window, builder, builder.Capacity);
        return length <= 0 ? null : builder.ToString();
    }

    private void ScheduleCapture(ForegroundSnapshot foreground)
    {
        lock (_gate)
        {
            _debounceTimer?.Dispose();
            var delay = IsExtendedDebounceProcess(foreground.ProcessPath) ? ExtendedDebounceMs : BaseDebounceMs;
            if (delay == ExtendedDebounceMs)
            {
                App.Log.Write($"[clipboard] change detected from process requiring extended debounce: {foreground.ProcessPath}");
            }
            _debounceTimer = new Timer(_ =>
            {
                var snapshot = _pendingForeground;
                _pendingForeground = null;
                CaptureAndRaise(snapshot);
            }, null, delay, Timeout.Infinite);
        }
    }

    private static bool IsExtendedDebounceProcess(string? processPath)
    {
        if (string.IsNullOrEmpty(processPath)) return false;
        var name = System.IO.Path.GetFileName(processPath);
        return ExtendedDebounceProcesses.Contains(name);
    }

    /// <summary>Opens the clipboard with retries, captures every supported format, raises the event.</summary>
    public void CaptureAndRaise(ForegroundSnapshot? foreground)
    {
        var entry = CaptureWithRetry(foreground);
        if (entry is null || entry.Items.Count == 0) return;
        var observationId = $"{ObservationHost}:{Interlocked.Increment(ref _observationSequence)}";
        try
        {
            EntryCaptured?.Invoke(entry, observationId);
        }
        catch (Exception error)
        {
            App.Log.Write($"[clipboard] capture handler failed: {error.Message}");
        }
    }

    private ClipboardEntry? CaptureWithRetry(ForegroundSnapshot? foreground)
    {
        for (var attempt = 0; attempt <= ClipboardRetryLimit; attempt++)
        {
            if (TryCapture(foreground, out var entry)) return entry;
            if (attempt == ClipboardRetryLimit)
            {
                App.Log.Write($"[clipboard] gave up capturing clipboard change after {ClipboardRetryLimit} retries");
                return null;
            }
            App.Log.Write($"[clipboard] couldn't capture clipboard change (held by another app), scheduling retry {attempt + 1}/{ClipboardRetryLimit} in {ClipboardRetryDelayMs}ms");
            Thread.Sleep(ClipboardRetryDelayMs);
        }
        return null;
    }

    private bool TryCapture(ForegroundSnapshot? foreground, out ClipboardEntry? entry)
    {
        entry = null;
        var processPath = ProcessPathValue(foreground);
        if (!OpenClipboard(_handle))
        {
            // ERROR_CLIPBOARD_NOT_OPEN / CLIPBRD_E_CANT_OPEN: another app is mid-write.
            return false;
        }
        try
        {
            if (IsFormatPresent(ExcludeClipboardContentFromMonitorProcessing))
            {
                App.Log.Write("[clipboard] content has ExcludeClipboardContentFromMonitorProcessing flag");
                return true;
            }
            if (IsFormatPresent(CanIncludeInClipboardHistory))
            {
                if (!TryGetInt(CanIncludeInClipboardHistory, out var include))
                {
                    App.Log.Write("[clipboard] failed to read CanIncludeInClipboardHistory value");
                }
                else
                {
                    App.Log.Write(include == 0
                        ? "[clipboard] content has CanIncludeInClipboardHistory=0 flag"
                        : "[clipboard] content has CanIncludeInClipboardHistory=1 flag, explicitly including");
                    if (include == 0) return true;
                }
            }

            var items = new List<ClipboardItem>();

            var uriPaths = ReadFilePaths();
            if (uriPaths.Count > 0)
            {
                // Raycast emits one item per copied file (`ClipboardPasteableItems`), so a multi-file
                // copy produces a multi-item entry and the row shows a count badge.
                foreach (var filePath in uriPaths)
                {
                    items.Add(new ClipboardItem
                    {
                        Representations = new List<ClipboardRepresentation>
                        {
                            Text("text/uri-list", filePath),
                        },
                    });
                }
            }

            var textRepresentations = new List<ClipboardRepresentation>();
            // Explorer puts the same paths on CF_UNICODETEXT as a fallback. Raycast shows a file copy as
            // files, not as that path list plus a duplicate text row, so it is only read when there is
            // no file drop payload at all.
            var plain = uriPaths.Count == 0 ? ReadUnicodeText(CF_UNICODETEXT) : null;
            if (plain is not null) textRepresentations.Add(Text("text/plain", plain));
            var html = ReadHtml();
            if (html is not null) textRepresentations.Add(Text("text/html", html));
            var rtf = ReadRtf();
            if (rtf is not null) textRepresentations.Add(Text("text/rtf", rtf));

            if (textRepresentations.Count > 0)
            {
                items.Add(new ClipboardItem { Representations = textRepresentations });
            }

            var image = ReadImage();
            if (image is not null) items.Add(new ClipboardItem { Representations = new List<ClipboardRepresentation> { image } });

            if (items.Count == 0)
            {
                App.Log.Write("[clipboard] no valid representations found");
                return true;
            }

            entry = new ClipboardEntry
            {
                Items = items,
                Source = new ClipboardSource
                {
                    Host = "Windows",
                    Name = processPath is null ? "Unknown" : System.IO.Path.GetFileName(processPath),
                    Url = processPath ?? string.Empty,
                    ClassName = foreground?.ClassName,
                },
                ProcessPath = processPath,
            };
            return true;
        }
        finally
        {
            CloseClipboard();
        }
    }

    private string? ProcessPathValue(ForegroundSnapshot? foreground) => foreground?.ProcessPath;

    private static ClipboardRepresentation Text(string mimeType, string content) => new()
    {
        MimeType = mimeType,
        ContentType = "text",
        Content = content,
        Size = Encoding.UTF8.GetByteCount(content),
    };

    private string? ReadUnicodeText(uint format)
    {
        if (!IsFormatPresent(format)) return null;
        var handle = GetClipboardData(format);
        if (handle == IntPtr.Zero) return null;
        var pointer = GlobalLock(handle);
        if (pointer == IntPtr.Zero) return null;
        try
        {
            return Marshal.PtrToStringUni(pointer);
        }
        finally
        {
            GlobalUnlock(handle);
        }
    }

    private string? ReadHtml()
    {
        var format = RegisterClipboardFormat("HTML Format");
        if (!IsFormatPresent(format)) return null;
        var handle = GetClipboardData(format);
        if (handle == IntPtr.Zero) return null;
        var pointer = GlobalLock(handle);
        if (pointer == IntPtr.Zero) return null;
        try
        {
            var header = Marshal.PtrToStringUni(pointer);
            if (header is null) return null;
            var marker = header.IndexOf("StartHTML", StringComparison.OrdinalIgnoreCase);
            if (marker < 0) return null;
            var digits = new StringBuilder();
            for (var index = marker; index < header.Length; index++)
            {
                var character = header[index];
                if (char.IsDigit(character)) digits.Append(character);
                else if (digits.Length > 0) break;
            }
            if (!int.TryParse(digits.ToString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var start))
            {
                return null;
            }
            // HTML Format is UTF-8 without a terminator; the header length bounds it.
            var maxLength = Math.Max(0, header.Length - start);
            var bytes = new byte[maxLength];
            Marshal.Copy(pointer + start, bytes, 0, maxLength);
            var nulIndex = Array.IndexOf(bytes, (byte)0);
            if (nulIndex >= 0) Array.Resize(ref bytes, nulIndex);
            return Encoding.UTF8.GetString(bytes);
        }
        finally
        {
            GlobalUnlock(handle);
        }
    }

    private string? ReadRtf()
    {
        var format = RegisterClipboardFormat("Rich Text Format");
        if (!IsFormatPresent(format)) return null;
        var handle = GetClipboardData(format);
        if (handle == IntPtr.Zero) return null;
        var pointer = GlobalLock(handle);
        if (pointer == IntPtr.Zero) return null;
        try
        {
            var bytes = new byte[(int)GlobalSize(handle)];
            if (bytes.Length == 0) return null;
            Marshal.Copy(pointer, bytes, 0, bytes.Length);
            var nulIndex = Array.IndexOf(bytes, (byte)0);
            if (nulIndex >= 0) Array.Resize(ref bytes, nulIndex);
            var rtf = Encoding.ASCII.GetString(bytes);
            return rtf.StartsWith("{\\rtf", StringComparison.Ordinal) ? rtf : null;
        }
        finally
        {
            GlobalUnlock(handle);
        }
    }

    /// <summary>
    /// CF_HDROP, one absolute path per line. TEMP paths are dropped: Raycast skips them because a
    /// screenshot or drag payload in flight points at a scratch file that is about to disappear.
    /// </summary>
    private List<string> ReadFilePaths()
    {
        var paths = new List<string>();
        // Explorer and every shell drag/copy publish standard `CF_HDROP` (15), not the registered
        // "FileDrop" name, so reading the registered format finds nothing in practice.
        var handle = GetClipboardData(CF_HDROP);
        if (handle == IntPtr.Zero) return paths;
        var pointer = GlobalLock(handle);
        if (pointer == IntPtr.Zero) return paths;
        try
        {
            var count = Marshal.ReadInt16(pointer);
            if (count <= 0) return paths;
            for (var index = 0; index < count; index++)
            {
                var entry = Marshal.PtrToStringUni(pointer + Native.MAX_PATH * (index + 1));
                if (!string.IsNullOrWhiteSpace(entry) && !IsTemporaryPath(entry)) paths.Add(entry);
            }
            if (paths.Count == 0)
            {
                App.Log.Write("[clipboard] skipped every file because it points to a TEMP file");
            }
            return paths;
        }
        finally
        {
            GlobalUnlock(handle);
        }
    }

    /// <summary>Raycast skips clipboard payloads that are temporary files (screenshots in progress, drag payloads).</summary>
    private static bool IsTemporaryPath(string path)
    {
        var temp = System.IO.Path.GetTempPath();
        return path.StartsWith(temp, StringComparison.OrdinalIgnoreCase);
    }

    private ClipboardRepresentation? ReadImage()
    {
        foreach (var candidate in new[] { RegisterClipboardFormat("PNG"), RegisterClipboardFormat("image/png") })
        {
            var png = ReadBinaryFormat(candidate);
            if (png is not null && png.Length > 8 && png[0] == 0x89 && png[1] == 0x50)
            {
                return new ClipboardRepresentation
                {
                    MimeType = "image/png",
                    ContentType = "blob",
                    Content = Convert.ToBase64String(png),
                    Size = png.Length,
                };
            }
        }

        // Windows hands out DIB; convert to PNG so the store only ever sees one raster format.
        foreach (var candidate in new[] { CF_DIBV5, CF_DIB })
        {
            var dib = ReadBinaryFormat(candidate);
            if (dib is null || dib.Length < 40) continue;
            var png = Native.BitmapToPng(dib);
            if (png is null)
            {
                App.Log.Write("[clipboard] bmp to png conversion produced incorrect data!");
                continue;
            }
            return new ClipboardRepresentation
            {
                MimeType = "image/png",
                ContentType = "blob",
                Content = Convert.ToBase64String(png),
                Size = png.Length,
            };
        }
        return null;
    }

    private byte[]? ReadBinaryFormat(uint format)
    {
        if (!IsFormatPresent(format)) return null;
        var handle = GetClipboardData(format);
        if (handle == IntPtr.Zero) return null;
        var pointer = GlobalLock(handle);
        if (pointer == IntPtr.Zero) return null;
        try
        {
            var size = (int)GlobalSize(handle);
            if (size <= 0) return null;
            var bytes = new byte[size];
            Marshal.Copy(pointer, bytes, 0, size);
            return bytes;
        }
        finally
        {
            GlobalUnlock(handle);
        }
    }

    private bool TryGetInt(uint format, out int value)
    {
        value = 0;
        var handle = GetClipboardData(format);
        if (handle == IntPtr.Zero) return false;
        var pointer = GlobalLock(handle);
        if (pointer == IntPtr.Zero) return false;
        try
        {
            value = Marshal.ReadInt32(pointer);
            return true;
        }
        finally
        {
            GlobalUnlock(handle);
        }
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        lock (_gate)
        {
            _debounceTimer?.Dispose();
            _debounceTimer = null;
        }
        if (_source is not null)
        {
            if (_handle != IntPtr.Zero) _ = RemoveClipboardFormatListener(_handle);
            _source.RemoveHook(WndProc);
            _source.Dispose();
            _source = null;
            _handle = IntPtr.Zero;
        }
    }

    // --- Win32 -------------------------------------------------------------------------------

    private const uint CF_UNICODETEXT = 13;
    private const uint CF_DIBV5 = 17;
    private const uint CF_DIB = 8;
    private const uint CF_HDROP = 15;

    public static readonly uint ExcludeClipboardContentFromMonitorProcessing =
        RegisterClipboardFormat("ExcludeClipboardContentFromMonitorProcessing");

    public static readonly uint CanIncludeInClipboardHistory =
        RegisterClipboardFormat("CanIncludeInClipboardHistory");

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool AddClipboardFormatListener(IntPtr window);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool RemoveClipboardFormatListener(IntPtr window);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool OpenClipboard(IntPtr newOwner);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool CloseClipboard();

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool IsClipboardFormatAvailable(uint format);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr GetClipboardData(uint format);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern uint RegisterClipboardFormat(string format);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr GlobalLock(IntPtr handle);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GlobalUnlock(IntPtr handle);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern UIntPtr GlobalSize(IntPtr handle);

    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll", SetLastError = true)]
    private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);

    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern int GetClassName(IntPtr hWnd, StringBuilder text, int maxCount);

    private bool IsFormatPresent(uint format) => IsClipboardFormatAvailable(format);
}
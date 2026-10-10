// Local, native work the backend asks for but that has no managed implementation on this side:
// image pixels for QR decoding, opening a path or link with its default handler, writing a file the
// user picked, and the capability probe. OCR is dispatched by `ClipboardHistory` because it shares that
// file's dispatch switch; the engine itself is in `ClipboardOcr`.

using System.Diagnostics;
using System.IO;
using System.Text.Json;

namespace RaycastMini.Launcher;

public static class ClipboardNative
{
    private const int MaxImageEdge = 4000;

    public static Task<object?> DispatchAsync(string method, JsonElement? data)
    {
        try
        {
            return method switch
            {
                "clipboardHistory.readImagePixels" => Task.FromResult(ReadImagePixels(data)),
                "clipboardHistory.registerHotkey" => Task.FromResult(RegisterHotkey(data)),
                "clipboardHistory.performOcr" => ClipboardHistory.DispatchAsync(method, data),
                "clipboardHistory.placeInClipboard" => ClipboardHistory.DispatchAsync(method, data),
                "clipboardHistory.openUrl" => ClipboardHistory.DispatchAsync(method, data),
                "clipboardHistory.openInApp" => Task.FromResult(OpenInApp(data)),
                "clipboardHistory.saveAsFile" => Task.FromResult(SaveAsFile(data)),
                "clipboardHistory.revealInFolder" => Task.FromResult(RevealInFolder(data)),
                "clipboardHistory.clipboardCapabilities" => Task.FromResult(Capabilities()),
                _ => Task.FromException<object?>(
                    new InvalidOperationException($"no clipboard handler for {method}")),
            };
        }
        catch (Exception error)
        {
            return Task.FromException<object?>(error);
        }
    }

    /// <summary>
    /// Decodes an image file to raw BGRA so the backend's QR decoder gets pixels without pulling in
    /// another image library. Oversized images are downsampled first, which is also what makes a
    /// full-screen screenshot decodable.
    /// </summary>
    private static object ReadImagePixels(JsonElement? data)
    {
        var path = RequireExistingPath(data, "path");
        using var source = System.Drawing.Image.FromFile(path);
        var width = source.Width;
        var height = source.Height;
        if (width <= 0 || height <= 0) throw new InvalidOperationException("image has no pixels");

        var longest = Math.Max(width, height);
        if (longest > MaxImageEdge)
        {
            var scale = MaxImageEdge / (double)longest;
            width = Math.Max(1, (int)Math.Round(source.Width * scale));
            height = Math.Max(1, (int)Math.Round(source.Height * scale));
            App.Log.Write($"[clipboard] downsampling {source.Width}x{source.Height} to {width}x{height} for decoding");
        }

        using var bitmap = new System.Drawing.Bitmap(width, height, System.Drawing.Imaging.PixelFormat.Format32bppArgb);
        using (var graphics = System.Drawing.Graphics.FromImage(bitmap))
        {
            graphics.DrawImage(source, new System.Drawing.Rectangle(0, 0, width, height));
        }

        var buffer = new byte[width * height * 4];
        var locked = bitmap.LockBits(
            new System.Drawing.Rectangle(0, 0, width, height),
            System.Drawing.Imaging.ImageLockMode.ReadOnly,
            System.Drawing.Imaging.PixelFormat.Format32bppArgb);
        try
        {
            System.Runtime.InteropServices.Marshal.Copy(locked.Scan0, buffer, 0, buffer.Length);
        }
        finally
        {
            bitmap.UnlockBits(locked);
        }

        return new { width, height, base64 = Convert.ToBase64String(buffer) };
    }

    /// <summary>
    /// Hands a target to the shell, which is how Raycast's `Open in App` works: an `http(s)` URL goes
    /// to the default browser, any other path goes to its registered handler.
    /// </summary>
    private static object OpenInApp(JsonElement? data)
    {
        var target = ReadString(data, "target");
        if (string.IsNullOrWhiteSpace(target))
        {
            throw new InvalidOperationException("openInApp: a target path or url is required");
        }
        if (Uri.TryCreate(target, UriKind.Absolute, out var uri)
            && (uri.Scheme == Uri.UriSchemeHttp || uri.Scheme == Uri.UriSchemeHttps))
        {
            using var browser = Process.Start(new ProcessStartInfo(uri.AbsoluteUri) { UseShellExecute = true });
            return new { ok = true, target = uri.AbsoluteUri, kind = "url" };
        }
        if (!File.Exists(target))
        {
            throw new FileNotFoundException("The system cannot find the file specified", target);
        }
        using var process = Process.Start(new ProcessStartInfo(target) { UseShellExecute = true });
        return new { ok = true, target, kind = "file" };
    }

    /// <summary>Writes the bytes the backend prepared to the location the save panel returned.</summary>
    private static object SaveAsFile(JsonElement? data)
    {
        var destination = ReadString(data, "destination");
        if (string.IsNullOrWhiteSpace(destination))
        {
            throw new InvalidOperationException("saveAsFile: a destination path is required");
        }
        var contents = data?.TryGetProperty("base64", out var encoded) == true
            ? Convert.FromBase64String(encoded.GetString() ?? string.Empty)
            : System.Text.Encoding.UTF8.GetBytes(ReadString(data, "text") ?? string.Empty);
        var directory = Path.GetDirectoryName(destination);
        if (!string.IsNullOrEmpty(directory)) Directory.CreateDirectory(directory);
        File.WriteAllBytes(destination, contents);
        return new { ok = true, path = destination, bytes = contents.Length };
    }

    private static object RevealInFolder(JsonElement? data)
    {
        var target = RequireExistingPath(data, "target");
        using var explorer = Process.Start(new ProcessStartInfo("explorer.exe", $"/select,\"{target}\"")
        {
            UseShellExecute = true,
        });
        return new { ok = true, path = target };
    }

    /// <summary>
    /// Registers the global Clipboard History shortcut on the main window, which owns the message pump.
    /// Raycast stores the combination per command and hands it to the host the same way.
    /// </summary>
    private static object RegisterHotkey(JsonElement? data)
    {
        var hotkey = ReadString(data, "hotkey") ?? string.Empty;
        var combo = MainWindow.RegisterCommandHotkey(hotkey);
        return combo is null
            ? new { ok = false, reason = "That shortcut is not one Windows can register" }
            : new { ok = true, hotkey };
    }

    /// <summary>What this host can actually do, so the backend records limits instead of guessing.</summary>
    private static object Capabilities() => new
    {
        ocr = new
        {
            available = ClipboardOcr.IsAvailable,
            languages = ClipboardOcr.AvailableLanguages,
            levels = new[] { "fast", "accurate" },
        },
        qr = new { available = true, engine = "jsqr", versions = new[] { 1, 2, 3, 4, 10, 40 } },
        shell = new { openInApp = true, saveAsFile = true, revealInFolder = true },
    };

    private static string RequireExistingPath(JsonElement? data, string property)
    {
        var value = ReadString(data, property);
        if (string.IsNullOrWhiteSpace(value) || !File.Exists(value))
        {
            throw new FileNotFoundException("The system cannot find the file specified", value ?? string.Empty);
        }
        return value;
    }

    private static string? ReadString(JsonElement? data, string property) =>
        data is not null && data.Value.TryGetProperty(property, out var element) ? element.GetString() : null;
}
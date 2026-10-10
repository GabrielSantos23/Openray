using System.IO;
using System.Runtime.InteropServices.WindowsRuntime;
using Windows.Graphics.Imaging;
using Windows.Media.Ocr;

namespace RaycastMini.Launcher;

/// <summary>
/// OCR for clipboard images, on Raycast's own terms.
///
/// `Windows.Media.Ocr` is a WinRT engine that runs off the UI thread once `RecognizeAsync` is awaited,
/// so this never blocks WPF. The engine supports a coarse language set only; Raycast's `fast` and
/// `accurate` levels are mapped onto the same local engine here and recorded in the spec, because
/// shipping a second OCR model would break the local-first rule.
/// </summary>
public static class ClipboardOcr
{
    private const int MaxImageEdge = 6000;
    private const int MaxDecodeBytes = 40 * 1024 * 1024;

    public static Task<string> RecognizeAsync(string path, string level, CancellationToken cancellation = default) =>
        Task.Run(() => Recognize(path, level, cancellation), cancellation);

    private static async Task<string> Recognize(string path, string level, CancellationToken cancellation)
    {
        if (!File.Exists(path))
        {
            throw new FileNotFoundException("The system cannot find the file specified", path);
        }
        var info = new FileInfo(path);
        if (info.Length > MaxDecodeBytes)
        {
            throw new InvalidOperationException($"image is too large to run OCR on ({info.Length} bytes)");
        }

        var engine = OcrEngine.TryCreateFromUserProfileLanguages();
        if (engine is null)
        {
            throw new InvalidOperationException(
                "no OCR language is installed for the current user's profile languages");
        }

using var image = System.Drawing.Image.FromFile(path);
        using var prepared = Prepare(image);
        cancellation.ThrowIfCancellationRequested();

        var result = await WindowsRuntimeSystemExtensions.AsTask(engine.RecognizeAsync(prepared.Bitmap));
        var text = result?.Text ?? string.Empty;
        App.Log.Write(
            $"[clipboard] OCR finished at level={level} over {path} as {prepared.Width}x{prepared.Height} ({text.Length} chars)");
        return text;
    }

    private sealed class PreparedBitmap : IDisposable
    {
        public PreparedBitmap(SoftwareBitmap bitmap, int width, int height)
        {
            Bitmap = bitmap;
            Width = width;
            Height = height;
        }

        public SoftwareBitmap Bitmap { get; }
        public int Width { get; }
        public int Height { get; }

        public void Dispose() => Bitmap.Dispose();
    }

    /// <summary>
    /// Windows' OCR engine is unhappy with very large bitmaps, so oversized screenshots are
    /// downsampled first. GDI+ produces the BGRA buffer WinRT expects; this stays off the UI thread.
    /// </summary>
    private static PreparedBitmap Prepare(System.Drawing.Image source)
    {
        var width = source.Width;
        var height = source.Height;
        var longest = Math.Max(width, height);
        if (longest > MaxImageEdge)
        {
            var scale = MaxImageEdge / (double)longest;
            width = Math.Max(1, (int)Math.Round(source.Width * scale));
            height = Math.Max(1, (int)Math.Round(source.Height * scale));
            App.Log.Write($"[clipboard] downsampling {source.Width}x{source.Height} image for OCR to {width}x{height}");
        }

        using var bitmap = new System.Drawing.Bitmap(width, height, System.Drawing.Imaging.PixelFormat.Format32bppArgb);
        using (var graphics = System.Drawing.Graphics.FromImage(bitmap))
        {
            graphics.DrawImage(source, new System.Drawing.Rectangle(0, 0, width, height));
        }

        var buffer = new byte[width * height * 4];
        var data = bitmap.LockBits(
            new System.Drawing.Rectangle(0, 0, width, height),
            System.Drawing.Imaging.ImageLockMode.ReadOnly,
            System.Drawing.Imaging.PixelFormat.Format32bppArgb);
        try
        {
            System.Runtime.InteropServices.Marshal.Copy(data.Scan0, buffer, 0, buffer.Length);
        }
        finally
        {
            bitmap.UnlockBits(data);
        }

        var software = SoftwareBitmap.CreateCopyFromBuffer(
            buffer.AsBuffer(),
            BitmapPixelFormat.Bgra8,
            width,
            height,
            BitmapAlphaMode.Premultiplied);
        return new PreparedBitmap(software, width, height);
    }

    public static bool IsAvailable => OcrEngine.AvailableRecognizerLanguages.Count > 0;

    public static string[] AvailableLanguages =>
        OcrEngine.AvailableRecognizerLanguages.Select(language => language.LanguageTag).ToArray();
}

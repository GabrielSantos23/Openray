// Bitmap helpers for the clipboard listener.
//
// Windows exposes clipboard images as DIB/CF_DIBV5, so something has to produce PNG. Raycast does the
// same in Rust (`gdi_to_bmp`, `bmp_to_png_unsafe`) and *validates* the result — the shipped log line
// `bmp to png conversion produced incorrect data!` shows a bad conversion is rejected, not shipped.
// We keep that check: a null return means the caller drops the image instead of storing garbage.
//
// A clipboard DIB is a BITMAPINFOHEADER + palette + pixels — a BMP *file* without its 14-byte
// BITMAPFILEHEADER. GDI+ refuses to decode it bare, so the header is reconstructed first
// (`offBits` follows the header plus palette and, for legacy 40-byte headers, the BI_BITFIELDS
// color masks).

using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;

namespace RaycastMini.Launcher;

internal static class Native
{
    public const int MAX_PATH = 260;

    private const int BiBitfields = 3;

    /// <summary>
    /// Converts a clipboard DIB (BITMAPINFOHEADER-prefixed, as GetClipboardData(CF_DIB/CF_DIBV5)
    /// hands it out) to PNG bytes. Returns null when the payload cannot be decoded or re-encoded.
    /// </summary>
    public static byte[]? BitmapToPng(byte[] dib)
    {
        try
        {
            if (dib.Length < 40) return null;
            var bmp = WrapDibInBmpFileHeader(dib);
            if (bmp is null) return null;
            using var stream = new MemoryStream(bmp);
            using var image = Image.FromStream(stream);
            using var encoded = new MemoryStream();
            image.Save(encoded, ImageFormat.Png);
            var png = encoded.ToArray();
            return IsPng(png) ? png : null;
        }
        catch (Exception error) when (error is ArgumentException or OutOfMemoryException or ExternalException)
        {
            return null;
        }
    }

    /// <summary>Prepends a BITMAPFILEHEADER so GDI+ accepts the DIB as a complete BMP file.</summary>
    private static byte[]? WrapDibInBmpFileHeader(byte[] dib)
    {
        var headerSize = BitConverter.ToInt32(dib, 0);
        if (headerSize < 40 || headerSize > dib.Length) return null;

        var compression = BitConverter.ToInt32(dib, 16);
        var bitsPerPixel = BitConverter.ToUInt16(dib, 14);
        var clrUsed = BitConverter.ToInt32(dib, 32);

        var paletteEntries = clrUsed != 0
            ? clrUsed
            : bitsPerPixel <= 8 ? 1 << bitsPerPixel : 0;
        var paletteBytes = paletteEntries * 4;

        // 40-byte BITMAPINFOHEADERs put the BI_BITFIELDS masks after the header; BITMAPV4/V5
        // headers already carry them inside headerSize.
        if (headerSize == 40 && compression == BiBitfields) paletteBytes += 12;

        var offBits = 14 + headerSize + paletteBytes;
        if (offBits > dib.Length) return null;

        var bmp = new byte[14 + dib.Length];
        bmp[0] = (byte)'B';
        bmp[1] = (byte)'M';
        WriteInt32(bmp, 2, bmp.Length);   // bfSize
        WriteInt32(bmp, 10, offBits);     // bfOffBits
        Buffer.BlockCopy(dib, 0, bmp, 14, dib.Length);
        return bmp;
    }

    private static void WriteInt32(byte[] buffer, int offset, int value)
    {
        buffer[offset] = (byte)value;
        buffer[offset + 1] = (byte)(value >> 8);
        buffer[offset + 2] = (byte)(value >> 16);
        buffer[offset + 3] = (byte)(value >> 24);
    }

    public static bool IsPng(byte[] bytes) =>
        bytes.Length > 8 && bytes[0] == 0x89 && bytes[1] == 0x50 && bytes[2] == 0x4E && bytes[3] == 0x47;

    // ---- Process integrity --------------------------------------------------------------------

    private const int TokenIntegrityLevel = 25;

    /// <summary>
    /// The current process's mandatory integrity RID (0x1000 = Low, 0x2000 = Medium, 0x3000 = High),
    /// or -1 when it cannot be determined.
    /// </summary>
    public static int CurrentIntegrityRid()
    {
        try
        {
            var token = WindowsIdentityGetCurrentToken();
            if (token == IntPtr.Zero) return -1;
            if (!GetTokenInformation(token, TokenIntegrityLevel, IntPtr.Zero, 0, out var retLen) && retLen == 0)
                return -1;
            var buffer = Marshal.AllocHGlobal((int)retLen);
            try
            {
                if (!GetTokenInformation(token, TokenIntegrityLevel, buffer, retLen, out _)) return -1;
                var sid = Marshal.ReadIntPtr(buffer);
                if (sid == IntPtr.Zero) return -1;
                var subAuthorityCount = Marshal.ReadByte(sid, 1);
                var rid = 0;
                for (var i = 0; i < 4; i++)
                    rid = (rid << 8) | Marshal.ReadByte(sid, 8 + 4 + (subAuthorityCount - 1) * 4 + i);
                return rid;
            }
            finally
            {
                Marshal.FreeHGlobal(buffer);
                CloseHandle(token);
            }
        }
        catch
        {
            return -1;
        }
    }

    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern bool GetTokenInformation(IntPtr token, int infoClass, IntPtr info, uint length, out uint returnLength);

    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern bool OpenProcessToken(IntPtr process, uint desiredAccess, out IntPtr token);

    [DllImport("kernel32.dll")]
    private static extern bool CloseHandle(IntPtr handle);

    private static IntPtr WindowsIdentityGetCurrentToken()
    {
        // Pseudo-handle of the current process token; never closed.
        if (!OpenProcessToken(new IntPtr(-1), 0x0008 /* TOKEN_QUERY */, out var token)) return IntPtr.Zero;
        return token;
    }
}

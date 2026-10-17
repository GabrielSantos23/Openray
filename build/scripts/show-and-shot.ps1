param([string]$Out = "shot-show.png", [int]$WaitMs = 2500)
$src = @'
using System;
using System.Runtime.InteropServices;
public class WShow {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  public struct RECT { public int L, T, R, B; }
}
'@
Add-Type -TypeDefinition $src -Language CSharp
Add-Type -AssemblyName System.Drawing
$proc = Get-Process Openray -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if (-not $proc) { $proc = Get-Process Openray -ErrorAction SilentlyContinue | Select-Object -First 1 }
if (-not $proc) { Write-Error "no process"; exit 1 }
$h = $proc.MainWindowHandle
if ($h -eq [IntPtr]::Zero) {
  # find the 720x480 "Openray" window ourselves
  $find = @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public class WFind {
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr p);
  public delegate bool EnumWindowsProc(IntPtr h, IntPtr p);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  public static IntPtr Result;
  public static uint Target;
  public static bool Cb(IntPtr h, IntPtr p) {
    uint pid; GetWindowThreadProcessId(h, out pid);
    if (pid == Target) {
      var sb = new StringBuilder(256); GetWindowText(h, sb, 256);
      if (sb.ToString() == "Openray") { Result = h; return false; }
    }
    return true;
  }
}
'@
  Add-Type -TypeDefinition $find -Language CSharp
  [WFind]::Target = [uint32]$proc.Id
  [WFind]::Result = [IntPtr]::Zero
  $cbDelegate = [WFind+EnumWindowsProc]{ param($hh, $pp) [WFind]::Cb($hh, $pp) }
  [void][WFind]::EnumWindows($cbDelegate, [IntPtr]::Zero)
  $h = [WFind]::Result
}
if ($h -eq [IntPtr]::Zero) { Write-Error "no window"; exit 1 }
[void][WShow]::ShowWindow($h, 5)  # SW_SHOW
[void][WShow]::SetForegroundWindow($h)
Start-Sleep -Milliseconds $WaitMs
$r = New-Object WShow+RECT
[void][WShow]::GetWindowRect($h, [ref]$r)
"vis=$([WShow]::IsWindowVisible($h)) rect=$($r.L),$($r.T) size=$($r.R-$r.L)x$($r.B-$r.T)"
$w = [Math]::Max(1, $r.R - $r.L); $hgt = [Math]::Max(1, $r.B - $r.T)
$bmp = New-Object System.Drawing.Bitmap $w, $hgt
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($r.L, $r.T, 0, 0, $bmp.Size)
$g.Dispose()
$bmp.Save((Join-Path (Get-Location) $Out), [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
"saved $Out"

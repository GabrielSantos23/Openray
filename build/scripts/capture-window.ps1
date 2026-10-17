param([string]$Out = "shot-pw.png")
$src = @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public class WCap {
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr p);
  public delegate bool EnumWindowsProc(IntPtr h, IntPtr p);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr hdc, uint flags);
  public struct RECT { public int L, T, R, B; }
}
'@
Add-Type -TypeDefinition $src -Language CSharp
Add-Type -AssemblyName System.Drawing
$ids = @(Get-Process Openray -ErrorAction SilentlyContinue | ForEach-Object { $_.Id })
if (-not $ids) { Write-Error "no process"; exit 1 }
$script:hits = New-Object System.Collections.ArrayList
$cb = {
  param($h, $l)
  $pid2 = [uint32]0
  [WCap]::GetWindowThreadProcessId($h, [ref]$pid2) | Out-Null
  if ($ids -contains [int]$pid2) {
    $sb = New-Object System.Text.StringBuilder 256
    [WCap]::GetWindowText($h, $sb, 256) | Out-Null
    $r = New-Object WCap+RECT
    [WCap]::GetWindowRect($h, [ref]$r) | Out-Null
    [void]$script:hits.Add(@{ H = $h; Title = $sb.ToString(); R = $r })
  }
  return $true
}
[WCap]::EnumWindows($cb, [IntPtr]::Zero) | Out-Null
$w = $script:hits | Where-Object { $_.Title -eq "Openray" } | Select-Object -First 1
if (-not $w) { Write-Error "no Openray window"; exit 1 }
[void][WCap]::ShowWindow($w.H, 5)
[void][WCap]::SetForegroundWindow($w.H)
Start-Sleep -Milliseconds 2000
$r = $w.R
$width = [Math]::Max(1, $r.R - $r.L); $height = [Math]::Max(1, $r.B - $r.T)
"window rect=$($r.L),$($r.T) size=${width}x${height}"
$bmp = New-Object System.Drawing.Bitmap $width, $height
$g = [System.Drawing.Graphics]::FromImage($bmp)
$hdc = $g.GetHdc()
# PW_RENDERFULLCONTENT (2): captures DirectComposition/WebView2 surfaces that plain PrintWindow misses.
$ok = [WCap]::PrintWindow($w.H, $hdc, 2)
$g.ReleaseHdc($hdc)
$g.Dispose()
"printwindow ok=$ok"
$bmp.Save((Join-Path (Get-Location) $Out), [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
"saved $Out"

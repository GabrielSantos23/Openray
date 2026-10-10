param([string]$Out = "shot2.png")
$src = @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public class WEnum {
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr p);
  public delegate bool EnumWindowsProc(IntPtr h, IntPtr p);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  public struct RECT { public int L, T, R, B; }
}
'@
Add-Type -TypeDefinition $src -Language CSharp
Add-Type -AssemblyName System.Drawing
$ids = @(Get-Process RaycastMini -ErrorAction SilentlyContinue | ForEach-Object { $_.Id })
if (-not $ids) { Write-Error "no RaycastMini process"; exit 1 }
$script:hits = New-Object System.Collections.ArrayList
$action = {
  param($h)
  $r = New-Object WEnum+RECT
  [WEnum]::GetWindowRect($h, [ref]$r) | Out-Null
  $sb = New-Object System.Text.StringBuilder 256
  [WEnum]::GetWindowText($h, $sb, 256) | Out-Null
  [void]$script:hits.Add(@{ H = $h; Vis = [WEnum]::IsWindowVisible($h); R = $r; Title = $sb.ToString() })
}
$cb = {
  param($h, $l)
  $pid2 = [uint32]0
  [WEnum]::GetWindowThreadProcessId($h, [ref]$pid2) | Out-Null
  if ($ids -contains [int]$pid2) { & $action $h }
  return $true
}
[WEnum]::EnumWindows($cb, [IntPtr]::Zero) | Out-Null
foreach ($w in $script:hits) {
  "hwnd=$($w.H) vis=$($w.Vis) rect=$($w.R.L),$($w.R.T) size=$($w.R.R - $w.R.L)x$($w.R.B - $w.R.T) title='$($w.Title)'"
}
# Pick the largest visible window; else the largest at all.
$candidate = $script:hits | Where-Object { $_.Vis } | Sort-Object { ($_.R.R - $_.R.L) * ($_.R.B - $_.R.T) } -Descending | Select-Object -First 1
if (-not $candidate) { $candidate = $script:hits | Sort-Object { ($_.R.R - $_.R.L) * ($_.R.B - $_.R.T) } -Descending | Select-Object -First 1 }
if (-not $candidate) { Write-Error "no window found"; exit 1 }
"capturing hwnd=$($candidate.H)"
[void][WEnum]::ShowWindow($candidate.H, 9)
[void][WEnum]::SetForegroundWindow($candidate.H)
Start-Sleep -Milliseconds 1500
$r = $candidate.R
$w = [Math]::Max(1, $r.R - $r.L); $hgt = [Math]::Max(1, $r.B - $r.T)
$bmp = New-Object System.Drawing.Bitmap $w, $hgt
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($r.L, $r.T, 0, 0, $bmp.Size)
$g.Dispose()
$bmp.Save((Join-Path (Get-Location) $Out), [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
"saved $Out (${w}x${hgt})"


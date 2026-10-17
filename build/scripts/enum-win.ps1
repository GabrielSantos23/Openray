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
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  public struct RECT { public int L, T, R, B; }
}
'@
Add-Type -TypeDefinition $src -Language CSharp
$ids = @(Get-Process Openray -ErrorAction SilentlyContinue | ForEach-Object { $_.Id })
foreach ($p in Get-Process Openray -ErrorAction SilentlyContinue) { "pid $($p.Id) mw=$($p.MainWindowHandle)" }
$found = @()
$cb = {
  param($h, $l)
  $pid2 = [uint32]0
  [WEnum]::GetWindowThreadProcessId($h, [ref]$pid2) | Out-Null
  if ($ids -contains [int]$pid2) {
    $r = New-Object WEnum+RECT
    [WEnum]::GetWindowRect($h, [ref]$r) | Out-Null
    $sb = New-Object System.Text.StringBuilder 256
    [WEnum]::GetWindowText($h, $sb, 256) | Out-Null
    $line = "hwnd=$h vis=$([WEnum]::IsWindowVisible($h)) rect=$($r.L),$($r.T) size=$($r.R-$r.L)x$($r.B-$r.T) title='$($sb.ToString())'"
    Write-Output $line
  }
  return $true
}
[WEnum]::EnumWindows($cb, [IntPtr]::Zero) | Out-Null

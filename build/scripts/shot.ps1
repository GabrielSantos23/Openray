param(
    [string]$ProcessName = "RaycastMini",
    [string]$Out = "shot.png",
    [int]$ClickX = -1,
    [int]$ClickY = -1,
    [string]$Keys = "",
    [int]$WaitMs = 2500,
    [switch]$Hotkey,
    [int]$ProcessId = 0
)

Add-Type -AssemblyName System.Drawing
$sig = @'
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, System.IntPtr lParam);
public delegate bool EnumWindowsProc(System.IntPtr hWnd, System.IntPtr lParam);
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(System.IntPtr hWnd, out uint processId);
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool GetWindowRect(System.IntPtr hWnd, out RECT lpRect);
public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool SetForegroundWindow(System.IntPtr hWnd);
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool ShowWindow(System.IntPtr hWnd, int nCmdShow);
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, int dx, int dy, uint dwData, int dwExtraInfo);
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, int dwExtraInfo);
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool IsWindowVisible(System.IntPtr hWnd);
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern int GetWindowTextLength(System.IntPtr hWnd);
'@
$t = @(Add-Type -MemberDefinition $sig -Name "Sh7" -Namespace ShNs7 -PassThru) | Where-Object { $_.Name -eq "Sh7" } | Select-Object -First 1

if ($ProcessId -gt 0) {
    $proc = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
} else {
    $proc = Get-Process -Name $ProcessName -ErrorAction SilentlyContinue | Select-Object -First 1
}
if (-not $proc) { Write-Error "process not found"; exit 1 }
$target = $proc.Id

# Pick the visible top-level window of the process (the last one found is usually the hidden
# message-only window, which reports a 0x0 rect).
$global:shotCandidates = New-Object System.Collections.ArrayList
$cb = [ShNs7.Sh7+EnumWindowsProc] {
    param($hWnd, $lParam)
    $procId = 0
    [void]$t::GetWindowThreadProcessId($hWnd, [ref]$procId)
    if ($procId -eq $target -and $t::IsWindowVisible($hWnd)) {
        $rr = New-Object ShNs7.Sh7+RECT
        [void]$t::GetWindowRect($hWnd, [ref]$rr)
        if (($rr.Right - $rr.Left) -gt 0) { [void]$global:shotCandidates.Add($hWnd) }
    }
    return $true
}
[void]$t::EnumWindows($cb, [System.IntPtr]::Zero)

$script:found = [System.IntPtr]::Zero
if ($global:shotCandidates.Count -gt 0) {
    $script:found = $global:shotCandidates[$global:shotCandidates.Count - 1]
    Write-Output "candidates: $($global:shotCandidates.Count)"
}

if ($script:found -eq [System.IntPtr]::Zero) { Write-Error "no visible window for pid $target"; exit 1 }
Write-Output "hwnd=$($script:found)"

if ($Hotkey) {
    [void]$t::keybd_event(0x11, 0, 0, 0)
    [void]$t::keybd_event(0x12, 0, 0, 0)
    Start-Sleep -Milliseconds 60
    [void]$t::keybd_event(0x20, 0, 0, 0)
    Start-Sleep -Milliseconds 90
    [void]$t::keybd_event(0x20, 0, 2, 0)
    [void]$t::keybd_event(0x12, 0, 2, 0)
    [void]$t::keybd_event(0x11, 0, 2, 0)
    Start-Sleep -Milliseconds 1500
}

[void]$t::ShowWindow($script:found, 9)
[void]$t::SetForegroundWindow($script:found)
Start-Sleep -Milliseconds 1800

if ($ClickX -ge 0 -and $ClickY -ge 0) {
    $r0 = New-Object ShNs7.Sh7+RECT
    [void]$t::GetWindowRect($script:found, [ref]$r0)
    [void]$t::SetCursorPos($r0.Left + $ClickX, $r0.Top + $ClickY)
    Start-Sleep -Milliseconds 250
    [void]$t::mouse_event(0x0002, 0, 0, 0, 0)
    [void]$t::mouse_event(0x0004, 0, 0, 0, 0)
    Start-Sleep -Milliseconds 500
}

if ($Keys) {
    $map = @{ "space" = 0x20; "enter" = 0x0D; "shift" = 0x10 }
    foreach ($key in $Keys.Split(",")) {
        $vk = $map[$key.ToLower()]
        if ($vk) {
            if ($vk -eq 0x0D) { [void]$t::keybd_event(0x10, 0, 0, 0) }
            [void]$t::keybd_event($vk, 0, 0, 0)
            Start-Sleep -Milliseconds 80
            [void]$t::keybd_event($vk, 0, 2, 0)
            if ($vk -eq 0x0D) { Start-Sleep -Milliseconds 80; [void]$t::keybd_event(0x10, 0, 2, 0) }
            Start-Sleep -Milliseconds 250
        }
    }
}

Start-Sleep -Milliseconds $WaitMs

$rect = New-Object ShNs7.Sh7+RECT
[void]$t::GetWindowRect($script:found, [ref]$rect)
$width = $rect.Right - $rect.Left
$height = $rect.Bottom - $rect.Top
Write-Output "size=${width}x${height}"
if ($width -le 0 -or $height -le 0) { Write-Error "window has no size"; exit 1 }

$bitmap = New-Object System.Drawing.Bitmap($width, $height)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$size = New-Object System.Drawing.Size($width, $height)
$graphics.CopyFromScreen($rect.Left, $rect.Top, 0, 0, $size)
$bitmap.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
Write-Output "saved $Out"

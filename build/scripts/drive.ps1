param(
    [string]$Out = "shot.png",
    [string]$Type = "",
    [string]$Keys = "",
    [int]$ClickX = -1,
    [int]$ClickY = -1,
    [int]$WaitMs = 1200,
    [int]$Width = 0,
    [int]$Height = 0,
    [switch]$Hotkey,
    [switch]$NoForeground,
    [int]$ProcessId = 0
)

# Drives the RaycastMini launcher for end-to-end checks:
#   -Hotkey              send the global hotkey (Ctrl+Alt+Space) to toggle the launcher
#   -Type "text"         type literal text into the focused field (SendKeys)
#   -Keys "enter,esc,down,ctrl+k,shift+esc,ctrl+["  send special keys, comma separated
#   capture              PrintWindow (PW_RENDERFULLCONTENT) so the shot is the window's own
#                        content even when the foreground lock steals focus back.

Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms
$sig = @'
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, System.IntPtr lParam);
public delegate bool EnumWindowsProc(System.IntPtr hWnd, System.IntPtr lParam);
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(System.IntPtr hWnd, out uint processId);
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool GetWindowRect(System.IntPtr hWnd, out RECT lpRect);
public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool SetForegroundWindow(System.IntPtr hWnd);
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool ShowWindow(System.IntPtr hWnd, int nCmdShow);
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool IsWindowVisible(System.IntPtr hWnd);
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern System.IntPtr GetForegroundWindow();
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(System.IntPtr hWnd, System.IntPtr unused);
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool PrintWindow(System.IntPtr hWnd, System.IntPtr hdc, uint flags);
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, System.UIntPtr dwExtraInfo);
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool SetWindowPos(System.IntPtr hWnd, System.IntPtr hWndInsertAfter, int x, int y, int cx, int cy, uint flags);
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, int dx, int dy, uint dwData, System.UIntPtr dwExtraInfo);
'@
$t = @(Add-Type -MemberDefinition $sig -Name "Drv" -Namespace DrvNs -PassThru) | Where-Object { $_.Name -eq "Drv" } | Select-Object -First 1

$ids = if ($ProcessId -gt 0) { @($ProcessId) } else { @(Get-Process RaycastMini -ErrorAction SilentlyContinue | ForEach-Object { $_.Id }) }
if ($ids.Count -eq 0) { Write-Error "RaycastMini process not found"; exit 1 }

$global:hits = New-Object System.Collections.ArrayList
$cb = [DrvNs.Drv+EnumWindowsProc] {
    param($hWnd, $lParam)
    $procId = 0
    [void]$t::GetWindowThreadProcessId($hWnd, [ref]$procId)
    if ($ids -contains [int]$procId -and $t::IsWindowVisible($hWnd)) {
        $rr = New-Object DrvNs.Drv+RECT
        [void]$t::GetWindowRect($hWnd, [ref]$rr)
        if (($rr.Right - $rr.Left) -gt 100) { [void]$global:hits.Add($hWnd) }
    }
    return $true
}
[void]$t::EnumWindows($cb, [System.IntPtr]::Zero)
if ($global:hits.Count -eq 0) { Write-Output "novisible"; $Out = ""; }
$hwnd = if ($global:hits.Count -gt 0) { $global:hits[$global:hits.Count - 1] } else { [System.IntPtr]::Zero }

# Send one VK, optionally with ctrl/shift held. (Defined before every call site — PowerShell only
# knows a function once execution has passed its definition.)
function Send-Vk([byte]$vk, [bool]$ctrl, [bool]$shift = $false) {
    if ($ctrl) { [void]$t::keybd_event(0x11, 0, 0, [System.UIntPtr]::Zero) }
    if ($shift) { [void]$t::keybd_event(0x10, 0, 0, [System.UIntPtr]::Zero) }
    [void]$t::keybd_event($vk, 0, 0, [System.UIntPtr]::Zero)
    Start-Sleep -Milliseconds 40
    [void]$t::keybd_event($vk, 0, 2, [System.UIntPtr]::Zero)
    if ($shift) { [void]$t::keybd_event(0x10, 0, 2, [System.UIntPtr]::Zero) }
    if ($ctrl) { [void]$t::keybd_event(0x11, 0, 2, [System.UIntPtr]::Zero) }
}

if ($Hotkey) {
    [void]$t::keybd_event(0x11, 0, 0, [System.UIntPtr]::Zero)
    [void]$t::keybd_event(0x12, 0, 0, [System.UIntPtr]::Zero)
    Start-Sleep -Milliseconds 60
    [void]$t::keybd_event(0x20, 0, 0, [System.UIntPtr]::Zero)
    Start-Sleep -Milliseconds 90
    [void]$t::keybd_event(0x20, 0, 2, [System.UIntPtr]::Zero)
    [void]$t::keybd_event(0x12, 0, 2, [System.UIntPtr]::Zero)
    [void]$t::keybd_event(0x11, 0, 2, [System.UIntPtr]::Zero)
    Start-Sleep -Milliseconds 1200
}

if ($hwnd -ne [System.IntPtr]::Zero -and -not $NoForeground) {
    # Only an externally-hidden HWND needs ShowWindow — and a WPF window shown this way does not
    # re-composite its WebView2 content, so never force it when the window is already visible.
    if (-not $t::IsWindowVisible($hwnd)) {
        [void]$t::ShowWindow($hwnd, 9)
        Start-Sleep -Milliseconds 600
    }
    # The foreground lock denies plain SetForegroundWindow from background processes; an ALT tap
    # makes this process "the last input" owner so the call sticks.
    for ($attempt = 0; $attempt -lt 5; $attempt++) {
        [void]$t::keybd_event(0x12, 0, 0, [System.UIntPtr]::Zero)
        [void]$t::keybd_event(0x12, 0, 2, [System.UIntPtr]::Zero)
        [void]$t::SetForegroundWindow($hwnd)
        Start-Sleep -Milliseconds 250
        if ($t::GetForegroundWindow() -eq $hwnd) { break }
        Start-Sleep -Milliseconds 200
    }
    if ($t::GetForegroundWindow() -eq $hwnd) { Write-Output "foreground=ok" } else { Write-Output "foreground=failed" }
    # Keep the launcher above every other window while the script drives and captures it (a launch
    # without --keep-open-style Topmost leaves it under a maximised editor).
    [void]$t::SetWindowPos($hwnd, [System.IntPtr](-1), 0, 0, 0, 0, 0x0003)
    if ($Width -gt 0 -and $Height -gt 0) {
        # SWP_NOMOVE(0x2) | SWP_NOZORDER(0x4): size only, keeping the topmost placement.
        [void]$t::SetWindowPos($hwnd, [System.IntPtr]::Zero, 0, 0, $Width, $Height, 0x0006)
        Start-Sleep -Milliseconds 300
    }
    Start-Sleep -Milliseconds 400

    if ($ClickX -ge 0 -and $ClickY -ge 0) {
        $r0 = New-Object DrvNs.Drv+RECT
        [void]$t::GetWindowRect($hwnd, [ref]$r0)
        [void]$t::SetCursorPos($r0.Left + $ClickX, $r0.Top + $ClickY)
        Start-Sleep -Milliseconds 250
        [void]$t::mouse_event(0x0002, 0, 0, 0, [System.UIntPtr]::Zero)
        [void]$t::mouse_event(0x0004, 0, 0, 0, [System.UIntPtr]::Zero)
        Start-Sleep -Milliseconds 400
    }

    if ($Clear -and $Type -ne "") {
        # Select-all + delete so -Type replaces whatever the field already holds.
        Send-Vk 0x41 $true
        Start-Sleep -Milliseconds 120
        Send-Vk 0x08 $false
        Start-Sleep -Milliseconds 200
    }
}

if ($hwnd -ne [System.IntPtr]::Zero -and -not $NoForeground) {
    # Safety: only ever inject keys while the launcher is exactly the foreground window —
    # keystrokes aimed at a hidden launcher would land in whatever the user has open.
    if ($hwnd -eq [System.IntPtr]::Zero -or $t::GetForegroundWindow() -ne $hwnd) {
        Write-Error "launcher is not foreground; refusing to type"
        exit 2
    }
}

if ($Type -ne "") {
    # SendKeys depends on the foreground-input guarantees SendInput enforces; keybd_event with the
    # per-char VK (plus shift for the shifted set) is what the hotkey path already uses and is what
    # reaches a WebView2 that holds focus.
    $shifted = '!@#$%^&*()_+{}|:"<>?~'
    foreach ($char in $Type.ToCharArray()) {
        $upper = [char]::ToUpper($char)
        $vk = [int]($upper)
        if ($vk -ge 0x20 -and $vk -le 0x5A -or $vk -eq 0x20) {
            $needShift = [char]::IsUpper($char) -or $shifted.Contains($char)
            if ($needShift) { [void]$t::keybd_event(0x10, 0, 0, [System.UIntPtr]::Zero) }
            [void]$t::keybd_event([byte]$vk, 0, 0, [System.UIntPtr]::Zero)
            Start-Sleep -Milliseconds 25
            [void]$t::keybd_event([byte]$vk, 0, 2, [System.UIntPtr]::Zero)
            if ($needShift) { [void]$t::keybd_event(0x10, 0, 2, [System.UIntPtr]::Zero) }
            Start-Sleep -Milliseconds 45
        }
    }
    Start-Sleep -Milliseconds 400
}

if ($Keys -ne "") {
    $special = @{
        "enter"      = "{ENTER}"
        "esc"        = "{ESC}"
        "escape"     = "{ESC}"
        "tab"        = "{TAB}"
        "down"       = "{DOWN}"
        "up"         = "{UP}"
        "left"       = "{LEFT}"
        "right"      = "{RIGHT}"
        "backspace"  = "{BACKSPACE}"
        "space"      = " "
    }
    # keybd_event-based key map (VK codes) — the same channel the -Type path uses, so every key
    # reaches the WebView2 exactly the same way.
    $vkMap = @{
        "enter"      = 0x0D
        "esc"        = 0x1B
        "escape"     = 0x1B
        "tab"        = 0x09
        "down"       = 0x28
        "up"         = 0x26
        "left"       = 0x25
        "right"      = 0x27
        "backspace"  = 0x08
        "space"      = 0x20
        "a"          = 0x41
        "k"          = 0x4B
    }
    foreach ($token in $Keys.Split(",")) {
        $key = $token.Trim().ToLower()
        if ($key -eq "") { continue }
        if ($key -eq "ctrl+k") { Send-Vk 0x4B $true }
        elseif ($key -eq "shift+esc") { Send-Vk 0x1B $false $true }
        elseif ($key -eq "ctrl+[") { Send-Vk 0xDB $true }
        elseif ($key -eq "ctrl+enter") { Send-Vk 0x0D $true }
        elseif ($key -eq "ctrl+a") { Send-Vk 0x41 $true }
        elseif ($vkMap.ContainsKey($key)) { Send-Vk $vkMap[$key] $false }
        Start-Sleep -Milliseconds 320
    }
}

Start-Sleep -Milliseconds $WaitMs

if ($Out -ne "" -and $hwnd -ne [System.IntPtr]::Zero) {
    $rect = New-Object DrvNs.Drv+RECT
    [void]$t::GetWindowRect($hwnd, [ref]$rect)
    $width = $rect.Right - $rect.Left
    $height = $rect.Bottom - $rect.Top
    $bitmap = New-Object System.Drawing.Bitmap($width, $height)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    if ($t::GetForegroundWindow() -eq $hwnd) {
        # Foreground: a straight screen copy is the most faithful for WebView2's DComp surface
        # (PrintWindow returns black for it on this setup).
        $graphics.CopyFromScreen($rect.Left, $rect.Top, 0, 0, (New-Object System.Drawing.Size($width, $height)))
    } else {
        $hdc = $graphics.GetHdc()
        [void]$t::PrintWindow($hwnd, $hdc, 2)
        $graphics.ReleaseHdc($hdc)
    }
    $graphics.Dispose()
    $bitmap.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
    $bitmap.Dispose()
    Write-Output "saved $Out (${width}x${height})"
}

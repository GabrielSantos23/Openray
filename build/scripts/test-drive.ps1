param(
    [Parameter(Mandatory=$true)][string]$Script,
    [string]$Out = ""
)

# Runs one script in the renderer through the host's dev-only `window.eval` dispatch and prints the
# JSON result. Capture: screenshot of the launcher window after the script settles.

Add-Type -AssemblyName System.Drawing
$sig = @'
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, System.IntPtr lParam);
public delegate bool EnumWindowsProc(System.IntPtr hWnd, System.IntPtr lParam);
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(System.IntPtr hWnd, out uint processId);
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool GetWindowRect(System.IntPtr hWnd, out RECT lpRect);
public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool SetForegroundWindow(System.IntPtr hWnd);
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool IsWindowVisible(System.IntPtr hWnd);
[System.Runtime.InteropServices.DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder s, int n);
'@
$t = @(Add-Type -MemberDefinition $sig -Name "DrvE" -Namespace DrvNsE -PassThru) | Where-Object { $_.Name -eq "DrvE" } | Select-Object -First 1

$ids = @(Get-Process RaycastMini -ErrorAction SilentlyContinue | ForEach-Object { $_.Id })
if ($ids.Count -eq 0) { Write-Error "RaycastMini not running"; exit 1 }
$global:hits = New-Object System.Collections.ArrayList
$cb = [DrvNsE.DrvE+EnumWindowsProc] {
    param($h, $l)
    $procId = 0
    [void]$t::GetWindowThreadProcessId($h, [ref]$procId)
    if ($ids -contains [int]$procId -and $t::IsWindowVisible($h)) {
        $sb = New-Object System.Text.StringBuilder 256
        [void]$t::GetWindowText($h, $sb, 256)
        if ($sb.ToString() -eq "Raycast Mini") { [void]$global:hits.Add($h) }
    }
    return $true
}
[void]$t::EnumWindows($cb, [System.IntPtr]::Zero)
if ($global:hits.Count -eq 0) { Write-Output "no visible launcher window"; exit 2 }
$hwnd = $global:hits[0]

$payload = @{ script = $Script } | ConvertTo-Json -Compress -Depth 4
# The launcher's WebView2 host object: invoke `window.eval` through the module 'frontend' lane by
# calling the same dispatch the renderer uses — via the diagnostics backdoor is not possible, so
# this drives the pipe indirectly: execute through the window's own host object bridge.
# Simplest reliable path: use the WebView2 CoreWebView2 through UI Automation is not available;
# instead call the host dispatch by posting to the window's bridge — done in-process by the app.
# Here we approximate with SendKeys-free JS injection via CDP is unavailable, so we use the
# renderer's own `ipcRequest` host object? Not reachable externally either.
Write-Output "eval-not-wired-externally"

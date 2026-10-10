param(
    [Parameter(Mandatory = $true)][ValidateSet("exclude", "can-include-0", "can-include-1", "none")]
    [string]$Mode,
    [string]$Text = "concealment probe",
    [switch]$Html,
    [int]$ExtraRtfBytes = 0
)

# Puts text on the clipboard with one of Raycast's concealment formats attached, so the listener's
# drop/include policy can be exercised by hand. Raycast's `RaycastClipboardListener` reads exactly
# these two Win32 clipboard formats:
#
#   ExcludeClipboardContentFromMonitorProcessing  -> the entry is dropped, never monitored
#   CanIncludeInClipboardHistory                  -> 0 drops the entry, 1 forces it in
#
# Run `build\scripts\set-clipboard-conceal.ps1 -Mode exclude -Text "secret"`, check the launcher log,
# and confirm the copy produced no Clipboard History entry. Then `-Mode can-include-0` must also be
# dropped, and `-Mode can-include-1` must be recorded even if the source app would normally be
# ignored. `-Mode none` is the control: a plain copy that must always be recorded.
#
# The format is written with a zero-byte payload. The listener only reads these formats as a flag, so
# an empty value is enough; the text still travels in CF_UNICODETEXT.

$ErrorActionPreference = "Stop"

if (-not ("Win32.NativeClipboard" -as [type])) {
    Add-Type -Namespace Win32 -Name NativeClipboard -MemberDefinition @'
[DllImport("user32.dll", SetLastError = true)] public static extern bool OpenClipboard(IntPtr hWndNewOwner);
[DllImport("user32.dll", SetLastError = true)] public static extern bool CloseClipboard();
[DllImport("user32.dll", SetLastError = true)] public static extern bool EmptyClipboard();
[DllImport("user32.dll", SetLastError = true)] public static extern bool SetClipboardData(uint uFormat, IntPtr hMem);
[DllImport("kernel32.dll", SetLastError = true)] public static extern IntPtr GlobalAlloc(uint uFlags, UIntPtr dwBytes);
[DllImport("kernel32.dll", SetLastError = true)] public static extern IntPtr GlobalLock(IntPtr hMem);
[DllImport("kernel32.dll", SetLastError = true)] public static extern bool GlobalUnlock(IntPtr hMem);
[DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)] public static extern uint RegisterClipboardFormat(string lpszFormat);
'@
}

$CF_UNICODETEXT = 13
$GMEM_MOVEABLE = 0x0002

function Set-ClipboardFormat([uint32]$Format, [byte[]]$Payload) {
    # A zero-byte GlobalAlloc returns a handle that GlobalLock refuses, so the flag formats get a
    # single throwaway byte. The listener only reads them as a presence/value flag.
    $size = [Math]::Max(1, $Payload.Length)
    $handle = [Win32.NativeClipboard]::GlobalAlloc($GMEM_MOVEABLE, [UIntPtr]::new([uint32]$size))
    if ($handle -eq [IntPtr]::Zero) { throw "GlobalAlloc failed for format $Format" }
    $pointer = [Win32.NativeClipboard]::GlobalLock($handle)
    if ($pointer -eq [IntPtr]::Zero) { throw "GlobalLock failed for format $Format" }
    try {
        [System.Runtime.InteropServices.Marshal]::Copy($Payload, 0, $pointer, $Payload.Length)
    }
    finally {
        [void][Win32.NativeClipboard]::GlobalUnlock($handle)
    }
    if (-not [Win32.NativeClipboard]::SetClipboardData($Format, $handle)) {
        throw "SetClipboardData failed for format $Format"
    }
}

function Set-ClipboardUnicodeText([string]$Value) {
    $bytes = [System.Text.Encoding]::Unicode.GetBytes($Value + "`0")
    Set-ClipboardFormat $CF_UNICODETEXT $bytes
}

function Set-ClipboardInt([uint32]$Format, [int]$Value) {
    Set-ClipboardFormat $Format ([System.BitConverter]::GetBytes($Value))
}

$excludeFormat = [Win32.NativeClipboard]::RegisterClipboardFormat("ExcludeClipboardContentFromMonitorProcessing")
$canIncludeFormat = [Win32.NativeClipboard]::RegisterClipboardFormat("CanIncludeInClipboardHistory")
if ($excludeFormat -eq 0 -or $canIncludeFormat -eq 0) { throw "RegisterClipboardFormat failed" }

$opened = $false
for ($attempt = 0; $attempt -lt 8 -and -not $opened; $attempt++) {
    $opened = [Win32.NativeClipboard]::OpenClipboard([IntPtr]::Zero)
    if (-not $opened) { Start-Sleep -Milliseconds 40 }
}
if (-not $opened) { throw "could not open the clipboard (another app is holding it)" }

try {
    [void][Win32.NativeClipboard]::EmptyClipboard()
    Set-ClipboardUnicodeText $Text

    if ($Html) {
        # Not `$html`: PowerShell variable names are case-insensitive, so it would clobber the switch.
        $htmlPayload = "<html><body><p>$Text</p></body></html>"
        $htmlFormat = [Win32.NativeClipboard]::RegisterClipboardFormat("HTML Format")
        Set-ClipboardFormat $htmlFormat ([System.Text.Encoding]::ASCII.GetBytes($htmlPayload))
    }

    if ($ExtraRtfBytes -gt 0) {
        $rtfPayload = "{\rtf1 $Text}"
        $rtfFormat = [Win32.NativeClipboard]::RegisterClipboardFormat("Rich Text Format")
        Set-ClipboardFormat $rtfFormat ([System.Text.Encoding]::ASCII.GetBytes($rtfPayload))
    }

    switch ($Mode) {
        "exclude" {
            Set-ClipboardFormat $excludeFormat ([byte[]]::new(0))
            Write-Host "clipboard: ExcludeClipboardContentFromMonitorProcessing set - the listener must NOT record this" -ForegroundColor Yellow
        }
        "can-include-0" {
            Set-ClipboardInt $canIncludeFormat 0
            Write-Host "clipboard: CanIncludeInClipboardHistory = 0 - the listener must NOT record this" -ForegroundColor Yellow
        }
        "can-include-1" {
            Set-ClipboardInt $canIncludeFormat 1
            Write-Host "clipboard: CanIncludeInClipboardHistory = 1 - the listener MUST record this" -ForegroundColor Green
        }
        "none" {
            Write-Host "clipboard: plain text only - the listener must record this (control)" -ForegroundColor Green
        }
    }
}
finally {
    [void][Win32.NativeClipboard]::CloseClipboard()
}

Write-Host ""
Write-Host "modes:"
Write-Host "  -Mode exclude       drop the entry (ExcludeClipboardContentFromMonitorProcessing)"
Write-Host "  -Mode can-include-0 drop the entry (CanIncludeInClipboardHistory = 0)"
Write-Host "  -Mode can-include-1 force the entry in (CanIncludeInClipboardHistory = 1)"
Write-Host "  -Mode none          control: always recorded"
Write-Host ""
Write-Host "use -Html or -ExtraRtfBytes to attach extra representations (needed to see copyCount move on a merge)"
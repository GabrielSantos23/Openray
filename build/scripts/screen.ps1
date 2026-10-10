param(
    [string]$Out = "screen.png",
    [int]$WaitMs = 600
)
# Full-virtual-screen capture (the HUD is a separate topmost window, not the launcher).
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms
Start-Sleep -Milliseconds $WaitMs
$bounds = [System.Windows.Forms.SystemInformation]::VirtualScreen
$bmp = New-Object System.Drawing.Bitmap($bounds.Width, $bounds.Height)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($bounds.Left, $bounds.Top, 0, 0, $bmp.Size)
$g.Dispose()
$bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
Write-Output "saved $Out ($($bounds.Width)x$($bounds.Height))"

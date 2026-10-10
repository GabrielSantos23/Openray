$sh = New-Object -ComObject WScript.Shell
$roots = @(
  [Environment]::GetFolderPath([Environment+SpecialFolder]::CommonPrograms),
  [Environment]::GetFolderPath([Environment+SpecialFolder]::Programs)
) | Select-Object -Unique
$total = 0; $resolved = 0; $exe = 0; $resolveFailed = 0
foreach ($root in $roots) {
  foreach ($file in [System.IO.Directory]::EnumerateFiles($root, "*.lnk", [System.IO.SearchOption]::AllDirectories)) {
    $total++
    try {
      $link = $sh.CreateShortcut($file)
      $target = $link.TargetPath
    } catch { $target = $null }
    if ([string]::IsNullOrWhiteSpace($target)) { $resolveFailed++; continue }
    $resolved++
    if ($target.ToLower().EndsWith(".exe")) { $exe++ } else { $resolveFailed++ }
  }
}
"total=$total resolved=$resolved exe=$exe failedOrNonExe=$resolveFailed"

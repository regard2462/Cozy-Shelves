# Creates the "00 Must-Read" shortcuts of a test library made by gen_lib.py (it writes manifest.json next to the
# library folder). Usage: powershell -File build/testlib/make_lnk.ps1 <folder of the test library>
param([Parameter(Mandatory = $true)][string]$Library)
$lib = (Resolve-Path $Library).Path
$m = Get-Content -Raw -Encoding UTF8 (Join-Path (Split-Path $lib -Parent) 'manifest.json') | ConvertFrom-Json
$sh = New-Object -ComObject WScript.Shell
$n = 0
foreach ($l in $m.lnk) {
  $s = $sh.CreateShortcut($l.lnk)
  $s.TargetPath = $l.target
  $s.WorkingDirectory = Split-Path $l.target
  $s.Save()
  $n++
}
"lnk created: $n"

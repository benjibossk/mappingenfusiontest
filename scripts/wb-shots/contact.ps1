# contact.ps1 - tile pictures into one labelled contact sheet (JPEG). No dependencies (System.Drawing).
#   powershell -File scripts\wb-shots\contact.ps1 -Images a.png,b.png -Out contact.jpg [-Cols 3] [-TileW 640]
param([Parameter(Mandatory)][string[]]$Images, [Parameter(Mandatory)][string]$Out, [int]$Cols = 3, [int]$TileW = 640)
Add-Type -AssemblyName System.Drawing
$Cols = [Math]::Max(1, [Math]::Min($Cols, $Images.Count))
$first = [Drawing.Image]::FromFile($Images[0])
$tileH = [int]($TileW * $first.Height / $first.Width); $first.Dispose()
$label = 22
$rows = [Math]::Ceiling($Images.Count / $Cols)
$sheet = New-Object Drawing.Bitmap ($Cols * $TileW), ($rows * ($tileH + $label))
$g = [Drawing.Graphics]::FromImage($sheet)
$g.Clear([Drawing.Color]::FromArgb(24, 24, 24))
$g.InterpolationMode = "HighQualityBicubic"
$font = New-Object Drawing.Font "Segoe UI", 10
for ($i = 0; $i -lt $Images.Count; $i++) {
  $x = ($i % $Cols) * $TileW; $y = [Math]::Floor($i / $Cols) * ($tileH + $label)
  $img = [Drawing.Image]::FromFile($Images[$i])
  $g.DrawImage($img, $x, $y + $label, $TileW, $tileH); $img.Dispose()
  $g.DrawString([IO.Path]::GetFileNameWithoutExtension($Images[$i]), $font, [Drawing.Brushes]::White, $x + 4, $y + 2)
}
$g.Dispose()
$sheet.Save($Out, [Drawing.Imaging.ImageFormat]::Jpeg); $sheet.Dispose()
Write-Host "contact sheet: $Out"

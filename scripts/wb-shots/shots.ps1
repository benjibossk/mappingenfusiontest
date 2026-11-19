# shots.ps1 - headless World Editor screenshots of a Mapgenerator world (model: Life-Framework tools/visual).
#
# Starts a SECOND Workbench on the private "MG-Agents" desktop (never drawn, never takes focus, the
# open Workbench is left alone) with its own -profile, runs MG_ShotsPlugin (addon Mapgenerator), which
# places the editor camera for each shot, calls System.MakeScreenshot and Workbench.Exit. Then copies
# the pictures to -OutDir and builds contact.jpg.
#
#   powershell -ExecutionPolicy Bypass -File scripts\wb-shots\shots.ps1 [-Plan shots.json] [-OutDir dir] [-TimeoutS 300] [-Show]
#
# shots.json:
#   { "world": "{106590BC14A91604}Worlds/MG_Test.ent", "settle": 600, "first": 4000,
#     "shots": [ { "name": "overview", "pos": [2048, 900, 300], "target": [2048, 0, 2048] },
#                { "name": "port", "target": [760, 0, 2230], "yaw": 200, "pitch": -25, "dist": 120, "agl": true } ] }
#   pos+target, or target+yaw(0 = north, clockwise)+pitch(deg, negative = looking down)+dist.
#   agl true = heights are metres above the terrain.
# -Show starts it on the normal desktop (debug). Notes:
#   -gproj skips the launcher's addon presets: only Mapgenerator + base game are loaded (enough here).
#   The NET API port 5775 belongs to the open Workbench; the second one simply does not get it.
param(
  [string]$Plan = (Join-Path $PSScriptRoot "shots.example.json"),
  [string]$OutDir = (Join-Path $env:LOCALAPPDATA "reforger-mapper\wb-shots\out"),
  [int]$TimeoutS = 300,
  [switch]$Show
)
$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "quiet-launch.ps1")

# Tools + game install: MG_WB_TOOLS / MG_GAME, else the install of the Workbench already running (its Tools and
# game data match), else D:\SteamLibrary. Not ENFUSION_*_PATH: on this PC they point at an OLD second install
# (D:\Program Files\Steam, game data 2026-08) whose scripts do not compile with the current addon.
$running = Get-CimInstance Win32_Process -Filter "Name like 'ArmaReforgerWorkbench%'" -ErrorAction SilentlyContinue | Where-Object ExecutablePath | Select-Object -First 1
$tools = if ($env:MG_WB_TOOLS) { $env:MG_WB_TOOLS } elseif ($running) { Split-Path (Split-Path $running.ExecutablePath) } else { "D:\SteamLibrary\steamapps\common\Arma Reforger Tools" }
$game = if ($env:MG_GAME) { $env:MG_GAME } else { Join-Path (Split-Path $tools) "Arma Reforger" }
$addons = Join-Path $env:USERPROFILE "Documents\My Games\ArmaReforgerWorkbench\addons"
$gproj = Join-Path $addons "Mapgenerator\addon.gproj"
$exe = Join-Path $tools "Workbench\ArmaReforgerWorkbenchSteamDiag.exe"
$profileDir = Join-Path $env:LOCALAPPDATA "reforger-mapper\wb-shots\profile"
$shotDir = Join-Path $profileDir "profile\MapGen\shots"  # -profile D makes $profile: = D\profile

$p = Get-Content -Raw -Encoding UTF8 $Plan | ConvertFrom-Json
$world = if ($p.world) { $p.world } else { "{106590BC14A91604}Worlds/MG_Test.ent" }
$settle = if ($p.settle) { [int]$p.settle } else { 600 }
$first = if ($p.first) { [int]$p.first } else { 4000 }

function F([double]$v) { $v.ToString("0.###", [Globalization.CultureInfo]::InvariantCulture) }
$lines = @("world $world", "settle $settle", "first $first")
foreach ($s in $p.shots) {
  $name = ($s.name -replace '[^A-Za-z0-9_-]', '_')
  $t = $s.target
  if ($s.pos) { $c = $s.pos }
  else {
    $yaw = [double]$s.yaw * [Math]::PI / 180; $pitch = [double]$s.pitch * [Math]::PI / 180; $d = [double]$s.dist
    # camera stands behind the target, looking along (yaw, pitch)
    $dx = [Math]::Sin($yaw) * [Math]::Cos($pitch); $dz = [Math]::Cos($yaw) * [Math]::Cos($pitch); $dy = [Math]::Sin($pitch)
    $c = @(([double]$t[0] - $dx * $d), ([double]$t[1] - $dy * $d), ([double]$t[2] - $dz * $d))
  }
  $agl = if ($s.agl) { 1 } else { 0 }
  $lines += "shot $name $(F $c[0]) $(F $c[1]) $(F $c[2]) $(F $t[0]) $(F $t[1]) $(F $t[2]) $agl"
}
New-Item -ItemType Directory -Force $shotDir | Out-Null
Get-ChildItem $shotDir -File | Remove-Item -Force
[IO.File]::WriteAllLines((Join-Path $shotDir "plan.txt"), $lines)

$wbArgs = @("-gproj", $gproj, "-wbModule=WorldEditor", "-plugin=MG_ShotsPlugin", "-noSplash", "-noSound",
  "-profile", $profileDir, "-addonsDir", "$game\addons,$addons")
if ($Show) { $env:MG_SHOW_WINDOWS = "1" }
Write-Host "wb-shots: $($p.shots.Count) shot(s), profile $profileDir"
$proc = Start-MgQuietProcess -FilePath $exe -ArgumentList $wbArgs -WorkingDirectory $game -KillOnClose
$status = Join-Path $shotDir "status.txt"
$sw = [Diagnostics.Stopwatch]::StartNew()
while (-not $proc.HasExited -and $sw.Elapsed.TotalSeconds -lt $TimeoutS) {
  Start-Sleep -Milliseconds 1000
  if ((Test-Path $status) -and ((Get-Content $status -Tail 1) -match " done ")) { if ($proc.WaitForExit(20000)) { break } }
}
$timedOut = -not $proc.HasExited
if ($timedOut) { & taskkill /PID $proc.Id /T /F | Out-Null }  # only OUR instance (by pid)

# script errors of that run (its own log under the private profile)
$log = Get-ChildItem (Join-Path $profileDir "logs") -Directory -ErrorAction SilentlyContinue | Sort-Object LastWriteTime | Select-Object -Last 1
if ($log) {
  $err = Select-String -Path (Join-Path $log.FullName "console.log") -Pattern "SCRIPT\s+\(E\)|Can't compile" | Where-Object { $_.Line -notmatch "Leaked" } | Select-Object -First 15
  if ($err) { Write-Host "script errors:"; $err | ForEach-Object { Write-Host "  $($_.Line)" } }
}
if (Test-Path $status) { Get-Content $status | ForEach-Object { Write-Host "  $_" } } else { Write-Host "no status.txt: plugin did not run (see $($log.FullName)\console.log)" }

# collect + contact sheet
New-Item -ItemType Directory -Force $OutDir | Out-Null
$imgs = @(Get-ChildItem $shotDir -File | Where-Object { $_.Extension -in ".png", ".bmp" } | Sort-Object Name)
foreach ($i in $imgs) { Copy-Item $i.FullName $OutDir -Force }
if ($imgs.Count) {
  & (Join-Path $PSScriptRoot "contact.ps1") -Images ($imgs | ForEach-Object { Join-Path $OutDir $_.Name }) -Out (Join-Path $OutDir "contact.jpg")
}
Write-Host "wb-shots: $($imgs.Count) picture(s) in $OutDir$(if ($timedOut) { ' (TIMEOUT, killed own instance)' })"
if ($timedOut -or -not $imgs.Count) { exit 1 }

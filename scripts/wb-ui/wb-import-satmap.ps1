# Import the flat satellite map (<profile>\MapGen\masks\MG_Test_satellite.png, written by the bridge /masks) into the
# open world via UI Automation: Terrain Tool > Manage > 'Import satellite map...' (SatelliteMapGenerationDialog),
# Source = the PNG, 'In linear color space' unchecked, OK, wait for the bake, acknowledge boxes, optional save.
# No keyboard, no focus. No script API exists for this (Workbench API has no satellite/supertexture import, checked
# 2026-11-27): the dialog IS the supertexture generation (it bakes <world>N_supertexture tiles = distant colour),
# so there is no separate "regenerate supertexture" step.
# SAFE ORDER: send -> quiet wait -> wb-save -> wb-import-masks (normal map) -> THIS -> wb-save (or let it save).
param(
  [string]$File = "$env:USERPROFILE\Documents\My Games\ArmaReforgerWorkbench\profile\MapGen\masks\MG_Test_satellite.png",
  [int]$TimeoutSec = 900,
  [switch]$NoSave,
  [switch]$RenderRoads,
  [int]$QuietSec = 60,
  [int]$QuietMaxSec = 900,
  [int]$SaveDelaySec = 60,
  [switch]$Probe
)
$ErrorActionPreference = 'Stop'
if (-not $env:MAPGEN_WB_PORT) { $env:MAPGEN_WB_PORT = '5777' }
if (-not (Test-Path $File)) { throw "satellite PNG not found: $File" }
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$A = [System.Windows.Automation.AutomationElement]
$P = [System.Windows.Automation.PropertyCondition]
$wbpid = (Get-CimInstance Win32_Process -Filter "Name like 'ArmaReforgerWorkbench%'" | Where-Object { $_.CommandLine -match 'Mapgenerator' } | Select-Object -First 1).ProcessId
if (-not $wbpid) { throw 'Mapgenerator Workbench not running' }
function Tops { $A::RootElement.FindAll('Children', (New-Object $P($A::ProcessIdProperty, [int]$wbpid))) }
# the top window is named 'World Editor - ...' or just 'Arma Reforger Workbench' depending on the session: match the Qt class too
function WE { Tops | Where-Object { $_.Current.Name -match '^World Editor' -or $_.Current.ClassName -eq 'WorldEditorQt' } | Select-Object -First 1 }
function Find($root, $name, $type) {
  $root.FindAll('Descendants', (New-Object $P($A::NameProperty, $name))) |
    Where-Object { -not $type -or $_.Current.ControlType.ProgrammaticName -eq "ControlType.$type" } | Select-Object -First 1
}
function Pat($el, $pat) { $el.GetCurrentPattern($pat::Pattern) }
function Dialogs {
  Tops | Where-Object { $_.Current.ClassName -notmatch '^(WorldEditorQt|ResourceManager)$' -and $_.Current.Name -notmatch '^(World Editor - |Enfusion Workbench - )' }
  $we = WE; if ($we) { $we.FindAll('Children', (New-Object $P($A::ControlTypeProperty, [System.Windows.Automation.ControlType]::Window))) }
}
function Visible { @(Dialogs | Where-Object { -not $_.Current.IsOffscreen }) }
function DescribeDialog($d) {
  $txt = ($d.FindAll('Descendants', [System.Windows.Automation.Condition]::TrueCondition) | ForEach-Object { $_.Current.Name } | Where-Object { $_ } | Select-Object -Unique) -join ' | '
  "dialog '$($d.Current.Name)' cls=$($d.Current.ClassName): $txt"
}
function SetCheck($dlg, $name, [bool]$on) {
  $cb = Find $dlg $name 'CheckBox'; if (-not $cb) { "checkbox '$name' not found"; return }
  $tp = Pat $cb ([System.Windows.Automation.TogglePattern])
  if (($tp.Current.ToggleState -eq 'On') -ne $on) { $tp.Toggle() }
  "checkbox '$name' = $($tp.Current.ToggleState)"
}

$we = WE; if (-not $we) { throw 'World Editor window not found' }
$btn = Find $we 'Import satellite map...' 'Button'
if (-not $btn) {
  $mt = Find $we 'Manage' 'TabItem'
  if (-not $mt) { throw 'Terrain Tool not open (Tools > Terrain Tool, Manage tab): run wb-import-masks.ps1 first' }
  (Pat $mt ([System.Windows.Automation.SelectionItemPattern])).Select(); Start-Sleep -Milliseconds 700
  $btn = Find (WE) 'Import satellite map...' 'Button'; if (-not $btn) { throw "'Import satellite map...' not found" }
}
$dlg = Tops | Where-Object { $_.Current.ClassName -eq 'SatelliteMapGenerationDialog' -and -not $_.Current.IsOffscreen } | Select-Object -First 1
if (-not $dlg) {
  (Pat $btn ([System.Windows.Automation.InvokePattern])).Invoke(); 'Import satellite map... invoked'
  for ($i = 0; $i -lt 20 -and -not $dlg; $i++) {
    Start-Sleep -Milliseconds 500
    $dlg = @(Tops) + @((WE).FindAll('Children', (New-Object $P($A::ControlTypeProperty, [System.Windows.Automation.ControlType]::Window)))) |
      Where-Object { $_.Current.ClassName -eq 'SatelliteMapGenerationDialog' -and -not $_.Current.IsOffscreen } | Select-Object -First 1
  }
}
if (-not $dlg) { throw 'Import Satellite Map dialog did not appear' }
# Source line edit = the first QLineEdit of the 'Source' group (the next two are width/height)
$src = $dlg.FindAll('Descendants', (New-Object $P($A::ControlTypeProperty, [System.Windows.Automation.ControlType]::Edit))) |
  Where-Object { $_.Current.ClassName -eq 'QLineEdit' } | Select-Object -First 1
$vp = Pat $src ([System.Windows.Automation.ValuePattern])
function Norm($x) { ($x.Replace([char]92, [char]47)).ToLowerInvariant() }
if ((Norm $vp.Current.Value) -ne (Norm $File)) {
  if ($vp.Current.IsReadOnly) { throw "Source field read-only and holds '$($vp.Current.Value)'" }
  $vp.SetValue($File.Replace([char]92, [char]47)); Start-Sleep -Milliseconds 500
}
"source = '$($vp.Current.Value)'"
if ((Norm $vp.Current.Value) -ne (Norm $File)) { throw 'Source field did not take the file' }
SetCheck $dlg 'In linear color space' $false
SetCheck $dlg 'Render roads' ([bool]$RenderRoads)
if ($Probe) { 'probe only: dialog left open'; exit 0 }
$before = @(Dialogs | ForEach-Object { $_.Current.NativeWindowHandle })
$ok = Find $dlg 'OK' 'Button'; (Pat $ok ([System.Windows.Automation.InvokePattern])).Invoke(); 'OK invoked: satellite bake running'
$t0 = Get-Date; $deadline = $t0.AddSeconds($TimeoutSec); $quiet = 0
while ((Get-Date) -lt $deadline) {
  Start-Sleep -Seconds 2
  $new = @(Visible | Where-Object { $before -notcontains $_.Current.NativeWindowHandle })
  $busy = @($new | Where-Object { $_.Current.ClassName -match 'Progress' }).Count
  $boxes = @($new | Where-Object { $_.Current.ClassName -notmatch 'Progress' })
  foreach ($d in $boxes) {
    $desc = DescribeDialog $d; $desc
    if ($desc -match 'fail|error') { $script:failed = $true }
    $b = $null; foreach ($n in 'OK', 'Ok', 'Yes', 'Continue', 'Close') { $b = Find $d $n 'Button'; if ($b) { break } }
    if ($b) { (Pat $b ([System.Windows.Automation.InvokePattern])).Invoke(); "  -> $($b.Current.Name)" } else { '  -> no OK button, leaving it'; $before += $d.Current.NativeWindowHandle }
  }
  if ($busy -or $boxes.Count) { $quiet = 0 } else { $quiet++ }
  if ($quiet -ge 10 -and (WE).Current.IsEnabled) { break }
}
"satellite import finished in $([int]((Get-Date) - $t0).TotalSeconds) s" + $(if ($script:failed) { ' (WITH ERRORS, see console.log)' } else { '' })
$ld = Get-ChildItem "$env:USERPROFILE\Documents\My Games\ArmaReforgerWorkbench\logs" -Directory | Sort-Object { (Get-Item (Join-Path $_.FullName "console.log") -ErrorAction SilentlyContinue).LastWriteTime } -Descending | Select-Object -First 1
$cl = Join-Path $ld.FullName 'console.log'
$res = @(Get-Content $cl -Tail 3000 -ErrorAction SilentlyContinue | Where-Object { $_ -match 'Satellite map import (finished|failed)|TERRAIN +\(E\).*atellite' }) | Select-Object -Last 1
if ($res) { "console: $($res.Trim())" } else { 'console: no satellite import line found (check console.log)' }
if ($NoSave) { exit 0 }
$qEnd = (Get-Date).AddSeconds($QuietMaxSec); $age = 0
while ((Get-Date) -lt $qEnd) { $age = ((Get-Date) - (Get-Item $cl).LastWriteTime).TotalSeconds; if ($age -ge $QuietSec) { break }; Start-Sleep -Seconds 5 }
if ($age -lt $QuietSec) { "console never quiet for $QuietSec s: save skipped"; exit 4 }
Start-Sleep -Seconds $SaveDelaySec
if (-not (Get-Process -Id $wbpid -ErrorAction SilentlyContinue) -or (Get-Process -Name CrashReporter* -ErrorAction SilentlyContinue)) { 'WORKBENCH CRASHED before save'; exit 3 }
node (Join-Path $PSScriptRoot 'wb-save.mjs')
Start-Sleep -Seconds 6
if (-not (Get-Process -Id $wbpid -ErrorAction SilentlyContinue) -or (Get-Process -Name CrashReporter* -ErrorAction SilentlyContinue)) { 'WORKBENCH CRASHED during save'; exit 3 }
"title: $((Get-Process -Id $wbpid).MainWindowTitle)"

# Import terrain surface masks into the open World Editor world via UI Automation (no mouse, no keys
# except Ctrl+S fallback). Steps: Tools > Terrain Tool, Window > Current Tool, Paint tab, set the
# "Import/export masks from/to" path field (ValuePattern), Invoke Import, dismiss info dialogs, save.
#
# ORDER OF THE SEND FLOW: apply (objects) -> SAVE -> write masks -> this import -> wait -> save.
# Save the objects BEFORE the mask import: the save at the end of this script is the risky one (the
# Workbench re-encodes textures in the background after the import / "Fix block borders" / normal map
# generation, and a save during that crashed it in nvtt::CubeSurface::toGamma, twice on 2026-11-21,
# while a save ~10 min later worked). If it crashes, only the masks are lost, not the objects.
# Before saving this script waits for a quiet console.log (>= -QuietSec, default 120 s, max -QuietMaxSec)
# AND then a fixed -SaveDelaySec (default 180 s). -NoNormalMap: the normal map is not generated, so its
# 'Reimporting Done' is not awaited (the quiet console + delay still apply before the save).
# -TerrainFix: also run Terrain Tool > Manage > 'Fix block borders' (off by default, see below).
param(
  [string]$Folder = "$env:USERPROFILE\Documents\My Games\ArmaReforgerWorkbench\profile\MapGen\masks\MG_Test",
  [int]$TimeoutSec = 300,
  [switch]$NoSave,
  [switch]$NoTerrainFix, # kept for old command lines: the border fix is now opt-in (-TerrainFix)
  [switch]$TerrainFix,
  [switch]$NoNormalMap, # AVOID: without it the heights sent by the bridge keep stale normals on every 256 m tile border
                        # (straight light/dark 2 m strips at x/z = k*256, seen 2026-11-26; 'Fix block borders' does not remove them)
  [int]$QuietSec = 120,
  [int]$QuietMaxSec = 900,
  [int]$SaveDelaySec = 180,
  [switch]$Probe
)
$ErrorActionPreference = 'Stop'
# the save below goes through wb-save.mjs: aim it at the Mapgenerator Workbench port (5777), never the 5775 default of other projects
if (-not $env:MAPGEN_WB_PORT) { $env:MAPGEN_WB_PORT = '5777' }
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$A = [System.Windows.Automation.AutomationElement]
$P = [System.Windows.Automation.PropertyCondition]
# pick OUR Workbench (several can run, e.g. another session's FF project): the one whose window or command line names Mapgenerator
$wbpid = (Get-CimInstance Win32_Process -Filter "Name like 'ArmaReforgerWorkbench%'" | Where-Object { $_.CommandLine -match 'Mapgenerator' -or (Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue).MainWindowTitle -match 'Mapgenerator' } | Select-Object -First 1).ProcessId
if (-not $wbpid) { throw 'Workbench not running' }
function Tops { $A::RootElement.FindAll('Children', (New-Object $P($A::ProcessIdProperty, [int]$wbpid))) }
function WE { Tops | Where-Object { $_.Current.Name -match '^World Editor' } | Select-Object -First 1 }
function Find($root, $name, $type) {
  $root.FindAll('Descendants', (New-Object $P($A::NameProperty, $name))) |
    Where-Object { -not $type -or $_.Current.ControlType.ProgrammaticName -eq "ControlType.$type" } | Select-Object -First 1
}
function Pat($el, $pat) { $el.GetCurrentPattern($pat::Pattern) }
function MenuInvoke($menu, $item) {
  $mi = Find (WE) $menu 'MenuItem'; if (-not $mi) { throw "menu $menu not found" }; $ec = Pat $mi ([System.Windows.Automation.ExpandCollapsePattern])
  $ec.Expand(); Start-Sleep -Milliseconds 400
  $t = Find $mi $item 'MenuItem'
  # Qt can open the menu as a separate popup window: look there too
  if (-not $t) { foreach ($w in @(Tops)) { $t = Find $w $item 'MenuItem'; if ($t) { break } } }
  if (-not $t) { $ec.Collapse(); throw "menu item $menu > $item not found" }
  (Pat $t ([System.Windows.Automation.InvokePattern])).Invoke(); Start-Sleep -Milliseconds 400
  # Qt leaves the popup open after a UIA Invoke: close it explicitly.
  if ($ec.Current.ExpandCollapseState -ne 'Collapsed') { $ec.Collapse() }
  "menu: $menu > $item"
}
# Dialogs: any top-level of the pid other than the two main windows.
# top-level boxes AND modal windows parented inside the World Editor (the import confirmation is one of those)
function Dialogs {
  Tops | Where-Object { $_.Current.Name -notmatch '^(World Editor - |Enfusion Workbench - )' }
  $we = WE; if ($we) { $we.FindAll('Children', (New-Object $P($A::ControlTypeProperty, [System.Windows.Automation.ControlType]::Window))) }
}
function DescribeDialog($d) {
  $txt = ($d.FindAll('Descendants', [System.Windows.Automation.Condition]::TrueCondition) | ForEach-Object { $_.Current.Name } | Where-Object { $_ }) -join ' | '
  "dialog '$($d.Current.Name)' cls=$($d.Current.ClassName): $txt"
}

$we = WE; if (-not $we) { throw 'World Editor window not found' }
if (-not (Find $we 'Import/export masks from/to' 'Text')) {
  MenuInvoke 'Tools' 'Terrain Tool'
  if (-not (Find (WE) 'Terrain Tool' 'Window')) { MenuInvoke 'Window' 'Current Tool' }
  Start-Sleep -Milliseconds 500
  $tab = Find (WE) 'Paint' 'TabItem'; if (-not $tab) { throw 'Terrain Tool Paint tab not found' }
  (Pat $tab ([System.Windows.Automation.SelectionItemPattern])).Select(); Start-Sleep -Milliseconds 500
}
$we = WE
$label = Find $we 'Import/export masks from/to' 'Text'; if (-not $label) { throw 'Paint page not exposed' }
$frame = [System.Windows.Automation.TreeWalker]::ControlViewWalker.GetParent($label)
$edit = $frame.FindFirst('Children', (New-Object $P($A::ControlTypeProperty, [System.Windows.Automation.ControlType]::Edit)))
$vp = Pat $edit ([System.Windows.Automation.ValuePattern])
function Norm($x) { ($x.Replace([char]92, [char]47)).TrimEnd([char]47).ToLowerInvariant() }
"path field = '$($vp.Current.Value)'"
if ((Norm $vp.Current.Value) -ne (Norm $Folder)) {
  # The field is read-only for UIA: go through the '...' folder picker.
  $pre = @(Dialogs | ForEach-Object { $_.Current.NativeWindowHandle })
  (Pat (Find $frame '...' 'Button') ([System.Windows.Automation.InvokePattern])).Invoke()
  $dlg = $null; for ($i = 0; $i -lt 20 -and -not $dlg; $i++) { Start-Sleep -Milliseconds 500; $dlg = Dialogs | Where-Object { $pre -notcontains $_.Current.NativeWindowHandle } | Select-Object -First 1 }
  if (-not $dlg) { throw 'folder picker did not appear' }
  DescribeDialog $dlg
  $box = $dlg.FindAll('Descendants', (New-Object $P($A::ControlTypeProperty, [System.Windows.Automation.ControlType]::Edit))) |
    Where-Object { $_.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$null) -and -not (Pat $_ ([System.Windows.Automation.ValuePattern])).Current.IsReadOnly } | Select-Object -Last 1
  if (-not $box) { throw 'folder picker: no writable path box (left open)' }
  (Pat $box ([System.Windows.Automation.ValuePattern])).SetValue($Folder)
  $btn = $null; foreach ($n in 'Select Folder', 'Choose', 'Sélectionner un dossier', 'OK') { $btn = Find $dlg $n 'Button'; if ($btn) { break } }
  if (-not $btn) { throw 'folder picker: no confirm button (left open)' }
  (Pat $btn ([System.Windows.Automation.InvokePattern])).Invoke(); Start-Sleep -Seconds 1
  "path field = '$($vp.Current.Value)'"
  if ((Norm $vp.Current.Value) -ne (Norm $Folder)) { throw 'path field did not take the folder' }
}
if ($Probe) { 'probe only: stopping before Import'; exit 0 }
$before = @(Dialogs | ForEach-Object { $_.Current.NativeWindowHandle })
$imp = Find $frame 'Import' 'Button'
(Pat $imp ([System.Windows.Automation.InvokePattern])).Invoke(); 'import invoked'
# Wait: acknowledge info/warning boxes (OK / Yes) while the import runs.
$deadline = (Get-Date).AddSeconds($TimeoutSec); $quiet = 0
while ((Get-Date) -lt $deadline) {
  Start-Sleep -Seconds 2
  $new = @(Dialogs | Where-Object { $before -notcontains $_.Current.NativeWindowHandle })
  if ($new.Count -eq 0) { $quiet++; if ($quiet -ge 8 -and (WE).Current.IsEnabled) { break }; continue }
  $quiet = 0
  foreach ($d in $new) {
    $desc = DescribeDialog $d; $desc
    if ($desc -match 'import(ed)? failed') { $script:importFailed = $true }
    $ok = $null; foreach ($n in 'OK', 'Ok', 'Yes', 'Import', 'Continue', 'Apply', 'Close') { $ok = Find $d $n 'Button'; if ($ok) { break } }
    if ($ok) { (Pat $ok ([System.Windows.Automation.InvokePattern])).Invoke(); "  -> $($ok.Current.Name)" }
    else { "  -> no OK button, leaving it"; $before += $d.Current.NativeWindowHandle }
  }
}
# late boxes (e.g. "Some surface masks were imported, however some were missing") can sit deep in the editor tree: sweep for them
# The "Surface mask import" result box (e.g. "some were missing") shows up late and is NOT a Window-type element:
# poll up to 30 s over every top window, any control type, by name, and click its OK.
for ($i = 0; $i -lt 15; $i++) {
  Start-Sleep -Seconds 2; $hit = $false
  foreach ($t in @(Tops)) {
    $late = @($t.FindAll('Descendants', (New-Object $P($A::NameProperty, 'Surface mask import'))))
    if ($t.Current.Name -eq 'Surface mask import') { $late += $t }
    foreach ($d in $late) {
      $ok = Find $d 'OK' 'Button'; if (-not $ok) { continue }
      $desc = DescribeDialog $d; $desc; if ($desc -match 'import(ed)? failed') { $script:importFailed = $true }
      (Pat $ok ([System.Windows.Automation.InvokePattern])).Invoke(); '  -> OK'; $hit = $true
    }
  }
  if ($hit) { break }
}
if ($script:importFailed) { 'IMPORT FAILED: see TERRAIN (E) lines in console.log (often "Too many layers" in a block)' } else { 'import finished' }
# Terrain Tool > Manage: "Fix block borders" (else no grass on Grass_01 blocks) then
# "Generate normal/vegetation map..." (lighting after the heights). Both buttons found by a UIA
# probe on 2026-11-20; boxes they open are acknowledged like the import ones.
function AckDialogs($sec) {
  $pre = $script:before; $end = (Get-Date).AddSeconds($sec); $q = 0
  while ((Get-Date) -lt $end) {
    Start-Sleep -Seconds 2
    $new = @(Dialogs | Where-Object { $pre -notcontains $_.Current.NativeWindowHandle })
    if ($new.Count -eq 0) { $q++; if ($q -ge 4 -and (WE).Current.IsEnabled) { break }; continue }
    $q = 0
    foreach ($d in $new) {
      DescribeDialog $d
      $ok = $null; foreach ($n in 'Generate', 'OK', 'Ok', 'Yes', 'Continue', 'Apply', 'Close') { $ok = Find $d $n 'Button'; if ($ok) { break } }
      if ($ok) { (Pat $ok ([System.Windows.Automation.InvokePattern])).Invoke(); "  -> $($ok.Current.Name)" }
      else { '  -> no OK button, leaving it'; $pre += $d.Current.NativeWindowHandle }
    }
  }
}
# 'Fix block borders' is OPT-IN (-TerrainFix): every save after it crashed the Workbench in
# nvtt::CubeSurface::toGamma (2026-11-21 x2, 2026-11-26 x2, even 11 min later on a quiet console, the save
# truncating MG_Test.ent and leaving the MG_* layers unsaved), while the same import without it then saved fine.
$fixButtons = @(if ($TerrainFix -and -not $NoTerrainFix) { 'Fix block borders' }) + @(if (-not $NoNormalMap) { 'Generate normal/vegetation map...' })
if ($fixButtons.Count -and -not $script:importFailed) {
  $mt = Find (WE) 'Manage' 'TabItem'
  if ($mt) {
    (Pat $mt ([System.Windows.Automation.SelectionItemPattern])).Select(); Start-Sleep -Milliseconds 700
    foreach ($bn in $fixButtons) {
      $b = Find (WE) $bn 'Button'
      if (-not $b) { "terrain fix: '$bn' not found, skipped"; continue }
      $script:before = @(Dialogs | ForEach-Object { $_.Current.NativeWindowHandle })
      (Pat $b ([System.Windows.Automation.InvokePattern])).Invoke(); "terrain fix: '$bn' invoked"
      AckDialogs 600
    }
    $pt = Find (WE) 'Paint' 'TabItem'; if ($pt) { (Pat $pt ([System.Windows.Automation.SelectionItemPattern])).Select() }
    # The normal/vegetation generation runs asynchronously: Ctrl+S during it crashed the Workbench
    # in nvtt (2026-11-20 13:45). Wait for 'Reimporting Done' in the live console.log before saving.
    # Only when it was launched: with -NoNormalMap nothing prints it (the old 6 min wait then skipped the save).
    if (-not $NoNormalMap) {
      $logDir = Get-ChildItem "$env:USERPROFILE\Documents\My Games\ArmaReforgerWorkbench\logs" -Directory | Sort-Object LastWriteTime -Descending | Select-Object -First 1
      $clog = Join-Path $logDir.FullName 'console.log'; $done = $false; $quiet = 0
      for ($i = 0; $i -lt 180 -and -not $done; $i++) {
        Start-Sleep -Seconds 2
        $tail = Get-Content $clog -Tail 400 -ErrorAction SilentlyContinue
        if ($tail -match 'Reimporting Done') { $done = $true }
        # 2026-11-26: the generation ran (and removed the tile-border strips) without printing 'Reimporting Done':
        # also accept 30 s without any progress dialog on screen as the end of the generation
        if ($i -ge 15 -and -not @(Dialogs | Where-Object { $_.Current.ClassName -match 'Progress' }).Count) { $quiet++ } else { $quiet = 0 }
        if ($quiet -ge 15) { $done = $true }
      }
      if ($done) { 'terrain fix: generation finished'; Start-Sleep -Seconds 5 } else { 'terrain fix: generation not confirmed after 6 min, save skipped'; $NoSave = $true }
    } else { 'terrain fix: normal map not generated (-NoNormalMap): expect straight strips on the 256 m tile borders until Manage > Generate normal/vegetation map is run' }
  } else { 'terrain fix: Manage tab not found, skipped' }
}
if (-not $NoSave) {
  # Ctrl+S right after a mask import crashed the Workbench in nvtt (2026-11-20 14:28) while it was still
  # re-encoding textures. 30 s of quiet console was not enough: the save right after the import + "Fix block
  # borders" crashed twice in nvtt::CubeSurface::toGamma (2026-11-21), a save ~10 min later worked.
  # So: console.log quiet for >= $QuietSec (max $QuietMaxSec of waiting), THEN a fixed $SaveDelaySec.
  $ld = Get-ChildItem "$env:USERPROFILE\Documents\My Games\ArmaReforgerWorkbench\logs" -Directory | Sort-Object LastWriteTime -Descending | Select-Object -First 1
  $cl = Join-Path $ld.FullName 'console.log'
  $qEnd = (Get-Date).AddSeconds($QuietMaxSec); $age = 0
  while ((Get-Date) -lt $qEnd) { $age = ((Get-Date) - (Get-Item $cl).LastWriteTime).TotalSeconds; if ($age -ge $QuietSec) { break }; Start-Sleep -Seconds 5 }
  if ($age -lt $QuietSec) { "console never quiet for $QuietSec s within $QuietMaxSec s: save skipped (save by hand later)"; exit 4 }
  "console quiet before save ($([int]$age) s), extra delay $SaveDelaySec s"
  Start-Sleep -Seconds $SaveDelaySec
  $wp0 = Get-Process -Id $wbpid -ErrorAction SilentlyContinue
  if (-not $wp0 -or (Get-Process -Name CrashReporter* -ErrorAction SilentlyContinue)) { 'WORKBENCH CRASHED before save'; exit 3 }
  # save through the NET API only (wb-save.mjs): no keyboard, no focus, no UIA Invoke (both crashed or stole focus)
  $saved = $false
  $lastErr = 'NET API save did not clear the * in the title'
  if (-not $saved) {
    node (Join-Path $PSScriptRoot 'wb-save.mjs')
    Start-Sleep -Seconds 6
    $wp = Get-Process -Id $wbpid -ErrorAction SilentlyContinue
    if (-not $wp -or (Get-Process -Name CrashReporter* -ErrorAction SilentlyContinue)) { 'WORKBENCH CRASHED during save'; exit 3 }
    $tt = $wp.MainWindowTitle; if ($tt.EndsWith('*')) { "SAVE FAILED: $lastErr" } else { "saved ($tt)" }
  }
  Start-Sleep -Seconds 3
  foreach ($d in @(Dialogs | Where-Object { $before -notcontains $_.Current.NativeWindowHandle })) { DescribeDialog $d }
  "title: $((Get-Process -Id $wbpid).MainWindowTitle)"
}

# Import terrain surface masks into the open World Editor world via UI Automation (no mouse, no keys
# except Ctrl+S fallback). Steps: Tools > Terrain Tool, Window > Current Tool, Paint tab, set the
# "Import/export masks from/to" path field (ValuePattern), Invoke Import, dismiss info dialogs, save.
param(
  [string]$Folder = "$env:USERPROFILE\Documents\My Games\ArmaReforgerWorkbench\profile\MapGen\masks\MG_Test",
  [int]$TimeoutSec = 300,
  [switch]$NoSave,
  [switch]$Probe
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$A = [System.Windows.Automation.AutomationElement]
$P = [System.Windows.Automation.PropertyCondition]
$wbpid = (Get-Process | Where-Object { $_.ProcessName -like 'ArmaReforgerWorkbench*' } | Select-Object -First 1).Id
if (-not $wbpid) { throw 'Workbench not running' }
function Tops { $A::RootElement.FindAll('Children', (New-Object $P($A::ProcessIdProperty, [int]$wbpid))) }
function WE { Tops | Where-Object { $_.Current.Name -match '^World Editor' } | Select-Object -First 1 }
function Find($root, $name, $type) {
  $root.FindAll('Descendants', (New-Object $P($A::NameProperty, $name))) |
    Where-Object { -not $type -or $_.Current.ControlType.ProgrammaticName -eq "ControlType.$type" } | Select-Object -First 1
}
function Pat($el, $pat) { $el.GetCurrentPattern($pat::Pattern) }
function MenuInvoke($menu, $item) {
  $mi = Find (WE) $menu 'MenuItem'; $ec = Pat $mi ([System.Windows.Automation.ExpandCollapsePattern])
  $ec.Expand(); Start-Sleep -Milliseconds 400
  $t = Find $mi $item 'MenuItem'; if (-not $t) { $ec.Collapse(); throw "menu item $menu > $item not found" }
  (Pat $t ([System.Windows.Automation.InvokePattern])).Invoke(); Start-Sleep -Milliseconds 400
  # Qt leaves the popup open after a UIA Invoke: close it explicitly.
  if ($ec.Current.ExpandCollapseState -ne 'Collapsed') { $ec.Collapse() }
  "menu: $menu > $item"
}
# Dialogs: any top-level of the pid other than the two main windows.
function Dialogs { Tops | Where-Object { $_.Current.Name -notmatch '^(World Editor - |Enfusion Workbench - )' } }
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
  if ($new.Count -eq 0) { $quiet++; if ($quiet -ge 3 -and (WE).Current.IsEnabled) { break }; continue }
  $quiet = 0
  foreach ($d in $new) {
    DescribeDialog $d
    $ok = $null; foreach ($n in 'OK', 'Ok', 'Yes', 'Close') { $ok = Find $d $n 'Button'; if ($ok) { break } }
    if ($ok) { (Pat $ok ([System.Windows.Automation.InvokePattern])).Invoke(); "  -> $($ok.Current.Name)" }
    else { "  -> no OK button, leaving it"; $before += $d.Current.NativeWindowHandle }
  }
}
'import finished'
if (-not $NoSave) {
  MenuInvoke 'File' 'Save World'
  Start-Sleep -Seconds 3
  foreach ($d in @(Dialogs | Where-Object { $before -notcontains $_.Current.NativeWindowHandle })) { DescribeDialog $d }
  "title: $((WE).Current.Name)"
}

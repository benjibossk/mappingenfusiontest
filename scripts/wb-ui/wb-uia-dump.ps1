# Dump the UI Automation tree of every top-level window of the Workbench process.
# Usage: wb-uia-dump.ps1 [-Filter regex] [-Depth 25] [-Window regex]
param([string]$Filter = '', [int]$Depth = 25, [string]$Window = '')
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$procs = Get-Process | Where-Object { $_.ProcessName -like 'ArmaReforgerWorkbench*' }
$pids = @($procs | ForEach-Object { $_.Id })
$root = [System.Windows.Automation.AutomationElement]::RootElement
$cond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ProcessIdProperty, [int]$pids[0])
$tops = $root.FindAll([System.Windows.Automation.TreeScope]::Children, $cond)
$walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
function Walk($el, $d, $path) {
  if ($d -gt $Depth) { return }
  $c = $el.Current
  $line = ('  ' * $d) + "[$($c.ControlType.ProgrammaticName -replace 'ControlType.','')] '$($c.Name)' id=$($c.AutomationId) cls=$($c.ClassName)"
  if (-not $Filter -or $line -match $Filter) { $line }
  $ch = $walker.GetFirstChild($el)
  while ($ch) { Walk $ch ($d + 1) $path; $ch = $walker.GetNextSibling($ch) }
}
foreach ($t in $tops) {
  if ($Window -and $t.Current.Name -notmatch $Window) { continue }
  "=== TOP '$($t.Current.Name)' hwnd=$($t.Current.NativeWindowHandle)"
  Walk $t 0 ''
}

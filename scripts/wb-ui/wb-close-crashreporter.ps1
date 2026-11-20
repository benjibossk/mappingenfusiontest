# Closes Bohemia's "Crash Reporter" window WITHOUT sending anything (WM_CLOSE = the Close button).
# Needed after a Workbench crash: the reporter keeps the dead Workbench's NET API port (5775) open,
# so a relaunched Workbench cannot bind it until the reporter is gone.
Add-Type @"
using System; using System.Text; using System.Runtime.InteropServices; using System.Collections.Generic;
public class CRW { public delegate bool CB(IntPtr h, IntPtr l);
[DllImport("user32.dll")] public static extern bool EnumWindows(CB cb, IntPtr l);
[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);
[DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
[DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
public static List<IntPtr> Of(uint pid){ var r=new List<IntPtr>(); EnumWindows((h,l)=>{uint p; GetWindowThreadProcessId(h,out p); if(p==pid) r.Add(h); return true;}, IntPtr.Zero); return r; } }
"@
$procs = @(Get-Process CrashReporter -ErrorAction SilentlyContinue)
if (-not $procs.Count) { 'no crash reporter'; exit 0 }
foreach ($p in $procs) {
  foreach ($h in [CRW]::Of([uint32]$p.Id)) {
    $sb = New-Object System.Text.StringBuilder 200; [CRW]::GetWindowText($h, $sb, 200) | Out-Null
    if ("$sb" -eq 'Crash Reporter') { [CRW]::PostMessage($h, 0x10, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null; "closed crash reporter $($p.Id) (nothing sent)" }
  }
}

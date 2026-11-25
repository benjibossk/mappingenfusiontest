# Launches a project's Workbench on ITS OWN NET API port, then checks the link reaches the right Workbench.
#   powershell -ExecutionPolicy Bypass -File scripts/wb-ui/wb-launch.ps1                (Mapgenerator, port 5777)
#   powershell -ExecutionPolicy Bypass -File scripts/wb-ui/wb-launch.ps1 -Gproj <addon.gproj> -Port 5778
# Why: the NET API port is a WORKBENCH option, global to the Windows user (registry
# HKCU\Software\Bohemia Interactive\Arma Reforger Workbench\Workbench, value NetAPI_Port, DWORD; absent = 5775),
# read only at startup. Two Workbenches on 5775 steal each other's link (2026-11-25: sends and a compile landed on
# F44_Core). So: write the port, start this Workbench, wait for it to listen, put the registry back to default so the
# other projects keep 5775, then prove the link with MG_Status (a function only the Mapgenerator addon has).
# 5776 is taken by the script debugger: do not use it. Never touches another project's Workbench.
param(
  [string]$Gproj = "$env:USERPROFILE\Documents\My Games\ArmaReforgerWorkbench\addons\Mapgenerator\addon.gproj",
  [int]$Port = $(if ($env:MAPGEN_WB_PORT) { [int]$env:MAPGEN_WB_PORT } else { 5777 }),
  [string]$Exe = 'D:\SteamLibrary\steamapps\common\Arma Reforger Tools\Workbench\ArmaReforgerWorkbenchSteamDiag.exe',
  [string]$GameDir = 'D:\SteamLibrary\steamapps\common\Arma Reforger',
  [string]$Probe = 'MG_Status'
)
$key = 'HKCU:\Software\Bohemia Interactive\Arma Reforger Workbench\Workbench'
$busy = netstat -ano | Select-String ":$Port .*LISTENING"
if ($busy) { Write-Output "port $Port already listening (a Workbench is already up there, nothing launched): testing the link"; $l = $busy }
else {
New-ItemProperty -Path $key -Name NetAPI_Port -Value $Port -PropertyType DWord -Force | Out-Null
try {
  $p = Start-Process $Exe -ArgumentList "-gproj `"$Gproj`" -wbModule WorldEditor" -WorkingDirectory $GameDir -PassThru
  Write-Output "launched PID $($p.Id) on port $Port"
  $t = 0
  do { Start-Sleep 5; $t += 5; $l = netstat -ano | Select-String ":$Port .*LISTENING" } until ($l -or $t -ge 300)
} finally {
  # back to the default (5775) for every other Workbench started later
  Remove-ItemProperty -Path $key -Name NetAPI_Port -ErrorAction SilentlyContinue
}
}
if (-not $l) { Write-Output "FAILED: nothing listens on $Port after $t s"; exit 1 }
# link test: same framing as bridge/server.mjs
$node = @"
const {Socket}=require('net');const p=s=>{const b=Buffer.from(s);const l=Buffer.alloc(4);l.writeInt32LE(b.length);return Buffer.concat([l,b])};
const v=Buffer.alloc(4);v.writeInt32LE(1);const s=new Socket(),c=[];setTimeout(()=>{console.log('LINK TIMEOUT');process.exit(1)},15000);
s.on('data',d=>c.push(d));s.on('error',e=>{console.log('LINK ERROR '+e.message);process.exit(1)});
s.on('close',()=>{const b=Buffer.concat(c);const n=b.readInt32LE(0);const st=b.toString('utf8',4,4+n);console.log(st==='Ok'?'LINK OK ($Probe answered: right Workbench)':'LINK WRONG WORKBENCH: '+st);process.exit(st==='Ok'?0:1)});
s.connect($Port,'127.0.0.1',()=>s.end(Buffer.concat([v,p('wb-launch'),p('JsonRPC'),p(JSON.stringify({APIFunc:'$Probe'}))])));
"@
node -e $node

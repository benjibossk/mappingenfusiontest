# Launches the Mapgenerator Workbench on ITS OWN NET API port and checks the link.
#   powershell -ExecutionPolicy Bypass -File scripts/wb-ui/wb-launch.ps1                (Mapgenerator, port 5777)
#   powershell -ExecutionPolicy Bypass -File scripts/wb-ui/wb-launch.ps1 -Gproj <addon.gproj> -Port 5778
# Delegates to the shared launcher C:\Users\benbo\tools\wb-launch\wb-launch.ps1 when present (port registry,
# cross-session lock, PID/cmdline check, blocking-dialog detection, -addonsDir fix). Otherwise falls back to a
# minimal local launch. Why a port per project: the NET API port is a global Workbench option (registry
# HKCU\Software\Bohemia Interactive\Arma Reforger Workbench\Workbench, NetAPI_Port, DWORD; absent = 5775), read
# only at startup; two Workbenches on 5775 steal each other's link. 5776 = script debugger.
param(
  [string]$Gproj = "$env:USERPROFILE\Documents\My Games\ArmaReforgerWorkbench\addons\Mapgenerator\addon.gproj",
  [int]$Port = $(if ($env:MAPGEN_WB_PORT) { [int]$env:MAPGEN_WB_PORT } else { 5777 }),
  [string]$Exe = 'D:\SteamLibrary\steamapps\common\Arma Reforger Tools\Workbench\ArmaReforgerWorkbenchSteamDiag.exe',
  [string]$GameDir = 'D:\SteamLibrary\steamapps\common\Arma Reforger',
  [string]$Probe = 'MG_Status',
  [string]$Shared = $(if ($env:WB_LAUNCH_PS1) { $env:WB_LAUNCH_PS1 } else { "$env:USERPROFILE\tools\wb-launch\wb-launch.ps1" })
)
if (Test-Path $Shared) {
  & powershell -NoProfile -ExecutionPolicy Bypass -File $Shared -Gproj $Gproj -Port $Port -Probe $Probe -Exe $Exe -GameDir $GameDir
  exit $LASTEXITCODE
}
Write-Output "shared launcher not found ($Shared): minimal local launch"
$key = 'HKCU:\Software\Bohemia Interactive\Arma Reforger Workbench\Workbench'
$busy = netstat -ano | Select-String ":$Port .*LISTENING"
if ($busy) { Write-Output "port $Port already listening: testing the link"; $l = $busy }
else {
  New-ItemProperty -Path $key -Name NetAPI_Port -Value $Port -PropertyType DWord -Force | Out-Null
  try {
    # cwd = game folder AND explicit -addonsDir, else "Missing Addon: can't find 58D0FB3206B6F859"
    $dirs = @("$GameDir\addons", "$env:USERPROFILE\Documents\My Games\ArmaReforger\addons") -join ','
    $p = Start-Process $Exe -ArgumentList "-gproj `"$Gproj`" -addonsDir `"$dirs`" -wbModule WorldEditor" -WorkingDirectory $GameDir -PassThru
    Write-Output "launched PID $($p.Id) on port $Port"
    $t = 0
    do { Start-Sleep 5; $t += 5; $l = netstat -ano | Select-String ":$Port .*LISTENING" } until ($l -or $t -ge 300 -or $p.HasExited)
  } finally { Remove-ItemProperty -Path $key -Name NetAPI_Port -ErrorAction SilentlyContinue }
}
if (-not $l) { Write-Output "FAILED: nothing listens on $Port (check for a blocking dialog, e.g. Missing Addon)"; exit 1 }
$node = @"
const {Socket}=require('net');const p=s=>{const b=Buffer.from(s);const l=Buffer.alloc(4);l.writeInt32LE(b.length);return Buffer.concat([l,b])};
const v=Buffer.alloc(4);v.writeInt32LE(1);const s=new Socket(),c=[];setTimeout(()=>{console.log('LINK TIMEOUT');process.exit(1)},15000);
s.on('data',d=>c.push(d));s.on('error',e=>{console.log('LINK ERROR '+e.message);process.exit(1)});
s.on('close',()=>{const b=Buffer.concat(c);const n=b.readInt32LE(0);const st=b.toString('utf8',4,4+n);console.log(st==='Ok'?'LINK OK ($Probe answered: right Workbench)':'LINK WRONG WORKBENCH: '+st);process.exit(st==='Ok'?0:1)});
s.connect($Port,'127.0.0.1',()=>s.end(Buffer.concat([v,p('wb-launch'),p('JsonRPC'),p(JSON.stringify({APIFunc:'$Probe'}))])));
"@
node -e $node

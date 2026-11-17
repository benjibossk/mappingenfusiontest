// builds library/mods/*.json from installed Workshop paks (read-only). usage: node modreg.js <outDir>
const pak=require('./pak.js'),fs=require('fs');const A='C:/Users/benbo/Documents/My Games/ArmaReforger/addons/';
const MI=require('../mods/idx.json'),BI=require('../xob/idx.json');const BD='D:/Program Files/Steam/steamapps/common/Arma Reforger/addons/data/';
const MODS=Object.keys(MI);
function rd(p,pref){p=p.toLowerCase();for(const m of [pref,...MODS]){const e=MI[m]&&MI[m][p];if(e)return pak.read(e.pak,e)}const e=BI[p];return e?pak.read(BD+e.pak,e):null}
function rdb(m){const b=fs.readFileSync(A+m+'/resourceDatabase.rdb');const out={};const re=/[\x20-\x7e]{5,}\x00/g;const s=b.toString('latin1');let k;
 while(k=re.exec(s)){const i=k.index,L=k[0].length;if(i<24||b.readUInt32LE(i-4)!==L)continue;if(i+L+14>b.length)continue;const g=Buffer.from(b.slice(i+L+6,i+L+14)).reverse().toString('hex').toUpperCase();out[k[0].slice(0,-1).toLowerCase()]=g}return out}
const xc={};function xob(p,m){if(p in xc)return xc[p];const b=rd(p,m);let r=null;
 if(b&&b.toString('latin1',8,12)=='XOB9'&&b.toString('latin1',12,16)=='HEAD'){const f=[];for(let i=0;i<6;i++)f.push(b.readFloatLE(24+4*i));if(f.every(Number.isFinite)&&f[3]>=f[0]&&f[4]>=f[1]&&f[5]>=f[2])r=f;}return xc[p]=r}
const ec={};function et(p,m,depth=0){const key=p.toLowerCase();if(key in ec)return ec[key];ec[key]=null;if(depth>20)return null;const b=rd(p,m);if(!b)return null;const t=b.toString('utf8');
 const ci=t.search(/^ children \{/m);const root=ci<0?t:t.slice(0,ci);
 const mm=root.match(/MeshObject [^\n]*\{\s*\n\s*Object "(?:\{[0-9A-F]+\})?([^"]+\.xob)"/);let r=null;if(mm)r=xob(mm[1],m);
 if(!r&&!mm){const par=t.match(/^\w+ : "(?:\{[0-9A-F]+\})?([^"]+\.et)"/);if(par)r=et(par[1],m,depth+1)}
 if(!r&&ci>=0){const ch=t.slice(ci);const re=/^  \w+ : "(?:\{[0-9A-F]+\})?([^"]+\.et)" \{([\s\S]*?)^  \}/gm;let k,u=null;
  while(k=re.exec(ch)){const c=et(k[1],m,depth+1);if(!c)continue;const co=k[2].match(/^   coords ([-\d.e]+) ([-\d.e]+) ([-\d.e]+)/m);const o=co?co.slice(1).map(Number):[0,0,0];
   const g=[c[0]+o[0],c[1]+o[1],c[2]+o[2],c[3]+o[0],c[4]+o[1],c[5]+o[2]];u=u?[Math.min(u[0],g[0]),Math.min(u[1],g[1]),Math.min(u[2],g[2]),Math.max(u[3],g[3]),Math.max(u[4],g[4]),Math.max(u[5],g[5])]:g}r=u}
 return ec[key]=r}
const SKIP=/(_dst|dst\.et|_base|\bbase\b|lod|ruin|debris|wreck|destroyed|\/ai\/|sounds?\/|particles?|gamemode|characters|weapons|editor\/|system\/|radio\/|wegenerators|generators|admintool|doesn't|not working|trigger|empty\.et|ghost|\/test|_test|managers?\/|scr_aiworld|ammo|pricesetter)/i;
const TAGS=[['house|home|residential|cottage|villa|flat','house'],['church|chapel|mosque|cultural|statue|monument','cultural'],['industr|factory|fabric|warehouse|hangar|silo|plant|tank','industrial'],['farm|agricult|barn|stable','agriculture'],['military|bunker|barrack|trench|sandbag','military'],['airport|runway|hangar','airport'],['bridge|tunnel|rail|train|road|dam|powerline|pole|infrastructure','infrastructure'],['shop|store|commercial|market|kiosk','commercial'],['wall|fence|gate','wall'],['rock|stone','rock'],['tree|bush|vegetation','vegetation'],['dam\b|dam_|dam\/|weir|sluice','dam']];
const outDir=process.argv[2];fs.mkdirSync(outDir,{recursive:true});const index={version:1,generated:new Date().toISOString().slice(0,10),mods:[]};
for(const m of MODS){const G=m.split('_').pop();const gp=fs.readFileSync(A+m+'/addon.gproj','utf8');const meta=JSON.parse(fs.readFileSync(A+m+'/meta','utf8').replace(/^\uFEFF/,'')).meta;
 const deps=((gp.match(/Dependencies \{([^}]*)\}/)||[])[1]||'').match(/[0-9A-F]{16}/g)||[];const ver=(meta.versions&&meta.versions[0]&&meta.versions[0].version)||'';
 const guids=rdb(m);const fam={};const rows=[];let thumbs=0;
 for(const k in MI[m]){const e=MI[m][k];if(!/^prefabs\/.*\.et$/.test(k)||SKIP.test(k))continue;const r=et(e.path,m);if(!r)continue;
  const f=x=>Math.round(x*100)/100;const d=[f(r[3]-r[0]),f(r[5]-r[2]),f(r[4]-r[1]),f((r[0]+r[3])/2),f((r[2]+r[5])/2)];if(!(d[0]>0.05&&d[1]>0.05))continue;
  const p=e.path.replace(/^Prefabs\//,'');const seg=p.split('/');const c=seg.length>2?seg[0]+'/'+seg[1]:seg[0];const mx=Math.max(d[0],d[1]);
  const t=TAGS.filter(([re])=>new RegExp(re,'i').test(p)).map(x=>x[1]);const row={p,c,s:mx<3?'S':mx<15?'M':'L',t,d};const g=guids[k];if(g)row.g=g;
  const name=seg[seg.length-1].replace(/\.et$/,'').toLowerCase();if(Object.keys(MI[m]).some(q=>q.includes('editorpreviews')&&q.includes(name))){row.thumb=true;thumbs++}
  rows.push(row);fam[c]=(fam[c]||0)+1}
 rows.sort((a,b)=>a.p.localeCompare(b.p));const id=meta.name.replace(/[^A-Za-z0-9]+/g,'');const file=`${id}_${G}.json`;
 fs.writeFileSync(outDir+'/'+file,JSON.stringify({version:1,mod:meta.name,guid:G,modVersion:ver,dependencies:deps,source:'Workshop pak metadata only (paths, GUIDs, mesh bbox); no assets copied',prefabs:rows},null,0).replace(/\},\{"p"/g,'},\r\n{"p"'));
 index.mods.push({id,name:meta.name,guid:G,version:ver,file,dependencies:deps,licence:meta.license||meta.licence||null,count:rows.length,withGuid:rows.filter(r=>r.g).length,families:fam});console.log(m,rows.length,rows.filter(r=>r.g).length,thumbs)}
fs.writeFileSync(outDir+'/index.json',JSON.stringify(index,null,1).replace(/\n/g,'\r\n'));

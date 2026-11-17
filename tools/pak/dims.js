const pak=require('./pak.js'),fs=require('fs');const I=require('../xob/idx.json');const D='D:/Program Files/Steam/steamapps/common/Arma Reforger/addons/data/';
const rd=p=>{const e=I[p.toLowerCase()];return e?pak.read(D+e.pak,e):null};
const xc={};function xob(p){if(p in xc)return xc[p];const b=rd(p);let r=null;
 if(b&&b.toString('latin1',8,12)=='XOB9'&&b.toString('latin1',12,16)=='HEAD'){const f=[];for(let i=0;i<6;i++)f.push(b.readFloatLE(24+4*i));if(f.every(Number.isFinite)&&f[3]>=f[0]&&f[4]>=f[1]&&f[5]>=f[2])r=f;}
 return xc[p]=r;}
const ec={};function et(p,depth=0){p=p.toLowerCase();if(p in ec)return ec[p];ec[p]=null;if(depth>20)return null;const b=rd(p);if(!b)return null;const t=b.toString('utf8');
 const ci=t.search(/^ children \{/m);const root=ci<0?t:t.slice(0,ci);
 const m=root.match(/MeshObject [^\n]*\{\s*\n\s*Object "(?:\{[0-9A-F]+\})?([^"]+\.xob)"/);let r=null;
 if(m)r=xob(m[1]);
 if(!r){const par=t.match(/^\w+ : "(?:\{[0-9A-F]+\})?([^"]+\.et)"/);if(par&&!m)r=et(par[1],depth+1);}
 if(!r&&ci>=0){const ch=t.slice(ci);const re=/^  \w+ : "(?:\{[0-9A-F]+\})?([^"]+\.et)" \{([\s\S]*?)^  \}/gm;let k,u=null;
  while(k=re.exec(ch)){const c=et(k[1],depth+1);if(!c)continue;const co=k[2].match(/^   coords ([-\d.e]+) ([-\d.e]+) ([-\d.e]+)/m);const o=co?co.slice(1).map(Number):[0,0,0];
   const g=[c[0]+o[0],c[1]+o[1],c[2]+o[2],c[3]+o[0],c[4]+o[1],c[5]+o[2]];u=u?[Math.min(u[0],g[0]),Math.min(u[1],g[1]),Math.min(u[2],g[2]),Math.max(u[3],g[3]),Math.max(u[4],g[4]),Math.max(u[5],g[5])]:g;}
  r=u;}
 return ec[p]=r;}
module.exports={et,xob};
if(require.main===module){const F=process.argv[2];const src=fs.readFileSync(F,'utf8');let n=0,h=0;
 const out=src.replace(/\{"p":"([^"]+)"[^{}]*\}/g,(line,p)=>{n++;line=line.replace(/,"d":\[[^\]]*\]/,'');const r=et('Prefabs/'+p);if(!r)return line;h++;
  const f=x=>Math.round(x*100)/100;const d=[f(r[3]-r[0]),f(r[5]-r[2]),f(r[4]-r[1]),f((r[0]+r[3])/2),f((r[2]+r[5])/2)];return line.replace(/\}$/,',"d":'+JSON.stringify(d)+'}');});
 fs.writeFileSync(process.argv[3]||F,out);console.log(n,h);}

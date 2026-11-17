// node ancestors.js <paksDir> <thumbsDir>  : thumbs for base prefabs via PrefabsEditable inheritance + m_Image
const fs=require('fs'),path=require('path'),{list,read}=require('./pak.js');
const [D,T]=process.argv.slice(2);
const C='C:/Users/benbo/Documents/Projets/reforger-mapper/library/prefabs-catalogue.json';const cat=JSON.parse(fs.readFileSync(C));
const byG={};for(const e of cat.prefabs)if(e.g)byG[e.g.toUpperCase()]=e;
const ets={};// guid->{parent,img,path}
for(const fn of fs.readdirSync(D).filter(x=>x.endsWith('.pak')))for(const e of list(D+'/'+fn)){if(!/\.et$/i.test(e.path)||!/^Prefabs(Editable)?\//i.test(e.path))continue;
 let txt;try{txt=read(D+'/'+fn,e).toString('utf8');}catch(_){continue}
 const h=txt.match(/^\s*\w+\s*:\s*"\{([0-9A-F]{16})\}/m);const id=txt.match(/ID "([0-9A-F]{16})"/);
 const img=txt.match(/m_Image "\{[0-9A-F]{16}\}UI\/Textures\/EditorPreviews\/([^"]+)\.edds"/i);
 ets[e.path]={parent:h&&h[1],img:img&&img[1]};}
// meta guids: map path->guid via catalogue for base; for editable we only need parent chain on base prefabs
const pathByG={};for(const e of cat.prefabs)if(e.g)pathByG[e.g.toUpperCase()]='Prefabs/'+e.p;
const etByPath={};for(const [p,v] of Object.entries(ets))etByPath[p.toLowerCase()]=v;
const pngs=new Set();(function w(d,r){for(const f of fs.readdirSync(d)){const p=d+'/'+f;if(fs.statSync(p).isDirectory())w(p,r+f+'/');else pngs.add((r+f).toLowerCase());}})(T+'/png','');
const pngReal={};(function w(d,r){for(const f of fs.readdirSync(d)){const p=d+'/'+f;if(fs.statSync(p).isDirectory())w(p,r+f+'/');else pngReal[(r+f).toLowerCase()]=r+f;}})(T+'/png','');
let added=0,cand=0;const out=T+'/byprefab';
for(const [p,v] of Object.entries(ets)){if(!v.img||!/^PrefabsEditable/i.test(p))continue;
 let rel=v.img.replace(/^Auto\//i,'')+'.png';let real=pngReal[rel.toLowerCase()]||pngReal[v.img.toLowerCase()+'.png'];if(!real)continue;
 // walk ancestors to first catalogue prefab
 let g=v.parent,hops=0;while(g&&hops<6){const e=byG[g.toUpperCase()];if(e){cand++;const n=e.p.replace(/\.et$/,'').replace(/\//g,'__')+'.png';if(!e.thumb&&!fs.existsSync(out+'/'+n)){fs.copyFileSync(T+'/png/'+real,out+'/'+n);e.thumb=true;e.thumbFrom='editable';added++;}break;}
  const pp=pathByG[g.toUpperCase()];const nx=pp&&etByPath[pp.toLowerCase()];g=nx&&nx.parent;hops++;}}
cat.counts.withThumb=cat.prefabs.filter(e=>e.thumb).length;fs.writeFileSync(C,JSON.stringify(cat));
fs.writeFileSync(process.argv[4]||T+'/../prefabshots/prefab-list-missing.txt',cat.prefabs.filter(e=>!e.thumb).map(e=>e.p).join('\n')+'\n');
console.log({ets:Object.keys(ets).length,cand,added,withThumb:cat.counts.withThumb});

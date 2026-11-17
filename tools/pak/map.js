const fs=require('fs'),path=require('path');const T=process.argv[2];
const C='C:/Users/benbo/Documents/Projets/reforger-mapper/library/prefabs-catalogue.json';const cat=JSON.parse(fs.readFileSync(C));
const pngs=[];(function w(d){for(const f of fs.readdirSync(d)){const p=d+'/'+f;if(fs.statSync(p).isDirectory())w(p);else pngs.push(path.relative(T+"/png",p).split(path.sep).join("/"));}})(T+'/png');
const byFull={},byBase={};for(const r of pngs){const b=path.basename(r,'.png').replace(/^E_/,'').toLowerCase();const full=path.dirname(r).toLowerCase()+'/'+b;byFull[full]=r;(byBase[b]=byBase[b]||[]).push(r);}
let hit=0,hitE=0,nE=0;const missing=[],fam={};fs.mkdirSync(T+'/byprefab',{recursive:true});const used=new Set();
for(const e of cat.prefabs){const b=path.basename(e.p,'.et').toLowerCase();const full=path.dirname(e.p).toLowerCase()+'/'+b;
 let r=byFull[full]||(byBase[b]&&byBase[b].length==1?byBase[b][0]:null);if(e.e)nE++;
 if(r){hit++;if(e.e)hitE++;e.thumb=true;used.add(r);const n=e.p.replace(/\.et$/,'').replace(/\//g,'__')+'.png';fs.copyFileSync(T+'/png/'+r,T+'/byprefab/'+n);(fam[e.c]=fam[e.c]||[]).push([n,path.basename(e.p,'.et')]);}
 else{delete e.thumb;missing.push(e.p);}}
cat.legend.thumb='true if an EditorPreviews thumbnail was extracted (see docs Miniatures)';cat.counts.withThumb=hit;
fs.writeFileSync(C,JSON.stringify(cat));
fs.writeFileSync(process.argv[3],missing.join('\n')+'\n');
// contact sheets
const sh=T+'/sheets';fs.mkdirSync(sh,{recursive:true});const idx=[];
for(const f of Object.keys(fam).sort()){const L=fam[f];for(let i=0;i*48<L.length;i++){const nm=f.replace(/\//g,'_')+'_'+(i+1)+'.html';idx.push([nm,f,L.length]);
 fs.writeFileSync(sh+'/'+nm,`<!doctype html><meta charset=utf-8><title>${f} ${i+1}</title><style>body{background:#333;color:#eee;font:11px sans-serif;margin:8px}h1{font-size:16px}.g{display:grid;grid-template-columns:repeat(8,200px);gap:4px}.c{background:#555;text-align:center;overflow-wrap:anywhere}img{width:200px;height:150px;object-fit:contain;display:block}</style><h1>${f} — page ${i+1} (${L.length})</h1><div class=g>`+L.slice(i*48,i*48+48).map(([n,l])=>`<div class=c><img src="../byprefab/${n}"><div>${l}</div></div>`).join('')+'</div>');}}
fs.writeFileSync(sh+'/index.html','<!doctype html><meta charset=utf-8><title>Sheets</title><ul>'+idx.map(([n,f,c])=>`<li><a href="${n}">${n}</a> (${c})`).join('')+'</ul>');
console.log({catalogue:cat.prefabs.length,hit,nE,hitE,previews:pngs.length,unusedPreviews:pngs.length-used.size,sheets:idx.length});
console.log(Object.entries(fam).map(([k,v])=>k+':'+v.length).join(' '));

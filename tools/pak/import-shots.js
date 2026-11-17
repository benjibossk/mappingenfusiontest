// node import-shots.js [dossier_sortie_generateur]
// 1) convertit les captures (BMP/PNG) en PNG 200x150 dans thumbs/byprefab (nom = chemin prefab sans Prefabs/, / -> __)
// 2) marque thumb=true dans le catalogue reforger-mapper, regenere prefab-list-missing.txt
// 3) regenere les planches contact thumbs/sheets (toutes les miniatures, vanilla + generees)
const fs=require('fs'),path=require('path'),{execFileSync}=require('child_process');
const S=path.resolve(__dirname,'..'),T=S+'/thumbs',B=T+'/byprefab';
const OUT=process.argv[2]||path.join(process.env.USERPROFILE,'Documents/My Games/ArmaReforgerWorkbench/profile/prefabshots/out');
const C='C:/Users/benbo/Documents/Projets/reforger-mapper/library/prefabs-catalogue.json';
if(fs.existsSync(OUT))execFileSync('python',[__dirname+'/shrink.py',OUT,B],{stdio:'inherit'});else console.log('pas de dossier',OUT,'(on regenere juste les planches)');
const have=new Set(fs.readdirSync(B));const cat=JSON.parse(fs.readFileSync(C));const fam={};let n=0;
for(const e of cat.prefabs){const f=e.p.replace(/\.et$/,'').replace(/\//g,'__')+'.png';
 if(have.has(f)){if(!e.thumb){e.thumb=true;e.thumbFrom='generated';}n++;(fam[e.c]=fam[e.c]||[]).push([f,path.basename(e.p,'.et')]);}}
cat.counts.withThumb=n;fs.writeFileSync(C,JSON.stringify(cat));
fs.writeFileSync(S+'/prefabshots/prefab-list-missing.txt',cat.prefabs.filter(e=>!e.thumb).map(e=>e.p).join('\n')+'\n');
const sh=T+'/sheets';fs.rmSync(sh,{recursive:true,force:true});fs.mkdirSync(sh,{recursive:true});const idx=[];
for(const f of Object.keys(fam).sort()){const L=fam[f];for(let i=0;i*48<L.length;i++){const nm=f.replace(/\//g,'_')+'_'+(i+1)+'.html';idx.push([nm,f,L.length]);
 fs.writeFileSync(sh+'/'+nm,`<!doctype html><meta charset=utf-8><title>${f} ${i+1}</title><style>body{background:#333;color:#eee;font:11px sans-serif;margin:8px}h1{font-size:16px}.g{display:grid;grid-template-columns:repeat(8,200px);gap:4px}.c{background:#555;text-align:center;overflow-wrap:anywhere}img{width:200px;height:150px;object-fit:contain;display:block}</style><h1>${f} — page ${i+1} (${L.length})</h1><div class=g>`+L.slice(i*48,i*48+48).map(([a,l])=>`<div class=c><img src="../byprefab/${a}"><div>${l}</div></div>`).join('')+'</div>');}}
fs.writeFileSync(sh+'/index.html','<!doctype html><meta charset=utf-8><title>Sheets</title><ul>'+idx.map(([a,f,c])=>`<li><a href="${a}">${a}</a> (${c})`).join('')+'</ul>');
console.log({avecMiniature:n,total:cat.prefabs.length,manquants:cat.prefabs.length-n,planches:idx.length});

const fs=require('fs'),path=require('path'),P=require('./pak.js');
const D='D:/Program Files/Steam/steamapps/common/Arma Reforger/addons/data/';
const OUT=process.argv[2];
function lz4(src,o,end,total){const out=Buffer.alloc(total);let op=0;
 while(o<end){let bs=src.readUInt32LE(o);o+=4;const last=bs&0x80000000;bs&=0x7fffffff;const be=o+bs;
  while(o<be){const tok=src[o++];let ll=tok>>4;if(ll==15){let x;do{x=src[o++];ll+=x}while(x==255)}
   src.copy(out,op,o,o+ll);op+=ll;o+=ll;if(o>=be)break;
   const off=src.readUInt16LE(o);o+=2;let ml=tok&15;if(ml==15){let x;do{x=src[o++];ml+=x}while(x==255)}ml+=4;
   for(let k=0;k<ml;k++){out[op]=out[op-off];op++;}}
  if(last)break;}
 if(op!=total)throw new Error('lz4 size '+op+'/'+total);return out;}
const ix=JSON.parse(fs.readFileSync(process.argv[3]));let ok=0,bad=[];const fmts={};
for(const e of ix){try{const b=P.read(D+e.pak,e);if(b.toString('ascii',0,4)!='DDS ')throw 'nodds';
 let hl=128;const dx10=b.toString('ascii',84,88)=='DX10';if(dx10)hl+=20;const fmt=dx10?b.readUInt32LE(128):b.toString('ascii',84,88);fmts[fmt]=(fmts[fmt]||0)+1;
 const mips=Math.max(1,b.readUInt32LE(28));let o=hl;const tags=[];for(let k=0;k<mips;k++){tags.push([b.toString('ascii',o,o+4),b.readUInt32LE(o+4)]);o+=8;}
 let mip;for(const [t,s] of tags){if(tags.indexOf(tags.find(x=>x))>=0){} const last=(t===tags[tags.length-1][0]&&s===tags[tags.length-1][1]);
  if([t,s]===tags[tags.length-1]||tags.indexOf(tags.find(q=>q[0]==t&&q[1]==s))<0){} 
  o+=0;}
 // data offsets
 let p=hl+mips*8;for(let k=0;k<mips-1;k++)p+=tags[k][1];const [t,s]=tags[mips-1];
 if(t=='COPY')mip=b.slice(p,p+s);else if(t=='LZ4 ')mip=lz4(b,p+4,p+s,b.readUInt32LE(p));else throw 'tag '+t;
 const h=Buffer.from(b.slice(0,hl));if(dx10&&fmt==72)h.writeUInt32LE(71,128);if(dx10&&fmt==91)h.writeUInt32LE(87,128);h.writeUInt32LE(1,28);h.writeUInt32LE(h.readUInt32LE(8)&~0x20000,8);h.writeUInt32LE(mip.length,20);
 const rel=e.path.replace(/^UI\/Textures\/EditorPreviews\/Auto\//,'').replace(/\.edds$/,'.dds');const f=path.join(OUT,rel);fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,Buffer.concat([h,mip]));ok++;}catch(err){bad.push(e.path+' '+err);}}
console.log(ok,bad.length,fmts);fs.writeFileSync(OUT+'/../dds_errors.txt',bad.join('\n'));

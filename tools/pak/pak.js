const fs=require('fs'),zlib=require('zlib');
function list(p){const f=fs.openSync(p,'r');const b=Buffer.alloc(8);fs.readSync(f,b,0,8,0x34);const dl=b.readUInt32BE(0);
let off=0x30+8+dl;fs.readSync(f,b,0,8,off);const n=b.readUInt32BE(4);const t=Buffer.alloc(n);fs.readSync(f,t,0,n,off+8);
let i=0,out=[];function node(pre){const ty=t[i++],l=t[i++],nm=t.toString('utf8',i,i+l);i+=l;
 if(ty==0){const c=t.readUInt32LE(i);i+=4;const pp=pre+(nm?nm+'/':'');for(let k=0;k<c;k++)node(pp);}
 else{const o=t.readUInt32LE(i),cs=t.readUInt32LE(i+4),s=t.readUInt32LE(i+8),fl=t.readUInt16LE(i+16);i+=24;out.push({path:pre+nm,o,cs,s,fl});}}
node('');fs.closeSync(f);return out;}
function read(p,e){const f=fs.openSync(p,'r');const b=Buffer.alloc(e.cs);fs.readSync(f,b,0,e.cs,e.o);fs.closeSync(f);return e.cs!=e.s?zlib.inflateSync(b):b;}
module.exports={list,read};
if(require.main===module){const D=process.argv[2];const res=[];for(const fn of fs.readdirSync(D).filter(x=>x.endsWith('.pak'))){for(const e of list(D+'/'+fn))if(/EditorPreviews/i.test(e.path))res.push({pak:fn,...e});}
fs.writeFileSync(process.argv[3],JSON.stringify(res));console.log(res.length);const fl={};res.forEach(r=>fl[r.fl]=(fl[r.fl]||0)+1);console.log(fl,res.slice(0,3));}

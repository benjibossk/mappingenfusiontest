const fs=require('fs');const f=fs.openSync(process.argv[2],'r');
const b=Buffer.alloc(16);fs.readSync(f,b,0,16,0x30);const dl=b.readUInt32BE(4);
let off=0x30+8+dl;fs.readSync(f,b,0,8,off);console.log(b.toString('ascii',0,4),b.readUInt32BE(4));
const n=b.readUInt32BE(4);const t=Buffer.alloc(n);fs.readSync(f,t,0,n,off+8);console.log(t.slice(0,160).toString('hex'));console.log(t.slice(0,160).toString('latin1'));

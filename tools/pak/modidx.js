const pak=require('./pak.js'),fs=require('fs');const A='C:/Users/benbo/Documents/My Games/ArmaReforger/addons/';
const out={};for(const m of process.argv.slice(3)){const D=A+m+'/';const idx={};for(const fn of fs.readdirSync(D).filter(x=>/\.pak$/.test(x)))for(const e of pak.list(D+fn))if(/\.(et|xob|meta|edds)$/i.test(e.path))idx[e.path.toLowerCase()]={pak:D+fn,...e,path:e.path};out[m]=idx;console.log(m,Object.keys(idx).length);}
fs.writeFileSync(process.argv[2],JSON.stringify(out));

const pak=require('./pak.js'),fs=require('fs');const D='D:/Program Files/Steam/steamapps/common/Arma Reforger/addons/data/';
const idx={};for(const fn of fs.readdirSync(D).filter(x=>/^data.*\.pak$/.test(x)))for(const e of pak.list(D+fn)){if(/\.(et|xob|meta)$/i.test(e.path))idx[e.path.toLowerCase()]={pak:fn,...e,path:e.path};}
fs.writeFileSync(process.argv[2],JSON.stringify(idx));console.log(Object.keys(idx).length);

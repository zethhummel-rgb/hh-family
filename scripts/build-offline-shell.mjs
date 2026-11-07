import fs from 'node:fs';
const assets=fs.readdirSync('dist/assets').filter(file=>/\.(js|css)$/.test(file)).sort().map(file=>'assets/'+file);
const files=['index.html','icon.svg','favicon.svg','manifest.webmanifest','icons/hh-180.png','icons/hh-192.png','icons/hh-512.png',...assets];
const {createHash}=await import('node:crypto');
const hash=createHash('sha256');
for(const file of files)hash.update(fs.readFileSync('dist/'+file));
const version=hash.digest('hex').slice(0,16);
const worker=fs.readFileSync('dist/sw.js','utf8').replace("/* shopping-shell */ {version:'dev',files:[]}",JSON.stringify({version,files}));
fs.writeFileSync('dist/sw.js',worker);

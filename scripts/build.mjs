import { readdir, readFile, mkdir, writeFile, copyFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { marker, siteVersion } from './build-version.mjs';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
const root = new URL('../', import.meta.url);
const file = (rel) => new URL(rel,root);
const types = {html:'text/html; charset=utf-8', css:'text/css; charset=utf-8',js:'text/javascript; charset=utf-8',svg:'image/svg+xml',png:'image/png',json:'application/json; charset=utf-8',txt:'text/plain; charset=utf-8',traineddata:'application/octet-stream'};
const sourceDir='client/';
const assets={};
const version=await siteVersion(root);
async function addAsset(fileName) {
  const type=types[fileName.split('.').at(-1)] || (fileName==='ocr-vendor/SHA256SUMS'?'text/plain; charset=utf-8':null);
  if(!type||!fileName.split('/').every(part=>/^[\w.-]+$/.test(part)&&!part.startsWith('.')))return;
  let content=await readFile(file(sourceDir+fileName));
  if(fileName==='index.html')content=Buffer.from(content.toString('utf8').replace(marker,version));
  const zip=type==='image/png'?content:gzipSync(content,{level:9});
  const encoding=zip!==content&&zip.length<content.length?'gzip':'identity';
  assets['/'+fileName]=[type,encoding,(encoding==='gzip'?zip:content).toString('base64')];
}
for(const item of (await readdir(file(sourceDir),{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name,'en'))){
  if(item.isFile())await addAsset(item.name);
}
for(const folder of ['ocr-vendor/','ocr-vendor/core/','ocr-vendor/lang/']){
  for(const item of (await readdir(file(sourceDir+folder),{withFileTypes:true})).filter(x=>x.isFile()).map(x=>x.name).sort()){
    await addAsset(folder+item);
  }
}
assets['/build-version.json']=['application/json; charset=utf-8','identity',Buffer.from(JSON.stringify({version})).toString('base64')];
for(const needed of ['index.html','app.js','krv-full.js','style.css'])if(!assets['/'+needed])throw new Error('missing asset '+needed);
const server=await readFile(file('worker/sync.mjs'),'utf8')+'\nconst assets = '+JSON.stringify(assets)+';\n'+await readFile(file('worker/serve.mjs'),'utf8');
await mkdir(file('dist/server/'),{recursive:true});
await mkdir(file('dist/.openai/'),{recursive:true});
await build({
  stdin:{contents:server,resolveDir:fileURLToPath(file('worker/')),sourcefile:'entry.mjs',loader:'js'},
  outfile:fileURLToPath(file('dist/server/index.js')),bundle:true,format:'esm',platform:'browser',target:'es2022',minify:false
});
try {
  await copyFile(file('.openai/hosting.json'),file('dist/.openai/hosting.json'));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
console.log(Object.keys(assets).length+' private assets packaged; '+Buffer.byteLength(server)+' bytes');

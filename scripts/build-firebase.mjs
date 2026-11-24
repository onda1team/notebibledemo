import {cp, mkdir, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {marker} from './build-version.mjs';

const root=new URL('../',import.meta.url);
const file=path=>new URL(path,root);
const output=file('dist/firebase/');
await rm(output,{recursive:true,force:true});
await mkdir(output,{recursive:true});
await cp(file('client/'),output,{recursive:true});
await build({
  entryPoints:[fileURLToPath(file('client/firebase-sync.js'))],
  outfile:fileURLToPath(new URL('firebase-sync.js',output)),
  bundle:true,format:'iife',platform:'browser',target:'es2022',minify:true,
  legalComments:'linked'
});
let html=await readFile(new URL('index.html',output),'utf8');
const syncScript='<script defer src="sync.js"></script>';
if(!html.includes(syncScript))throw new Error('The Firebase build requires the sync.js script marker.');
html=html.replace(syncScript,'<script defer src="firebase-sync.js"></script>')
  .replaceAll('현재 로그인한 ChatGPT 계정에만 저장합니다. 다른 기기에서도 같은 계정으로 이 체험판을 열어주세요.',
    '현재 로그인한 Google 계정에만 저장합니다. 다른 기기에서도 같은 Google 계정으로 열어주세요.');
await writeFile(new URL('index.html',output),html);
const hash=createHash('sha256');
async function fingerprint(dir,prefix=''){
  for(const entry of (await readdir(dir,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name,'en'))){
    const path=prefix+entry.name;
    if(entry.isDirectory())await fingerprint(new URL(entry.name+'/',dir),path+'/');
    else hash.update(path+'\0').update(await readFile(new URL(entry.name,dir))).update('\0');
  }
}
await fingerprint(output);
const version=hash.digest('hex');
await writeFile(new URL('index.html',output),html.replace(marker,version));
await writeFile(new URL('build-version.json',output),JSON.stringify({version}));
console.log(`Firebase Hosting build: dist/firebase (${version.slice(0,12)})`);

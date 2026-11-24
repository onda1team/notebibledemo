import {createHash} from 'node:crypto';
import {readdir,readFile} from 'node:fs/promises';
export const marker='__YEO_BUILD_VERSION__';
export async function siteVersion(root){
  const h=createHash('sha256');
  for(const folder of ['client','client/ocr-vendor','client/ocr-vendor/core','client/ocr-vendor/lang','worker','drizzle']){
    const base=new URL(folder+'/',root);
    for(const name of (await readdir(base,{withFileTypes:true})).filter(x=>x.isFile()).map(x=>x.name).sort()){
      h.update(folder+'/'+name+'\0');h.update(await readFile(new URL(name,base)));h.update('\0');
    }
  }
  for(const file of ['.openai/hosting.json','scripts/build.mjs','scripts/build-version.mjs']){
    let content;
    try { content=await readFile(new URL(file,root)); }
    catch(error){ if(file==='.openai/hosting.json'&&error.code==='ENOENT')continue; throw error; }
    h.update(file+'\0').update(content).update('\0');
  }
  return h.digest('hex');
}

// Local managed preview only. This file is not in the hosted artifact.
import {createServer} from 'node:http';
import {Readable} from 'node:stream';
import {DatabaseSync} from 'node:sqlite';
import {readFile,readdir} from 'node:fs/promises';
import {handleAuth,getIdentity} from '../worker/google-auth.mjs';
import {handleSync} from '../worker/sync.mjs';
import {sameOriginHeaders} from '../worker/serve.mjs';
import {marker,siteVersion} from './build-version.mjs';
const mock=new DatabaseSync(':memory:');
for(const name of (await readdir(new URL('../drizzle/',import.meta.url))).filter(n=>n.endsWith('.sql')).sort())mock.exec(await readFile(new URL('../drizzle/'+name,import.meta.url),'utf8'));
const db={prepare(query){const stmt=mock.prepare(query);return {bind(...args){return {first:async()=>stmt.get(...args),all:async()=>({results:stmt.all(...args)})}}};}};
const mime={js:'text/javascript; charset=utf-8',css:'text/css; charset=utf-8',html:'text/html; charset=utf-8',png:'image/png',svg:'image/svg+xml',txt:'text/plain; charset=utf-8',json:'application/json; charset=utf-8',traineddata:'application/octet-stream'};
const folder='../client/';
const server=createServer(async(req,res)=>{
 try{
  const base=req.headers.origin||'http://'+req.headers.host;
  const url=new URL(req.url,base);
  if(url.pathname.startsWith('/api/sync/')||url.pathname.startsWith('/api/auth/')){
   const headers=new Headers(req.headers);
   headers.set('oai-authenticated-user-id','local-preview-test-only');
   const hasBody=!['GET','HEAD'].includes(req.method);
   const request=new Request(url,{method:req.method,headers,...(hasBody?{body:Readable.toWeb(req),duplex:'half'}:{})});
   const env={DB:db,TRUST_SITES_IDENTITY:'1'};
   const result=url.pathname.startsWith('/api/auth/')?await handleAuth(request,env):await handleSync(request,db);
   res.writeHead(result.status,Object.fromEntries(result.headers));
   return res.end(Buffer.from(await result.arrayBuffer()));
  }
  if(!['GET','HEAD'].includes(req.method))return res.writeHead(405).end();
  if(url.pathname==='/build-version.json'){
   res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');
   return res.end(req.method==='GET'?JSON.stringify({version:await siteVersion(new URL('../',import.meta.url))}):undefined);
  }
  const file=url.pathname==='/'?'index.html':url.pathname.slice(1);
  const type=mime[file.split('.').at(-1)] || (file==='ocr-vendor/SHA256SUMS'?'text/plain; charset=utf-8':null);
  if(!/^(?:ocr-vendor\/(?:core\/|lang\/)?)?[\w][\w.-]*$/.test(file)||!type)return res.writeHead(404).end();
  let body=await readFile(new URL(folder+file,import.meta.url));
  if(file==='index.html')body=body.toString('utf8').replace(marker,await siteVersion(new URL('../',import.meta.url)));
  res.writeHead(200,sameOriginHeaders(type,url.pathname));
  res.end(req.method==='GET'?body:undefined);
 }catch(error){res.writeHead(error?.code==='ENOENT'?404:500).end();}
});
const ix=process.argv.indexOf('--port');
server.listen(Number(process.env.PORT??(ix>=0?process.argv[ix+1]:4173)),'0.0.0.0');

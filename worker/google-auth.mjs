import {createRemoteJWKSet, jwtVerify, customFetch} from 'jose';

const SESSION_COOKIE='__Host-yeo-session', FLOW_COOKIE='__Host-yeo-oauth';
const STATE_TTL=10*60*1000, SESSION_TTL=30*24*60*60*1000;
const TOKEN_URL='https://oauth2.googleapis.com/token';
const JWKS_URL='https://www.googleapis.com/oauth2/v3/certs';
const googleKeys=createRemoteJWKSet(new URL(JWKS_URL),{timeoutDuration:10000});
const tokenPattern=/^[A-Za-z0-9_-]{43}$/;
const securityHeaders={'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'};
const json=(status,body,headers={})=>Response.json(body,{status,headers:{...securityHeaders,...headers}});
const bytesToBase64=bytes=>btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
const randomToken=()=>bytesToBase64(crypto.getRandomValues(new Uint8Array(32)));
const digest=async value=>bytesToBase64(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))));
const cookie=(name,value,age)=>`${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${age}`;
function readCookie(request,name){
 const values=(request.headers.get('cookie')||'').split(';').map(part=>part.trim()).filter(part=>part.startsWith(name+'=')).map(part=>part.slice(name.length+1));
 return {present:values.length>0,value:values.length===1&&tokenPattern.test(values[0])?values[0]:null};
}
function appOrigin(env,options={}){
 try{
  const source=env.APP_ORIGIN;
  if(typeof source!=='string')return null;
  const url=new URL(source);
  if(source!==url.origin||url.username||url.password)return null;
  if(url.protocol!=='https:'&&!(options.allowInsecureLocalhost===true&&url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname)))return null;
  return url.origin;
 }catch{return null;}
}
function configured(env,options){
 return !!(appOrigin(env,options)&&typeof env.GOOGLE_CLIENT_ID==='string'&&env.GOOGLE_CLIENT_ID.trim()&&typeof env.GOOGLE_CLIENT_SECRET==='string'&&env.GOOGLE_CLIENT_SECRET.trim());
}
function trustedLegacy(request,env){
 // Never enable this on a Worker reached directly from the public internet.
 // Only the Sites gateway authenticates and replaces this header.
 if(env.TRUST_SITES_IDENTITY!=='1')return null;
 const value=request.headers.get('oai-authenticated-user-id');
 return typeof value==='string'&&value.length>0&&value.length<=255&&!/[\x00-\x20\x7f]/.test(value)?value:null;
}
function sameOriginPost(request,origin){
 const site=request.headers.get('sec-fetch-site');
 return request.method==='POST'&&request.headers.get('origin')===origin&&(!site||site==='same-origin')&&/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type')||'');
}
function redirect(origin,query,cookies=[]){
 const headers=new Headers({...securityHeaders,Location:origin+'/'+query});
 for(const value of cookies)headers.append('Set-Cookie',value);
 return new Response(null,{status:303,headers});
}

export async function getIdentity(request,env,options={}){
 const legacyAccount=trustedLegacy(request,env),session=readCookie(request,SESSION_COOKIE);
 if(session.present){
  // A stale Google cookie must never turn a request into a different account.
  if(!session.value)return {account:null,user:null,provider:null,sessionInvalid:true,legacyAccount};
  if(!env.DB)throw Error('storage_unavailable');
  const row=await env.DB.prepare('SELECT owner, name, email, expires_at FROM auth_sessions WHERE token_hash = ?').bind(await digest(session.value)).first();
  if(!row||row.expires_at<=(options.clock||Date.now)()||!row.owner.startsWith('google:'))return {account:null,user:null,provider:null,sessionInvalid:true,legacyAccount};
  return {account:row.owner,user:{name:row.name,email:row.email},provider:'google',legacyAccount};
 }
 return legacyAccount?{account:legacyAccount,user:{name:'ChatGPT 사용자',email:''},provider:'chatgpt',legacyAccount}:{account:null,user:null,provider:null,legacyAccount:null};
}

async function beginGoogle(request,env,options,origin){
 const now=(options.clock||Date.now)(),state=randomToken(),browser=randomToken(),nonce=randomToken(),verifier=randomToken();
 await env.DB.prepare('DELETE FROM auth_sessions WHERE token_hash IN (SELECT token_hash FROM auth_sessions WHERE expires_at <= ? ORDER BY expires_at LIMIT 100)').bind(now).run();
 await env.DB.prepare('DELETE FROM auth_oauth_states WHERE state_hash IN (SELECT state_hash FROM auth_oauth_states WHERE expires_at <= ? ORDER BY expires_at LIMIT 100)').bind(now).run();
 await env.DB.prepare('INSERT INTO auth_oauth_states(state_hash,browser_hash,nonce,verifier,created_at,expires_at) VALUES(?,?,?,?,?,?)').bind(await digest(state),await digest(browser),nonce,verifier,now,now+STATE_TTL).run();
 const target=new URL('https://accounts.google.com/o/oauth2/v2/auth');
 target.search=new URLSearchParams({client_id:env.GOOGLE_CLIENT_ID,redirect_uri:origin+'/api/auth/google/callback',response_type:'code',scope:'openid email profile',state,nonce,code_challenge:await digest(verifier),code_challenge_method:'S256',prompt:'select_account'}).toString();
 return new Response(null,{status:303,headers:{...securityHeaders,Location:target.href,'Set-Cookie':cookie(FLOW_COOKIE,browser,STATE_TTL/1000)}});
}

async function finishGoogle(request,env,options,origin){
 const url=new URL(request.url),flow=readCookie(request,FLOW_COOKIE),state=url.searchParams.get('state');
 if(!flow.value||!state||!tokenPattern.test(state)||url.searchParams.getAll('state').length!==1)return json(400,{error:'invalid_oauth_state'});
 const now=(options.clock||Date.now)();
 // DELETE RETURNING is an atomic one-time claim, including parallel callbacks.
 const stored=await env.DB.prepare('DELETE FROM auth_oauth_states WHERE state_hash = ? AND browser_hash = ? AND expires_at > ? RETURNING nonce, verifier').bind(await digest(state),await digest(flow.value),now).first();
 if(!stored)return json(400,{error:'invalid_oauth_state'});
 const clearFlow=cookie(FLOW_COOKIE,'',0);
 if(url.searchParams.has('error'))return redirect(origin,'?auth_error=access_denied',[clearFlow]);
 const code=url.searchParams.get('code');
 if(typeof code!=='string'||!code||code.length>4096||url.searchParams.getAll('code').length!==1)return json(400,{error:'invalid_oauth_code'},{'Set-Cookie':clearFlow});
 let idToken;
 try{
  const response=await (options.fetch||globalThis.fetch)(TOKEN_URL,{
   method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded',Accept:'application/json'},
   body:new URLSearchParams({code,client_id:env.GOOGLE_CLIENT_ID,client_secret:env.GOOGLE_CLIENT_SECRET,redirect_uri:origin+'/api/auth/google/callback',grant_type:'authorization_code',code_verifier:stored.verifier}),
   signal:AbortSignal.timeout(10000),redirect:'error'
  });
  if(!response.ok)throw Error('token_exchange_failed');
  const body=await response.json();
  if(typeof body.id_token!=='string'||body.id_token.length>20000)throw Error('token_exchange_failed');
  idToken=body.id_token;
 }catch{return redirect(origin,'?auth_error=token_exchange_failed',[clearFlow]);}
 let claims;
 try{
  const keys=options.jwks||(options.fetch?createRemoteJWKSet(new URL(JWKS_URL),{[customFetch]:options.fetch,timeoutDuration:10000}):googleKeys);
  const result=await jwtVerify(idToken,keys,{
   issuer:['https://accounts.google.com','accounts.google.com'],audience:env.GOOGLE_CLIENT_ID,algorithms:['RS256'],
   requiredClaims:['iss','aud','sub','iat','exp','nonce'],maxTokenAge:'15m',clockTolerance:30,currentDate:new Date(now)
  });
  claims=result.payload;
  if(claims.nonce!==stored.nonce||typeof claims.sub!=='string'||!/^[\x21-\x7e]{1,255}$/.test(claims.sub)||
   (claims.azp!==undefined&&claims.azp!==env.GOOGLE_CLIENT_ID)||
   (Array.isArray(claims.aud)&&claims.aud.length>1&&claims.azp!==env.GOOGLE_CLIENT_ID))throw Error('invalid_token');
 }catch{return redirect(origin,'?auth_error=invalid_token',[clearFlow]);}
 const session=randomToken(),owner='google:'+claims.sub;
 const name=typeof claims.name==='string'?claims.name.slice(0,160):'';
 const email=claims.email_verified===true&&typeof claims.email==='string'?claims.email.slice(0,320):'';
 await env.DB.prepare('INSERT INTO auth_sessions(token_hash,owner,name,email,created_at,expires_at) VALUES(?,?,?,?,?,?)').bind(await digest(session),owner,name,email,now,now+SESSION_TTL).run();
 const old=readCookie(request,SESSION_COOKIE);
 if(old.value)await env.DB.prepare('DELETE FROM auth_sessions WHERE token_hash = ?').bind(await digest(old.value)).run();
 return redirect(origin,'?auth=google',[clearFlow,cookie(SESSION_COOKIE,session,SESSION_TTL/1000)]);
}

async function importLegacy(request,env,options){
 const identity=await getIdentity(request,env,options);
 if(identity.provider!=='google'||!identity.legacyAccount)return json(403,{error:'legacy_import_unavailable'});
 if(Number(request.headers.get('content-length'))>256)return json(400,{error:'invalid_import_confirmation'});
 let body;
 try{
  const reader=request.body?.getReader();if(!reader)throw Error('empty');
  const chunks=[];let size=0;
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>256){await reader.cancel();throw Error('large');}chunks.push(value);}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
 }catch{return json(400,{error:'invalid_import_confirmation'});}
 if(body?.confirm!==true)return json(400,{error:'invalid_import_confirmation'});
 const now=(options.clock||Date.now)();
 const count=await env.DB.prepare('SELECT COUNT(*) AS total FROM chapter_sync WHERE owner = ?').bind(identity.legacyAccount).first();
 // Each copied chapter begins its own revision history. Conflict keys are left
 // unchanged, and the source account is neither renamed nor deleted.
 const result=await env.DB.prepare('INSERT INTO chapter_sync(owner,chapter,revision,updated_at,payload) SELECT ?,chapter,1,?,payload FROM chapter_sync WHERE owner = ? AND 1 ON CONFLICT(owner,chapter) DO NOTHING RETURNING chapter').bind(identity.account,now,identity.legacyAccount).all();
 const imported=result.results.length,total=count?.total||0;
 return json(200,{imported,skipped:Math.max(0,total-imported),total});
}

export async function handleAuth(request,env,options={}){
 const url=new URL(request.url),path=url.pathname;
 if(path!=='/api/auth'&&!path.startsWith('/api/auth/'))return null;
 try{
  if(path==='/api/auth/session'&&request.method==='GET'){
   const identity=await getIdentity(request,env,options);
   return json(200,{account:identity.account,user:identity.user,provider:identity.provider,googleEnabled:configured(env,options),hasLegacyAccount:!!identity.legacyAccount,...(identity.sessionInvalid?{sessionInvalid:true}:{})});
  }
  const origin=appOrigin(env,options);
  if(!origin)return json(503,{error:'auth_not_configured'});
  if(url.origin!==origin)return json(400,{error:'invalid_auth_origin'});
  if(path==='/api/auth/google/start'||path==='/api/auth/google/callback'){
   if(request.method!=='GET')return json(405,{error:'unsupported_method'});
   if(!configured(env,options))return json(503,{error:'google_not_configured'});
   if(!env.DB)return json(503,{error:'storage_unavailable'});
   return path.endsWith('/start')?await beginGoogle(request,env,options,origin):await finishGoogle(request,env,options,origin);
  }
  if(path==='/api/auth/logout'||path==='/api/auth/import-legacy'){
   if(request.method!=='POST')return json(405,{error:'unsupported_method'});
   if(!sameOriginPost(request,origin))return json(403,{error:'invalid_origin'});
   if(!env.DB)return json(503,{error:'storage_unavailable'});
   if(path.endsWith('/import-legacy'))return await importLegacy(request,env,options);
   const session=readCookie(request,SESSION_COOKIE);
   if(session.value)await env.DB.prepare('DELETE FROM auth_sessions WHERE token_hash = ?').bind(await digest(session.value)).run();
   const response=json(200,{ok:true},{'Set-Cookie':cookie(SESSION_COOKIE,'',0)});
   response.headers.append('Set-Cookie',cookie(FLOW_COOKIE,'',0));
   return response;
  }
  return json(404,{error:'not_found'});
 }catch{return json(503,{error:'storage_unavailable'});}
}

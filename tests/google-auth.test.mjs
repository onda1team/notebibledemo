import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {SignJWT,generateKeyPair,exportJWK,createLocalJWKSet} from 'jose';
import {handleAuth,getIdentity} from '../worker/google-auth.mjs';

const ORIGIN='https://yeobaek.example.test';
const CLIENT='test-client.apps.googleusercontent.com';
const NOW=1795510200000;
const {publicKey,privateKey}=await generateKeyPair('RS256');
const publicJWK={...await exportJWK(publicKey),kid:'google-test-key',alg:'RS256',use:'sig'};
const jwks=createLocalJWKSet({keys:[publicJWK]});
const hash=async value=>Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))).toString('base64url');
function database(t){
 const sql=new DatabaseSync(':memory:');
 for(const path of ['0000_chapter_sync.sql','0001_google_auth.sql'])sql.exec(readFileSync(new URL('../drizzle/'+path,import.meta.url),'utf8'));
 t.after(()=>sql.close());
 return {sql,prepare(query){return {bind(...values){const statement=sql.prepare(query);return {first:async()=>statement.get(...values),all:async()=>({results:statement.all(...values)}),run:async()=>statement.run(...values)};}};}};
}
function setup(t,overrides={}){
 const env={DB:database(t),APP_ORIGIN:ORIGIN,GOOGLE_CLIENT_ID:CLIENT,GOOGLE_CLIENT_SECRET:'unit-test-only-secret',...overrides};
 return {env,options:{clock:()=>NOW,jwks}};
}
function request(path,options={}){return new Request(ORIGIN+path,options);}
const cookieValue=(response,name)=>response.headers.getSetCookie().find(value=>value.startsWith(name+'='))?.split(';')[0];
async function begin(env,options){
 const response=await handleAuth(request('/api/auth/google/start'),env,options);
 assert.equal(response.status,303);
 const url=new URL(response.headers.get('location'));
 return {response,url,state:url.searchParams.get('state'),nonce:url.searchParams.get('nonce'),cookie:cookieValue(response,'__Host-yeo-oauth')};
}
async function idToken(flow,claims={}){
 return new SignJWT({nonce:flow.nonce,name:'테스트 사용자',email:'verified@example.test',email_verified:true,
  iss:'https://accounts.google.com',aud:CLIENT,sub:'google-sub-001',iat:Math.floor(NOW/1000),exp:Math.floor(NOW/1000)+3600,...claims})
  .setProtectedHeader({alg:'RS256',kid:'google-test-key'}).sign(privateKey);
}
function callbackRequest(flow,extra={}){
 return request('/api/auth/google/callback?state='+flow.state+'&code=one-time-code',{headers:{cookie:flow.cookie,...extra}});
}
async function login(env,options,claims={},requestHeaders={}){
 const flow=await begin(env,options),token=await idToken(flow,claims);
 const response=await handleAuth(callbackRequest(flow,requestHeaders),env,{...options,fetch:async()=>Response.json({id_token:token,access_token:'not-stored'})});
 return {flow,response,cookie:cookieValue(response,'__Host-yeo-session')};
}

test('authorization code flow binds random state to browser, uses nonce/PKCE and hashes session tokens',async t=>{
 const {env,options}=setup(t),flow=await begin(env,options);
 assert.equal(flow.url.origin,'https://accounts.google.com');
 assert.equal(flow.url.searchParams.get('redirect_uri'),ORIGIN+'/api/auth/google/callback');
 assert.equal(flow.url.searchParams.get('scope'),'openid email profile');
 assert.equal(flow.url.searchParams.get('code_challenge_method'),'S256');
 assert.match(flow.response.headers.get('set-cookie'),/HttpOnly; Secure; SameSite=Lax/);
 const stored=env.DB.sql.prepare('SELECT * FROM auth_oauth_states').get();
 assert.equal(stored.state_hash,await hash(flow.state));assert.notEqual(stored.state_hash,flow.state);
 assert.equal(stored.expires_at-stored.created_at,600000);
 let calls=0;
 const token=await idToken(flow);
 const response=await handleAuth(callbackRequest(flow),env,{...options,fetch:async(url,init)=>{
  calls++;assert.equal(url,'https://oauth2.googleapis.com/token');
  const body=init.body;assert.equal(body.get('client_secret'),'unit-test-only-secret');
  assert.equal(body.get('grant_type'),'authorization_code');
  assert.equal(await hash(body.get('code_verifier')),flow.url.searchParams.get('code_challenge'));
  assert.equal(body.get('redirect_uri'),ORIGIN+'/api/auth/google/callback');
  return Response.json({id_token:token,access_token:'not-stored'});
 }});
 assert.equal(calls,1);assert.equal(response.status,303);assert.equal(response.headers.get('location'),ORIGIN+'/?auth=google');
 const sessionCookie=cookieValue(response,'__Host-yeo-session'),session=env.DB.sql.prepare('SELECT * FROM auth_sessions').get();
 assert.match(sessionCookie,/^__Host-yeo-session=[A-Za-z0-9_-]{43}$/);
 assert.equal(session.token_hash,await hash(sessionCookie.split('=')[1]));
 assert.equal(session.expires_at-session.created_at,30*24*60*60*1000);
 assert.equal(JSON.stringify(session).includes('not-stored'),false);assert.equal(JSON.stringify(session).includes(token),false);
 assert.equal(env.DB.sql.prepare('SELECT COUNT(*) AS n FROM auth_oauth_states').get().n,0);
 const identity=await getIdentity(request('/api/sync/session',{headers:{cookie:sessionCookie}}),env,options);
 assert.deepEqual({account:identity.account,user:identity.user,provider:identity.provider},{account:'google:google-sub-001',user:{name:'테스트 사용자',email:'verified@example.test'},provider:'google'});
 const status=await (await handleAuth(request('/api/auth/session',{headers:{cookie:sessionCookie}}),env,options)).json();
 assert.equal(status.googleEnabled,true);assert.equal(status.hasLegacyAccount,false);assert.equal(Object.hasOwn(status,'legacyAccount'),false);
});

test('malformed, missing, cross-browser and expired callbacks never exchange a code',async t=>{
 const {env,options}=setup(t),flow=await begin(env,options);let calls=0;
 const opts={...options,fetch:async()=>{calls++;throw Error('must not call');}};
 for(const candidate of [
  request('/api/auth/google/callback?code=abc'),
  request('/api/auth/google/callback?state='+flow.state+'&code=abc'),
  request('/api/auth/google/callback?state='+flow.state+'&state='+flow.state+'&code=abc',{headers:{cookie:flow.cookie}}),
  request('/api/auth/google/callback?state='+flow.state+'&code=abc',{headers:{cookie:'__Host-yeo-oauth='+'x'.repeat(43)}})
 ])assert.equal((await handleAuth(candidate,env,opts)).status,400);
 assert.equal((await handleAuth(callbackRequest(flow),env,{...opts,clock:()=>NOW+600001})).status,400);
 assert.equal(calls,0);assert.equal(env.DB.sql.prepare('SELECT COUNT(*) AS n FROM auth_sessions').get().n,0);
});

test('OAuth state is consumed atomically and callback replay cannot create another session',async t=>{
 const {env,options}=setup(t),flow=await begin(env,options),token=await idToken(flow);let calls=0;
 const opts={...options,fetch:async()=>{calls++;return Response.json({id_token:token});}};
 const results=await Promise.all([handleAuth(callbackRequest(flow),env,opts),handleAuth(callbackRequest(flow),env,opts)]);
 assert.deepEqual(results.map(r=>r.status).sort(),[303,400]);assert.equal(calls,1);
 assert.equal(env.DB.sql.prepare('SELECT COUNT(*) AS n FROM auth_sessions').get().n,1);
 assert.equal((await handleAuth(callbackRequest(flow),env,opts)).status,400);
});

test('issuer, audience, nonce, expiry, subject, azp and signature are all verified',async t=>{
 const {env,options}=setup(t);
 for(const claims of [{iss:'https://attacker.test'},{aud:'other-client'},{nonce:'not-this-flow'},
  {exp:Math.floor(NOW/1000)-90},{sub:''},{sub:'bad\nsubject'},
  {azp:'other-client'},{aud:[CLIENT,'another-client'],azp:undefined},
  {iat:Math.floor(NOW/1000)-3600}]){
  const {response}=await login(env,options,claims);
  assert.equal(response.status,303);assert.equal(response.headers.get('location'),ORIGIN+'/?auth_error=invalid_token');
  assert.equal(cookieValue(response,'__Host-yeo-session'),undefined);
 }
 const flow=await begin(env,options),valid=await idToken(flow);
 const pieces=valid.split('.');pieces[2]=(pieces[2][0]==='a'?'b':'a')+pieces[2].slice(1);
 const bad=await handleAuth(callbackRequest(flow),env,{...options,fetch:async()=>Response.json({id_token:pieces.join('.')})});
 assert.equal(bad.headers.get('location'),ORIGIN+'/?auth_error=invalid_token');
 assert.equal(env.DB.sql.prepare('SELECT COUNT(*) AS n FROM auth_sessions').get().n,0);
});

test('cancelled or failed token exchanges clear flow cookies and never leak token errors',async t=>{
 const {env,options}=setup(t),cancel=await begin(env,options);
 const cancelled=await handleAuth(request('/api/auth/google/callback?state='+cancel.state+'&error=access_denied',{headers:{cookie:cancel.cookie}}),env,options);
 assert.equal(cancelled.headers.get('location'),ORIGIN+'/?auth_error=access_denied');assert.match(cancelled.headers.get('set-cookie'),/Max-Age=0/);
 const flow=await begin(env,options);
 const failed=await handleAuth(callbackRequest(flow),env,{...options,fetch:async()=>Response.json({error:'secret-provider-detail'},{status:400})});
 assert.equal(failed.headers.get('location'),ORIGIN+'/?auth_error=token_exchange_failed');
 assert.equal((await failed.text()).includes('secret-provider-detail'),false);
 assert.equal(env.DB.sql.prepare('SELECT COUNT(*) AS n FROM auth_sessions').get().n,0);
});

test('Google sub is the stable account identity; email and legacy headers do not change the owner',async t=>{
 const {env,options}=setup(t,{TRUST_SITES_IDENTITY:'1'});
 const a=await login(env,options,{sub:'a',email:'old@example.test'});
 const b=await login(env,options,{sub:'b',email:'old@example.test'});
 const renamed=await login(env,options,{sub:'a',email:'new@example.test'});
 for(const [signed,owner] of [[a,'google:a'],[b,'google:b'],[renamed,'google:a']]){
  const identity=await getIdentity(request('/api/sync/session',{headers:{cookie:signed.cookie,'oai-authenticated-user-id':'legacy-owner'}}),env,options);
  assert.equal(identity.account,owner);assert.equal(identity.legacyAccount,'legacy-owner');assert.equal(identity.provider,'google');
 }
});

test('expired, malformed, duplicate and unknown Google cookies never fall back to a legacy account',async t=>{
 const {env,options}=setup(t,{TRUST_SITES_IDENTITY:'1'}),signed=await login(env,options);
 const legacy={'oai-authenticated-user-id':'legacy-account'};
 for(const cookie of ['__Host-yeo-session=bad','__Host-yeo-session='+'x'.repeat(43),signed.cookie+'; '+signed.cookie]){
  const identity=await getIdentity(request('/api/sync/session',{headers:{...legacy,cookie}}),env,options);
  assert.equal(identity.account,null);assert.equal(identity.provider,null);assert.equal(identity.sessionInvalid,true);
 }
 const expired=await getIdentity(request('/api/sync/session',{headers:{...legacy,cookie:signed.cookie}}),env,{...options,clock:()=>NOW+30*86400000});
 assert.equal(expired.account,null);assert.equal(expired.sessionInvalid,true);
 const fallback=await getIdentity(request('/api/sync/session',{headers:legacy}),env,options);
 assert.equal(fallback.account,'legacy-account');assert.equal(fallback.provider,'chatgpt');
 env.TRUST_SITES_IDENTITY='0';assert.equal((await getIdentity(request('/api/sync/session',{headers:legacy}),env,options)).account,null);
});

test('logout requires same-origin JSON POST and invalidates the server-side session',async t=>{
 const {env,options}=setup(t),signed=await login(env,options);
 const post=overrides=>request('/api/auth/logout',{method:'POST',headers:{cookie:signed.cookie,origin:ORIGIN,'content-type':'application/json','sec-fetch-site':'same-origin',...overrides},body:'{}'});
 for(const headers of [{origin:'https://evil.example'},{origin:''},{'sec-fetch-site':'cross-site'},{'content-type':'text/plain'}])assert.equal((await handleAuth(post(headers),env,options)).status,403);
 assert.equal((await getIdentity(request('/api/auth/session',{headers:{cookie:signed.cookie}}),env,options)).provider,'google');
 const result=await handleAuth(post({}),env,options);assert.equal(result.status,200);assert.deepEqual(await result.json(),{ok:true});assert.match(result.headers.get('set-cookie'),/Max-Age=0/);
 assert.equal(result.headers.getSetCookie().length,2);
 assert.equal((await getIdentity(request('/api/auth/session',{headers:{cookie:signed.cookie}}),env,options)).account,null);
 assert.equal(env.DB.sql.prepare('SELECT COUNT(*) AS n FROM auth_sessions').get().n,0);
});

test('successful account switch rotates the session and invalidates the previous cookie',async t=>{
 const {env,options}=setup(t),first=await login(env,options,{sub:'first'});
 const flow=await begin(env,options),token=await idToken(flow,{sub:'second'});
 const result=await handleAuth(callbackRequest(flow,{cookie:flow.cookie+'; '+first.cookie}),env,{...options,fetch:async()=>Response.json({id_token:token})});
 const next=cookieValue(result,'__Host-yeo-session');assert.ok(next);assert.notEqual(next,first.cookie);
 assert.equal((await getIdentity(request('/api/auth/session',{headers:{cookie:first.cookie}}),env,options)).account,null);
 assert.equal((await getIdentity(request('/api/auth/session',{headers:{cookie:next}}),env,options)).account,'google:second');
 assert.equal(env.DB.sql.prepare('SELECT COUNT(*) AS n FROM auth_sessions').get().n,1);
});

test('missing configuration stays anonymous and returns a clear unavailable response',async t=>{
 const {env,options}=setup(t);delete env.GOOGLE_CLIENT_SECRET;
 const info=await (await handleAuth(request('/api/auth/session'),env,options)).json();
 assert.equal(info.account,null);assert.equal(info.googleEnabled,false);
 assert.equal((await handleAuth(request('/api/auth/google/start'),env,options)).status,503);
 assert.equal(env.DB.sql.prepare('SELECT COUNT(*) AS n FROM auth_oauth_states').get().n,0);
 assert.equal(await handleAuth(request('/api/sync/session'),env,options),null);
});

test('origin is exact and fixed: redirect parameters cannot escape and HTTP is test-only',async t=>{
 const {env,options}=setup(t);
 for(const origin of [ORIGIN+'/',ORIGIN+'/path',ORIGIN+'?q=1','http://localhost:3000','https://user:pass@example.test']){
  assert.equal((await handleAuth(request('/api/auth/google/start'),{...env,APP_ORIGIN:origin},options)).status,503);
 }
 assert.equal((await handleAuth(new Request('https://other.test/api/auth/google/start'),env,options)).status,400);
 const response=await handleAuth(request('/api/auth/google/start?returnTo=https://evil.example'),env,options);
 assert.equal(new URL(response.headers.get('location')).searchParams.get('redirect_uri'),ORIGIN+'/api/auth/google/callback');
 const local=await handleAuth(new Request('http://localhost:3000/api/auth/google/start'),{...env,APP_ORIGIN:'http://localhost:3000'},{...options,allowInsecureLocalhost:true});
 assert.equal(local.status,303);
});

test('explicit legacy import is create-only, account-scoped, repeat-safe and leaves originals',async t=>{
 const {env,options}=setup(t,{TRUST_SITES_IDENTITY:'1'}),signed=await login(env,options);
 const insert=env.DB.sql.prepare('INSERT INTO chapter_sync(owner,chapter,revision,updated_at,payload) VALUES(?,?,?,?,?)');
 insert.run('legacy','PSA23',7,10,JSON.stringify({text:'legacy psalm'}));
 insert.run('legacy','JHN1',3,10,JSON.stringify({text:'legacy john'}));
 insert.run('unrelated','GEN1',1,10,JSON.stringify({text:'private unrelated'}));
 insert.run('google:google-sub-001','PSA23',5,20,JSON.stringify({text:'existing google psalm'}));
 const post=(body={confirm:true},headers={})=>request('/api/auth/import-legacy',{method:'POST',headers:{cookie:signed.cookie,origin:ORIGIN,'content-type':'application/json','oai-authenticated-user-id':'legacy',...headers},body:JSON.stringify(body)});
 assert.equal((await handleAuth(post({}),env,options)).status,400);
 assert.equal((await handleAuth(post({confirm:true},{origin:'https://evil.test'}),env,options)).status,403);
 const result=await handleAuth(post(),env,options);assert.deepEqual(await result.json(),{imported:1,skipped:1,total:2});
 assert.deepEqual(await (await handleAuth(post(),env,options)).json(),{imported:0,skipped:2,total:2});
 const rows=env.DB.sql.prepare('SELECT chapter,revision,payload FROM chapter_sync WHERE owner = ? ORDER BY chapter').all('google:google-sub-001');
 assert.deepEqual(rows.map(r=>[r.chapter,r.revision,JSON.parse(r.payload).text]),[['JHN1',1,'legacy john'],['PSA23',5,'existing google psalm']]);
 assert.equal(env.DB.sql.prepare('SELECT COUNT(*) AS n FROM chapter_sync WHERE owner = ?').get('legacy').n,2);
 env.TRUST_SITES_IDENTITY='0';assert.equal((await handleAuth(post(),env,options)).status,403);
});

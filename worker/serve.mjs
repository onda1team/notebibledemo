/* This entry is combined with sync.mjs and verified build-time assets. */
import {handleAuth, getIdentity} from './google-auth.mjs';
function assetBytes(encoded) {
  if (typeof Uint8Array.fromBase64 === 'function') return Uint8Array.fromBase64(encoded);
  const decoded=atob(encoded), bytes=new Uint8Array(decoded.length);
  for(let i=0;i<decoded.length;i++)bytes[i]=decoded.charCodeAt(i);
  return bytes;
}

export function sameOriginHeaders(type, path) {
  // The only document worker is the same-origin OCR worker. WebAssembly
  // compilation is enabled on that worker response, not on the app document.
  const ocrWorker = path === '/ocr-vendor/worker.min.js';
  return {
    'Content-Type': type,
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
    'Content-Security-Policy': ocrWorker
      ? "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'; worker-src 'none'; object-src 'none'"
      : "default-src 'none'; script-src 'self'; worker-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; object-src 'none'"
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/auth/')) {
      try { return await handleAuth(request, env); }
      catch { return reply(503, {error:'auth_unavailable'}); }
    }
    if (url.pathname === '/api/sync' || url.pathname.startsWith('/api/sync/')) {
      try {
        const identity = await getIdentity(request, env);
        const headers = new Headers(request.headers);
        headers.delete('oai-authenticated-user-id');
        if (identity?.account) headers.set('oai-authenticated-user-id', identity.account);
        return await handleSync(new Request(request, {headers}), env.DB);
      } catch {
        return reply(503, {error:'storage_unavailable'});
      }
    }
    const path = url.pathname === '/' ? '/index.html' : url.pathname;
    const entry = Object.hasOwn(assets, path) ? assets[path] : null;
    if (!entry) return new Response('Not found', {status:404,headers:sameOriginHeaders('text/plain; charset=utf-8')});
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response(null, {status:405,headers:{...sameOriginHeaders('text/plain'),Allow:'GET, HEAD'}});
    }
    const [type, encoding, encoded] = entry;
    let body = null;
    if (request.method === 'GET') {
      const bytes=assetBytes(encoded);
      body=encoding==='gzip' ? new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')) : bytes;
    }
    return new Response(body, {headers:sameOriginHeaders(type,path)});
  }
};

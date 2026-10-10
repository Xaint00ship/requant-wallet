import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
const files = [];
function walk(dir) {
  for (const entry of readdirSync(`dist-web${dir}`, { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) walk(path);
    else files.push(`/wallet${path}`);
  }
}
walk("");
const revision = createHash("sha256")
  .update(
    files
      .map((path) =>
        readFileSync(`dist-web${path.slice(7)}`).toString("base64"),
      )
      .join(""),
  )
  .digest("hex")
  .slice(0, 16);
writeFileSync(
  "dist-web/sw.js",
  `const CACHE='requant-wallet-${revision}';const FILES=${JSON.stringify(files)};
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(FILES)).then(()=>self.skipWaiting()));});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('requant-wallet-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',event=>{const url=new URL(event.request.url);if(event.request.method!=='GET'||url.origin!==self.location.origin||!url.pathname.startsWith('/wallet/'))return;event.respondWith((async()=>{const cache=await caches.open(CACHE);const key=event.request.mode==='navigate'?'/wallet/index.html':url.pathname;const saved=await cache.match(key);if(saved&&event.request.mode!=='navigate')return saved;try{return await fetch(event.request)}catch(e){if(saved)return saved;throw e}})());});
`,
);
console.log(
  `Packaged web wallet ${revision}; ${files.length} public assets available offline.`,
);

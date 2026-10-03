/* Iris service worker — served mode only, and a shell-only fallback.
 *
 * Registered from src/main.tsx when the engine itself served the page (the
 * tailnet deployment behind `tailscale serve`), never under the Tauri shell or
 * Vite dev. Its one job: when the laptop is out of reach, tapping the
 * home-screen icon opens Iris saying "server not reachable" instead of Safari's
 * error page. Iris has nothing else to offer offline — every table, statistic
 * and figure comes from the engine.
 *
 * The rules exist to make a stale bundle impossible, not merely rare (a cached
 * shell that has silently stopped matching its source is the failure whose
 * symptom is "my change did nothing"):
 *
 *   - SERVER FIRST, ALWAYS. Every shell request goes to the network; the cache
 *     is read only when the network fails or does not answer within TIMEOUT_MS.
 *   - THE SHELL ONLY: the page itself ("/"), the built bundle (/assets/…), the
 *     guide, and the icons/manifest at the root. Every engine endpoint and every
 *     non-GET is left alone — no respondWith, so the browser behaves exactly as
 *     if there were no worker.
 *   - AN UPDATE NEVER STRANDS AN INSTALLED APP: skipWaiting + clients.claim,
 *     and the engine serves /sw.js with Cache-Control: no-cache.
 */

const CACHE = "iris-shell-v1";
const TIMEOUT_MS = 4000;

const ROOT_FILE = /^\/[\w.-]+\.(png|svg|ico|webmanifest)$/;

function isShell(request, url) {
  if (url.origin !== self.location.origin) return false;
  if (request.mode === "navigate") return url.pathname === "/" || url.pathname === "/index.html";
  return url.pathname.startsWith("/assets/") || url.pathname.startsWith("/guide/")
    || ROOT_FILE.test(url.pathname);
}

/* The bundle's file names are content hashes, so they cannot be listed here.
   Read them out of the page instead: everything index.html links to. */
function referencedAssets(html) {
  const out = new Set();
  for (const m of html.matchAll(/(?:src|href)="(\/[^"]+)"/g)) out.add(m[1]);
  return out;
}

async function cacheShell(cache, html) {
  await Promise.all([...referencedAssets(html)].map(async (path) => {
    try {
      // Hashed (/assets/) or ?v=-versioned: a name already cached is that file.
      if (await cache.match(path)) return;
      const resp = await fetch(path, { cache: "no-store" });
      if (resp.ok) await cache.put(path, resp);
    } catch (e) { /* filled on the next good fetch */ }
  }));
}

/* A fresh index.html names the bundle that goes with it; any /assets/ entry it
   does not name belongs to an older build. Dropping those keeps the cache to
   one build instead of every build ever served. (Lazily loaded files are
   dropped too, and come back the next time they are fetched.) */
async function pruneOldBuilds(cache, html) {
  const keep = referencedAssets(html);
  for (const req of await cache.keys()) {
    const path = new URL(req.url).pathname;
    if (path.startsWith("/assets/") && !keep.has(path)) await cache.delete(req);
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    try {
      const cache = await caches.open(CACHE);
      const resp = await fetch("/", { cache: "no-store" });
      if (resp.ok) {
        const html = await resp.clone().text();
        await cache.put("/", resp);
        await cacheShell(cache, html);
      }
    } catch (e) { /* offline at install: filled on the next good fetch */ }
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((n) => n !== CACHE).map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (!isShell(request, url)) return;     // the engine's API: untouched
  event.respondWith(serverFirst(request, url));
});

async function serverFirst(request, url) {
  const cache = await caches.open(CACHE);
  const isPage = request.mode === "navigate";
  const key = isPage ? "/" : url.pathname + url.search;

  const network = fetch(request, { cache: "no-store" }).then((resp) => {
    // Only a real answer replaces the fallback; an error page is passed to the
    // browser as-is but never kept.
    if (resp.ok && resp.type === "basic") {
      const copy = resp.clone();
      if (isPage) {
        copy.text().then(async (html) => {
          await cache.put("/", new Response(html, { headers: resp.headers }));
          await pruneOldBuilds(cache, html);
          await cacheShell(cache, html);
        }).catch(() => {});
      } else {
        cache.put(key, copy).catch(() => {});
      }
    }
    return resp;
  });
  network.catch(() => {});                // observed below; silence the orphan

  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve(null), TIMEOUT_MS);
  });
  try {
    const resp = await Promise.race([network, timeout]);
    if (resp) return resp;
  } catch (e) {
    /* network error: fall through to the cache */
  } finally {
    clearTimeout(timer);
  }

  const cached = await cache.match(key);
  if (cached) return cached;
  return network;                         // nothing cached: wait it out
}

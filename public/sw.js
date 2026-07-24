/* PaoPao Fusion offline shell.
 *
 * This worker deliberately ignores /api requests. Account, inventory and
 * leaderboard traffic must always reach the application backend so an old
 * response can never masquerade as current cloud state.
 */
const CACHE_PREFIX = 'paopao-fusion-';
const CACHE_VERSION = 'hand-landmarker-2026-07-24-v16';
const SHELL_CACHE = `${CACHE_PREFIX}shell-${CACHE_VERSION}`;
const RUNTIME_CACHE = `${CACHE_PREFIX}runtime-${CACHE_VERSION}`;
const CURRENT_CACHES = new Set([SHELL_CACHE, RUNTIME_CACHE]);
const SCOPE_URL = new URL('./', self.registration.scope);
const SCOPE_PATH = SCOPE_URL.pathname.endsWith('/') ? SCOPE_URL.pathname : `${SCOPE_URL.pathname}/`;
const LAUNCHER_URL = SCOPE_URL.href;
const INDEX_URL = new URL('classic/', SCOPE_URL).href;

// Keep installation shell-first. The cinematic, music library, alternate
// realms, bosses and cosmetic collections are cached when the game requests
// them; none of those large optional files can block service-worker install.
// The paths below are the stable DOM shell plus enough default art to reopen a
// guest profile if the connection disappears immediately after first launch.
const CORE_SHELL_PATHS = [
  'manifest.webmanifest',
  'assets/fonts/fonts.css',
  'assets/fonts/paopao-display-cinzel-latin.woff2',
  'assets/fonts/fusion-sans-sora-latin.woff2',
  'assets/icons/favicon.ico',
  'assets/icons/favicon-32.png',
  'assets/icons/apple-touch-icon.png',
  'assets/icons/icon-192.png',
  'assets/icons/icon-512.png',
  'assets/icons/icon-maskable-512.png',
  'assets/brand/paopao-shattered-crown-key-art.png',
  'assets/cinematics/previews-v2/frame-00750ms.jpg',
  'assets/worlds/v3/world-crystal-hd.jpg',
  'assets/ui/v3/level-medallion-hd.png',
  'assets/ui/v6/mystery-chest-closed.png',
  'assets/ui/v6/coin-stack.png',
  'assets/ui/v6/tier-bronze.png',
  'assets/ui/v6/tier-silver.png',
  'assets/ui/v6/tier-gold.png',
  'assets/ui/v6/tier-prismatic.png',
  'assets/sprites/v6/nova-blue.png',
  'assets/sprites/v6/nova-green.png',
  'assets/sprites/v6/nova-orange.png',
  'assets/sprites/v6/nova-purple.png',
  'assets/sprites/v6/nova-red.png',
  'assets/sprites/v6/nova-yellow.png',
  'assets/sprites/v3/power-bomb-hd.png',
  'assets/sprites/v3/power-rainbow-hd.png',
  'assets/sprites/v3/crystal-launcher-hd.png',
  'mediapipe/models/hand_landmarker.task',
  'mediapipe/wasm/vision_wasm_internal.js',
  'mediapipe/wasm/vision_wasm_internal.wasm',
];

const STATIC_DESTINATIONS = new Set([
  'audio', 'font', 'image', 'manifest', 'script', 'style', 'track', 'video', 'worker',
]);
const STATIC_EXTENSION = /\.(?:avif|css|gif|ico|jpe?g|js|json|m4a|mjs|mp3|mp4|ogg|opus|png|svg|task|ts|wasm|wav|webm|webmanifest|webp|woff2?|xml)$/i;

function isApiRequest(url) {
  const path = url.pathname;
  const scopedApi = `${SCOPE_PATH}api`;
  return path === '/api'
    || path.startsWith('/api/')
    || path === scopedApi
    || path.startsWith(`${scopedApi}/`);
}

function isStaticRequest(request, url) {
  return STATIC_DESTINATIONS.has(request.destination)
    || url.pathname.startsWith(`${SCOPE_PATH}assets/`)
    || url.pathname.startsWith(`${SCOPE_PATH}mediapipe/`)
    || STATIC_EXTENSION.test(url.pathname);
}

function discoverShellUrls(html, responseUrl) {
  const urls = new Set();
  const baseMatch = /<base\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>/i.exec(html);
  let documentBase = responseUrl;
  if (baseMatch) {
    try {
      documentBase = new URL(baseMatch[1], responseUrl).href;
    } catch {
      // A malformed optional base falls back to the response URL.
    }
  }
  const attributePatterns = [
    /<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi,
    /<link\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>/gi,
  ];

  for (const pattern of attributePatterns) {
    let match;
    while ((match = pattern.exec(html)) !== null) {
      try {
        const url = new URL(match[1], documentBase);
        if (url.origin === self.location.origin && !isApiRequest(url)) urls.add(url.href);
      } catch {
        // Ignore malformed optional markup; the fetched index remains cached.
      }
    }
  }
  return [...urls];
}

async function fetchForCache(url) {
  const request = new Request(url, {
    cache: 'reload',
    credentials: 'same-origin',
  });
  const response = await fetch(request);
  if (!response.ok || response.status !== 200) {
    throw new Error(`Offline resource failed (${response.status}): ${url}`);
  }
  return { request, response };
}

async function cacheUrls(cache, urls, concurrency = 6) {
  const queue = [...new Set(urls)];
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    while (cursor < queue.length) {
      const url = queue[cursor];
      cursor += 1;
      const { request, response } = await fetchForCache(url);
      await cache.put(request, response);
    }
  });
  await Promise.all(workers);
}

async function installOfflineShell() {
  const cache = await caches.open(SHELL_CACHE);
  const { request: launcherRequest, response: launcherResponse } = await fetchForCache(LAUNCHER_URL);
  await cache.put(launcherRequest, launcherResponse);
  const { request: indexRequest, response: indexResponse } = await fetchForCache(INDEX_URL);
  const html = await indexResponse.clone().text();
  await cache.put(indexRequest, indexResponse);

  // Vite fingerprints its production entry module. Reading the live index at
  // install time avoids ever pinning an obsolete hash in this worker source.
  const discoveredShellUrls = discoverShellUrls(html, INDEX_URL);
  const coreUrls = CORE_SHELL_PATHS.map((path) => new URL(path, SCOPE_URL).href);
  await cacheUrls(cache, [...discoveredShellUrls, ...coreUrls]);
}

self.addEventListener('install', (event) => {
  // Let updates activate after existing clients close. A live tab therefore
  // cannot mix its old hashed application bundle with a new worker/cache.
  event.waitUntil(installOfflineShell());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const cacheNames = await caches.keys();
    await Promise.all(cacheNames.map((name) => (
      name.startsWith(CACHE_PREFIX) && !CURRENT_CACHES.has(name)
        ? caches.delete(name)
        : Promise.resolve(false)
    )));
    await self.clients.claim();
  })());
});

function canStoreResponse(response) {
  if (!response || !response.ok || response.status !== 200) return false;
  const cacheControl = response.headers.get('cache-control') ?? '';
  return !/\bno-store\b/i.test(cacheControl);
}

function isStreamedMediaRequest(request, url) {
  return request.destination === 'video'
    || request.destination === 'audio'
    || /\.(?:m4a|mp3|mp4|ogg|opus|wav|webm)$/i.test(url.pathname);
}

async function fetchWithDeadline(request, timeoutMs = 4500) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(request, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function navigationNetworkFirst(request) {
  const url = new URL(request.url);
  const isClassic = url.pathname.startsWith(`${SCOPE_PATH}classic`);
  const fallbackUrl = isClassic ? INDEX_URL : LAUNCHER_URL;
  const cacheTarget = url.pathname === SCOPE_PATH ? LAUNCHER_URL : isClassic ? INDEX_URL : null;
  try {
    // A captive portal or half-open mobile connection must not leave the
    // launch screen hanging forever when a complete shell is already cached.
    const response = await fetchWithDeadline(request);
    const isHtml = /text\/html/i.test(response.headers.get('content-type') ?? '');
    // Reverse proxies often answer an outage with a real 502/503 Response
    // rather than rejecting fetch. Treat those responses (and accidental
    // non-HTML navigation payloads) as offline so a valid cached shell wins.
    if (!response.ok || !isHtml) throw new Error(`navigation-unavailable-${response.status}`);
    if (cacheTarget && canStoreResponse(response)) {
      const cache = await caches.open(SHELL_CACHE);
      await cache.put(cacheTarget, response.clone());
    }
    return response;
  } catch {
    const cache = await caches.open(SHELL_CACHE);
    const cached = await cache.match(fallbackUrl);
    if (cached) return cached;
    return new Response('PaoPao Fusion is not available offline yet. Open it once while online.', {
      status: 503,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  }
}

function parseByteRange(rangeHeader, size) {
  const match = /^bytes=(\d*)-(\d*)$/i.exec(rangeHeader.trim());
  if (!match) return null;

  let start;
  let end;
  if (match[1] === '') {
    const suffixLength = Number(match[2]);
    if (!Number.isInteger(suffixLength) || suffixLength <= 0) return null;
    start = Math.max(0, size - suffixLength);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] === '' ? size - 1 : Number(match[2]);
  }

  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || start >= size || end < start) return null;
  return { start, end: Math.min(end, size - 1) };
}

async function rangeResponse(cached, rangeHeader) {
  const bytes = await cached.arrayBuffer();
  const range = parseByteRange(rangeHeader, bytes.byteLength);
  if (!range) {
    return new Response(null, {
      status: 416,
      headers: { 'content-range': `bytes */${bytes.byteLength}` },
    });
  }

  const headers = new Headers(cached.headers);
  headers.set('accept-ranges', 'bytes');
  headers.set('content-length', String(range.end - range.start + 1));
  headers.set('content-range', `bytes ${range.start}-${range.end}/${bytes.byteLength}`);
  return new Response(bytes.slice(range.start, range.end + 1), {
    status: 206,
    statusText: 'Partial Content',
    headers,
  });
}

async function staticCacheFirst(request, url, lifetimeEvent) {
  const shellCache = await caches.open(SHELL_CACHE);
  const runtimeCache = await caches.open(RUNTIME_CACHE);
  const cached = await shellCache.match(request) ?? await runtimeCache.match(request);
  const rangeHeader = request.headers.get('range');

  // Keep normal audio/video seeking on the browser's streaming path. Creating
  // an ArrayBuffer for an entire cached movie on every tiny byte range causes
  // large repeated allocations. The cached slice remains an offline fallback.
  if (rangeHeader && isStreamedMediaRequest(request, url)) {
    try {
      const response = await fetchWithDeadline(request);
      if (!response.ok) throw new Error(`stream-unavailable-${response.status}`);
      return response;
    } catch {
      if (cached) return rangeResponse(cached, rangeHeader);
      throw new Error('stream-unavailable');
    }
  }

  if (cached) {
    return rangeHeader ? rangeResponse(cached, rangeHeader) : cached;
  }

  const response = await fetch(request);
  if (!request.headers.has('range') && canStoreResponse(response)) {
    await runtimeCache.put(request, response.clone());
  }
  return response;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Intentionally do not call respondWith: this is an ordinary network fetch.
  if (isApiRequest(url)) return;

  // The retired client route is a server-owned 410 response. It must never be
  // converted into an offline launcher fallback by this worker.
  if (request.mode === 'navigate'
    && (url.pathname === `${SCOPE_PATH}3d` || url.pathname.startsWith(`${SCOPE_PATH}3d/`))) return;

  if (request.mode === 'navigate') {
    event.respondWith(navigationNetworkFirst(request));
    return;
  }

  if (isStaticRequest(request, url)) {
    event.respondWith(staticCacheFirst(request, url, event));
  }
});

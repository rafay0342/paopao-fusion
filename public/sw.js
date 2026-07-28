/* PaoPao Fusion offline shell.
 *
 * This worker deliberately ignores /api requests. Account, inventory and
 * leaderboard traffic must always reach the application backend so an old
 * response can never masquerade as current cloud state.
 */
const CACHE_PREFIX = 'paopao-fusion-';
const CACHE_VERSION = 'art-v14-delivery-2026-07-28-v21';
const SHELL_CACHE = `${CACHE_PREFIX}shell-${CACHE_VERSION}`;
const RUNTIME_CACHE = `${CACHE_PREFIX}runtime-${CACHE_VERSION}`;
const EQUIPPED_ART_CACHE = `${CACHE_PREFIX}equipped-art-${CACHE_VERSION}`;
const CURRENT_CACHES = new Set([SHELL_CACHE, RUNTIME_CACHE, EQUIPPED_ART_CACHE]);
const SCOPE_URL = new URL('./', self.registration.scope);
const SCOPE_PATH = SCOPE_URL.pathname.endsWith('/') ? SCOPE_URL.pathname : `${SCOPE_URL.pathname}/`;
const LAUNCHER_URL = SCOPE_URL.href;
const INDEX_URL = new URL('classic/', SCOPE_URL).href;
const V14_MANIFEST_URL = new URL('assets/v14/art-manifest.json', SCOPE_URL).href;

// Keep installation shell-first. The cinematic, music library, alternate
// realms, bosses and cosmetic collections are cached when the game requests
// them; none of those large optional files can block service-worker install.
// The fixed paths below are only manifests and fonts. The poster, default realm
// and equipped Pao family are selected from GameplayArtManifestV1 when present,
// with one bounded legacy fallback for backwards-compatible R5 installs.
const FIXED_PRECACHE_PATHS = [
  'manifest.webmanifest',
  'assets/fonts/fonts.css',
  'assets/fonts/paopao-display-cinzel-latin.woff2',
  'assets/fonts/fusion-sans-sora-latin.woff2',
];

const DEFAULT_ART_PRECACHE = [
  {
    stableKey: 'intro_poster',
    fallbackPath: 'assets/cinematics/previews-v2/frame-00750ms.jpg',
  },
  {
    stableKey: 'world_crystal',
    fallbackPath: 'assets/worlds/v12/world-luma-orchard-hd.jpg',
  },
];

const DEFAULT_EQUIPPED_ART_PRECACHE = [
  {
    stableKey: 'bubble_nova_blue',
    fallbackPath: 'assets/sprites/v6/nova-blue.png',
  },
  {
    stableKey: 'bubble_nova_green',
    fallbackPath: 'assets/sprites/v6/nova-green.png',
  },
  {
    stableKey: 'bubble_nova_orange',
    fallbackPath: 'assets/sprites/v6/nova-orange.png',
  },
  {
    stableKey: 'bubble_nova_purple',
    fallbackPath: 'assets/sprites/v6/nova-purple.png',
  },
  {
    stableKey: 'bubble_nova_red',
    fallbackPath: 'assets/sprites/v6/nova-red.png',
  },
  {
    stableKey: 'bubble_nova_yellow',
    fallbackPath: 'assets/sprites/v6/nova-yellow.png',
  },
];

const STATIC_DESTINATIONS = new Set([
  'audio', 'font', 'image', 'manifest', 'script', 'style', 'track', 'video', 'worker',
]);
const STATIC_EXTENSION = /\.(?:avif|css|gif|ico|jpe?g|js|json|m4a|mjs|mp3|mp4|ogg|opus|png|svg|task|ts|wasm|wav|webm|webmanifest|webp|woff2?|xml)$/i;
const CONTENT_HASHED_V14_PATH =
  /\/assets\/v14\/bundles\/[a-z0-9-]+\/[^/]+\.([a-f0-9]{12,64})\.[a-z0-9]+$/i;

function hasRetiredFightingSegment(url) {
  let pathname = url.pathname;
  try {
    pathname = decodeURIComponent(pathname);
  } catch {
    // A malformed encoded path stays blocked if its raw segments match.
  }
  return pathname
    .replace(/\\/g, '/')
    .split('/')
    .some((segment) => segment.toLowerCase() === 'fight' || segment.toLowerCase() === 'fighting');
}

function isContentHashedV14Request(url) {
  return url.origin === self.location.origin
    && !hasRetiredFightingSegment(url)
    && CONTENT_HASHED_V14_PATH.test(url.pathname);
}

function v14ContentHashPrefix(url) {
  return CONTENT_HASHED_V14_PATH.exec(url.pathname)?.[1]?.toLowerCase() ?? null;
}

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
      if (/^<link\b/i.test(match[0])) {
        const rel = /\brel\s*=\s*["']([^"']+)["']/i.exec(match[0])?.[1]?.toLowerCase() ?? '';
        const relTokens = rel.split(/\s+/);
        if (!relTokens.includes('stylesheet') && !relTokens.includes('modulepreload')) continue;
      }
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

async function loadOptionalV14Manifest(cache) {
  try {
    const { request, response } = await fetchForCache(V14_MANIFEST_URL);
    const manifest = await response.clone().json();
    if (!manifest || typeof manifest !== 'object'
      || manifest.schemaVersion !== 1 || !Array.isArray(manifest.entries)) return null;
    await cache.put(request, response);
    return manifest;
  } catch {
    // R5 and early private previews have no V14 runtime manifest. The bounded
    // legacy defaults below keep those builds installable and recoverable.
    return null;
  }
}

function manifestDefaultUrl(manifest, stableKey) {
  const entry = manifest?.entries?.find((candidate) => candidate?.stableKey === stableKey);
  const variant = entry?.variants?.performance
    ?? entry?.variants?.balanced
    ?? entry?.variants?.ultra;
  if (!variant || typeof variant.url !== 'string') return null;

  try {
    const url = new URL(variant.url, SCOPE_URL);
    return isContentHashedV14Request(url) ? url.href : null;
  } catch {
    return null;
  }
}

async function cacheDefaultArt(cache, manifest) {
  await Promise.all(DEFAULT_ART_PRECACHE.map(async ({ stableKey, fallbackPath }) => {
    const fallbackUrl = new URL(fallbackPath, SCOPE_URL).href;
    const preferredUrl = manifestDefaultUrl(manifest, stableKey);
    if (preferredUrl) {
      try {
        const { request, response } = await fetchForCache(preferredUrl);
        await verifyV14ResponseIntegrity(response, new URL(preferredUrl));
        if (!canStoreResponse(response)) throw new Error('V14 default art response is not cacheable.');
        await cache.put(request, response);
        return;
      } catch {
        // A missing or corrupt manifest target must fail closed to the one
        // known-good recovery asset instead of breaking worker installation.
      }
    }
    await cacheUrls(cache, [fallbackUrl], 1);
  }));
}

function normalizeEquippedArtRequest(data) {
  if (!data || data.type !== 'PAOPAO_CACHE_EQUIPPED_ART' || !Array.isArray(data.entries)
    || data.entries.length !== 6) return null;
  const normalized = [];
  const keys = new Set();
  for (const value of data.entries) {
    if (!value || typeof value !== 'object'
      || typeof value.stableKey !== 'string'
      || !/^bubble_[a-z0-9][a-z0-9_-]{0,62}_(?:blue|green|orange|purple|red|yellow)$/.test(value.stableKey)
      || typeof value.fallbackPath !== 'string'
      || !/^assets\/sprites\/[a-z0-9/-]+\.png$/.test(value.fallbackPath)
      || value.fallbackPath.includes('..')
      || value.fallbackPath.toLowerCase().includes('fighting')
      || keys.has(value.stableKey)) return null;
    keys.add(value.stableKey);
    normalized.push({
      stableKey: value.stableKey,
      fallbackPath: value.fallbackPath,
    });
  }
  return normalized;
}

async function cachedV14Manifest() {
  const shellCache = await caches.open(SHELL_CACHE);
  const response = await shellCache.match(V14_MANIFEST_URL);
  if (!response) return null;
  try {
    const manifest = await response.json();
    return manifest && typeof manifest === 'object' && Array.isArray(manifest.entries)
      ? manifest
      : null;
  } catch {
    return null;
  }
}

async function cacheEquippedArt(entries) {
  const manifest = await cachedV14Manifest();
  // Resolve and fully verify the complete six-piece family before replacing
  // the previous equipped-family cache, so a partial network failure cannot
  // discard the last known-good offline set.
  const prepared = await Promise.all(entries.map(async ({ stableKey, fallbackPath }) => {
    const preferredUrl = manifestDefaultUrl(manifest, stableKey);
    if (preferredUrl) {
      try {
        const { request, response } = await fetchForCache(preferredUrl);
        await verifyV14ResponseIntegrity(response, new URL(preferredUrl));
        if (!canStoreResponse(response)) throw new Error('V14 equipped art response is not cacheable.');
        return { request, response };
      } catch {
        // The immutable R5 family path below is the bounded recovery source.
      }
    }
    return fetchForCache(new URL(fallbackPath, SCOPE_URL).href);
  }));
  await caches.delete(EQUIPPED_ART_CACHE);
  const equippedCache = await caches.open(EQUIPPED_ART_CACHE);
  await Promise.all(prepared.map(({ request, response }) => equippedCache.put(request, response)));
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
  const fixedUrls = FIXED_PRECACHE_PATHS.map((path) => new URL(path, SCOPE_URL).href);
  await cacheUrls(cache, [...discoveredShellUrls, ...fixedUrls]);
  const v14Manifest = await loadOptionalV14Manifest(cache);
  await cacheDefaultArt(cache, v14Manifest);
  await cacheEquippedArt(DEFAULT_EQUIPPED_ART_PRECACHE);
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

self.addEventListener('message', (event) => {
  const entries = normalizeEquippedArtRequest(event.data);
  if (!entries) return;
  event.waitUntil(cacheEquippedArt(entries));
});

function canStoreResponse(response) {
  if (!response || !response.ok || response.status !== 200) return false;
  const cacheControl = response.headers.get('cache-control') ?? '';
  return !/\bno-store\b/i.test(cacheControl);
}

async function sha256Hex(bytes) {
  const subtle = self.crypto?.subtle;
  if (!subtle) throw new Error('v14-integrity-webcrypto-unavailable');
  const digest = await subtle.digest('SHA-256', bytes);
  return Array.from(
    new Uint8Array(digest),
    (byte) => byte.toString(16).padStart(2, '0'),
  ).join('');
}

async function verifyV14ResponseIntegrity(response, url) {
  const expectedPrefix = v14ContentHashPrefix(url);
  if (!expectedPrefix) throw new Error('v14-integrity-filename-missing');
  if (!response || !response.ok || response.status !== 200 || response.redirected) {
    throw new Error(`v14-integrity-response-invalid-${response?.status ?? 'missing'}`);
  }
  const bytes = await response.clone().arrayBuffer();
  const actualHash = await sha256Hex(bytes);
  if (!actualHash.startsWith(expectedPrefix)) throw new Error('v14-integrity-mismatch');
  return response;
}

function canonicalV14Request(request) {
  const headers = new Headers(request.headers);
  headers.delete('range');
  headers.delete('if-range');
  return new Request(request, { headers });
}

async function deleteCachedV14Request(shellCache, runtimeCache, equippedCache, request) {
  await Promise.all([
    shellCache.delete(request),
    runtimeCache.delete(request),
    equippedCache.delete(request),
  ]);
}

function v14IntegrityFailureResponse() {
  return new Response('PaoPao V14 art bundle failed integrity verification.', {
    status: 502,
    statusText: 'Bad Gateway',
    headers: {
      'cache-control': 'no-store',
      'content-type': 'text/plain; charset=utf-8',
    },
  });
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

async function v14ManifestNetworkFirst(request) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const response = await fetchWithDeadline(request);
    if (!response.ok || response.status !== 200) {
      throw new Error(`v14-manifest-unavailable-${response.status}`);
    }
    const contentType = response.headers.get('content-type') ?? '';
    if (!/application\/json/i.test(contentType)) throw new Error('v14-manifest-invalid-content-type');
    const manifest = await response.clone().json();
    if (!manifest || typeof manifest !== 'object'
      || manifest.schemaVersion !== 1 || !Array.isArray(manifest.entries)) {
      throw new Error('v14-manifest-invalid-shape');
    }
    if (canStoreResponse(response)) await cache.put(V14_MANIFEST_URL, response.clone());
    return response;
  } catch {
    const cached = await cache.match(V14_MANIFEST_URL);
    if (cached) return cached;
    return new Response('{"error":"V14 art manifest unavailable"}', {
      status: 503,
      headers: { 'content-type': 'application/json; charset=utf-8' },
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
  // arrayBuffer() exposes decoded entity bytes. Never retain an upstream
  // content-encoding header on a locally sliced response.
  headers.delete('content-encoding');
  headers.set('accept-ranges', 'bytes');
  headers.set('content-length', String(range.end - range.start + 1));
  headers.set('content-range', `bytes ${range.start}-${range.end}/${bytes.byteLength}`);
  return new Response(bytes.slice(range.start, range.end + 1), {
    status: 206,
    statusText: 'Partial Content',
    headers,
  });
}

async function v14BundleCacheFirst(request, url) {
  const shellCache = await caches.open(SHELL_CACHE);
  const runtimeCache = await caches.open(RUNTIME_CACHE);
  const equippedCache = await caches.open(EQUIPPED_ART_CACHE);
  const canonicalRequest = canonicalV14Request(request);
  const rangeHeader = request.headers.get('range');
  const cached = await equippedCache.match(canonicalRequest)
    ?? await shellCache.match(canonicalRequest)
    ?? await runtimeCache.match(canonicalRequest);

  if (cached) {
    try {
      await verifyV14ResponseIntegrity(cached, url);
      return rangeHeader ? rangeResponse(cached, rangeHeader) : cached;
    } catch {
      // Cache storage is not a trust boundary. Remove every copy before trying
      // the immutable network URL again.
      await deleteCachedV14Request(shellCache, runtimeCache, equippedCache, canonicalRequest);
    }
  }

  try {
    // A byte range cannot be compared with a whole-file content hash. Fetch the
    // full immutable object, verify it, cache only that verified response, then
    // synthesize a standards-compliant range from the verified entity bytes.
    const response = await fetch(canonicalRequest);
    await verifyV14ResponseIntegrity(response, url);
    if (canStoreResponse(response)) {
      await runtimeCache.put(canonicalRequest, response.clone());
    }
    return rangeHeader ? rangeResponse(response, rangeHeader) : response;
  } catch {
    await deleteCachedV14Request(shellCache, runtimeCache, equippedCache, canonicalRequest);
    return v14IntegrityFailureResponse();
  }
}

async function staticCacheFirst(request, url, lifetimeEvent) {
  const shellCache = await caches.open(SHELL_CACHE);
  const runtimeCache = await caches.open(RUNTIME_CACHE);
  const equippedCache = await caches.open(EQUIPPED_ART_CACHE);
  const cached = await equippedCache.match(request)
    ?? await shellCache.match(request)
    ?? await runtimeCache.match(request);
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

  // Retired fighting-mode files never belong to the public client, including
  // stale same-origin caches and cross-origin repository/CDN requests.
  if (hasRetiredFightingSegment(url)) {
    event.respondWith(new Response('Retired PaoPao asset path.', {
      status: 410,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    }));
    return;
  }

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

  // This mutable signed index is network-first. Content-addressed files may
  // remain cache-first, but an old manifest must never hide a newly approved
  // gate or point a fresh client at retired bundle identities.
  if (url.href === V14_MANIFEST_URL) {
    event.respondWith(v14ManifestNetworkFirst(request));
    return;
  }

  // V14 bundle files are immutable and content-addressed. They are never
  // warmed speculatively; the first scene request verifies and stores them.
  if (isContentHashedV14Request(url)) {
    event.respondWith(v14BundleCacheFirst(request, url));
    return;
  }

  if (isStaticRequest(request, url)) {
    event.respondWith(staticCacheFirst(request, url, event));
  }
});

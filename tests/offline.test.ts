import { createHash, webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { canRegisterOfflineShell, isLocalHostname } from '../src/game/offline';

const projectFile = (path: string): string => fileURLToPath(new URL(`../${path}`, import.meta.url));
const workerSource = readFileSync(projectFile('public/sw.js'), 'utf8');
const introSource = readFileSync(projectFile('src/scenes/IntroScene.ts'), 'utf8');
const manifest = JSON.parse(readFileSync(projectFile('public/manifest.webmanifest'), 'utf8')) as Record<string, unknown>;

interface IntegrityHarness {
  bundle: (request: Request, url: URL) => Promise<Response>;
  verify: (response: Response, url: URL) => Promise<Response>;
  prefix: (url: URL) => string | null;
  normalizeEquipped: (data: unknown) => Array<{ stableKey: string; fallbackPath: string }> | null;
  runtimeCache: string;
}

function createIntegrityHarness(
  fetcher: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
) {
  const stores = new Map<string, Map<string, Response>>();
  const stats = { puts: 0, deletes: 0 };
  const requestUrl = (input: RequestInfo | URL): string => (
    input instanceof Request ? input.url : String(input)
  );
  const cacheStorage = {
    async open(name: string) {
      const store = stores.get(name) ?? new Map<string, Response>();
      stores.set(name, store);
      return {
        async match(input: RequestInfo | URL) {
          return store.get(requestUrl(input))?.clone();
        },
        async put(input: RequestInfo | URL, response: Response) {
          stats.puts += 1;
          store.set(requestUrl(input), response.clone());
        },
        async delete(input: RequestInfo | URL) {
          stats.deletes += 1;
          return store.delete(requestUrl(input));
        },
      };
    },
    async keys() {
      return [...stores.keys()];
    },
    async delete(name: string) {
      return stores.delete(name);
    },
  };
  const context: Record<string, unknown> = {
    self: {
      registration: { scope: 'https://game.example/' },
      location: { origin: 'https://game.example' },
      crypto: webcrypto,
      clients: { claim: async () => undefined },
      addEventListener: () => undefined,
    },
    caches: cacheStorage,
    fetch: fetcher,
    URL,
    Request,
    Response,
    Headers,
    AbortController,
    DOMException,
    setTimeout,
    clearTimeout,
    console,
  };
  runInNewContext(`${workerSource}
globalThis.__integrityHarness = {
  bundle: v14BundleCacheFirst,
  verify: verifyV14ResponseIntegrity,
  prefix: v14ContentHashPrefix,
  normalizeEquipped: normalizeEquippedArtRequest,
  runtimeCache: RUNTIME_CACHE,
};`, context);
  const harness = context.__integrityHarness as IntegrityHarness;

  return {
    ...harness,
    stats,
    seed(cacheName: string, url: string, response: Response) {
      const store = stores.get(cacheName) ?? new Map<string, Response>();
      stores.set(cacheName, store);
      store.set(url, response.clone());
    },
  };
}

describe('offline shell registration policy', () => {
  it('permits supported secure origins and localhost only', () => {
    expect(canRegisterOfflineShell({ hasServiceWorker: true, isSecureContext: true, hostname: 'game.example' })).toBe(true);
    expect(canRegisterOfflineShell({ hasServiceWorker: true, isSecureContext: false, hostname: 'localhost' })).toBe(true);
    expect(canRegisterOfflineShell({ hasServiceWorker: true, isSecureContext: false, hostname: '127.0.0.1' })).toBe(true);
    expect(canRegisterOfflineShell({ hasServiceWorker: true, isSecureContext: false, hostname: '[::1]' })).toBe(true);
    expect(canRegisterOfflineShell({ hasServiceWorker: true, isSecureContext: false, hostname: '192.168.1.4' })).toBe(false);
    expect(canRegisterOfflineShell({ hasServiceWorker: false, isSecureContext: true, hostname: 'game.example' })).toBe(false);
    expect(isLocalHostname('studio.localhost')).toBe(true);
  });
});

describe('service worker routing invariants', () => {
  it('leaves API requests as normal network traffic before any respondWith branch', () => {
    const apiBypass = workerSource.indexOf('if (isApiRequest(url)) return;');
    const navigationBranch = workerSource.indexOf("if (request.mode === 'navigate')");
    const staticBranch = workerSource.indexOf('if (isStaticRequest(request, url))');

    expect(apiBypass).toBeGreaterThan(-1);
    expect(apiBypass).toBeLessThan(navigationBranch);
    expect(apiBypass).toBeLessThan(staticBranch);
    expect(workerSource).toContain("path.startsWith('/api/')");
  });

  it('uses network-first navigation, cache-first static assets and root/classic fallbacks', () => {
    expect(workerSource).toContain('event.respondWith(navigationNetworkFirst(request))');
    expect(workerSource).toContain('event.respondWith(staticCacheFirst(request, url, event))');
    expect(workerSource).toContain('const equippedCache = await caches.open(EQUIPPED_ART_CACHE)');
    expect(workerSource).toContain('?? await shellCache.match(request)');
    expect(workerSource).toContain('?? await runtimeCache.match(request)');
    expect(workerSource).toContain('const LAUNCHER_URL = SCOPE_URL.href');
    expect(workerSource).toContain("const INDEX_URL = new URL('classic/', SCOPE_URL).href");
    expect(workerSource).toContain('const fallbackUrl = isClassic ? INDEX_URL : LAUNCHER_URL');
    expect(workerSource).toContain('const cacheTarget = url.pathname === SCOPE_PATH ? LAUNCHER_URL : isClassic ? INDEX_URL : null');
    expect(workerSource).toContain('await cache.put(cacheTarget, response.clone())');
    expect(workerSource).not.toContain('await cache.put(fallbackUrl, response.clone())');
    expect(workerSource).toContain('const cached = await cache.match(fallbackUrl)');
    expect(workerSource).toContain('fetchWithDeadline(request)');
    expect(workerSource).toContain('const timeout = setTimeout(() => controller.abort(), timeoutMs)');
    expect(workerSource).toContain('if (!response.ok || !isHtml) throw');
  });

  it('caches both entry documents, discovers the Phaser bundle and cleans old versioned caches', () => {
    expect(workerSource).toContain('discoverShellUrls(html, INDEX_URL)');
    expect(workerSource).toContain('await cache.put(launcherRequest, launcherResponse)');
    expect(workerSource).toContain('await cache.put(indexRequest, indexResponse)');
    expect(workerSource).toContain('/<script\\b[^>]*\\bsrc');
    expect(workerSource).toContain('const baseMatch = /<base\\b');
    expect(workerSource).toContain('new URL(match[1], documentBase)');
    expect(workerSource).toContain("!relTokens.includes('stylesheet') && !relTokens.includes('modulepreload')");
    expect(workerSource).toContain('name.startsWith(CACHE_PREFIX) && !CURRENT_CACHES.has(name)');
    expect(workerSource).toContain('self.clients.claim()');
  });

  it('preloads only manifests, fonts, poster, default realm and equipped-family recovery art', () => {
    const quotedPaths = [...workerSource.matchAll(/'((?:assets|manifest|mediapipe)[^']+)'/g)]
      .map((match) => match[1])
      .filter((path) => !path.includes('${'));

    expect(quotedPaths).toContain('manifest.webmanifest');
    expect(quotedPaths).toContain('assets/v14/art-manifest.json');
    expect(quotedPaths).toContain('assets/fonts/paopao-display-cinzel-latin.woff2');
    expect(quotedPaths).toContain('assets/fonts/fusion-sans-sora-latin.woff2');
    expect(quotedPaths).toContain('assets/worlds/v12/world-luma-orchard-hd.jpg');
    expect(quotedPaths).toContain('assets/cinematics/previews-v2/frame-00750ms.jpg');
    expect(quotedPaths).toContain('assets/sprites/v6/nova-blue.png');
    expect(quotedPaths).toContain('assets/sprites/v6/nova-yellow.png');
    expect(quotedPaths.some((path) => path.startsWith('assets/icons/'))).toBe(false);
    expect(quotedPaths.some((path) => path.startsWith('mediapipe/'))).toBe(false);
    expect(workerSource).toContain('loadOptionalV14Manifest(cache)');
    expect(workerSource).toContain('manifestDefaultUrl(manifest, stableKey)');
    expect(workerSource).toContain("entry?.variants?.performance");
    expect(workerSource).toContain('await cacheDefaultArt(cache, v14Manifest)');
    expect(workerSource).toContain('await cacheEquippedArt(DEFAULT_EQUIPPED_ART_PRECACHE)');
    expect(workerSource).toContain("data.type !== 'PAOPAO_CACHE_EQUIPPED_ART'");
    expect(workerSource).toContain('event.waitUntil(cacheEquippedArt(entries))');
    expect(workerSource).toContain('await caches.delete(EQUIPPED_ART_CACHE)');
    for (const path of new Set(quotedPaths)) {
      if (path === 'assets/v14/art-manifest.json') continue;
      expect(() => readFileSync(projectFile(`public/${path}`))).not.toThrow();
    }
  });

  it('loads content-addressed V14 bundles lazily and blocks retired combat media', () => {
    expect(workerSource).toContain('const CONTENT_HASHED_V14_PATH =');
    expect(workerSource).toContain('function isContentHashedV14Request(url)');
    expect(workerSource).toContain('if (isContentHashedV14Request(url))');
    expect(workerSource).toContain('event.respondWith(v14BundleCacheFirst(request, url))');
    expect(workerSource).toContain("subtle.digest('SHA-256', bytes)");
    expect(workerSource).toContain('actualHash.startsWith(expectedPrefix)');
    expect(workerSource).toContain('await deleteCachedV14Request(shellCache, runtimeCache, equippedCache, canonicalRequest)');
    expect(workerSource).toContain('await runtimeCache.put(canonicalRequest, response.clone())');
    expect(workerSource).toContain('if (hasRetiredFightingSegment(url))');
    expect(workerSource).toContain("status: 410");
    expect(workerSource.indexOf('if (hasRetiredFightingSegment(url))'))
      .toBeLessThan(workerSource.indexOf('if (url.origin !== self.location.origin) return;'));
  });

  it('refreshes the mutable V14 manifest network-first while keeping hashed bundles cache-first', () => {
    const manifestBranch = workerSource.indexOf('if (url.href === V14_MANIFEST_URL)');
    const bundleBranch = workerSource.indexOf('if (isContentHashedV14Request(url))');

    expect(workerSource).toContain('async function v14ManifestNetworkFirst(request)');
    expect(workerSource).toContain('await cache.put(V14_MANIFEST_URL, response.clone())');
    expect(workerSource).toContain('const cached = await cache.match(V14_MANIFEST_URL)');
    expect(workerSource).toContain('event.respondWith(v14ManifestNetworkFirst(request))');
    expect(manifestBranch).toBeGreaterThan(-1);
    expect(manifestBranch).toBeLessThan(bundleBranch);
  });

  it('streams heavyweight media without making it part of blocking install', () => {
    const precacheStart = workerSource.indexOf('const FIXED_PRECACHE_PATHS =');
    const precacheEnd = workerSource.indexOf('const STATIC_DESTINATIONS =');
    const precacheSource = workerSource.slice(precacheStart, precacheEnd);
    expect(precacheStart).toBeGreaterThan(-1);
    expect(precacheEnd).toBeGreaterThan(precacheStart);
    expect(precacheSource).not.toContain('assets/cinematics/paopao-opening-final-light-1080.mp4');
    expect(precacheSource).not.toContain('assets/audio/');
    expect(workerSource).toContain('mp4');
    expect(workerSource).toContain('ogg');
    expect(workerSource).toContain("CACHE_VERSION = 'art-v14-delivery-2026-07-28-v21'");
    expect(workerSource).not.toContain('const FULL_MEDIA_WARMUPS = new Map()');
    expect(workerSource).toContain('rangeHeader && isStreamedMediaRequest(request, url)');
    expect(workerSource).toContain("request.destination === 'audio'");
    expect(workerSource).not.toContain('warmFullMedia(url)');
    expect(workerSource).toContain('const response = await fetchWithDeadline(request);');
    expect(workerSource).toContain('stream-unavailable-${response.status}');
    expect(workerSource).toContain('event.respondWith(staticCacheFirst(request, url, event))');
    expect(introSource).toContain('Phaser.GameObjects.Events.VIDEO_LOCKED');
  });

  it('stages worker updates instead of replacing a running hashed bundle', () => {
    expect(workerSource).toContain('event.waitUntil(installOfflineShell())');
    expect(workerSource).not.toContain('installOfflineShell().then(() => self.skipWaiting())');
  });

  it('never masks the retired 3D route with a cached HTML fallback', () => {
    const retiredBypass = workerSource.indexOf("url.pathname === `${SCOPE_PATH}3d`");
    const navigationBranch = workerSource.indexOf("if (request.mode === 'navigate') {");
    expect(retiredBypass).toBeGreaterThan(-1);
    expect(retiredBypass).toBeLessThan(navigationBranch);
    expect(workerSource).toContain("url.pathname.startsWith(`${SCOPE_PATH}3d/`)");
  });
});

describe('content-addressed V14 service-worker integrity', () => {
  const payload = new TextEncoder().encode('verified PaoPao V14 bundle bytes');
  const digest = createHash('sha256').update(payload).digest('hex');
  const assetUrl = `https://game.example/assets/v14/bundles/core/lumi.${digest.slice(0, 12)}.webp`;

  it('accepts exactly one safe six-colour equipped family and rejects traversal or partial payloads', () => {
    const harness = createIntegrityHarness(async () => new Response(payload));
    const colors = ['blue', 'green', 'orange', 'purple', 'red', 'yellow'];
    const entries = colors.map((color) => ({
      stableKey: `bubble_aurora_${color}`,
      fallbackPath: `assets/sprites/v7/aurora-${color}.png`,
    }));
    expect(harness.normalizeEquipped({
      type: 'PAOPAO_CACHE_EQUIPPED_ART',
      entries,
    })).toEqual(entries);
    expect(harness.normalizeEquipped({
      type: 'PAOPAO_CACHE_EQUIPPED_ART',
      entries: entries.slice(0, 5),
    })).toBeNull();
    expect(harness.normalizeEquipped({
      type: 'PAOPAO_CACHE_EQUIPPED_ART',
      entries: entries.map((entry, index) => index === 0
        ? { ...entry, fallbackPath: 'assets/sprites/../fighting/escape.png' }
        : entry),
    })).toBeNull();
  });

  it('accepts only bytes matching the content hash embedded in the filename', async () => {
    const harness = createIntegrityHarness(async () => new Response(payload));
    const url = new URL(assetUrl);

    expect(harness.prefix(url)).toBe(digest.slice(0, 12));
    await expect(harness.verify(new Response(payload), url)).resolves.toBeInstanceOf(Response);
    await expect(harness.verify(new Response('corrupt bytes'), url)).rejects.toThrow('v14-integrity-mismatch');
  });

  it('fails closed and never caches a corrupt network bundle', async () => {
    const harness = createIntegrityHarness(async () => new Response('corrupt bytes', { status: 200 }));
    const response = await harness.bundle(new Request(assetUrl), new URL(assetUrl));

    expect(response.status).toBe(502);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(harness.stats.puts).toBe(0);
  });

  it('purges corrupt cached bytes before failing a corrupt network retry', async () => {
    const harness = createIntegrityHarness(async () => new Response('also corrupt', { status: 200 }));
    harness.seed(harness.runtimeCache, assetUrl, new Response('corrupt cached bytes', { status: 200 }));

    const response = await harness.bundle(new Request(assetUrl), new URL(assetUrl));
    expect(response.status).toBe(502);
    expect(harness.stats.deletes).toBeGreaterThanOrEqual(2);
    expect(harness.stats.puts).toBe(0);
  });

  it('verifies a complete entity before caching and serving a requested media range', async () => {
    let observedRange: string | null = 'not-fetched';
    const harness = createIntegrityHarness(async (input) => {
      observedRange = new Request(input).headers.get('range');
      return new Response(payload, {
        status: 200,
        headers: {
          'content-length': String(payload.byteLength),
          'content-type': 'image/webp',
        },
      });
    });
    const request = new Request(assetUrl, { headers: { Range: 'bytes=2-9' } });
    const response = await harness.bundle(request, new URL(assetUrl));

    expect(observedRange).toBeNull();
    expect(response.status).toBe(206);
    expect(response.headers.get('content-range')).toBe(`bytes 2-9/${payload.byteLength}`);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(payload.slice(2, 10));
    expect(harness.stats.puts).toBe(1);
  });
});

describe('web app manifest', () => {
  it('describes the story game as a portrait standalone app with a real local icon', () => {
    expect(manifest.name).toBe('PaoPao Fusion: The Shattered Crown');
    expect(manifest.display).toBe('standalone');
    expect(manifest.orientation).toBe('portrait');
    expect(manifest.start_url).toBe('./');

    const icons = manifest.icons as Array<{ src: string; sizes: string; type: string; purpose: string }>;
    expect(icons.map((icon) => [icon.sizes, icon.purpose])).toEqual([
      ['192x192', 'any'],
      ['512x512', 'any'],
      ['512x512', 'maskable'],
    ]);
    for (const icon of icons) {
      expect(icon.type).toBe('image/png');
      expect(() => readFileSync(projectFile(`public/${icon.src.replace(/^\.\//, '')}`))).not.toThrow();
    }
  });
});

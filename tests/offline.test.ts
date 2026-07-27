import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { canRegisterOfflineShell, isLocalHostname } from '../src/game/offline';

const projectFile = (path: string): string => fileURLToPath(new URL(`../${path}`, import.meta.url));
const workerSource = readFileSync(projectFile('public/sw.js'), 'utf8');
const introSource = readFileSync(projectFile('src/scenes/IntroScene.ts'), 'utf8');
const manifest = JSON.parse(readFileSync(projectFile('public/manifest.webmanifest'), 'utf8')) as Record<string, unknown>;

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
    expect(workerSource).toContain('const cached = await shellCache.match(request) ?? await runtimeCache.match(request)');
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
    expect(workerSource).toContain('name.startsWith(CACHE_PREFIX) && !CURRENT_CACHES.has(name)');
    expect(workerSource).toContain('self.clients.claim()');
  });

  it('ships every explicit core shell resource from the public directory', () => {
    const quotedPaths = [...workerSource.matchAll(/'((?:assets|manifest|mediapipe)[^']+)'/g)]
      .map((match) => match[1])
      .filter((path) => !path.includes('${'));

    expect(quotedPaths).toContain('manifest.webmanifest');
    expect(quotedPaths).toContain('assets/fonts/paopao-display-cinzel-latin.woff2');
    expect(quotedPaths).toContain('assets/fonts/fusion-sans-sora-latin.woff2');
    expect(quotedPaths).toContain('assets/icons/icon-maskable-512.png');
    expect(quotedPaths).toContain('assets/cinematics/previews-v2/frame-00750ms.jpg');
    expect(quotedPaths).toContain('assets/worlds/v12/world-luma-orchard-hd.jpg');
    expect(quotedPaths).toContain('mediapipe/models/hand_landmarker.task');
    expect(quotedPaths).toContain('mediapipe/wasm/vision_wasm_internal.wasm');
    for (const path of new Set(quotedPaths)) {
      expect(() => readFileSync(projectFile(`public/${path}`))).not.toThrow();
    }
  });

  it('streams heavyweight media without making it part of blocking install', () => {
    const shellPaths = workerSource.match(/const CORE_SHELL_PATHS = \[([\s\S]*?)\n\];/)?.[1] ?? '';
    expect(shellPaths).not.toContain('assets/cinematics/paopao-opening-final-light-1080.mp4');
    expect(shellPaths).not.toContain('assets/audio/');
    expect(workerSource).toContain('mp4');
    expect(workerSource).toContain('ogg');
    expect(workerSource).toContain("CACHE_VERSION = 'luma-orchard-2026-07-24-v17'");
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

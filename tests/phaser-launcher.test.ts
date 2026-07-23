import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const projectFile = (path: string): string => fileURLToPath(new URL(`../${path}`, import.meta.url));
const readText = (path: string): string => readFileSync(projectFile(path), 'utf8');

describe('Phaser-only launcher and install hub', () => {
  it('uses a Phaser-only smart launcher at root and keeps the game at /classic', () => {
    const game = readText('index.html');
    const launcher = readText('public/choose/index.html');
    const vite = readText('vite.config.ts');
    expect(game).toContain('PaoPao Fusion · The Shattered Crown');
    expect(game).toContain('<script type="module" src="/src/main.ts"></script>');
    expect(launcher).toContain('PaoPao Fusion · Smart Launcher');
    expect(launcher).toContain('href="/classic/"');
    expect(launcher).toContain('href="/downloads/"');
    expect(launcher).not.toContain('href="/3d/"');
    expect(launcher).toContain("const quality=!webgl2||(!memory?false:memory<=4)?'performance':memory>=8?'ultra':'balanced'");
    expect(vite).toContain("const builtHtml = injectReleaseMeta(readFileSync(resolve(destination, 'index.html'), 'utf8'))");
    expect(vite).toContain("writeFileSync(resolve(classicDirectory, 'index.html'), builtHtml.replace");
    expect(vite).toContain("const launcherHtml = injectReleaseMeta(readFileSync(resolve(source, 'choose', 'index.html'), 'utf8'))");
    expect(vite.indexOf("writeFileSync(resolve(classicDirectory, 'index.html')"))
      .toBeLessThan(vite.indexOf("writeFileSync(resolve(destination, 'index.html'), launcherHtml)"));
  });

  it('publishes browser, Windows and Android as one installable Phaser web app', () => {
    const manifest = JSON.parse(readText('public/downloads/release-manifest.json'));
    expect(manifest).toMatchObject({
      schemaVersion: 2,
      client: 'classic',
      engine: 'phaser-3.90.0',
      deliveryPolicy: 'installable-web-app',
      nativeBinaries: { published: false },
    });
    expect(manifest.channels.map(({ id }: { id: string }) => id)).toEqual(['browser', 'windows', 'android']);
    for (const channel of manifest.channels) {
      expect(channel.available).toBe(true);
      expect(channel.href).toMatch(/^\/classic\/(?:\?install=pwa)?$/);
    }
  });

  it('makes /downloads a capability-checked PWA and verified-backup hub', () => {
    const html = readText('public/downloads/index.html');
    expect(html).toContain("window.addEventListener('beforeinstallprompt'");
    expect(html).toContain("fetchJson('/downloads/release-manifest.json'");
    expect(html).toContain("fetchJson('/api/v3/content/manifest'");
    expect(html).toContain("fetchJson('/dl/manifest.json'");
    expect(html).toContain("release.schemaVersion === 2 && release.client === 'classic'");
    expect(html).toContain("channel.available === true && safeRoute(channel.href)");
    expect(html).toContain("/(?:\\.tar\\.gz|\\.sha256|\\.mp4)$/i");
    expect(html).toContain('Guides & verified game backups');
    expect(html).toContain("navigator.serviceWorker.register('/sw.js'");
    expect(html).not.toMatch(/href="\/dl\/[^"/]+/);
  });
});

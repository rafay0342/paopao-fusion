import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const projectFile = (path: string): string => fileURLToPath(new URL(`../${path}`, import.meta.url));
const readText = (path: string): string => readFileSync(projectFile(path), 'utf8');

describe('first-impression shell', () => {
  it('renders branded DOM content before Phaser and hands off on the boot event', () => {
    const html = readText('index.html');

    expect(html).toContain('id="app-splash"');
    expect(html).toContain('PAOPAO FUSION');
    expect(html).toContain('The Shattered Crown');
    expect(html).toContain('Powered by RafayGen AI');
    expect(html).toContain("window.addEventListener('paopao:boot-visible'");
    expect(html).toContain('900 - (performance.now() - shownAt)');
    expect(html).toContain('@media (prefers-reduced-motion: reduce)');
    expect(html.toLowerCase()).not.toContain('shimmer');
  });

  it('bundles two local font roles and bounds font startup waiting', () => {
    const html = readText('index.html');
    const fontCss = readText('public/assets/fonts/fonts.css');
    const uiSource = readText('src/gfx/ui.ts');
    const mainSource = readText('src/main.ts');

    expect(html).toContain('./assets/fonts/fonts.css');
    expect(fontCss).toContain('font-family: "PaoPao Display"');
    expect(fontCss).toContain('font-family: "Fusion Sans"');
    expect(uiSource).toContain('export const DISPLAY_FONT');
    expect(uiSource).toContain('export const UI_FONT');
    expect(mainSource).toContain('FONT_STARTUP_BUDGET_MS = 1800');
    expect(mainSource).toContain('Promise.race([requestedFonts, timeout])');
    expect(mainSource).toContain("dataset.gameFonts = fontsReady ? 'ready' : 'fallback'");

    expect(() => readFileSync(projectFile('public/assets/fonts/paopao-display-cinzel-latin.woff2'))).not.toThrow();
    expect(() => readFileSync(projectFile('public/assets/fonts/fusion-sans-sora-latin.woff2'))).not.toThrow();
  });

  it('ships correctly sized standard, install and maskable icons', () => {
    const dimensions = (path: string): [number, number] => {
      const png = readFileSync(projectFile(path));
      return [png.readUInt32BE(16), png.readUInt32BE(20)];
    };

    expect(dimensions('public/assets/icons/icon-192.png')).toEqual([192, 192]);
    expect(dimensions('public/assets/icons/icon-512.png')).toEqual([512, 512]);
    expect(dimensions('public/assets/icons/icon-maskable-512.png')).toEqual([512, 512]);
    expect(dimensions('public/assets/icons/apple-touch-icon.png')).toEqual([180, 180]);
    expect(dimensions('public/assets/icons/favicon-32.png')).toEqual([32, 32]);
  });

  it('hands the DOM splash to a real-progress boot and a resilient cinematic', () => {
    const bootSource = readText('src/scenes/BootScene.ts');
    const introSource = readText('src/scenes/IntroScene.ts');

    expect(bootSource).toContain("CustomEvent('paopao:boot-visible')");
    expect(bootSource).toContain("this.load.on('progress', onProgress)");
    expect(bootSource).toContain("this.load.on('fileprogress', onFileProgress)");
    expect(bootSource).toContain('WORLD_THEMES.map');
    expect(bootSource).toContain('(index + 1) / realmSeals.length');
    expect(bootSource).toContain("assets/cinematics/previews-v2/frame-00750ms.jpg");

    expect(introSource).toContain("type IntroPlaybackState = 'loading' | 'buffering'");
    expect(introSource).toContain("Phaser.GameObjects.Events.VIDEO_ERROR");
    expect(introSource).toContain("Phaser.GameObjects.Events.VIDEO_UNSUPPORTED");
    expect(introSource).toContain('VITE_INTRO_VIDEO_1080_URL');
    expect(introSource).toContain("window.matchMedia('(prefers-reduced-motion: reduce)')");
    expect(introSource).toContain("assets/cinematics/paopao-opening-final-light-1080.mp4");
    expect(introSource).not.toContain("const VIDEO_URL = 'assets/cinematics/paopao-opening-v2.mp4'");
    expect(introSource).not.toContain('paopao-fusion-clean-full-stitch-rafaygen-outro-4k-ai.mp4');

    const finalLightIntro = readFileSync(projectFile('public/assets/cinematics/paopao-opening-final-light-1080.mp4'));
    expect(createHash('sha256').update(finalLightIntro).digest('hex'))
      .toBe('eda9d2f2725069c7fa01066bfbafd62dc9630d1b65a405a9818677ca80d68b5c');
  });
});

import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const projectFile = (path: string): string => fileURLToPath(new URL(`../${path}`, import.meta.url));
const readText = (path: string): string => readFileSync(projectFile(path), 'utf8');

describe('V13 art, responsive launcher and accessible interaction contract', () => {
  it('keeps browser zoom available and handles safe areas plus compact landscape coaching', () => {
    const shell = readText('index.html');
    expect(shell).not.toContain('maximum-scale=1');
    expect(shell).not.toContain('user-scalable=no');
    expect(shell).toContain('env(safe-area-inset-top)');
    expect(shell).toContain('id="orientation-coach"');
    expect(shell).toContain('(orientation: landscape) and (max-height: 560px)');
  });

  it('puts one real play action above launcher diagnostics on small screens', () => {
    const launcher = readText('public/choose/index.html');
    expect(launcher).toContain('id="hero-play"');
    expect(launcher).toContain('Play PaoPao Fusion');
    expect(launcher).toContain('<details class="diagnostics"');
    expect(launcher.indexOf('id="hero-play"')).toBeLessThan(launcher.indexOf('<details class="diagnostics"'));
  });

  it('mounts persistent scene semantics and mirrors Phaser controls as native buttons', () => {
    const ui = readText('src/gfx/ui.ts');
    const game = readText('src/scenes/GameScene.ts');
    const main = readText('src/main.ts');
    const launcher = readText('public/choose/index.html');
    const vite = readText('vite.config.ts');
    expect(ui).toContain('ensureAccessibleScene(scene)');
    expect(ui).toContain('registerButton({');
    expect(game).toContain("id: 'game-fire'");
    expect(game).toContain("id: 'game-hand-tracking'");
    expect(game).toContain("event.key === 'ArrowLeft'");
    expect(main).toContain("game.canvas.setAttribute('role', 'application')");
    expect(main).toContain('game.canvas.tabIndex = 0');
    expect(launcher).not.toContain('/fight/');
    expect(launcher).not.toContain('Shattered Tribunal');
    expect(vite).not.toContain("fight: resolve('fight/index.html')");
    expect(vite).toContain("resolve(source, 'assets', 'fighting')");
    expect(vite).toContain("entry.name === 'appdeploy'");
  });

  it('ships original transparent masters through lightweight alpha WebP runtime variants', () => {
    for (const path of [
      'public/assets/characters/v13/prism-keeper-hero.webp',
      'public/assets/characters/v13/lumi-guide.webp',
    ]) {
      const bytes = readFileSync(projectFile(path));
      expect(bytes.subarray(0, 4).toString('ascii')).toBe('RIFF');
      expect(bytes.subarray(8, 12).toString('ascii')).toBe('WEBP');
      expect(statSync(projectFile(path)).size).toBeLessThan(300_000);
    }
    expect(() => readFileSync(projectFile('art-source/v13/characters/prism-keeper-hero-chroma.png'))).not.toThrow();
    expect(() => readFileSync(projectFile('art-source/v13/characters/lumi-guide-chroma-master.png'))).not.toThrow();
  });

  it('respects reduced motion for background parallax and story character staging', () => {
    const ui = readText('src/gfx/ui.ts');
    const story = readText('src/scenes/StoryScene.ts');
    const boot = readText('src/scenes/BootScene.ts');
    expect(ui).toContain('quality.parallax && !prefersReducedMotion()');
    expect(story).toContain('scaleX: spiritScaleX');
    expect(story).toContain('if (reducedMotion)');
    expect(boot).toContain("INTRO_SEEN_KEY");
    expect(boot).toContain("get('intro') === '1'");
  });
});

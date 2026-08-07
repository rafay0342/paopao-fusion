import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string): string => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

describe('strict mobile viewport regression contract', () => {
  it('blocks short coarse-pointer landscape instead of shrinking gameplay', () => {
    const shell = read('index.html');

    expect(shell).toContain('role="dialog"');
    expect(shell).toContain('aria-modal="true"');
    expect(shell).toContain("toggleAttribute('inert', shouldShow)");
    expect(shell).toContain('GAME RESUMES AUTOMATICALLY');
    expect(shell).not.toContain('Continue landscape');
    expect(shell).not.toContain('landscape-coach-dismissed');
  });

  it('keeps classic command wings above hosting chrome and outside the launcher lane', () => {
    const game = read('src/scenes/GameScene.ts');

    expect(game).toContain('const powerY = height - 162');
    expect(game).toContain('const superX = 222');
    expect(game).toContain('const queueCard = this.addSlimHudStrip(width - 170, powerY');
    expect(game).toContain('const handCard = this.addSlimHudStrip(width - 50, powerY');
  });

  it('uses separated campaign-map steps and compact label cards', () => {
    const map = read('src/scenes/WorldMapScene.ts');

    expect(map).toContain('{ x: 220, y: 468, side: 1 }');
    expect(map).toContain('{ x: 232, y: 1_138, side: 1 }');
    expect(map).toContain('const chipWidth = 214');
    expect(map).toContain('chipWidth + 20, 78, 12');
    expect(map).not.toContain('chipWidth + 20, 101, 14');
  });

  it('keeps Match-3 actions above a backed, concise instruction strip', () => {
    const match3 = read('src/scenes/Match3Scene.ts');

    expect(match3).toContain("1_096, 'HINT'");
    expect(match3).toContain("1_096, 'RESTART'");
    expect(match3).toContain("addArtPanel(this, VIEW.width / 2, 1_166, 664, 52");
    expect(match3).toContain('HAND / EYES OPTIONAL');
  });

  it('does not start vision inference for an ordinary touch-only route', () => {
    const main = read('src/main.ts');
    const modes = read('src/scenes/ModeSelectScene.ts');
    const game = read('src/scenes/GameScene.ts');
    const match3 = read('src/scenes/Match3Scene.ts');

    expect(main.slice(main.indexOf('async function startGame()'))).not.toContain('getHandTracker().prepare()');
    expect(modes).not.toContain('getHandTracker().prepare()');
    expect(game).not.toContain('tracker.prepare().catch');
    expect(match3).not.toContain('tracker.prepare().catch');
  });

  it('enforces one shared gutter for panels, controls, icons and dynamic text', () => {
    const ui = read('src/gfx/ui.ts');

    expect(ui).toContain('export const UI_SAFE_GUTTER = 24');
    expect(ui).toContain('export function constrainTextToSafeViewport');
    expect(ui).toContain('VIEW.width - UI_SAFE_GUTTER * 2');
    expect(ui).toContain('VIEW.height - UI_SAFE_GUTTER * 2');
    expect(ui).toContain('Phaser.Scenes.Events.POST_UPDATE, keepDynamicTextSafe');
    expect(ui).toContain('.setDisplaySize(width, height)');
    expect(ui).not.toContain('.setDisplaySize(width + 12, height + 12)');
  });

  it('keeps every production scene on the global dynamic-text safety pass', () => {
    const sceneNames = [
      'Account', 'ArcadeHub', 'Challenges', 'Chronicle', 'Competitive', 'Ending',
      'Endless', 'Gallery', 'Game', 'GazeSetup', 'HandSetup', 'Inventory',
      'Match3Map', 'Match3', 'MemoryConstellation', 'Menu', 'ModeSelect',
      'ProductionArchive', 'ProductionExperience', 'ProductionSystems', 'Rewards',
      'Social', 'Store', 'Story', 'WorldMap',
    ];
    for (const scene of sceneNames) {
      expect(read(`src/scenes/${scene}Scene.ts`), `${scene} should enforce safe text`).toContain('sharpenSceneText(this)');
    }
  });

  it('treats a malformed auth-provider response as an empty provider list', () => {
    const platform = read('src/game/platform.ts');
    expect(platform).toContain('Array.isArray(response.providers) ? response.providers : []');
  });
});

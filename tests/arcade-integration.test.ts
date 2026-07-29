import { existsSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  ARCADE_GAME_CATALOG,
  ARCADE_GAME_IDS,
} from '../src/game/arcade';
import {
  ARCADE_WORLD_IMAGES,
  arcadeWorldTextureKey,
} from '../src/game/arcade-art';
import {
  ACTIVE_GAMEPLAY_SCENE_KEYS,
  isActiveGameplayScene,
} from '../src/game/playable-scenes';

const projectFile = (path: string): string => fileURLToPath(new URL(`../${path}`, import.meta.url));
const readText = (path: string): string => readFileSync(projectFile(path), 'utf8');

describe('V15 PaoPao Arcade cross-scene integration', () => {
  it('exposes three distinct deterministic games with explicit scene contracts', () => {
    expect(ARCADE_GAME_IDS).toEqual([
      'prism-sprint',
      'nexus-aim',
      'memory-constellation',
    ]);
    expect(ARCADE_GAME_CATALOG).toHaveLength(3);
    expect(Object.isFrozen(ARCADE_GAME_CATALOG)).toBe(true);
    expect(new Set(ARCADE_GAME_CATALOG.map(({ id }) => id)).size).toBe(3);
    expect(new Set(ARCADE_GAME_CATALOG.map(({ route }) => route)).size).toBe(3);

    expect(ARCADE_GAME_CATALOG.map(({ id, route, sceneData }) => ({
      id,
      route,
      sceneData,
    }))).toEqual([
      {
        id: 'prism-sprint',
        route: 'Match3',
        sceneData: { variant: 'sprint' },
      },
      {
        id: 'nexus-aim',
        route: 'Endless',
        sceneData: { practice: true },
      },
      {
        id: 'memory-constellation',
        route: 'MemoryConstellation',
        sceneData: undefined,
      },
    ]);
  });

  it('treats every routed game as gameplay for back handling and quality boundaries', () => {
    expect(ACTIVE_GAMEPLAY_SCENE_KEYS).toEqual([
      'Game',
      'Match3',
      'Endless',
      'MemoryConstellation',
    ]);
    ARCADE_GAME_CATALOG.forEach(({ route }) => {
      expect(isActiveGameplayScene(route), `${route} should be a gameplay boundary`).toBe(true);
    });
    for (const nonGameplayScene of ['ArcadeHub', 'ModeSelect', 'GazeSetup', 'HandSetup', 'Menu']) {
      expect(isActiveGameplayScene(nonGameplayScene)).toBe(false);
    }

    const navigation = readText('src/game/navigation.ts');
    const performance = readText('src/game/performance.ts');
    expect(navigation).toContain("import { isActiveGameplayScene } from './playable-scenes'");
    expect(performance).toContain("import { isActiveGameplayScene } from './playable-scenes'");
    expect(navigation).toContain('isActiveGameplayScene(active.scene.key)');
    expect(performance).toContain('isActiveGameplayScene(scene.scene.key)');
  });

  it('registers the hub and all three destinations behind compatible release gates', () => {
    const main = readText('src/main.ts');
    const modes = readText('src/scenes/ModeSelectScene.ts');
    const hub = readText('src/scenes/ArcadeHubScene.ts');

    expect(main).toContain("import { ArcadeHubScene } from './scenes/ArcadeHubScene'");
    expect(main).toContain("import { MemoryConstellationScene } from './scenes/MemoryConstellationScene'");
    expect(main).toMatch(/completeGameplay \? \[[\s\S]*Match3Scene,[\s\S]*ArcadeHubScene,[\s\S]*MemoryConstellationScene/);
    expect(main).toMatch(/endlessLiveOperations \? \[EndlessScene\]/);
    expect(main).toContain('renderSurface: {');
    expect(main).toContain('worldView: {');

    expect(modes).toContain('PHASER_RELEASE_FEATURES.completeGameplay && PHASER_RELEASE_FEATURES.endlessLiveOperations');
    expect(modes).toContain("'PAOPAO ARCADE'");
    expect(modes).toContain("this.scene.start('ArcadeHub')");

    expect(hub).toContain('const PAGE_SIZE = 2');
    expect(hub).toContain('ARCADE_GAME_CATALOG.slice(start, start + PAGE_SIZE)');
    expect(hub).toContain('this.scene.start(game.route, game.sceneData ? { ...game.sceneData } : undefined)');
    expect(hub).toContain('setArtButtonHitArea');
    expect(hub).toContain('accessibilityRuntimeForCanvas(this.game.canvas).mountScene');
    expect(hub).toContain("label: 'Previous arcade page'");
    expect(hub).toContain("label: 'Next arcade page'");
    expect(hub).toContain('fadeIn(prefersReducedMotion() ? 0 : 170');
  });

  it('binds each mode to its intended daily/local variant and generated realm art', () => {
    const match3 = readText('src/scenes/Match3Scene.ts');
    const endless = readText('src/scenes/EndlessScene.ts');
    const memory = readText('src/scenes/MemoryConstellationScene.ts');

    expect(match3).toContain("variant?: 'campaign' | 'sprint'");
    expect(match3).toContain("recordArcadeResult('prism-sprint'");
    expect(match3).toContain("this.isSprint() ? arcadeWorldTextureKey('rainway', getMeta().quality)");
    expect(match3).toContain('pointer.positionToCamera(this.cameras.main)');
    expect(match3).not.toMatch(/cellAtPoint\(pointer\.(?:x|y)/);

    expect(endless).toContain('type EndlessSceneData = { event?: boolean; practice?: boolean }');
    expect(endless).toContain("recordArcadeResult('nexus-aim'");
    expect(endless).toContain("this.practice ? arcadeWorldTextureKey('rainway', getMeta().quality)");

    expect(memory).toContain("super('MemoryConstellation')");
    expect(memory).toContain("recordArcadeResult('memory-constellation'");
    expect(memory).toContain("arcadeWorldTextureKey('memory', meta.quality)");

    const localProgress = readText('src/game/arcade-progress.ts');
    expect(localProgress).toContain("const STORAGE_KEY = 'paopao-arcade-progress-v1'");
    expect(localProgress).toContain('localStorage.setItem(STORAGE_KEY');
    expect(localProgress).not.toMatch(/\b(?:fetch|submitRunV3|addCoins|grantCoins|setCoins)\s*\(/);

    const competitive = readText('src/scenes/CompetitiveScene.ts');
    expect(competitive).toContain('pointer.positionToCamera(this.cameras.main)');
    expect(competitive).not.toContain('pointer.y - board.y');
  });

  it('ships a complete two-world by three-tier WebP/JPEG compatibility matrix', () => {
    const qualities = ['performance', 'balanced', 'ultra'] as const;
    expect(ARCADE_WORLD_IMAGES).toHaveLength(6);
    expect(new Set(ARCADE_WORLD_IMAGES.map(({ key }) => key)).size).toBe(6);

    for (const world of ['rainway', 'memory'] as const) {
      for (const quality of qualities) {
        const key = arcadeWorldTextureKey(world, quality);
        const asset = ARCADE_WORLD_IMAGES.find((candidate) => candidate.key === key);
        expect(asset, `${key} should be present`).toBeDefined();
        expect(asset?.url).toMatch(new RegExp(`-${quality}\\.webp$`));
        expect(asset?.fallbackUrl).toMatch(new RegExp(`-${quality}\\.jpg$`));

        const webpPath = projectFile(`public/${asset!.url}`);
        const jpegPath = projectFile(`public/${asset!.fallbackUrl}`);
        expect(existsSync(webpPath), webpPath).toBe(true);
        expect(existsSync(jpegPath), jpegPath).toBe(true);
        expect(statSync(webpPath).size).toBeGreaterThan(16_384);
        expect(statSync(jpegPath).size).toBeGreaterThan(16_384);

        const webpHeader = readFileSync(webpPath).subarray(0, 12);
        const jpegHeader = readFileSync(jpegPath).subarray(0, 2);
        expect(webpHeader.subarray(0, 4).toString('ascii')).toBe('RIFF');
        expect(webpHeader.subarray(8, 12).toString('ascii')).toBe('WEBP');
        expect([...jpegHeader]).toEqual([0xff, 0xd8]);
      }
    }
  });

  it('preloads WebP tiers and retries exactly the matching JPEG fallback', () => {
    const boot = readText('src/scenes/BootScene.ts');
    expect(boot).toContain('...ARCADE_WORLD_IMAGES.map(({ key, url }) => ({ key, url }))');
    expect(boot).toContain('const arcadeAsset = ARCADE_WORLD_IMAGES.find((asset) => asset.key === key)');
    expect(boot).toContain('this.arcadeFallbackQueued.add(key)');
    expect(boot).toContain('this.load.image(key, hostedAssetUrl(arcadeAsset.fallbackUrl))');
    expect(boot).toContain('this.arcadeFallbackQueued.clear()');
  });
});

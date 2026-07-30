import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const projectFile = (path: string): string => fileURLToPath(new URL(`../${path}`, import.meta.url));
const readText = (path: string): string => readFileSync(projectFile(path), 'utf8');

function exportedFunction(source: string, name: string): string {
  const start = source.indexOf(`export function ${name}`);
  expect(start, `${name} should be exported`).toBeGreaterThanOrEqual(0);
  const next = source.indexOf('\nexport function ', start + 1);
  return source.slice(start, next === -1 ? source.length : next);
}

function classMethod(source: string, name: string, nextName: string): string {
  const start = source.indexOf(`private ${name}(`);
  expect(start, `${name} should exist`).toBeGreaterThanOrEqual(0);
  const end = source.indexOf(`private ${nextName}(`, start + 1);
  expect(end, `${nextName} should follow ${name}`).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe('V10 Crownshard visual grammar', () => {
  const ui = readText('src/gfx/ui.ts');

  it('builds shared panels, buttons and sockets from asymmetric crystal faces', () => {
    expect(ui).toContain('function facetedSurfacePoints');
    for (const name of ['addArtPanel', 'addArtButton', 'addIconFrame']) {
      const source = exportedFunction(ui, name);
      expect(source).toContain('fillPoints');
      expect(source).toContain('strokePoints');
      expect(source).not.toContain('BlendModes.ADD');
      expect(source).not.toContain('repeat: -1');
    }
  });

  it('expands compact map controls through their real Phaser hit rectangles', () => {
    const button = exportedFunction(ui, 'addArtButton');
    expect(button).toContain('setSize(Math.max(100, width), Math.max(100, height))');
    const helper = exportedFunction(ui, 'setArtButtonHitArea');
    expect(helper).toContain('button.setSize(width, height)');
    expect(helper).toContain('hitArea.setTo(0, 0, width, height)');
    for (const path of ['src/scenes/WorldMapScene.ts', 'src/scenes/Match3MapScene.ts']) {
      const map = readText(path);
      expect(map).toContain('setArtButtonHitArea(addArtButton');
      expect(map).not.toMatch(/addArtButton\([^;]+\.setSize\([^;]+100\)/s);
    }
  });

  it('lights every realm with its own energy colour', () => {
    const background = exportedFunction(ui, 'addWorldBackground');
    expect(background).toContain('const realmLight');
    for (const realm of ['world_crystal', 'world_emerald', 'world_celestial', 'world_ember', 'world_frostbound', 'world_nexus']) {
      expect(background).toContain(realm);
    }
    expect(background).not.toContain('0x54ddff');
  });

  it('keeps the menu hierarchy while adding an altar, crown rails and static facets', () => {
    const menu = readText('src/scenes/MenuScene.ts');
    expect(menu).toContain('addFacetRail');
    expect(menu).toContain('heroSigil');
    expect(menu).toContain('fillTriangle');
    expect(menu).toContain("this.scene.start('ModeSelect')");
    expect(menu).not.toMatch(/\b(?:sweep|shimmer|launcherGlint)\b/i);
  });

  it('uses shipped game art instead of system emoji for mode identity', () => {
    const mode = readText('src/scenes/ModeSelectScene.ts');
    expect(mode).not.toContain('MODE_SYMBOLS');
    expect(mode).toContain("orbTexture(meta.equippedSkin, 'blue')");
    expect(mode).toContain("'artifact_chrono'");
    expect(mode).toContain("'mechanic_crystal_seal'");
    expect(mode).toContain('addModeCrystalIdentity');
  });

  it('turns the gameplay HUD into faceted command rails without an idle shine loop', () => {
    const game = readText('src/scenes/GameScene.ts');
    for (const source of [
      classMethod(game, 'addHudPlate', 'addSlimHudStrip'),
      classMethod(game, 'addSlimHudStrip', 'addHudIconControl'),
      classMethod(game, 'addHudIconControl', 'addHudControl'),
    ]) {
      expect(source).toContain('fillPoints');
      expect(source).not.toContain('BlendModes.ADD');
      expect(source).not.toContain('repeat: -1');
    }
  });

  it('renders the map route as a subtle, kind-specific dashed rail with bounded reward copy', () => {
    const map = readText('src/scenes/WorldMapScene.ts');
    expect(map).toContain('const route = [');
    expect(map).toContain('drawDashedSegment(path, start, point');
    expect(map).toContain('unlocked ? 0.28 : 0.12');
    expect(map).toContain('addNodeKindFrame(this, mapNode.kind');
    expect(map).toContain('labelRail');
    expect(map).toContain('node.setSize(180, 180)');
    expect(map).not.toContain('const rewardChest');
  });

  it('gives store relics and gallery collections distinct static identities', () => {
    const store = readText('src/scenes/StoreScene.ts');
    const gallery = readText('src/scenes/GalleryScene.ts');
    expect(store).toContain('addArtifactCrystalDetails');
    expect(store).toContain('if (!owned) icon.setAlpha(0.82)');
    expect(gallery).toContain('addWorldPictureFrame');
    expect(gallery).toContain('addArtifactPedestal');
    expect(gallery).toContain('addIconFrame(this, 80 + index * 112');
  });

  it('makes the prize chest a static altar hero and reserves motion for the reveal', () => {
    const rewards = readText('src/scenes/RewardsScene.ts');
    expect(rewards).toContain('addPrismPedestal');
    expect(rewards).toContain('addRuneRail');
    expect(rewards).not.toContain('BlendModes.ADD');
    expect(rewards).not.toContain('repeat: -1');
    expect(rewards).not.toContain('addAmbientMotes');
  });
});

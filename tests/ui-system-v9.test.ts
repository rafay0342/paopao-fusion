import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const projectFile = (path: string): string => fileURLToPath(new URL(`../${path}`, import.meta.url));
const readText = (path: string): string => readFileSync(projectFile(path), 'utf8');

function functionSource(source: string, name: string): string {
  const start = source.indexOf(`export function ${name}`);
  expect(start, `${name} should be exported`).toBeGreaterThanOrEqual(0);
  const next = source.indexOf('\nexport function ', start + 1);
  return source.slice(start, next === -1 ? source.length : next);
}

describe('V9 unified premium UI system', () => {
  const ui = readText('src/gfx/ui.ts');

  it('uses one readable type scale and delegates each surface fit to its requested floor', () => {
    expect(ui).toContain("screen: '42px'");
    expect(ui).toContain("body: '22px'");
    expect(ui).toContain("label: '21px'");
    expect(ui).toContain("caption: '20px'");
    expect(functionSource(ui, 'fitText')).toContain('resolveTextFitScale(text.width, maxWidth, minScale)');
  });

  it('builds cards and buttons from quiet code-native surfaces', () => {
    const panel = functionSource(ui, 'addArtPanel');
    const button = functionSource(ui, 'addArtButton');

    for (const primitive of [panel, button]) {
      expect(primitive).not.toMatch(/ui[_-](?:panel|button)/i);
      expect(primitive).not.toContain('BlendModes.ADD');
      expect(primitive).not.toContain('repeat: -1');
      expect(primitive).not.toContain('Back.easeOut');
    }
    expect(panel).toContain('UI_COLORS.quietBorder');
    expect(button).toContain('Cubic.easeOut');
  });

  it('provides static icon framing and motion-aware ambient decoration', () => {
    const icons = functionSource(ui, 'addIconFrame');
    const motes = functionSource(ui, 'addAmbientMotes');

    expect(icons).toContain('strokeCircle');
    expect(icons).not.toContain('tweens.add');
    expect(motes).toContain('quality.glints ? 18');
    expect(motes).toContain('prefersReducedMotion()');
    expect(motes).not.toContain('BlendModes.ADD');
  });

  it('does not preload or render the retired ornate panel/button rasters', () => {
    const boot = readText('src/scenes/BootScene.ts');
    expect(boot).not.toContain("'ui_panel'");
    expect(boot).not.toContain("'ui_button'");
    expect(ui).not.toContain("'ui_panel'");
    expect(ui).not.toContain("'ui_button'");
  });
});

describe('V9 scene application', () => {
  const priorityScenes = [
    'Account',
    'Challenges',
    'Chronicle',
    'Competitive',
    'Ending',
    'Gallery',
    'Inventory',
    'ModeSelect',
    'Rewards',
    'Store',
    'Story',
    'WorldMap',
  ];

  it.each(priorityScenes)('%s uses display type for its primary screen heading', (scene) => {
    const source = readText(`src/scenes/${scene}Scene.ts`);
    expect(source).toMatch(/fontFamily:\s*DISPLAY_FONT[\s\S]{0,100}fontSize:\s*TYPE\.screen/);
  });

  it('keeps small literal type out of the first-impression and gameplay path', () => {
    const scenes = ['Boot', 'Intro', 'Menu', 'ModeSelect', 'WorldMap', 'Gallery', 'Store', 'Inventory', 'Game'];
    for (const scene of scenes) {
      const source = readText(`src/scenes/${scene}Scene.ts`);
      expect(source, `${scene} contains a literal type size below 16px`)
        .not.toMatch(/fontSize:\s*['"](?:[0-9]|1[0-5])px['"]/);
    }
  });

  it('uses static framed orb and artifact identity on key collection screens', () => {
    for (const scene of ['Menu', 'ModeSelect', 'Gallery', 'Store', 'Inventory', 'Rewards']) {
      expect(readText(`src/scenes/${scene}Scene.ts`), `${scene} should use addIconFrame`)
        .toContain('addIconFrame(');
    }
    expect(readText('src/scenes/WorldMapScene.ts')).toContain('addNodeKindFrame(');
  });

  it('keeps all six gallery worlds in a deterministic safe grid', () => {
    const gallery = readText('src/scenes/GalleryScene.ts');
    expect(gallery).toContain('const worldColumns = [126, 360, 594]');
    expect(gallery).toContain('const worldRows = [350, 548]');
    expect(gallery).toContain('WORLD_THEMES.forEach');
    expect(gallery).toContain('index % worldColumns.length');
    expect(gallery).toContain('Math.floor(index / worldColumns.length)');
  });

  it('removes persistent launcher and random bubble glints while keeping game events', () => {
    const game = readText('src/scenes/GameScene.ts');
    const hudPlateStart = game.indexOf('private addHudPlate(');
    const hudPlateEnd = game.indexOf('private addSlimHudStrip(', hudPlateStart);
    const hudPlate = game.slice(hudPlateStart, hudPlateEnd);

    expect(game).not.toContain('launcherGlint');
    expect(game).not.toContain('twinkleRandomBubble');
    expect(game).not.toContain('focusLeft');
    expect(game).not.toContain('focusRight');
    expect(hudPlate).not.toContain('BlendModes.ADD');
    expect(hudPlate).not.toContain('repeat: -1');
  });

  it('keeps dense Store and Inventory content in non-overlapping lanes', () => {
    const store = readText('src/scenes/StoreScene.ts');
    const inventory = readText('src/scenes/InventoryScene.ts');

    expect(store).toContain('{ x: 190, y: 430 }');
    expect(store).toContain('{ x: 190, y: 850 }');
    expect(store).toContain('addArtPanel(this, x, y, 310, 414');
    expect(inventory).toContain("lines.join('\\n')");
    expect(inventory).not.toContain("lines.join('\\n\\n')");
  });

  it('reveals the bundled intro fallback when reused video playback resumes', () => {
    const intro = readText('src/scenes/IntroScene.ts');
    expect(intro).toMatch(/VIDEO_PLAYING[\s\S]{0,180}revealVideo\(\)/);
  });
});

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '..');
const read = (path: string): string => readFileSync(resolve(root, path), 'utf8');

describe('original cinematic fantasy-horror boundary', () => {
  it('allows eerie corrupted realms while retaining the no-gore and no-fighting canon', () => {
    const bible = read('docs/art/v14/style-bible.md');
    expect(bible).toContain('original cinematic fantasy-horror');
    expect(bible).toContain('No blood, mutilation, corpse imagery');
    expect(bible).toContain('never gameplay modifiers');
    expect(bible).toContain('Reduced motion freezes fog, parallax and decorative fractures');
  });

  it('binds the Nexus environment and atmosphere to PF-asset-231 only', () => {
    const manifest = JSON.parse(read('public/assets/v14/art-manifest.json'));
    const nexus = manifest.entries.filter(({ stableKey }: { stableKey: string }) => (
      stableKey === 'world_nexus' || stableKey === 'world_nexus_atmosphere'
    ));
    expect(nexus).toHaveLength(2);
    expect(new Set(nexus.map(({ pfId }: { pfId: string }) => pfId))).toEqual(
      new Set(['PF-asset-231']),
    );
    expect(nexus.every(({ bundle }: { bundle: string }) => bundle === 'realm-nexus')).toBe(true);
    const base = nexus.find(({ stableKey }: { stableKey: string }) => stableKey === 'world_nexus');
    const atmosphere = nexus.find(({ stableKey }: { stableKey: string }) => stableKey === 'world_nexus_atmosphere');
    expect(base.dependencies).toContain('aurora_crown');
    expect(base.fallbackKey).toBe('world_crystal');
    expect(atmosphere.dependencies).toEqual(['world_nexus']);
    for (const entry of nexus) {
      for (const variant of Object.values(entry.variants) as Array<{
        dimensions: { width: number; height: number };
        fallbacks: Array<{ dimensions: { width: number; height: number } }>;
      }>) {
        expect(variant.fallbacks[0].dimensions).toEqual(variant.dimensions);
      }
    }
  });

  it('keeps the generated source while binding an honest editable layered master', () => {
    const sourceManifest = JSON.parse(read('art-source/v14/manifest.json'));
    const entry = sourceManifest.entries.find(({ id }: { id: string }) => id === 'PF-asset-231');
    const layered = JSON.parse(read(entry.primary.path));
    const roles = new Set(layered.layers.map(({ id }: { id: string }) => id));

    expect(entry.provenance.actualTool).toBe('local-post-processing');
    expect(entry.provenance.referenceImages.some(({ role }: { role: string }) => (
      role.includes('generated-source')
    ))).toBe(true);
    expect(roles).toEqual(new Set([
      'generated-source',
      'background',
      'midground',
      'gameplay-plane',
      'foreground',
      'atmosphere',
      'runtime-composite',
    ]));
    const runtimeComposite = layered.layers.find(({ id }: { id: string }) => id === 'runtime-composite');
    expect(runtimeComposite.derivedFrom).toEqual([
      'background',
      'midground',
      'gameplay-plane',
      'foreground',
    ]);
    for (const role of ['background', 'midground', 'gameplay-plane', 'foreground']) {
      expect(layered.layers.find(({ id }: { id: string }) => id === role).parallax).toBe(0);
    }
    expect(layered.finishing.layerMethod).toContain('only the independent atmosphere layer is parallax-safe');
  });

  it('keeps presentation code out of hand tracking, deterministic cores and saves', () => {
    for (const path of [
      'src/game/handtracking.ts',
      'src/game/handcontrol.ts',
      'shared/runtime/match3-core.mjs',
      'src/game/save-v4.ts',
    ]) {
      expect(read(path)).not.toContain('world-presentation');
    }
  });

  it('keeps reduced-motion shooter HUD and terminal rewards static', () => {
    const game = read('src/scenes/GameScene.ts');
    expect(game).toContain('setDepth(depth).setAlpha(this.reducedMotion ? 1 : 0)');
    expect(game).toMatch(/if \(!this\.reducedMotion\) \{\s*this\.tweens\.add\(\{ targets: strip,/);
    expect(game).toMatch(/if \(this\.reducedMotion\) \{\s*endRewardIcon\.setScale\(1\)\.setAlpha\(1\)\.setAngle\(0\);/);
  });

  it('exposes Match-3 state, board focus and direct realm selection to assistive tech', () => {
    const game = read('src/scenes/Match3Scene.ts');
    const map = read('src/scenes/Match3MapScene.ts');
    expect(game).toContain('mountScene({');
    expect(game).toContain('private boardCellDescription(');
    expect(game).toContain('this.a11y?.setStatus(');
    expect(game).toContain('this.a11y?.announce(message, priority)');
    expect(map).toContain('marker.setSize(100, 100).setInteractive');
    expect(map).toContain('id: `match3-realm-${world + 1}`');
    expect(map).toContain('disabled: !accessible || active');
  });

  it('keeps mobile command targets large without changing dense board-piece sizing', () => {
    const shooter = read('src/scenes/GameScene.ts');
    expect(shooter).toContain('const MIN_MOBILE_COMMAND_TARGET = 100');
    expect(shooter.match(/MIN_MOBILE_COMMAND_TARGET/g)?.length).toBeGreaterThanOrEqual(11);
    expect(shooter).toContain("id: 'game-tutorial-action'");
    expect(shooter).toContain("id: 'game-tutorial-skip'");
    expect(shooter).toContain("'MAIN MENU', () =>");
    expect(shooter).toContain("polarity_nodes: 'NODES'");
    expect(shooter).not.toContain("polarity_nodes: 'POLARITY NODES'");

    const match3 = read('src/scenes/Match3Scene.ts');
    expect(match3).toContain('const CELL_SIZE = 72');
  });

  it('prevents mirrored accessibility controls from also mutating the Match-3 board', () => {
    const game = read('src/scenes/Match3Scene.ts');
    expect(game).toContain("activeTag === 'BUTTON'");
    expect(game).toContain("activeTag === 'SELECT'");
    expect(game).toMatch(
      /this\.keyboardCell = \{ \.\.\.released \};\s*this\.selected = \{ \.\.\.released \};/,
    );
  });
});

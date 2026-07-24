import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getMatch3Progress,
  isMatch3LevelUnlocked,
  normalizeMatch3Progress,
  recordMatch3Clear,
} from '../src/game/match3-progress';

const read = (path: string): string => readFileSync(
  fileURLToPath(new URL(`../${path}`, import.meta.url)),
  'utf8',
);

class MemoryStorage {
  private readonly values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
  removeItem(key: string): void { this.values.delete(key); }
  clear(): void { this.values.clear(); }
}

describe('Prism Cascade delivery wiring', () => {
  it('registers a gated map and playable scene with an original launcher entry', () => {
    const main = read('src/main.ts');
    const modes = read('src/scenes/ModeSelectScene.ts');
    expect(main).toContain("import { Match3MapScene } from './scenes/Match3MapScene';");
    expect(main).toContain("import { Match3Scene } from './scenes/Match3Scene';");
    expect(main).toMatch(/completeGameplay \? \[[\s\S]*Match3MapScene[\s\S]*Match3Scene/);
    expect(modes).toContain('PRISM CASCADE  •  MATCH-3');
    expect(modes).toContain("this.scene.start('Match3Map')");
  });

  it('funnels pointer, keyboard and measured-hand swaps into one deterministic action', () => {
    const scene = read('src/scenes/Match3Scene.ts');
    expect(scene).toContain('private async attemptSwap(');
    expect(scene).toContain('tryMatch3Swap(this.state, from, to)');
    expect(scene).toContain('void this.attemptSwap(down, released)');
    expect(scene).toContain('void this.attemptSwap(this.selected, this.keyboardCell)');
    expect(scene).toContain('void this.attemptSwap(swap.from, swap.to)');
    expect(scene).toContain("event === 'latched'");
    expect(scene).toContain('this.handDrag.updateContact(frame)');
    expect(scene).toContain('this.pinchControl.holdForUncertainty(sample.timestampMs)');
    expect(scene).toContain('HAND_LOSS_RESET_MS');
    expect(scene).not.toMatch(/\b(?:addCoins|grantCoins|setCoins|submitRunV3)\s*\(/);
  });

  it('cleans camera, listeners and gesture state at every lifecycle boundary', () => {
    const scene = read('src/scenes/Match3Scene.ts');
    expect(scene).toContain('Phaser.Scenes.Events.SHUTDOWN');
    expect(scene).toContain("window.removeEventListener('paopao:quality-adapted'");
    expect(scene).toContain("window.removeEventListener('paopao:render-context-boundary'");
    expect(scene).toContain("this.events.off('paopao:back-request'");
    expect(scene).toContain('getHandTracker().suspend()');
    expect(scene).toContain('this.handDrag.cancel()');
  });

  it('protects live boards from Escape, browser Back and mid-cascade quality upgrades', () => {
    const navigation = read('src/game/navigation.ts');
    const performance = read('src/game/performance.ts');
    expect(navigation).toContain("active.scene.key === 'Game' || active.scene.key === 'Match3'");
    expect(performance).toContain("scene.scene.key === 'Game' || scene.scene.key === 'Match3'");
  });
});

describe('Prism Cascade local stage progress', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', new MemoryStorage());
  });

  it('normalizes hostile storage and unlocks stages sequentially', () => {
    const progress = normalizeMatch3Progress({
      unlocked: 999,
      bestScores: [-5, '42', Number.POSITIVE_INFINITY],
      stars: [8, -2, 2],
      cleared: [-1, 2, 30, '3'],
    });
    expect(progress.unlocked).toBe(30);
    expect(progress.bestScores.slice(0, 3)).toEqual([0, 42, 0]);
    expect(progress.stars.slice(0, 3)).toEqual([3, 0, 2]);
    expect(progress.cleared).toEqual([0, 2]);
  });

  it('persists best score/stars and never relocks a cleared stage', () => {
    expect(getMatch3Progress().unlocked).toBe(1);
    recordMatch3Clear(0, 100_000);
    const progress = getMatch3Progress();
    expect(progress.unlocked).toBe(2);
    expect(progress.bestScores[0]).toBe(100_000);
    expect(progress.stars[0]).toBe(3);
    expect(isMatch3LevelUnlocked(1, progress)).toBe(true);
    expect(isMatch3LevelUnlocked(2, progress)).toBe(false);
  });
});

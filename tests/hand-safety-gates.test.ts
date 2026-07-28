import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  HAND_RESULT_ACTION_MAX_AGE_MS,
  HAND_RESULT_HARD_MAX_AGE_MS,
  HAND_RESULT_MAX_FRAME_BUDGETS,
  classifyHandWorkerResultFreshness,
} from '../src/game/handreliability';

const projectFile = (path: string): string => fileURLToPath(new URL(`../${path}`, import.meta.url));
const readText = (path: string): string => readFileSync(projectFile(path), 'utf8');

const freshness = (
  patch: Partial<Parameters<typeof classifyHandWorkerResultFreshness>[0]> = {},
) => classifyHandWorkerResultFreshness({
  generation: 7,
  activeGeneration: 7,
  captureTimestampMs: 1_000,
  lastAcceptedCaptureTimestampMs: 960,
  receivedTimestampMs: 1_050,
  targetFps: 30,
  ...patch,
});

describe('hand worker and gameplay safety gates', () => {
  it('accepts the newest slow-CPU result within a hard bounded adaptive age', () => {
    expect(HAND_RESULT_MAX_FRAME_BUDGETS).toBe(2);
    expect(HAND_RESULT_ACTION_MAX_AGE_MS).toBe(180);
    expect(HAND_RESULT_HARD_MAX_AGE_MS).toBe(350);
    expect(freshness()).toBe('fresh-action');
    expect(freshness({ receivedTimestampMs: 1_000 + (2_000 / 30) - 0.001 })).toBe('fresh-action');
    expect(freshness({ receivedTimestampMs: 1_000 + (2_000 / 30) + 0.001 })).toBe('visual-only');
    expect(freshness({ inferenceMs: 90, receivedTimestampMs: 1_120 })).toBe('fresh-action');
    expect(freshness({ inferenceMs: 120, receivedTimestampMs: 1_165 })).toBe('fresh-action');
    expect(freshness({ inferenceMs: 120, receivedTimestampMs: 1_170 })).toBe('fresh-action');
    expect(freshness({ inferenceMs: 120, receivedTimestampMs: 1_170.001 })).toBe('visual-only');
    expect(freshness({ inferenceMs: 150, receivedTimestampMs: 1_180 })).toBe('fresh-action');
    expect(freshness({ inferenceMs: 150, receivedTimestampMs: 1_180.001 })).toBe('visual-only');
    expect(freshness({ targetFps: 15, receivedTimestampMs: 1_133 })).toBe('fresh-action');
    expect(freshness({ targetFps: 15, receivedTimestampMs: 1_134 })).toBe('visual-only');
    expect(freshness({ receivedTimestampMs: 1_349 })).toBe('visual-only');
    expect(freshness({ receivedTimestampMs: 1_351 })).toBe('stale');
    expect(freshness({ generation: 6 })).toBe('wrong-generation');
  });

  it('rejects duplicate, out-of-order, future and invalid capture clocks', () => {
    expect(freshness({ lastAcceptedCaptureTimestampMs: 1_000 })).toBe('duplicate');
    expect(freshness({ lastAcceptedCaptureTimestampMs: 1_001 })).toBe('out-of-order');
    expect(freshness({ receivedTimestampMs: 999 })).toBe('future');
    expect(freshness({ captureTimestampMs: Number.NaN })).toBe('invalid-timestamp');
  });

  it('propagates confidence and gates both gameplay modes before gesture progression', () => {
    const tracking = readText('src/game/handtracking.ts');
    const game = readText('src/scenes/GameScene.ts');
    const endless = readText('src/scenes/EndlessScene.ts');

    expect(tracking).toContain('usableForGesture: confidence.usableForGesture');
    expect(tracking).toContain('classifyHandWorkerResultFreshness({');
    expect(tracking).toContain('lastAcceptedCaptureTimestampMs: this.lastAcceptedCaptureTimestampMs');
    expect(tracking).toContain('if (gestureTimely) this.stableHandFrames = Math.min(120, this.stableHandFrames + 1)');
    expect(tracking).toContain('this.stableHandFrames = 0;');

    for (const [source, sampleName] of [[game, 's'], [endless, 'sample']] as const) {
      const gate = source.indexOf(`this.handContinuity.observe(`);
      const gestureUpdate = source.indexOf(`this.pinchControl.update(${sampleName})`, gate);
      expect(gate).toBeGreaterThan(-1);
      expect(gestureUpdate).toBeGreaterThan(gate);
      expect(source.slice(gate, gestureUpdate)).toContain('this.pinchControl.resetForContinuity()');
      expect(source.slice(gate, gestureUpdate)).toContain("continuity === 'cancel'");
      expect(source.slice(gate, gestureUpdate)).toContain(
        `this.pinchControl.holdForUncertainty(${sampleName}.timestampMs)`,
      );
    }

    expect(game.indexOf('this.handTarget = mapHandToAim(')).toBeLessThan(
      game.indexOf('this.handContinuity.observe('),
    );
    expect(endless.indexOf('const point = mapHandToAim(')).toBeLessThan(
      endless.indexOf('this.handContinuity.observe('),
    );
  });

  it('keeps first acquisition searching instead of declaring loss or disabling hand mode', () => {
    for (const path of [
      'src/scenes/GameScene.ts',
      'src/scenes/EndlessScene.ts',
      'src/scenes/Match3Scene.ts',
    ]) {
      const source = readText(path);
      const poll = source.slice(source.indexOf('private pollHand(): void'));
      expect(poll).toContain('if (!this.handHasSeen)');
      expect(poll).toContain('SEARCH');
    }
    const gamePoll = readText('src/scenes/GameScene.ts').slice(
      readText('src/scenes/GameScene.ts').indexOf('private pollHand(): void'),
      readText('src/scenes/GameScene.ts').indexOf('private pollGaze(): void'),
    );
    expect(gamePoll).not.toContain('getHandTracker().disable()');
  });
});

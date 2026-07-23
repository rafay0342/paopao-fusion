import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
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
  it('accepts only current-generation results inside two target frame budgets', () => {
    expect(HAND_RESULT_MAX_FRAME_BUDGETS).toBe(2);
    expect(freshness()).toBe('fresh');
    expect(freshness({ receivedTimestampMs: 1_000 + (2_000 / 30) - 0.001 })).toBe('fresh');
    expect(freshness({ receivedTimestampMs: 1_000 + (2_000 / 30) + 0.001 })).toBe('stale');
    expect(freshness({ targetFps: 15, receivedTimestampMs: 1_133 })).toBe('fresh');
    expect(freshness({ targetFps: 15, receivedTimestampMs: 1_134 })).toBe('stale');
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

    for (const [source, sampleName] of [[game, 's'], [endless, 'sample']] as const) {
      const gate = source.indexOf(`if (!${sampleName}.usableForGesture)`);
      const gestureUpdate = source.indexOf(`this.pinchControl.update(${sampleName})`, gate);
      expect(gate).toBeGreaterThan(-1);
      expect(gestureUpdate).toBeGreaterThan(gate);
      expect(source.slice(gate, gestureUpdate)).toContain('this.pinchControl.resetForContinuity()');
    }

    expect(game.indexOf('this.handTarget = mapHandToAim(')).toBeLessThan(
      game.indexOf('if (!s.usableForGesture)'),
    );
    expect(endless.indexOf('const point = mapHandToAim(')).toBeLessThan(
      endless.indexOf('if (!sample.usableForGesture)'),
    );
  });
});

import { describe, expect, it } from 'vitest';
import {
  appendArenaShot,
  buildArenaTargetSequence,
  simulateArenaReplay,
  validateArenaShotTrace,
} from '../shared/runtime/arena-replay.mjs';

describe('authoritative arena replay', () => {
  it('replays a timestamped aim corpus identically in batch and streaming modes', () => {
    const seed = 734_201;
    const level = 17;
    const targets = buildArenaTargetSequence({ seed, level, shotCount: 5 });
    const shotTrace = targets.map((target, index) => ({
      seq: index + 1,
      atMs: 120 + index * 220,
      angleMilliDegrees: target.angleMilliDegrees,
    }));

    const first = simulateArenaReplay({ seed, level, shotTrace });
    const second = simulateArenaReplay({ seed, level, shotTrace: shotTrace.map((shot) => ({ ...shot })) });
    expect(first).toEqual(second);
    expect(first).toMatchObject({ ok: true, result: { shots: 5, hits: 5 } });

    let streamedTrace: typeof shotTrace = [];
    let streamedResult: ReturnType<typeof appendArenaShot> | undefined;
    for (const shot of shotTrace) {
      streamedResult = appendArenaShot({ seed, level, shotTrace: streamedTrace, shot });
      expect(streamedResult.ok).toBe(true);
      if (streamedResult.ok) streamedTrace = streamedResult.shotTrace;
    }
    expect(streamedResult?.ok && streamedResult.result).toEqual(first.ok && first.result);
  });

  it('fails closed for malformed, out-of-order, impossible-cadence and out-of-cone actions', () => {
    expect(validateArenaShotTrace(null as never)).toMatchObject({ ok: false, error: 'arena-replay-trace-required' });
    expect(validateArenaShotTrace([{ seq: 2, atMs: 120, angleMilliDegrees: 0 }]))
      .toMatchObject({ ok: false, error: 'arena-replay-order-invalid', sequence: 1 });
    expect(validateArenaShotTrace([
      { seq: 1, atMs: 120, angleMilliDegrees: 0 },
      { seq: 2, atMs: 299, angleMilliDegrees: 0 },
    ])).toMatchObject({ ok: false, error: 'arena-replay-cadence-invalid', sequence: 2 });
    expect(validateArenaShotTrace([{ seq: 1, atMs: 120, angleMilliDegrees: 30_001 }]))
      .toMatchObject({ ok: false, error: 'arena-replay-aim-invalid', sequence: 1 });
  });
});

import { describe, expect, it } from 'vitest';
import fixture from '../shared/fixtures/determinism-v1.json';
import { seededRandom } from '../src/game/retention';

describe('shared deterministic runtime contract', () => {
  it('pins Phaser Mulberry32 to the cross-client unsigned integer corpus', () => {
    expect(fixture.schemaVersion).toBe(1);
    expect(fixture.random.algorithm).toBe('mulberry32');
    const random = seededRandom(fixture.random.seed);
    const actual = fixture.random.uint32.map(() => Math.floor(random() * 0x1_0000_0000) >>> 0);
    expect(actual).toEqual(fixture.random.uint32);
  });

  it('pins the shared shot cone and fixed-point replay representation', () => {
    expect(fixture.aim).toEqual({ minimumDegrees: -30, maximumDegrees: 30 });
    expect(fixture.simulation).toEqual({ numericFormat: 'q16.16', fractionBits: 16 });
  });
});

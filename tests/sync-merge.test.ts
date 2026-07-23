import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  default: {
    Math: {
      Clamp: (value: number, minimum: number, maximum: number): number => Math.min(maximum, Math.max(minimum, value)),
    },
  },
}));

import { mergeMetaState } from '../src/game/meta';
import { mergeGameProgress } from '../src/game/progression';

describe('cloud restore merge regressions', () => {
  it('does not resurrect a spent Mystery Key and unions cloud/local collections', () => {
    const merged = mergeMetaState(
      {
        mysteryKeys: 0,
        openedMysteryBoxes: 2,
        ownedArtifacts: ['chrono', 'phoenix'],
        equippedArtifact: 'phoenix',
        ownedSkins: ['nova', 'nova_optical', 'aurora'],
        equippedSkin: 'aurora',
      },
      {
        mysteryKeys: 1,
        openedMysteryBoxes: 1,
        ownedArtifacts: ['chrono', 'void'],
        equippedArtifact: 'void',
        ownedSkins: ['nova', 'nova_optical', 'voidforge'],
        equippedSkin: 'voidforge',
      },
    );

    expect(merged.mysteryKeys).toBe(0);
    expect(merged.openedMysteryBoxes).toBe(2);
    expect(merged.ownedArtifacts).toEqual(expect.arrayContaining(['chrono', 'phoenix', 'void']));
    expect(merged.ownedSkins).toEqual(expect.arrayContaining(['nova', 'nova_optical', 'aurora', 'voidforge']));
    expect(merged.equippedArtifact).toBe('void');
    expect(merged.equippedSkin).toBe('voidforge');
  });

  it('preserves the maximum unlock, score and stars from both progress branches', () => {
    const merged = mergeGameProgress(
      {
        unlocked: 8,
        bestScores: [100, 900, 0, 800],
        stars: [3, 1, 0, 2],
      },
      {
        unlocked: 5,
        bestScores: [700, 200, 600, 0],
        stars: [1, 3, 2, 0],
      },
    );

    expect(merged.unlocked).toBe(8);
    expect(merged.bestScores.slice(0, 4)).toEqual([700, 900, 600, 800]);
    expect(merged.stars.slice(0, 4)).toEqual([3, 3, 2, 2]);
    expect(merged.bestScores).toHaveLength(30);
    expect(merged.stars).toHaveLength(30);
  });

  it('normalizes malformed cloud collections without throwing or amplifying shapes', () => {
    const meta = mergeMetaState(null as unknown as never, {
      coins: Number.POSITIVE_INFINITY,
      ownedArtifacts: { length: 1_000_000_000 } as unknown as never,
      ownedSkins: null as unknown as never,
    });
    const progress = mergeGameProgress(
      { cleared: null as unknown as never },
      {
        bestScores: { length: 1_000_000_000 } as unknown as never,
        stars: ['bad', 99, -4] as unknown as number[],
        mastered: { 0: 1 } as unknown as number[],
      },
    );

    expect(meta).toMatchObject({ coins: 600, ownedArtifacts: ['chrono'] });
    expect(progress.bestScores).toHaveLength(30);
    expect(progress.bestScores.every((value) => Number.isFinite(value))).toBe(true);
    expect(progress.stars.slice(0, 3)).toEqual([0, 3, 0]);
    expect(progress.mastered).toEqual([1]);
  });
});

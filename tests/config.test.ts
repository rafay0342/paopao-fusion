import { describe, expect, it } from 'vitest';
import { GRID, LEVELS } from '../src/config';

const ORIGINAL_TITLES = [
  'PRISM GATE',
  'MOONLIT GROTTO',
  'CROWN VAULT',
  'MOSSLIGHT TRAIL',
  'VERDANT CANOPY',
  'HEARTWOOD SHRINE',
  'CLOUDSTEP SANCTUM',
  'STARLIGHT ORRERY',
  'ASTRAL CROWN',
  'CINDER BASTION',
  'MAGMA CRUCIBLE',
  'INFERNO THRONE',
] as const;

describe('V11 level configuration', () => {
  it('preserves all original save-compatible indices and expands every realm to five levels', () => {
    expect(LEVELS).toHaveLength(30);
    expect(LEVELS.slice(0, 12).map(({ title }) => title)).toEqual(ORIGINAL_TITLES);
    expect(LEVELS.slice(0, 18).map(({ world }) => world)).toEqual([
      0, 0, 0,
      1, 1, 1,
      2, 2, 2,
      3, 3, 3,
      4, 4, 4,
      5, 5, 5,
    ]);

    for (let world = 0; world < 6; world += 1) {
      expect(LEVELS.filter((level) => level.world === world)).toHaveLength(5);
    }
  });

  it('uses the approved goal and world-mechanic mapping', () => {
    expect(LEVELS.slice(0, 12).map(({ goal, mechanic, mechanicCount, shotLimit }) => ({
      goal,
      mechanic,
      mechanicCount,
      shotLimit: shotLimit ?? null,
    }))).toEqual([
      { goal: 'clear', mechanic: 'none', mechanicCount: 0, shotLimit: null },
      { goal: 'seals', mechanic: 'crystal', mechanicCount: 6, shotLimit: 36 },
      { goal: 'boss', mechanic: 'crystal', mechanicCount: 0, shotLimit: null },
      { goal: 'clear', mechanic: 'vine', mechanicCount: 3, shotLimit: null },
      { goal: 'vines', mechanic: 'vine', mechanicCount: 6, shotLimit: 32 },
      { goal: 'boss', mechanic: 'vine', mechanicCount: 0, shotLimit: null },
      { goal: 'clear', mechanic: 'portal', mechanicCount: 1, shotLimit: null },
      { goal: 'portal_cores', mechanic: 'portal', mechanicCount: 5, shotLimit: 40 },
      { goal: 'boss', mechanic: 'portal', mechanicCount: 0, shotLimit: null },
      { goal: 'clear', mechanic: 'ember', mechanicCount: 3, shotLimit: null },
      { goal: 'embers', mechanic: 'ember', mechanicCount: 8, shotLimit: 36 },
      { goal: 'boss', mechanic: 'ember', mechanicCount: 0, shotLimit: null },
    ]);
  });

  it('keeps shot limits and regular mechanic counts within playable bounds', () => {
    const limitedLevels = LEVELS.filter(({ shotLimit }) => shotLimit !== undefined);
    expect(limitedLevels.map(({ shotLimit }) => shotLimit)).toEqual([36, 32, 40, 36, 40, 42, 32, 30, 34, 32, 38, 36, 34, 34, 38, 36, 40, 38]);
    expect(limitedLevels.every(({ shotLimit }) => Number.isInteger(shotLimit) && shotLimit! > 0)).toBe(true);

    for (const level of LEVELS.filter(({ goal }) => goal !== 'boss')) {
      expect(Number.isInteger(level.mechanicCount)).toBe(true);
      expect(level.mechanicCount).toBeGreaterThanOrEqual(0);
      expect(level.mechanicCount).toBeLessThanOrEqual(level.rows * GRID.cols);
      if (level.mechanic === 'none') {
        expect(level.mechanicCount).toBe(0);
      } else {
        expect(level.mechanicCount).toBeGreaterThan(0);
      }
    }
  });

  it('defines bosses only at the six world-ending level indices', () => {
    const bosses = LEVELS.flatMap((level, index) => level.boss ? [{ index, ...level.boss }] : []);

    expect(bosses).toEqual([
      { index: 2, name: 'PRISM WARDEN', hp: 6, actionEvery: 3 },
      { index: 5, name: 'HEARTWOOD GUARDIAN', hp: 8, actionEvery: 2 },
      { index: 8, name: 'ASTRAL SENTINEL', hp: 10, actionEvery: 3 },
      { index: 11, name: 'INFERNO SOVEREIGN', hp: 12, actionEvery: 2 },
      { index: 14, name: 'FROST REGENT', hp: 14, actionEvery: 2 },
      { index: 17, name: 'NEXUS ARCHITECT', hp: 16, actionEvery: 2 },
    ]);

    LEVELS.forEach((level, index) => {
      if ([2, 5, 8, 11, 14, 17].includes(index)) {
        expect(level.goal).toBe('boss');
        expect(level.boss).toBeDefined();
      } else {
        expect(level.goal).not.toBe('boss');
        expect(level.boss).toBeUndefined();
      }
    });
  });
});

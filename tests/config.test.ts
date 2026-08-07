import { describe, expect, it } from 'vitest';
import { GRID, LEVELS, MAP_NODES, WORLD_THEMES, campaignStageNumber } from '../src/config';

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

describe('V16 Crown Echoes level configuration', () => {
  it('preserves the original 30 save-compatible indices and appends two Echo levels per realm', () => {
    expect(LEVELS).toHaveLength(42);
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
      expect(LEVELS.filter((level) => level.world === world && level.act === 'crown')).toHaveLength(5);
      expect(LEVELS.filter((level) => level.world === world && level.act === 'echoes')).toHaveLength(2);
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
    expect(limitedLevels.map(({ shotLimit }) => shotLimit)).toEqual([36, 32, 40, 36, 40, 42, 32, 30, 34, 32, 38, 36, 34, 34, 38, 36, 40, 38, 34, 38, 36, 38, 34, 36, 32, 34, 36, 36, 32, 34]);
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

  it('defines the six Crown bosses and six Ascended bosses at authored endings', () => {
    const bosses = LEVELS.flatMap((level, index) => level.boss ? [{ index, ...level.boss }] : []);

    expect(bosses).toEqual([
      { index: 2, name: 'PRISM WARDEN', hp: 6, actionEvery: 3 },
      { index: 5, name: 'HEARTWOOD GUARDIAN', hp: 8, actionEvery: 2 },
      { index: 8, name: 'ASTRAL SENTINEL', hp: 10, actionEvery: 3 },
      { index: 11, name: 'INFERNO SOVEREIGN', hp: 12, actionEvery: 2 },
      { index: 14, name: 'FROST REGENT', hp: 14, actionEvery: 2 },
      { index: 17, name: 'NEXUS ARCHITECT', hp: 16, actionEvery: 2 },
      { index: 31, name: 'PRISM WARDEN ASCENDED', hp: 10, actionEvery: 3 },
      { index: 33, name: 'HEARTWOOD GUARDIAN ASCENDED', hp: 12, actionEvery: 3 },
      { index: 35, name: 'ASTRAL SENTINEL ASCENDED', hp: 13, actionEvery: 3 },
      { index: 37, name: 'INFERNO SOVEREIGN ASCENDED', hp: 14, actionEvery: 2 },
      { index: 39, name: 'FROST REGENT ASCENDED', hp: 15, actionEvery: 2 },
      { index: 41, name: 'NEXUS ARCHITECT ASCENDED', hp: 18, actionEvery: 2 },
    ]);

    LEVELS.forEach((level, index) => {
      if ([2, 5, 8, 11, 14, 17, 31, 33, 35, 37, 39, 41].includes(index)) {
        expect(level.goal).toBe('boss');
        expect(level.boss).toBeDefined();
      } else {
        expect(level.goal).not.toBe('boss');
        expect(level.boss).toBeUndefined();
      }
    });
  });

  it('keeps stable save IDs while presenting one clear 1–42 campaign route', () => {
    expect(MAP_NODES.map(({ level }) => campaignStageNumber(level))).toEqual(
      Array.from({ length: LEVELS.length }, (_, index) => index + 1),
    );

    // Nexus deliberately interleaves legacy and expanded canonical IDs. Those
    // IDs cannot change without breaking saves/replays/rewards; only the
    // player-facing stage labels are normalized.
    expect(WORLD_THEMES[5].levels).toEqual([15, 28, 16, 29, 17]);
    expect(WORLD_THEMES[5].levels.map(campaignStageNumber)).toEqual([26, 27, 28, 29, 30]);
    expect(WORLD_THEMES[0].echoLevels.map(campaignStageNumber)).toEqual([31, 32]);
    expect(WORLD_THEMES[5].echoLevels.map(campaignStageNumber)).toEqual([41, 42]);
  });
});

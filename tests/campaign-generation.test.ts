import { describe, expect, it } from 'vitest';
import { COLOR_KEYS, GRID, LEVELS, type ColorKey } from '../src/config';
import { cellPos, computeGeom } from '../src/game/grid';
import { clusterOf, floaters, type Cell } from '../src/game/matcher';
import {
  CAMPAIGN_CONTENT_VERSION,
  CAMPAIGN_MODES,
  advanceShotQueue,
  buildCampaignOpening,
  buildLevelZeroTutorialOpening,
  campaignGenerationSeed,
  campaignMechanicSeed,
  createCampaignShotQueue,
  createColorBag,
  createShotQueue,
  drawColorBag,
  drawColorBagMany,
  preloadShotQueue,
  reconcileShotQueue,
  swapShotQueue,
  type ShotQueueState,
} from '../src/game/campaign-generation';

function openingFingerprint(level: number, mode: 'classic' | 'rush' | 'precision'): string {
  return buildCampaignOpening({ level, mode }).grid.map((row) => row.join(',')).join('|');
}

function playQueueScript(): ShotQueueState {
  const full = COLOR_KEYS.slice(0, 4);
  const reduced: ColorKey[] = ['red', 'green'];
  let state = createCampaignShotQueue({ level: 7, mode: 'precision' }, full);
  state = swapShotQueue(state, full).state;
  state = advanceShotQueue(state, full);
  state = advanceShotQueue(state, full);
  state = reconcileShotQueue(state, reduced);
  state = swapShotQueue(state, reduced).state;
  state = advanceShotQueue(state, reduced);
  state = advanceShotQueue(state, reduced);
  return state;
}

describe('deterministic campaign identity and openings', () => {
  it('locks stable content-versioned seeds for level and mode', () => {
    expect(CAMPAIGN_CONTENT_VERSION).toBe('2026.07.22-r1');
    expect(campaignGenerationSeed({ level: 0, mode: 'classic' })).toBe(3918183452);
    expect(campaignGenerationSeed({ level: 7, mode: 'rush' })).toBe(1726054823);
    expect(campaignGenerationSeed({ level: 29, mode: 'precision' })).toBe(937350449);

    expect(campaignGenerationSeed({ level: 7, mode: 'classic' }))
      .not.toBe(campaignGenerationSeed({ level: 7, mode: 'rush' }));
    expect(campaignGenerationSeed({ level: 7, mode: 'classic', contentVersion: '2026.07.22-r2' }))
      .not.toBe(campaignGenerationSeed({ level: 7, mode: 'classic' }));
  });

  it('domain-separates deterministic runtime mechanics from board and queue generation', () => {
    const identity = { level: 18, mode: 'precision' } as const;
    expect(campaignMechanicSeed(identity)).toBe(campaignMechanicSeed(identity));
    expect(campaignMechanicSeed(identity)).not.toBe(campaignGenerationSeed(identity));
    expect(campaignMechanicSeed(identity)).not.toBe(campaignMechanicSeed({ ...identity, mode: 'rush' }));
    expect(campaignMechanicSeed(identity)).not.toBe(campaignMechanicSeed({
      ...identity,
      contentVersion: '2026.07.22-r2',
    }));
  });

  it('generates every campaign opening deterministically within its hex bounds and palette', () => {
    const fingerprints = new Set<string>();
    for (const mode of CAMPAIGN_MODES) {
      for (let level = 0; level < LEVELS.length; level += 1) {
        const first = buildCampaignOpening({ level, mode });
        const second = buildCampaignOpening({ level, mode });
        const definition = LEVELS[level];

        expect(second).toEqual(first);
        expect(first.level).toBe(level);
        expect(first.mode).toBe(mode);
        expect(first.rows).toBe(definition.rows);
        expect(first.columns).toBe(GRID.cols);
        expect(first.grid).toHaveLength(definition.rows);
        expect(first.palette).toEqual(COLOR_KEYS.slice(0, definition.colors));
        first.grid.forEach((row, rowIndex) => {
          expect(row).toHaveLength(rowIndex % 2 === 0 ? GRID.cols : GRID.cols - 1);
          expect(row.every((color) => first.palette.includes(color))).toBe(true);
        });
        fingerprints.add(`${first.rows}:${first.palette.length}:${openingFingerprint(level, mode)}`);
      }
    }
    expect(fingerprints.size).toBe(LEVELS.length * CAMPAIGN_MODES.length);
  });

  it('rejects invalid campaign identities instead of silently aliasing a board', () => {
    expect(() => buildCampaignOpening({ level: -1, mode: 'classic' })).toThrow(RangeError);
    expect(() => buildCampaignOpening({ level: 30, mode: 'classic' })).toThrow(RangeError);
    expect(() => campaignGenerationSeed({ level: 0, mode: 'arcade' as 'classic' })).toThrow(RangeError);
    expect(() => campaignGenerationSeed({ level: 0, mode: 'classic', contentVersion: ' bad ' })).toThrow(RangeError);
  });

  it('provides a sparse Level-0 first-shot contract that matches and drops exactly as taught', () => {
    const tutorial = buildLevelZeroTutorialOpening();
    const geom = computeGeom(720);
    geom.topPad = 154;
    let nextId = 0;
    const cells: Cell[] = tutorial.grid.flatMap((row, rowIndex) => row.flatMap((color, colIndex) => {
      if (color == null) return [];
      const position = cellPos(geom, rowIndex, colIndex);
      return [{
        id: nextId++,
        row: rowIndex,
        col: colIndex,
        color,
        active: true,
        ...position,
      }];
    }));
    const address = (cell: Cell): string => `${cell.row}:${cell.col}`;
    const expectedAnchors = tutorial.firstShot.anchorPair.map(({ row, col }) => `${row}:${col}`).sort();
    const expectedHanging = tutorial.firstShot.hangingCluster.map(({ row, col }) => `${row}:${col}`).sort();
    const targetPosition = cellPos(geom, tutorial.firstShot.target.row, tutorial.firstShot.target.col);
    const shot: Cell = {
      id: nextId,
      ...tutorial.firstShot.target,
      color: tutorial.firstShot.loadedColor,
      active: true,
      ...targetPosition,
    };
    const withShot = [...cells, shot];
    const match = clusterOf(shot, withShot, geom.cellW);
    const matchedIds = new Set(match.map(({ id }) => id));
    const afterMatch = withShot.map((cell) => matchedIds.has(cell.id) ? { ...cell, active: false } : cell);
    const dropped = floaters(afterMatch, geom.cellW);

    expect(tutorial.level).toBe(0);
    expect(tutorial.grid).toHaveLength(LEVELS[0].rows);
    expect(tutorial.grid.flat().some((color) => color == null)).toBe(true);
    expect(tutorial.grid[tutorial.firstShot.target.row][tutorial.firstShot.target.col]).toBeNull();
    expect(floaters(cells, geom.cellW)).toEqual([]);
    expect(match).toHaveLength(tutorial.firstShot.expectedMatchCount);
    expect(match.filter(({ id }) => id !== shot.id).map(address).sort()).toEqual(expectedAnchors);
    expect(dropped).toHaveLength(tutorial.firstShot.expectedDropCount);
    expect(dropped.map(address).sort()).toEqual(expectedHanging);
    expect(afterMatch.some((cell) => (
      cell.active
      && tutorial.firstShot.persistentTopAnchors.some(({ row, col }) => cell.row === row && cell.col === col)
    ))).toBe(true);
  });
});

describe('deterministic active-colour bag', () => {
  it('draws each active colour exactly once per complete bag', () => {
    const active: ColorKey[] = ['red', 'blue', 'green', 'yellow'];
    const result = drawColorBagMany(createColorBag(0x12345678, active), 16, active);
    for (let offset = 0; offset < result.colors.length; offset += active.length) {
      expect([...result.colors.slice(offset, offset + active.length)].sort()).toEqual([...active].sort());
    }
  });

  it('normalizes input order and produces the same stream from the same seed', () => {
    const first = drawColorBagMany(createColorBag(44, ['yellow', 'red', 'blue']), 30);
    const second = drawColorBagMany(createColorBag(44, ['blue', 'yellow', 'red']), 30);
    expect(second).toEqual(first);
  });

  it('never emits a colour absent from the supplied active board', () => {
    const all = drawColorBagMany(createColorBag(77, COLOR_KEYS), 7);
    const active: ColorKey[] = ['green', 'purple'];
    const reduced = drawColorBagMany(all.state, 100, active);

    expect(new Set(reduced.colors)).toEqual(new Set(active));
    expect(reduced.colors.every((color) => active.includes(color))).toBe(true);
    expect(reduced.state.activeColors).toEqual(active);
    expect(reduced.state.remaining.every((color) => active.includes(color))).toBe(true);
  });

  it('does not mutate caller-owned state or colour arrays', () => {
    const active: ColorKey[] = ['red', 'blue', 'green'];
    const state = createColorBag(91, active);
    const before = structuredClone(state);
    const draw = drawColorBag(state, active);
    expect(state).toEqual(before);
    expect(active).toEqual(['red', 'blue', 'green']);
    expect(draw.state).not.toBe(state);
  });

  it('fails closed for empty palettes and invalid draw counts', () => {
    expect(() => createColorBag(1, [])).toThrow(RangeError);
    expect(() => drawColorBagMany(createColorBag(1, ['red']), -1)).toThrow(RangeError);
    expect(() => drawColorBagMany(createColorBag(1, ['red']), 1_000_001)).toThrow(RangeError);
  });
});

describe('one-swap-per-shot queue contract', () => {
  it('preloads an authored FIFO without forging deterministic bag metadata', () => {
    const active: ColorKey[] = ['red', 'blue', 'green', 'yellow'];
    const initial = createCampaignShotQueue({ level: 0, mode: 'classic' }, active);
    const initialSnapshot = structuredClone(initial);
    const preloaded = preloadShotQueue(initial, ['blue', 'red', 'green']);

    expect(initial).toEqual(initialSnapshot);
    expect(preloaded.current).toBe('blue');
    expect(preloaded.next).toBe('red');
    expect(preloaded.preloaded).toEqual(['green']);
    expect(preloaded.swappedThisShot).toBe(false);
    expect(preloaded.bag).toBe(initial.bag);
    expect(preloaded.bag).toEqual(initialSnapshot.bag);

    const authoredAdvance = advanceShotQueue(preloaded, active);
    expect(authoredAdvance.current).toBe('red');
    expect(authoredAdvance.next).toBe('green');
    expect(authoredAdvance.preloaded).toEqual([]);
    expect(authoredAdvance.bag).toBe(initial.bag);
    expect(authoredAdvance.bag.drawCount).toBe(initial.bag.drawCount);

    const bagAdvance = advanceShotQueue(authoredAdvance, active);
    expect(bagAdvance.bag.drawCount).toBe(initial.bag.drawCount + 1);
    expect(bagAdvance.bag).not.toBe(initial.bag);
  });

  it('rejects authored colours outside the active palette', () => {
    const state = createShotQueue(123, ['red', 'blue']);
    expect(() => preloadShotQueue(state, ['red', 'purple'])).toThrow(RangeError);
    expect(() => preloadShotQueue(
      state,
      ['red'] as unknown as readonly [ColorKey, ColorKey, ...ColorKey[]],
    )).toThrow(RangeError);
  });

  it('allows one swap, refuses a second, and resets only after a committed shot', () => {
    const active = COLOR_KEYS.slice(0, 4);
    const initial = createCampaignShotQueue({ level: 0, mode: 'classic' }, active);
    const first = swapShotQueue(initial, active);
    const second = swapShotQueue(first.state, active);

    expect(first.applied).toBe(true);
    expect(first.state.current).toBe(initial.next);
    expect(first.state.next).toBe(initial.current);
    expect(first.state.swappedThisShot).toBe(true);
    expect(second).toEqual({ applied: false, state: first.state });

    const advanced = advanceShotQueue(second.state, active);
    const third = swapShotQueue(advanced, active);
    expect(advanced.shot).toBe(1);
    expect(advanced.swappedThisShot).toBe(false);
    expect(third.applied).toBe(true);
  });

  it('reconciles preloaded and future colours when the active board shrinks', () => {
    const active: ColorKey[] = ['red'];
    const initial = createCampaignShotQueue({ level: 12, mode: 'rush' }, COLOR_KEYS);
    const reconciled = reconcileShotQueue(initial, active);

    expect(reconciled.current).toBe('red');
    expect(reconciled.next).toBe('red');
    for (let shot = 0, state = reconciled; shot < 20; shot += 1) {
      expect(state.current).toBe('red');
      expect(state.next).toBe('red');
      state = advanceShotQueue(state, active);
    }
  });

  it('removes only invalid explicit future shots when the board palette shrinks', () => {
    const initial = createShotQueue(456, ['red', 'blue', 'green']);
    const preloaded = preloadShotQueue(initial, ['red', 'blue', 'green', 'red']);
    const reconciled = reconcileShotQueue(preloaded, ['red', 'blue']);

    expect(reconciled.current).toBe('red');
    expect(reconciled.next).toBe('blue');
    expect(reconciled.preloaded).toEqual(['red']);
    expect(reconciled.bag.activeColors).toEqual(['red', 'blue']);
  });

  it('replays the same seed and actions to an identical serializable result', () => {
    const first = playQueueScript();
    const second = playQueueScript();
    expect(second).toEqual(first);
    expect(JSON.parse(JSON.stringify(second))).toEqual(first);
    expect(['red', 'green']).toContain(first.current);
    expect(['red', 'green']).toContain(first.next);
  });

  it('keeps swap and advance operations pure', () => {
    const active = COLOR_KEYS.slice(0, 4);
    const initial = createCampaignShotQueue({ level: 5, mode: 'classic' }, active);
    const before = structuredClone(initial);
    const swapped = swapShotQueue(initial, active);
    const advanced = advanceShotQueue(swapped.state, active);

    expect(initial).toEqual(before);
    expect(swapped.state).not.toBe(initial);
    expect(advanced).not.toBe(swapped.state);
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ARCADE_GAME_CATALOG,
  ARCADE_GAME_IDS,
  MEMORY_CONSTELLATION_CARD_COUNT,
  MEMORY_CONSTELLATION_PAIR_COUNT,
  createMemoryConstellationState,
  memoryConstellationFingerprint,
  resolveMemoryConstellationMismatch,
  revealMemoryConstellationCard,
  validateMemoryConstellationState,
  type MemoryConstellationState,
} from '../src/game/arcade';
import {
  getArcadeProgress,
  normalizeArcadeProgress,
  recordArcadeResult,
} from '../src/game/arcade-progress';

class MemoryStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, String(value));
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('PaoPao arcade catalog', () => {
  it('pins the three stable, unique game ids and routes', () => {
    expect(ARCADE_GAME_IDS).toEqual([
      'prism-sprint',
      'nexus-aim',
      'memory-constellation',
    ]);
    expect(ARCADE_GAME_CATALOG.map(({ id }) => id)).toEqual(ARCADE_GAME_IDS);
    expect(new Set(ARCADE_GAME_CATALOG.map(({ route }) => route)).size).toBe(3);
  });
});

describe('Memory Constellation deterministic core', () => {
  it('repeats the same deck for the same seed and separates adjacent seeds', () => {
    const first = createMemoryConstellationState(0x1234_5678);
    const repeated = createMemoryConstellationState(0x1234_5678);
    const adjacent = createMemoryConstellationState(0x1234_5679);
    expect(memoryConstellationFingerprint(repeated)).toBe(memoryConstellationFingerprint(first));
    expect(memoryConstellationFingerprint(adjacent)).not.toBe(memoryConstellationFingerprint(first));
  });

  it('keeps a large seed corpus legal with exactly two of every stable pair', () => {
    for (let seed = 0; seed < 5_000; seed += 1) {
      const state = createMemoryConstellationState(seed);
      expect(validateMemoryConstellationState(state)).toBe(true);
      expect(state.cards).toHaveLength(MEMORY_CONSTELLATION_CARD_COUNT);
      const counts = Array.from({ length: MEMORY_CONSTELLATION_PAIR_COUNT }, (_, pairIndex) => (
        state.cards.filter((card) => card.pairIndex === pairIndex).length
      ));
      expect(counts).toEqual([2, 2, 2, 2, 2, 2, 2, 2]);
      expect(new Set(state.cards.map(({ id }) => id)).size).toBe(MEMORY_CONSTELLATION_CARD_COUNT);
    }
  });

  it('resolves mismatches explicitly without mutating its input', () => {
    const initial = createMemoryConstellationState(417);
    const firstIndex = 0;
    const secondIndex = initial.cards.findIndex(
      (card, index) => index !== firstIndex && card.pairIndex !== initial.cards[firstIndex].pairIndex,
    );
    const initialSnapshot = structuredClone(initial);
    const first = revealMemoryConstellationCard(initial, firstIndex);
    expect(first.accepted).toBe(true);
    expect(initial).toEqual(initialSnapshot);
    if (!first.accepted) throw new Error('First reveal rejected.');

    const second = revealMemoryConstellationCard(first.state, secondIndex);
    expect(second).toMatchObject({ accepted: true, event: 'mismatch' });
    if (!second.accepted) throw new Error('Second reveal rejected.');
    expect(second.state.moves).toBe(1);
    expect(second.state.phase).toBe('mismatch');
    expect(revealMemoryConstellationCard(second.state, 3)).toMatchObject({
      accepted: false,
      reason: 'awaiting-resolution',
    });

    const resolved = resolveMemoryConstellationMismatch(second.state);
    expect(resolved).toMatchObject({ accepted: true, event: 'mismatch-resolved' });
    if (!resolved.accepted) throw new Error('Mismatch resolution rejected.');
    expect(resolved.state.phase).toBe('ready');
    expect(resolved.state.cards.filter(({ state }) => state === 'revealed')).toHaveLength(0);
  });

  it('reaches one immutable terminal state after all eight pairs', () => {
    let state = createMemoryConstellationState(9_001);
    const initial = structuredClone(state);
    for (let pairIndex = 0; pairIndex < MEMORY_CONSTELLATION_PAIR_COUNT; pairIndex += 1) {
      const [firstIndex, secondIndex] = state.cards.flatMap((card, index) => (
        card.pairIndex === pairIndex ? [index] : []
      ));
      const first = revealMemoryConstellationCard(state, firstIndex);
      expect(first.accepted).toBe(true);
      if (!first.accepted) throw new Error('First pair card rejected.');
      const second = revealMemoryConstellationCard(first.state, secondIndex);
      expect(second.accepted).toBe(true);
      if (!second.accepted) throw new Error('Second pair card rejected.');
      state = second.state;
    }
    expect(state).toMatchObject({
      phase: 'completed',
      completed: true,
      matchedPairs: 8,
      moves: 8,
    });
    expect(state.cards.every(({ state: cardState }) => cardState === 'matched')).toBe(true);
    expect(validateMemoryConstellationState(state)).toBe(true);
    expect(revealMemoryConstellationCard(state, 0)).toMatchObject({
      accepted: false,
      reason: 'completed',
    });
    expect(initial.cards.every(({ state: cardState }) => cardState === 'hidden')).toBe(true);
  });

  it('fails closed for malformed selections and contradictory state', () => {
    const state = createMemoryConstellationState(72);
    expect(revealMemoryConstellationCard(state, -1)).toMatchObject({
      accepted: false,
      reason: 'invalid-index',
    });
    expect(revealMemoryConstellationCard(state, 16)).toMatchObject({
      accepted: false,
      reason: 'invalid-index',
    });
    const corrupt = structuredClone(state) as MemoryConstellationState;
    corrupt.cards[0].pairIndex = 99;
    expect(validateMemoryConstellationState(corrupt)).toBe(false);
    expect(revealMemoryConstellationCard(corrupt, 0)).toEqual({
      accepted: false,
      reason: 'invalid-state',
      state: null,
    });
  });
});

describe('bounded local arcade progress', () => {
  it('normalizes corruption, drops unknown games and clamps every metric', () => {
    const progress = normalizeArcadeProgress({
      version: 99,
      games: {
        'prism-sprint': {
          plays: 9e20,
          bestScore: Infinity,
          bestCombo: -40,
          bestTimeMs: 9e20,
          bestMoves: 0,
        },
        unknown: { plays: 500 },
      },
    });
    expect(progress).toEqual({
      version: 1,
      games: {
        'prism-sprint': {
          plays: 1_000_000,
          bestScore: 0,
          bestCombo: 0,
          bestTimeMs: 86_400_000,
          bestMoves: 1,
        },
        'nexus-aim': {
          plays: 0,
          bestScore: 0,
          bestCombo: 0,
          bestTimeMs: null,
          bestMoves: null,
        },
        'memory-constellation': {
          plays: 0,
          bestScore: 0,
          bestCombo: 0,
          bestTimeMs: null,
          bestMoves: null,
        },
      },
    });
  });

  it('persists maxima for score/combo and minima for time/moves without wallet fields', () => {
    vi.stubGlobal('localStorage', new MemoryStorage());
    recordArcadeResult('memory-constellation', {
      score: 2_400,
      combo: 4,
      timeMs: 80_000,
      moves: 19,
    });
    const progress = recordArcadeResult('memory-constellation', {
      score: 2_100,
      combo: 9,
      timeMs: 73_000,
      moves: 21,
    });
    expect(progress.games['memory-constellation']).toEqual({
      plays: 2,
      bestScore: 2_400,
      bestCombo: 9,
      bestTimeMs: 73_000,
      bestMoves: 19,
    });
    expect(getArcadeProgress()).toEqual(progress);
    expect(JSON.stringify(progress)).not.toMatch(/coin|wallet|inventory|reward|run/i);
  });
});

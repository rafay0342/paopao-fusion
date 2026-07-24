import { describe, expect, it } from 'vitest';
import {
  MATCH3_LEVEL_COUNT,
  cloneMatch3State,
  createMatch3State,
  findMatch3Runs,
  findValidMatch3Moves,
  getMatch3LevelDefinition,
  match3BoardFingerprint,
  match3Hint,
  tryMatch3Swap,
  useMatch3Booster,
  type Match3Board,
  type Match3Color,
} from '../src/game/match3';

function stableBoard(): Match3Board {
  const colors: Match3Color[] = ['red', 'blue', 'green', 'yellow', 'purple', 'orange'];
  let id = 1;
  return Array.from({ length: 8 }, (_, row) => (
    Array.from({ length: 8 }, (_, col) => ({
      tile: {
        id: id++,
        color: colors[(row * 2 + col) % colors.length],
        special: null,
      },
      shell: 0,
      vine: false,
    }))
  ));
}

describe('Prism Cascade deterministic board generation', () => {
  it('creates all 30 stages without opening matches or dead boards', () => {
    expect(MATCH3_LEVEL_COUNT).toBe(30);
    for (let level = 0; level < MATCH3_LEVEL_COUNT; level += 1) {
      const first = createMatch3State(level);
      const second = createMatch3State(level);
      expect(match3BoardFingerprint(second.board)).toBe(match3BoardFingerprint(first.board));
      expect(findMatch3Runs(first.board)).toEqual([]);
      expect(findValidMatch3Moves(first.board, 1)).toHaveLength(1);
      expect(first.movesRemaining).toBe(getMatch3LevelDefinition(level).moves);
      expect(first.board.flat()).toHaveLength(64);
      expect(new Set(first.board.flat().map((cell) => cell.tile?.id)).size).toBe(64);
    }
  });

  it('domain-separates level seeds and accepts deterministic seed overrides', () => {
    const fingerprints = new Set(
      Array.from({ length: MATCH3_LEVEL_COUNT }, (_, level) => match3BoardFingerprint(createMatch3State(level).board)),
    );
    expect(fingerprints.size).toBe(MATCH3_LEVEL_COUNT);
    expect(match3BoardFingerprint(createMatch3State(5, 44).board))
      .toBe(match3BoardFingerprint(createMatch3State(5, 44).board));
    expect(match3BoardFingerprint(createMatch3State(5, 44).board))
      .not.toBe(match3BoardFingerprint(createMatch3State(5, 45).board));
  });

  it('rejects invalid level identities', () => {
    expect(() => getMatch3LevelDefinition(-1)).toThrow(RangeError);
    expect(() => getMatch3LevelDefinition(30)).toThrow(RangeError);
  });

  it('keeps a 10,000-seed acquisition corpus match-free and playable', () => {
    for (let seed = 1; seed <= 10_000; seed += 1) {
      const state = createMatch3State(seed % MATCH3_LEVEL_COUNT, seed);
      expect(findMatch3Runs(state.board)).toHaveLength(0);
      expect(findValidMatch3Moves(state.board, 1)).toHaveLength(1);
    }
  });
});

describe('Prism Cascade swaps, cascades and specials', () => {
  it('accepts a legal hint, consumes one move and leaves a stable playable state', () => {
    const state = createMatch3State(12);
    const hint = match3Hint(state);
    expect(hint).not.toBeNull();
    const before = structuredClone(state);
    const result = tryMatch3Swap(state, hint!.from, hint!.to);
    expect(result.accepted).toBe(true);
    expect(result.state.movesRemaining).toBe(state.movesRemaining - 1);
    expect(result.steps.length).toBeGreaterThanOrEqual(1);
    expect(result.steps.every((step, index) => step.cascade === index + 1 || step.kind === 'shuffle')).toBe(true);
    expect(result.state.score).toBeGreaterThan(0);
    expect(findMatch3Runs(result.state.board)).toEqual([]);
    expect(findValidMatch3Moves(result.state.board, 1)).toHaveLength(1);
    expect(state).toEqual(before);
  });

  it('reverts a no-match swap without consuming RNG, moves or caller state', () => {
    const state = createMatch3State(0);
    const legal = new Set(findValidMatch3Moves(state.board).flatMap(({ from, to }) => [
      `${from.row}:${from.col}-${to.row}:${to.col}`,
      `${to.row}:${to.col}-${from.row}:${from.col}`,
    ]));
    let rejected: ReturnType<typeof tryMatch3Swap> | null = null;
    for (let row = 0; row < 8 && !rejected; row += 1) {
      for (let col = 0; col < 7 && !rejected; col += 1) {
        if (!legal.has(`${row}:${col}-${row}:${col + 1}`)) {
          rejected = tryMatch3Swap(state, { row, col }, { row, col: col + 1 });
        }
      }
    }
    expect(rejected?.accepted).toBe(false);
    expect(rejected?.reason).toBe('no-match');
    expect(rejected?.state).toEqual(state);
    expect(state.movesRemaining).toBe(getMatch3LevelDefinition(0).moves);
  });

  it('creates a row prism from a straight four and protects its anchor', () => {
    const state = createMatch3State(0, 998);
    state.board = stableBoard();
    // Swap the red tile upward to complete red-red-red-red on row 3.
    state.board[3][0].tile!.color = 'blue';
    state.board[3][1].tile!.color = 'red';
    state.board[3][2].tile!.color = 'red';
    state.board[3][3].tile!.color = 'blue';
    state.board[3][4].tile!.color = 'red';
    state.board[3][5].tile!.color = 'blue';
    state.board[4][3].tile!.color = 'red';
    const result = tryMatch3Swap(state, { row: 3, col: 3 }, { row: 4, col: 3 });
    expect(result.accepted).toBe(true);
    expect(result.steps[0].created).toContainEqual({ at: { row: 3, col: 3 }, special: 'row' });
    expect(result.steps[0].cleared).toHaveLength(3);
    expect(result.state.board.flat().some((cell) => cell.tile?.special === 'row')).toBe(true);
  });

  it('creates a spectrum core from five and activates it on a color swap', () => {
    const state = createMatch3State(0, 551);
    state.board = stableBoard();
    for (const col of [1, 2, 4, 5]) state.board[2][col].tile!.color = 'green';
    state.board[2][3].tile!.color = 'blue';
    state.board[3][3].tile!.color = 'green';
    const created = tryMatch3Swap(state, { row: 2, col: 3 }, { row: 3, col: 3 });
    expect(created.accepted).toBe(true);
    expect(created.steps[0].created).toContainEqual({ at: { row: 2, col: 3 }, special: 'spectrum' });
    const spectrumAt = created.state.board.flatMap((row, rowIndex) => row.flatMap((cell, colIndex) => (
      cell.tile?.special === 'spectrum' ? [{ row: rowIndex, col: colIndex }] : []
    )))[0];
    expect(spectrumAt).toBeDefined();
    const neighbor = spectrumAt.col < 7
      ? { row: spectrumAt.row, col: spectrumAt.col + 1 }
      : { row: spectrumAt.row, col: spectrumAt.col - 1 };
    const activated = tryMatch3Swap(created.state, spectrumAt, neighbor);
    expect(activated.accepted).toBe(true);
    expect(activated.steps[0].activated.some(({ tile }) => tile.special === 'spectrum')).toBe(true);
  });

  it('chains two adjacent specials in one deterministic fusion wave', () => {
    const state = createMatch3State(0, 804);
    state.board = stableBoard();
    state.board[3][3].tile = { id: 9_001, color: null, special: 'spectrum' };
    state.board[3][4].tile = { id: 9_002, color: 'red', special: 'row' };
    const redBefore = state.board.flat().filter((cell) => cell.tile?.color === 'red').length;
    const result = tryMatch3Swap(state, { row: 3, col: 3 }, { row: 3, col: 4 });
    expect(result.accepted).toBe(true);
    expect(result.steps[0].activated.map(({ tile }) => tile.special)).toEqual(
      expect.arrayContaining(['spectrum', 'row']),
    );
    expect(result.steps[0].cleared.length).toBeGreaterThan(redBefore);
  });
});

describe('Prism Cascade blockers and boosters', () => {
  it('tracks shell and vine destruction as objective progress', () => {
    const state = createMatch3State(18);
    const target = state.board.flatMap((row, rowIndex) => row.flatMap((cell, colIndex) => (
      cell.shell > 0 || cell.vine ? [{ row: rowIndex, col: colIndex, shell: cell.shell, vine: cell.vine }] : []
    )))[0];
    expect(target).toBeDefined();
    const result = useMatch3Booster(state, 'hammer', target);
    expect(result.accepted).toBe(true);
    expect(result.state.progress.shellsCleared).toBeGreaterThanOrEqual(target.shell > 0 ? 1 : 0);
    expect(result.state.progress.vinesCleared).toBeGreaterThanOrEqual(target.vine ? 1 : 0);
    expect(result.state.movesRemaining).toBe(state.movesRemaining);
    expect(result.state.boosters.hammer).toBe(0);
  });

  it('supports one-shot shuffle and spectrum boosters without mutating input', () => {
    const state = createMatch3State(4);
    const copy = cloneMatch3State(state);
    const shuffled = useMatch3Booster(state, 'shuffle');
    expect(shuffled.accepted).toBe(true);
    expect(shuffled.steps[0].kind).toBe('shuffle');
    expect(shuffled.state.boosters.shuffle).toBe(0);
    expect(findMatch3Runs(shuffled.state.board)).toEqual([]);
    expect(state).toEqual(copy);

    const transformed = useMatch3Booster(state, 'spectrum', { row: 0, col: 0 });
    expect(transformed.accepted).toBe(true);
    expect(transformed.state.board[0][0].tile?.special).toBe('spectrum');
    expect(transformed.state.board[0][0].tile?.color).toBeNull();
    expect(transformed.state.boosters.spectrum).toBe(0);
  });
});

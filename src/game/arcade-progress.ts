import { ARCADE_GAME_IDS, isArcadeGameId, type ArcadeGameId } from './arcade';

export interface ArcadeGameProgressV1 {
  plays: number;
  bestScore: number;
  bestCombo: number;
  bestTimeMs: number | null;
  bestMoves: number | null;
}

export interface ArcadeProgressV1 {
  version: 1;
  games: Record<ArcadeGameId, ArcadeGameProgressV1>;
}

export interface ArcadeResult {
  score?: number;
  combo?: number;
  timeMs?: number;
  moves?: number;
}

const STORAGE_KEY = 'paopao-arcade-progress-v1';
const MAX_PLAYS = 1_000_000;
const MAX_SCORE = 100_000_000;
const MAX_COMBO = 1_000_000;
const MAX_TIME_MS = 86_400_000;
const MAX_MOVES = 10_000;

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function boundedInteger(
  value: unknown,
  minimum: number,
  maximum: number,
  fallback: number,
): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(maximum, Math.max(minimum, Math.trunc(value)))
    : fallback;
}

function nullableBest(
  value: unknown,
  minimum: number,
  maximum: number,
): number | null {
  return typeof value === 'number' && Number.isFinite(value)
    ? boundedInteger(value, minimum, maximum, minimum)
    : null;
}

function emptyGameProgress(): ArcadeGameProgressV1 {
  return {
    plays: 0,
    bestScore: 0,
    bestCombo: 0,
    bestTimeMs: null,
    bestMoves: null,
  };
}

function normalizeGameProgress(value: unknown): ArcadeGameProgressV1 {
  const input = record(value);
  return {
    plays: boundedInteger(input.plays, 0, MAX_PLAYS, 0),
    bestScore: boundedInteger(input.bestScore, 0, MAX_SCORE, 0),
    bestCombo: boundedInteger(input.bestCombo, 0, MAX_COMBO, 0),
    bestTimeMs: nullableBest(input.bestTimeMs, 1, MAX_TIME_MS),
    bestMoves: nullableBest(input.bestMoves, 1, MAX_MOVES),
  };
}

export function normalizeArcadeProgress(value: unknown = {}): ArcadeProgressV1 {
  const input = record(value);
  const games = record(input.games);
  return {
    version: 1,
    games: Object.fromEntries(
      ARCADE_GAME_IDS.map((id) => [id, normalizeGameProgress(games[id])]),
    ) as Record<ArcadeGameId, ArcadeGameProgressV1>,
  };
}

export function getArcadeProgress(): ArcadeProgressV1 {
  try {
    return normalizeArcadeProgress(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}'));
  } catch {
    return normalizeArcadeProgress();
  }
}

function persistArcadeProgress(value: unknown): ArcadeProgressV1 {
  const progress = normalizeArcadeProgress(value);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
  } catch {
    // Arcade records stay playable when browser storage is blocked or full.
  }
  return progress;
}

function betterMinimum(current: number | null, candidate: unknown, maximum: number): number | null {
  const normalized = nullableBest(candidate, 1, maximum);
  if (normalized === null) return current;
  return current === null ? normalized : Math.min(current, normalized);
}

/**
 * Records local bests only. Arcade results intentionally never touch wallet,
 * campaign, inventory, signed runs, or server-authoritative reward state.
 */
export function recordArcadeResult(
  id: ArcadeGameId,
  result: ArcadeResult,
): ArcadeProgressV1 {
  if (!isArcadeGameId(id)) throw new RangeError(`Unknown arcade game: ${String(id)}`);
  const safeResult = record(result);
  const progress = getArcadeProgress();
  const previous = progress.games[id] ?? emptyGameProgress();
  progress.games[id] = {
    plays: Math.min(MAX_PLAYS, previous.plays + 1),
    bestScore: Math.max(
      previous.bestScore,
      boundedInteger(safeResult.score, 0, MAX_SCORE, 0),
    ),
    bestCombo: Math.max(
      previous.bestCombo,
      boundedInteger(safeResult.combo, 0, MAX_COMBO, 0),
    ),
    bestTimeMs: betterMinimum(previous.bestTimeMs, safeResult.timeMs, MAX_TIME_MS),
    bestMoves: betterMinimum(previous.bestMoves, safeResult.moves, MAX_MOVES),
  };
  return persistArcadeProgress(progress);
}

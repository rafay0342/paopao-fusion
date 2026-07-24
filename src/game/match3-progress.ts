import { MATCH3_LEVEL_COUNT, getMatch3LevelDefinition } from './match3';
import { notifyLocalSaveChanged } from './save-events';

export interface Match3CampaignProgress {
  version: 1;
  unlocked: number;
  bestScores: number[];
  stars: number[];
  cleared: number[];
}

const STORAGE_KEY = 'paopao-prism-cascade-progress-v1';

function integer(value: unknown, minimum: number, maximum: number, fallback = minimum): number {
  const numeric = Number(value);
  return Number.isFinite(numeric)
    ? Math.min(maximum, Math.max(minimum, Math.trunc(numeric)))
    : fallback;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function normalizeMatch3Progress(value: unknown = {}): Match3CampaignProgress {
  const input = asRecord(value);
  const rawScores = Array.isArray(input.bestScores) ? input.bestScores : [];
  const rawStars = Array.isArray(input.stars) ? input.stars : [];
  const bestScores = Array.from(
    { length: MATCH3_LEVEL_COUNT },
    (_, level) => integer(rawScores[level], 0, 100_000_000, 0),
  );
  const stars = Array.from(
    { length: MATCH3_LEVEL_COUNT },
    (_, level) => integer(rawStars[level], 0, 3, 0),
  );
  const inferred = stars.flatMap((value, level) => value > 0 ? [level] : []);
  const cleared = Array.from(new Set([
    ...(Array.isArray(input.cleared) ? input.cleared : []),
    ...inferred,
  ]))
    .filter((level): level is number => (
      Number.isInteger(level) && Number(level) >= 0 && Number(level) < MATCH3_LEVEL_COUNT
    ))
    .map(Number)
    .sort((first, second) => first - second);
  const sequentialUnlock = Math.min(
    MATCH3_LEVEL_COUNT,
    (cleared.length > 0 ? cleared[cleared.length - 1] : -1) + 2,
  );
  return {
    version: 1,
    unlocked: Math.max(1, integer(input.unlocked, 1, MATCH3_LEVEL_COUNT, sequentialUnlock), sequentialUnlock),
    bestScores,
    stars,
    cleared,
  };
}

export function getMatch3Progress(): Match3CampaignProgress {
  try {
    return normalizeMatch3Progress(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}'));
  } catch {
    return normalizeMatch3Progress();
  }
}

export function persistMatch3Progress(value: unknown): Match3CampaignProgress {
  const progress = normalizeMatch3Progress(value);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
  } catch {
    // Private storage failures do not prevent the current play session.
  }
  notifyLocalSaveChanged();
  return progress;
}

export function match3StarsForScore(level: number, score: number): number {
  const target = getMatch3LevelDefinition(level).goals.targetScore;
  if (score >= Math.ceil(target * 1.55)) return 3;
  if (score >= Math.ceil(target * 1.25)) return 2;
  return score >= target ? 1 : 0;
}

export function recordMatch3Clear(level: number, score: number): Match3CampaignProgress {
  if (!Number.isInteger(level) || level < 0 || level >= MATCH3_LEVEL_COUNT) {
    throw new RangeError(`Invalid Match-3 level: ${level}`);
  }
  const progress = getMatch3Progress();
  const safeScore = integer(score, 0, 100_000_000, 0);
  progress.bestScores[level] = Math.max(progress.bestScores[level] ?? 0, safeScore);
  progress.stars[level] = Math.max(progress.stars[level] ?? 0, match3StarsForScore(level, safeScore));
  if (!progress.cleared.includes(level)) progress.cleared.push(level);
  progress.cleared.sort((first, second) => first - second);
  progress.unlocked = Math.min(MATCH3_LEVEL_COUNT, Math.max(progress.unlocked, level + 2));
  return persistMatch3Progress(progress);
}

export function isMatch3LevelUnlocked(level: number, progress = getMatch3Progress()): boolean {
  return Number.isInteger(level) && level >= 0 && level < progress.unlocked;
}

export function totalMatch3Stars(progress = getMatch3Progress()): number {
  return progress.stars.reduce((sum, stars) => sum + stars, 0);
}

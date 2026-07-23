import { LEVELS, MAP_NODES, mapNodeForLevel } from '../config';
import { notifyLocalSaveChanged } from './save-events';

export interface GameProgress {
  unlocked: number;
  bestScores: number[];
  stars: number[];
  cleared: number[];
  mastered: number[];
  claimedFirstClears: number[];
}

const KEY = 'paopao-fusion-progress-v2';

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function safeInteger(value: unknown, minimum: number, maximum: number, fallback = minimum): number {
  const numeric = Number(value);
  return Number.isFinite(numeric)
    ? Math.min(maximum, Math.max(minimum, Math.trunc(numeric)))
    : fallback;
}

function emptyProgress(): GameProgress {
  return {
    unlocked: 1,
    bestScores: Array(LEVELS.length).fill(0),
    stars: Array(LEVELS.length).fill(0),
    cleared: [],
    mastered: [],
    claimedFirstClears: [],
  };
}

export function normalizeGameProgress(value: unknown = {}): GameProgress {
  const saved = record(value);
  const rawBestScores = Array.isArray(saved.bestScores) ? saved.bestScores : [];
  const rawStars = Array.isArray(saved.stars) ? saved.stars : [];
  const bestScores = Array.from({ length: LEVELS.length }, (_, i) => safeInteger(rawBestScores[i], 0, 10_000_000, 0));
  const stars = Array.from({ length: LEVELS.length }, (_, i) => safeInteger(rawStars[i], 0, 3, 0));
  const legacyUnlocked = safeInteger(saved.unlocked, 1, LEVELS.length, 1);
  const clearedLegacyFinale = bestScores[11] > 0 || stars[11] > 0;
  const inferredCleared = stars.flatMap((value, level) => value > 0 ? [level] : []);
  const cleared = Array.from(new Set([...(Array.isArray(saved.cleared) ? saved.cleared : []), ...inferredCleared]))
    .filter((level) => Number.isInteger(level) && level >= 0 && level < LEVELS.length);
  const mastered = Array.from(new Set([...(Array.isArray(saved.mastered) ? saved.mastered : []), ...stars.flatMap((value, level) => value >= 3 ? [level] : [])]))
    .filter((level) => Number.isInteger(level) && level >= 0 && level < LEVELS.length);
  return {
    unlocked: Math.min(LEVELS.length, Math.max(1, clearedLegacyFinale ? Math.max(13, legacyUnlocked) : legacyUnlocked)),
    bestScores,
    stars,
    cleared,
    mastered,
    claimedFirstClears: Array.from(new Set(Array.isArray(saved.claimedFirstClears) ? saved.claimedFirstClears : []))
      .filter((level) => Number.isInteger(level) && level >= 0 && level < LEVELS.length),
  };
}

export function getProgress(): GameProgress {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}') as unknown;
    return normalizeGameProgress(saved);
  } catch {
    return emptyProgress();
  }
}

export function mergeGameProgress(localInput: Partial<GameProgress>, cloudInput: Partial<GameProgress>): GameProgress {
  const local = normalizeGameProgress(localInput);
  const cloud = normalizeGameProgress({ ...local, ...record(cloudInput) });
  return {
    unlocked: Math.max(local.unlocked, cloud.unlocked),
    bestScores: local.bestScores.map((score, index) => Math.max(score, cloud.bestScores[index] ?? 0)),
    stars: local.stars.map((stars, index) => Math.max(stars, cloud.stars[index] ?? 0)),
    cleared: Array.from(new Set([...local.cleared, ...cloud.cleared])),
    mastered: Array.from(new Set([...local.mastered, ...cloud.mastered])),
    claimedFirstClears: Array.from(new Set([...local.claimedFirstClears, ...cloud.claimedFirstClears])),
  };
}

export function persistGameProgress(value: unknown): GameProgress {
  const progress = normalizeGameProgress(value);
  try {
    localStorage.setItem(KEY, JSON.stringify(progress));
  } catch {
    // The normalized value remains usable for the current session.
  }
  notifyLocalSaveChanged();
  return progress;
}

function starsFor(level: number, score: number): number {
  const target = LEVELS[level]?.targetScore ?? 1;
  if (score >= target) return 3;
  if (score >= target * 0.66) return 2;
  return 1;
}

export function recordLevelClear(level: number, score: number): GameProgress {
  const progress = getProgress();
  progress.bestScores[level] = Math.max(progress.bestScores[level] ?? 0, score);
  progress.stars[level] = Math.max(progress.stars[level] ?? 0, starsFor(level, score));
  if (!progress.cleared.includes(level)) progress.cleared.push(level);
  if ((progress.stars[level] ?? 0) >= 3 && !progress.mastered.includes(level)) progress.mastered.push(level);
  progress.unlocked = MAP_NODES.filter((node) => isLevelUnlocked(node.level, progress)).length;
  return persistGameProgress(progress);
}

export function isLevelUnlocked(level: number, progress = getProgress()): boolean {
  const node = mapNodeForLevel(level);
  return node.requires.length === 0 || node.requires.every((required) => progress.cleared.includes(required));
}

export function isLevelCleared(level: number, progress = getProgress()): boolean {
  return progress.cleared.includes(level);
}

export function claimFirstClear(level: number): boolean {
  const progress = getProgress();
  if (!progress.cleared.includes(level) || progress.claimedFirstClears.includes(level)) return false;
  progress.claimedFirstClears.push(level);
  persistGameProgress(progress);
  return true;
}

export function totalStars(progress = getProgress()): number {
  return progress.stars.reduce((sum, value) => sum + value, 0);
}

export function furthestUnlockedWorld(progress = getProgress()): number {
  return MAP_NODES.reduce((world, node) => isLevelUnlocked(node.level, progress)
    ? Math.max(world, LEVELS[node.level].world)
    : world, 0);
}

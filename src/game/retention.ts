import type { ArtifactId, GameMode } from './meta';
import { addCoins, addMysteryKeys, getMeta } from './meta';
import { notifyLocalSaveChanged } from './save-events';

export type ChallengeModifier = 'score_frenzy' | 'precision_plus' | 'short_fuse';
export type QuestMetric = 'runs' | 'wins' | 'score' | 'hits' | 'specialHits' | 'accuracy90' | 'combo10' | 'bossWins';

export interface GhostShot {
  atMs: number;
  angle: number;
  color: string;
}

const GHOST_COLORS = new Set(['red', 'blue', 'green', 'yellow', 'purple', 'orange']);
const MAX_GHOST_SHOTS = 250;
const MAX_GHOST_DURATION_MS = 14_400_000;

export interface RunSummary {
  id: string;
  level: number;
  mode: GameMode;
  score: number;
  won: boolean;
  hits: number;
  misses: number;
  specialHits: number;
  maxCombo: number;
  accuracy: number;
  durationMs: number;
  artifact: ArtifactId;
  challengeId?: string;
  challengeToken?: string;
  ghost?: GhostShot[];
  createdAt: string;
}

export interface ChallengeDef {
  id: string;
  date: string;
  seed: number;
  level: number;
  mode: GameMode;
  modifier: ChallengeModifier;
  rewardCoins: number;
  submissionToken?: string;
}

export interface QuestDef {
  id: string;
  title: string;
  metric: QuestMetric;
  target: number;
  rewardCoins: number;
  rewardKeys: number;
}

export interface QuestProgress extends QuestDef {
  value: number;
  claimed: boolean;
}

export interface AchievementDef extends QuestDef {
  badge: string;
}

export interface PlayerSaveV3 {
  version: 3;
  playerId: string;
  displayName: string;
  createdAt: string;
  dailyDate: string;
  weeklyKey: string;
  lastLoginDate: string;
  loginStreak: number;
  daily: QuestProgress[];
  weekly: QuestProgress[];
  achievements: Record<string, { value: number; unlocked: boolean; claimed: boolean }>;
  badges: string[];
  mastery: Record<ArtifactId, { xp: number; level: number }>;
  totals: Record<QuestMetric, number>;
  claimedChallengeIds: string[];
  recentRuns: RunSummary[];
  pendingRuns: RunSummary[];
  lastSyncedAt: string;
}

export const PLAYER_SAVE_STORAGE_KEY = 'paopao-fusion-player-v3';
const KEY = PLAYER_SAVE_STORAGE_KEY;
export const PLAYER_SAVE_CORRUPT_STORAGE_KEY = `${PLAYER_SAVE_STORAGE_KEY}.corrupt`;
const DAY = 86_400_000;
const MAX_SAFE_COUNT = 1_000_000_000;
const ARTIFACT_IDS: readonly ArtifactId[] = ['chrono', 'phoenix', 'void', 'fortune'];
const GAME_MODES: readonly GameMode[] = ['classic', 'rush', 'precision'];
const QUEST_METRICS: readonly QuestMetric[] = ['runs', 'wins', 'score', 'hits', 'specialHits', 'accuracy90', 'combo10', 'bossWins'];

let volatileSave: PlayerSaveV3 | null = null;
let preferVolatileSave = false;
let observedStorage: Storage | null = null;

export const DAILY_QUESTS: readonly QuestDef[] = [
  { id: 'daily-runs', title: 'Complete 2 runs', metric: 'runs', target: 2, rewardCoins: 120, rewardKeys: 0 },
  { id: 'daily-hits', title: 'Land 30 successful hits', metric: 'hits', target: 30, rewardCoins: 160, rewardKeys: 0 },
  { id: 'daily-score', title: 'Earn 12,000 score', metric: 'score', target: 12_000, rewardCoins: 180, rewardKeys: 1 },
] as const;

export const WEEKLY_QUESTS: readonly QuestDef[] = [
  { id: 'weekly-wins', title: 'Win 7 levels', metric: 'wins', target: 7, rewardCoins: 700, rewardKeys: 1 },
  { id: 'weekly-special', title: 'Trigger 40 special hits', metric: 'specialHits', target: 40, rewardCoins: 850, rewardKeys: 1 },
  { id: 'weekly-score', title: 'Earn 100,000 score', metric: 'score', target: 100_000, rewardCoins: 1200, rewardKeys: 2 },
] as const;

const ACHIEVEMENT_BASE: readonly Omit<AchievementDef, 'rewardKeys'>[] = [
  { id: 'first-light', title: 'Win your first level', metric: 'wins', target: 1, rewardCoins: 200, badge: 'FIRST LIGHT' },
  { id: 'steady-hand', title: 'Finish 5 runs', metric: 'runs', target: 5, rewardCoins: 250, badge: 'STEADY HAND' },
  { id: 'prism-hunter', title: 'Land 100 hits', metric: 'hits', target: 100, rewardCoins: 350, badge: 'PRISM HUNTER' },
  { id: 'combo-smith', title: 'Reach a 10 combo', metric: 'combo10', target: 1, rewardCoins: 450, badge: 'COMBO SMITH' },
  { id: 'sharp-eye', title: 'Finish a run at 90% accuracy', metric: 'accuracy90', target: 1, rewardCoins: 500, badge: 'SHARP EYE' },
  { id: 'boss-breaker', title: 'Defeat a boss', metric: 'bossWins', target: 1, rewardCoins: 600, badge: 'BOSS BREAKER' },
  { id: 'royal-score', title: 'Earn 100,000 total score', metric: 'score', target: 100_000, rewardCoins: 900, badge: 'ROYAL SCORE' },
  { id: 'veteran', title: 'Win 25 levels', metric: 'wins', target: 25, rewardCoins: 1200, badge: 'VETERAN' },
  { id: 'pathfinder', title: 'Win 5 levels', metric: 'wins', target: 5, rewardCoins: 300, badge: 'PATHFINDER' },
  { id: 'conqueror', title: 'Win 10 levels', metric: 'wins', target: 10, rewardCoins: 550, badge: 'CONQUEROR' },
  { id: 'eternal', title: 'Win 50 levels', metric: 'wins', target: 50, rewardCoins: 1800, badge: 'ETERNAL' },
  { id: 'adventurer', title: 'Complete 25 runs', metric: 'runs', target: 25, rewardCoins: 650, badge: 'ADVENTURER' },
  { id: 'centurion', title: 'Complete 100 runs', metric: 'runs', target: 100, rewardCoins: 2000, badge: 'CENTURION' },
  { id: 'orb-sage', title: 'Land 500 hits', metric: 'hits', target: 500, rewardCoins: 850, badge: 'ORB SAGE' },
  { id: 'orb-legend', title: 'Land 2,000 hits', metric: 'hits', target: 2000, rewardCoins: 2200, badge: 'ORB LEGEND' },
  { id: 'supercharged', title: 'Trigger 100 special hits', metric: 'specialHits', target: 100, rewardCoins: 900, badge: 'SUPERCHARGED' },
  { id: 'sovereign-score', title: 'Earn 500,000 total score', metric: 'score', target: 500_000, rewardCoins: 1800, badge: 'SOVEREIGN SCORE' },
  { id: 'million-prism', title: 'Earn 1,000,000 total score', metric: 'score', target: 1_000_000, rewardCoins: 3000, badge: 'MILLION PRISM' },
  { id: 'world-breaker', title: 'Defeat 4 bosses', metric: 'bossWins', target: 4, rewardCoins: 1500, badge: 'WORLD BREAKER' },
  { id: 'six-crowns', title: 'Defeat all 6 world bosses', metric: 'bossWins', target: 6, rewardCoins: 2600, badge: 'SIX CROWNS' },
] as const;

export const ACHIEVEMENTS: readonly AchievementDef[] = ACHIEVEMENT_BASE.map((item) => ({ ...item, rewardKeys: 1 }));

function utcDate(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

function weekKey(now = new Date()): string {
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((date.getTime() - yearStart.getTime()) / DAY) + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

function id(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

function zeroTotals(): Record<QuestMetric, number> {
  return { runs: 0, wins: 0, score: 0, hits: 0, specialHits: 0, accuracy90: 0, combo10: 0, bossWins: 0 };
}

function quests(defs: readonly QuestDef[]): QuestProgress[] {
  return defs.map((quest) => ({ ...quest, value: 0, claimed: false }));
}

function initialSave(now = new Date()): PlayerSaveV3 {
  return {
    version: 3,
    playerId: id('player'),
    displayName: 'PLAYER',
    createdAt: now.toISOString(),
    dailyDate: utcDate(now),
    weeklyKey: weekKey(now),
    lastLoginDate: '',
    loginStreak: 0,
    daily: quests(DAILY_QUESTS),
    weekly: quests(WEEKLY_QUESTS),
    achievements: Object.fromEntries(ACHIEVEMENTS.map((item) => [item.id, { value: 0, unlocked: false, claimed: false }])),
    badges: [],
    mastery: Object.fromEntries(ARTIFACT_IDS.map((artifact) => [artifact, { xp: 0, level: 1 }])) as PlayerSaveV3['mastery'],
    totals: zeroTotals(),
    claimedChallengeIds: [],
    recentRuns: [],
    pendingRuns: [],
    lastSyncedAt: '',
  };
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function safeInteger(value: unknown, min = 0, max = MAX_SAFE_COUNT, fallback = 0): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.min(max, Math.max(min, Math.trunc(numeric))) : fallback;
}

function safeText(value: unknown, fallback: string, maxLength: number): string {
  return typeof value === 'string' && value.trim()
    ? value.trim().slice(0, maxLength)
    : fallback;
}

function safeDate(value: unknown, fallback = ''): string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? value : fallback;
}

function uniqueStrings(value: unknown, limit: number, maxLength = 96): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map((item) => item.trim().slice(0, maxLength))))
    .slice(-limit);
}

function normalizeQuests(value: unknown, definitions: readonly QuestDef[]): QuestProgress[] {
  const byId = new Map<string, Record<string, unknown>>();
  if (Array.isArray(value)) {
    for (const candidate of value) {
      const item = record(candidate);
      if (typeof item.id === 'string') byId.set(item.id, item);
    }
  }
  return definitions.map((definition) => {
    const saved = byId.get(definition.id) ?? {};
    const value = safeInteger(saved.value, 0, definition.target);
    return { ...definition, value, claimed: Boolean(saved.claimed) && value >= definition.target };
  });
}

function normalizeAchievements(value: unknown): PlayerSaveV3['achievements'] {
  const source = record(value);
  return Object.fromEntries(ACHIEVEMENTS.map((definition) => {
    const saved = record(source[definition.id]);
    const progress = safeInteger(saved.value, 0, definition.target);
    const unlocked = progress >= definition.target || saved.unlocked === true;
    return [definition.id, { value: progress, unlocked, claimed: unlocked && saved.claimed === true }];
  }));
}

function normalizeMastery(value: unknown): PlayerSaveV3['mastery'] {
  const source = record(value);
  return Object.fromEntries(ARTIFACT_IDS.map((artifact) => {
    const saved = record(source[artifact]);
    const xp = safeInteger(saved.xp, 0, MAX_SAFE_COUNT);
    const earnedLevel = Math.min(10, 1 + Math.floor(xp / 500));
    return [artifact, { xp, level: safeInteger(saved.level, earnedLevel, 10, earnedLevel) }];
  })) as PlayerSaveV3['mastery'];
}

function normalizeTotals(value: unknown): PlayerSaveV3['totals'] {
  const source = record(value);
  return Object.fromEntries(QUEST_METRICS.map((metric) => [metric, safeInteger(source[metric])])) as PlayerSaveV3['totals'];
}

export function normalizeGhostTrace(value: unknown, durationMs = MAX_GHOST_DURATION_MS): GhostShot[] | undefined {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_GHOST_SHOTS) return undefined;
  const maximumAtMs = Math.min(
    MAX_GHOST_DURATION_MS,
    Math.max(0, Number.isFinite(durationMs) ? Math.trunc(durationMs) : 0),
  );
  const shots: GhostShot[] = [];
  let previousAtMs = -1;
  for (const candidate of value) {
    const shot = record(candidate);
    if (typeof shot.atMs !== 'number' || !Number.isInteger(shot.atMs)
      || shot.atMs < previousAtMs || shot.atMs > maximumAtMs
      || typeof shot.angle !== 'number' || !Number.isFinite(shot.angle)
      || shot.angle < -180 || shot.angle > 0
      || typeof shot.color !== 'string' || !GHOST_COLORS.has(shot.color)) {
      return undefined;
    }
    shots.push({ atMs: shot.atMs, angle: shot.angle, color: shot.color });
    previousAtMs = shot.atMs;
  }
  return shots;
}

function normalizeRun(value: unknown): RunSummary | null {
  const run = record(value);
  const id = safeText(run.id, '', 128);
  if (!id) return null;
  const mode = GAME_MODES.includes(run.mode as GameMode) ? run.mode as GameMode : 'classic';
  const artifact = ARTIFACT_IDS.includes(run.artifact as ArtifactId) ? run.artifact as ArtifactId : 'chrono';
  const createdAt = safeDate(run.createdAt, '');
  const durationMs = safeInteger(run.durationMs);
  const ghost = normalizeGhostTrace(run.ghost, durationMs);
  return {
    id,
    level: safeInteger(run.level, 0, 999),
    mode,
    score: safeInteger(run.score),
    won: run.won === true,
    hits: safeInteger(run.hits),
    misses: safeInteger(run.misses),
    specialHits: safeInteger(run.specialHits),
    maxCombo: safeInteger(run.maxCombo),
    accuracy: Math.min(100, Math.max(0, Number.isFinite(Number(run.accuracy)) ? Number(run.accuracy) : 0)),
    durationMs,
    artifact,
    ...(typeof run.challengeId === 'string' && run.challengeId.trim() ? { challengeId: run.challengeId.trim().slice(0, 128) } : {}),
    ...(typeof run.challengeToken === 'string' && run.challengeToken.trim() ? { challengeToken: run.challengeToken.trim().slice(0, 512) } : {}),
    ...(ghost ? { ghost } : {}),
    createdAt: createdAt || new Date(0).toISOString(),
  };
}

function normalizeRuns(value: unknown, limit: number, keepNewestAtEnd = false): RunSummary[] {
  if (!Array.isArray(value)) return [];
  const byId = new Map<string, RunSummary>();
  for (const candidate of value) {
    const run = normalizeRun(candidate);
    if (run && !byId.has(run.id)) byId.set(run.id, run);
  }
  const runs = Array.from(byId.values());
  return keepNewestAtEnd ? runs.slice(-limit) : runs.slice(0, limit);
}

export function normalizePlayerSaveV3(rawValue: unknown, now = new Date()): PlayerSaveV3 {
  const raw = record(rawValue);
  const base = initialSave(now);
  const saved: PlayerSaveV3 = {
    ...base,
    version: 3,
    playerId: safeText(raw.playerId, base.playerId, 96),
    displayName: safeText(raw.displayName, base.displayName, 14).toUpperCase(),
    createdAt: safeDate(raw.createdAt, base.createdAt),
    dailyDate: typeof raw.dailyDate === 'string' ? raw.dailyDate.slice(0, 10) : base.dailyDate,
    weeklyKey: typeof raw.weeklyKey === 'string' ? raw.weeklyKey.slice(0, 12) : base.weeklyKey,
    lastLoginDate: typeof raw.lastLoginDate === 'string' ? raw.lastLoginDate.slice(0, 10) : '',
    loginStreak: safeInteger(raw.loginStreak, 0, 7),
    daily: normalizeQuests(raw.daily, DAILY_QUESTS),
    weekly: normalizeQuests(raw.weekly, WEEKLY_QUESTS),
    achievements: normalizeAchievements(raw.achievements),
    badges: uniqueStrings(raw.badges, 100, 64),
    mastery: normalizeMastery(raw.mastery),
    totals: normalizeTotals(raw.totals),
    claimedChallengeIds: uniqueStrings(raw.claimedChallengeIds, 90, 128),
    recentRuns: normalizeRuns(raw.recentRuns, 20),
    pendingRuns: normalizeRuns(raw.pendingRuns, 50, true),
    lastSyncedAt: safeDate(raw.lastSyncedAt, ''),
  };
  refreshPeriods(saved, now);
  return saved;
}

function refreshPeriods(save: PlayerSaveV3, now = new Date()): void {
  const today = utcDate(now);
  if (save.dailyDate !== today) {
    save.dailyDate = today;
    save.daily = quests(DAILY_QUESTS);
  }
  const currentWeek = weekKey(now);
  if (save.weeklyKey !== currentWeek) {
    save.weeklyKey = currentWeek;
    save.weekly = quests(WEEKLY_QUESTS);
  }
  if (save.lastLoginDate !== today) {
    const yesterday = utcDate(new Date(now.getTime() - DAY));
    save.loginStreak = save.lastLoginDate === yesterday ? Math.min(7, save.loginStreak + 1) : 1;
    save.lastLoginDate = today;
  }
}

function availableStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function resetVolatileIfStorageChanged(storage: Storage | null): void {
  if (storage && observedStorage && storage !== observedStorage) {
    volatileSave = null;
    preferVolatileSave = false;
  }
  if (storage) observedStorage = storage;
}

function persist(save: PlayerSaveV3): PlayerSaveV3 {
  volatileSave = save;
  const storage = availableStorage();
  resetVolatileIfStorageChanged(storage);
  if (!storage) {
    preferVolatileSave = true;
    notifyLocalSaveChanged();
    return save;
  }
  try {
    storage.setItem(KEY, JSON.stringify(save));
    preferVolatileSave = false;
  } catch {
    preferVolatileSave = true;
  }
  notifyLocalSaveChanged();
  return save;
}

export function getPlayerSave(now = new Date()): PlayerSaveV3 {
  const storage = availableStorage();
  resetVolatileIfStorageChanged(storage);
  if (!storage) {
    const recovered = normalizePlayerSaveV3(volatileSave ?? initialSave(now), now);
    volatileSave = recovered;
    preferVolatileSave = true;
    return recovered;
  }
  if (preferVolatileSave && volatileSave) return persist(normalizePlayerSaveV3(volatileSave, now));

  let rawText: string | null;
  try {
    rawText = storage.getItem(KEY);
  } catch {
    const recovered = normalizePlayerSaveV3(volatileSave ?? initialSave(now), now);
    volatileSave = recovered;
    preferVolatileSave = true;
    return recovered;
  }

  if (rawText === null) return persist(normalizePlayerSaveV3(initialSave(now), now));
  try {
    const save = normalizePlayerSaveV3(JSON.parse(rawText), now);
    return persist(save);
  } catch {
    try {
      storage.setItem(PLAYER_SAVE_CORRUPT_STORAGE_KEY, JSON.stringify({
        capturedAt: now.toISOString(),
        raw: rawText.slice(0, 100_000),
      }));
      storage.removeItem(KEY);
    } catch {
      // Recovery still continues through the stable in-memory copy below.
    }
    return persist(normalizePlayerSaveV3(volatileSave ?? initialSave(now), now));
  }
}

function metricDelta(summary: RunSummary): Record<QuestMetric, number> {
  return {
    runs: 1,
    wins: summary.won ? 1 : 0,
    score: Math.max(0, summary.score),
    hits: Math.max(0, summary.hits),
    specialHits: Math.max(0, summary.specialHits),
    accuracy90: summary.accuracy >= 90 ? 1 : 0,
    combo10: summary.maxCombo >= 10 ? 1 : 0,
    bossWins: summary.won && [2, 5, 8, 11, 14, 17].includes(summary.level) ? 1 : 0,
  };
}

export function recordRunSummary(summary: RunSummary): PlayerSaveV3 {
  const save = getPlayerSave();
  if (save.recentRuns.some((run) => run.id === summary.id)) return save;
  const delta = metricDelta(summary);
  (Object.keys(delta) as QuestMetric[]).forEach((metric) => { save.totals[metric] += delta[metric]; });
  for (const list of [save.daily, save.weekly]) {
    list.forEach((quest) => { quest.value = Math.min(quest.target, quest.value + delta[quest.metric]); });
  }
  ACHIEVEMENTS.forEach((definition) => {
    const progress = save.achievements[definition.id];
    progress.value = Math.min(definition.target, progress.value + delta[definition.metric]);
    progress.unlocked = progress.value >= definition.target;
  });
  const mastery = save.mastery[summary.artifact];
  mastery.xp += summary.hits * 3 + summary.specialHits * 8 + (summary.won ? 120 : 25);
  mastery.level = Math.min(10, 1 + Math.floor(mastery.xp / 500));
  if (mastery.level >= 5) save.badges.push(`${summary.artifact.toUpperCase()} ADEPT`);
  if (mastery.level >= 10) save.badges.push(`${summary.artifact.toUpperCase()} MASTER`);
  save.badges = Array.from(new Set(save.badges));
  save.recentRuns.unshift(summary);
  save.recentRuns = save.recentRuns.slice(0, 20);
  save.pendingRuns.push(summary);
  save.pendingRuns = save.pendingRuns.slice(-50);
  return persist(save);
}

export function claimQuest(kind: 'daily' | 'weekly', questId: string): { ok: boolean; save: PlayerSaveV3 } {
  const save = getPlayerSave();
  const quest = save[kind].find((item) => item.id === questId);
  if (!quest || quest.claimed || quest.value < quest.target) return { ok: false, save };
  quest.claimed = true;
  addCoins(quest.rewardCoins);
  if (quest.rewardKeys) addMysteryKeys(quest.rewardKeys);
  return { ok: true, save: persist(save) };
}

export function claimAchievement(achievementId: string): { ok: boolean; save: PlayerSaveV3 } {
  const save = getPlayerSave();
  const definition = ACHIEVEMENTS.find((item) => item.id === achievementId);
  const progress = save.achievements[achievementId];
  if (!definition || !progress?.unlocked || progress.claimed) return { ok: false, save };
  progress.claimed = true;
  save.badges.push(definition.badge);
  addCoins(definition.rewardCoins);
  addMysteryKeys(definition.rewardKeys);
  return { ok: true, save: persist(save) };
}

function hash(text: string): number {
  let value = 2166136261;
  for (let i = 0; i < text.length; i += 1) value = Math.imul(value ^ text.charCodeAt(i), 16777619);
  return value >>> 0;
}

export function seededRandom(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export function getDailyChallenge(now = new Date()): ChallengeDef {
  const date = utcDate(now);
  const seed = hash(`paopao-${date}`);
  const modes: GameMode[] = ['classic', 'rush', 'precision'];
  const modifiers: ChallengeModifier[] = ['score_frenzy', 'precision_plus', 'short_fuse'];
  return {
    id: `daily-${date}`,
    date,
    seed,
    level: seed % 12,
    mode: modes[(seed >>> 4) % modes.length],
    modifier: modifiers[(seed >>> 8) % modifiers.length],
    rewardCoins: 500,
  };
}

export function createRunSummary(input: Omit<RunSummary, 'id' | 'createdAt'>): RunSummary {
  return { ...input, id: id('run'), createdAt: new Date().toISOString() };
}

export function claimChallengeReward(challengeId: string): { ok: boolean; save: PlayerSaveV3 } {
  const save = getPlayerSave();
  const run = save.recentRuns.find((item) => item.challengeId === challengeId && item.won);
  if (!run || save.claimedChallengeIds.includes(challengeId)) return { ok: false, save };
  save.claimedChallengeIds.push(challengeId);
  addCoins(getDailyChallenge().id === challengeId ? getDailyChallenge().rewardCoins : 500);
  return { ok: true, save: persist(save) };
}

export function setDisplayName(name: string): PlayerSaveV3 {
  const save = getPlayerSave();
  save.displayName = name.trim().slice(0, 14).toUpperCase() || 'PLAYER';
  return persist(save);
}

export function markRunsSynced(ids: readonly string[], syncedAt: string): PlayerSaveV3 {
  const save = getPlayerSave();
  const accepted = new Set(ids);
  save.pendingRuns = save.pendingRuns.filter((run) => !accepted.has(run.id));
  save.lastSyncedAt = syncedAt;
  return persist(save);
}

export function importCloudProgress(cloud: Partial<PlayerSaveV3>): PlayerSaveV3 {
  const local = getPlayerSave();
  const cloudRecord = record(cloud);
  const remote = normalizePlayerSaveV3(cloudRecord);
  const merged = normalizePlayerSaveV3({ ...local, ...cloudRecord, playerId: local.playerId });
  merged.badges = uniqueStrings([...local.badges, ...remote.badges], 100, 64);
  merged.claimedChallengeIds = uniqueStrings(
    [...local.claimedChallengeIds, ...remote.claimedChallengeIds],
    90,
    128,
  );
  (Object.keys(local.totals) as QuestMetric[]).forEach((key) => {
    merged.totals[key] = Math.max(local.totals[key], remote.totals[key]);
  });
  return persist(merged);
}

/**
 * Adopt an account recovered on another device while retaining any legitimate
 * progress made in guest mode. Identity comes from the server; monotonic
 * progression and unsubmitted local runs are merged instead of overwritten.
 */
export function adoptCloudPlayer(
  playerId: string,
  displayName: string,
  cloud: Partial<PlayerSaveV3> = {},
): PlayerSaveV3 {
  const local = getPlayerSave();
  const cloudRecord = record(cloud);
  const remote = normalizePlayerSaveV3(cloudRecord);
  const merged = normalizePlayerSaveV3({
    ...local,
    ...cloudRecord,
    playerId: safeText(playerId, local.playerId, 96),
    displayName: safeText(displayName, local.displayName, 14).toUpperCase(),
  });
  merged.badges = uniqueStrings([...local.badges, ...remote.badges], 100, 64);
  merged.claimedChallengeIds = uniqueStrings(
    [...local.claimedChallengeIds, ...remote.claimedChallengeIds],
    90,
    128,
  );
  (Object.keys(local.totals) as QuestMetric[]).forEach((key) => {
    merged.totals[key] = Math.max(local.totals[key], remote.totals[key]);
  });
  for (const artifact of Object.keys(local.mastery) as ArtifactId[]) {
    const remoteMastery = remote.mastery[artifact];
    merged.mastery[artifact] = {
      xp: Math.max(local.mastery[artifact].xp, remoteMastery.xp),
      level: Math.max(local.mastery[artifact].level, remoteMastery.level),
    };
  }
  for (const definition of ACHIEVEMENTS) {
    const localProgress = local.achievements[definition.id];
    const remoteProgress = remote.achievements[definition.id];
    merged.achievements[definition.id] = {
      value: Math.max(localProgress?.value ?? 0, remoteProgress?.value ?? 0),
      unlocked: Boolean(localProgress?.unlocked || remoteProgress?.unlocked),
      claimed: Boolean(localProgress?.claimed || remoteProgress?.claimed),
    };
  }
  const runs = [...local.recentRuns, ...remote.recentRuns];
  merged.recentRuns = Array.from(new Map(runs.map((run) => [run.id, run])).values())
    .sort((first, second) => second.createdAt.localeCompare(first.createdAt))
    .slice(0, 20);
  const pending = [...local.pendingRuns, ...remote.pendingRuns];
  merged.pendingRuns = Array.from(new Map(pending.map((run) => [run.id, run])).values()).slice(-50);
  return persist(merged);
}

export function masteryLabel(artifact: ArtifactId, save = getPlayerSave()): string {
  const mastery = save.mastery[artifact];
  return `LV ${mastery.level}  •  ${mastery.xp % 500}/500 XP`;
}

export function currentPlayerName(): string {
  return getPlayerSave().displayName || getMeta().equippedArtifact.toUpperCase();
}

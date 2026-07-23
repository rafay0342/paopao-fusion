import { beforeEach, describe, expect, it } from 'vitest';
import {
  ACHIEVEMENTS,
  claimQuest,
  createRunSummary,
  getDailyChallenge,
  getPlayerSave,
  recordRunSummary,
  seededRandom,
} from '../src/game/retention';

class MemoryStorage {
  private values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
  removeItem(key: string): void { this.values.delete(key); }
  clear(): void { this.values.clear(); }
}

beforeEach(() => {
  Object.defineProperty(globalThis, 'localStorage', { value: new MemoryStorage(), configurable: true });
});

describe('retention save and deterministic challenges', () => {
  it('defines twenty permanent achievements and stable daily challenge seeds', () => {
    expect(ACHIEVEMENTS).toHaveLength(20);
    const date = new Date('2026-07-20T12:00:00.000Z');
    expect(getDailyChallenge(date)).toEqual(getDailyChallenge(date));
    const first = seededRandom(1234);
    const second = seededRandom(1234);
    expect([first(), first(), first()]).toEqual([second(), second(), second()]);
  });

  it('records a run exactly once and makes a completed quest claim idempotent', () => {
    const run = createRunSummary({
      level: 2, mode: 'classic', score: 15000, won: true, hits: 35, misses: 2,
      specialHits: 4, maxCombo: 10, accuracy: 94, durationMs: 60000, artifact: 'chrono',
    });
    recordRunSummary(run);
    recordRunSummary(run);
    const saved = getPlayerSave();
    expect(saved.totals).toMatchObject({ runs: 1, wins: 1, score: 15000, hits: 35, combo10: 1, accuracy90: 1, bossWins: 1 });
    expect(saved.recentRuns).toHaveLength(1);
    expect(claimQuest('daily', 'daily-hits').ok).toBe(true);
    expect(claimQuest('daily', 'daily-hits').ok).toBe(false);
  });

  it('rolls daily quests and preserves a consecutive UTC login streak', () => {
    expect(getPlayerSave(new Date('2026-07-20T10:00:00Z')).loginStreak).toBe(1);
    const next = getPlayerSave(new Date('2026-07-21T10:00:00Z'));
    expect(next.loginStreak).toBe(2);
    expect(next.dailyDate).toBe('2026-07-21');
    expect(next.daily.every((quest) => quest.value === 0 && !quest.claimed)).toBe(true);
  });
});

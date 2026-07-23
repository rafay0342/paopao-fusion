import { beforeEach, describe, expect, it } from 'vitest';
import {
  MAP_NODES,
  WORLD_THEMES,
  mapRewardLabel,
  nextStoryLevel,
} from '../src/config';
import {
  campaignLevelScore,
  getProgress,
  isLevelUnlocked,
  normalizeGameProgress,
  recordLevelClear,
} from '../src/game/progression';
import { classicFirstClearReward } from '../shared/runtime/classic-economy.mjs';

class MemoryStorage {
  private readonly values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
  removeItem(key: string): void { this.values.delete(key); }
  clear(): void { this.values.clear(); }
}

beforeEach(() => {
  Object.defineProperty(globalThis, 'localStorage', { value: new MemoryStorage(), configurable: true });
});

describe('campaign score integrity', () => {
  it('records only the score earned in a sequential level while retaining the campaign total', () => {
    const campaignTotalBefore = 3_200;
    const campaignTotalAfter = 7_200;
    const levelScore = campaignLevelScore(campaignTotalAfter, campaignTotalBefore);

    expect(levelScore).toBe(4_000);
    expect(campaignTotalAfter).toBe(7_200);

    recordLevelClear(1, levelScore);
    const progress = getProgress();
    expect(progress.bestScores[1]).toBe(4_000);
    expect(progress.stars[1]).toBe(2);
  });

  it('fails malformed deltas closed and never lowers migrated best scores or stars', () => {
    localStorage.setItem('paopao-fusion-progress-v2', JSON.stringify({
      unlocked: 3,
      bestScores: [3_200, 4_500],
      stars: [3, 2],
      cleared: [0, 1],
      mastered: [0],
      claimedFirstClears: [0],
    }));

    expect(campaignLevelScore(1_000, 2_000)).toBe(0);
    expect(campaignLevelScore(Number.NaN, 2_000)).toBe(0);
    recordLevelClear(1, campaignLevelScore(7_200, 3_200));

    expect(getProgress()).toMatchObject({
      bestScores: expect.arrayContaining([3_200, 4_500]),
      stars: expect.arrayContaining([3, 2]),
      cleared: expect.arrayContaining([0, 1]),
      mastered: expect.arrayContaining([0]),
      claimedFirstClears: expect.arrayContaining([0]),
    });
  });
});

describe('campaign map integrity', () => {
  it('uses one sequential visible route that exactly matches Next Level navigation', () => {
    for (const world of WORLD_THEMES) {
      world.levels.forEach((level, index) => {
        const node = MAP_NODES.find((candidate) => candidate.level === level);
        expect(node).toBeDefined();
        if (index > 0) {
          expect(node?.requires).toEqual([world.levels[index - 1]]);
          expect(nextStoryLevel(world.levels[index - 1])).toBe(level);
        }
      });
    }
  });

  it('preserves access to legacy-cleared branch levels after prerequisites become sequential', () => {
    const legacy = normalizeGameProgress({
      unlocked: 3,
      bestScores: [3_200, 4_600],
      stars: [3, 3],
      cleared: [0, 1],
    });
    const crystalRoute = WORLD_THEMES[0].levels;

    expect(crystalRoute).toEqual([0, 18, 1, 19, 2]);
    expect(isLevelUnlocked(1, legacy)).toBe(true);
    expect(isLevelUnlocked(18, legacy)).toBe(true);
    expect(isLevelUnlocked(19, legacy)).toBe(true);
  });

  it('projects the exact shared server first-clear reward and labels its availability honestly', () => {
    for (const node of MAP_NODES) {
      expect(node.reward).toEqual({
        source: 'classic-first-clear',
        currency: 'coins',
        amount: classicFirstClearReward(node.level),
        firstClearOnly: true,
        accountRequired: true,
      });
    }

    const reward = MAP_NODES[0].reward;
    expect(mapRewardLabel(reward, 'available')).toBe('1ST CLEAR ◆ 120');
    expect(mapRewardLabel(reward, 'account-required')).toBe('SIGN IN ◆ 120');
    expect(mapRewardLabel(reward, 'verification-pending')).toBe('VERIFY ◆ 120');
    expect(mapRewardLabel(reward, 'claimed')).toBe('CLAIMED');
  });
});

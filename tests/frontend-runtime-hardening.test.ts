import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  PLAYER_SAVE_CORRUPT_STORAGE_KEY,
  PLAYER_SAVE_STORAGE_KEY,
  getPlayerSave,
} from '../src/game/retention';

class MemoryStorage {
  private readonly values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
  removeItem(key: string): void { this.values.delete(key); }
  clear(): void { this.values.clear(); }
}

beforeEach(() => {
  Object.defineProperty(globalThis, 'localStorage', {
    value: new MemoryStorage(), configurable: true,
  });
  Object.defineProperty(globalThis, 'sessionStorage', {
    value: new MemoryStorage(), configurable: true,
  });
});

describe('frontend runtime hardening', () => {
  it('quarantines corrupt saves and keeps the recovered player identity stable', () => {
    const storage = globalThis.localStorage;
    storage.setItem(PLAYER_SAVE_STORAGE_KEY, '{not-json');
    const now = new Date('2026-07-22T10:00:00.000Z');
    const first = getPlayerSave(now);
    const second = getPlayerSave(now);

    expect(first.playerId).toBe(second.playerId);
    expect(JSON.parse(storage.getItem(PLAYER_SAVE_CORRUPT_STORAGE_KEY) ?? '{}')).toMatchObject({ raw: '{not-json' });
    expect(JSON.parse(storage.getItem(PLAYER_SAVE_STORAGE_KEY) ?? '{}').playerId).toBe(first.playerId);
  });

  it('deep-normalizes attacker-controlled save fields back to canonical shapes', () => {
    const now = new Date('2026-07-22T10:00:00.000Z');
    const baseline = getPlayerSave(now);
    globalThis.localStorage.setItem(PLAYER_SAVE_STORAGE_KEY, JSON.stringify({
      ...baseline,
      badges: [null, 'LEGIT', 'LEGIT'],
      totals: { runs: 'invalid', score: -99 },
      mastery: { chrono: null },
      daily: [null, {
        id: 'daily-hits', title: 'INJECTED', metric: 'wins', target: 1,
        rewardCoins: 999_999, rewardKeys: 9, value: 999_999, claimed: true,
      }],
      recentRuns: [null, { id: '', score: 999_999 }],
    }));

    const save = getPlayerSave(now);
    const hits = save.daily.find((quest) => quest.id === 'daily-hits');
    expect(hits).toMatchObject({ metric: 'hits', target: 30, rewardCoins: 160, rewardKeys: 0, value: 30, claimed: true });
    expect(save.daily).toHaveLength(3);
    expect(Object.keys(save.mastery)).toEqual(['chrono', 'phoenix', 'void', 'fortune']);
    expect(save.totals).toMatchObject({ runs: 0, score: 0 });
    expect(save.badges).toEqual(['LEGIT']);
    expect(save.recentRuns).toEqual([]);
  });

  it('composes caller aborts with hard fetch deadlines in both network clients', () => {
    const online = readFileSync(new URL('../src/game/online.ts', import.meta.url), 'utf8');
    const platform = readFileSync(new URL('../src/game/platform.ts', import.meta.url), 'utf8');
    for (const source of [online, platform]) {
      expect(source).toContain("parent?.addEventListener('abort', abortFromParent");
      expect(source).toContain("parent?.removeEventListener('abort', abortFromParent)");
      expect(source).toContain("controller.abort(new Error('request-timeout'))");
      expect(source).toContain('signal: deadline.signal');
      expect(source).toContain('deadline.cleanup()');
    }
  });

  it('applies a pressure downgrade during gameplay but defers visual upgrades', () => {
    const source = readFileSync(new URL('../src/game/performance.ts', import.meta.url), 'utf8');
    expect(source).toContain('private pendingChange:');
    expect(source).toContain('} else if (!allowChange) {');
    expect(source).toContain('const target = this.pendingChange.target');
    expect(source).toContain('this.commitChange(sampledAt)');
    expect(source).toContain('this.controller.evaluate({ ...this.snapshot, sampledAt: now }, true)');
    expect(source).toContain('gameActive && QUALITY_ORDER.indexOf(candidate) > QUALITY_ORDER.indexOf(current)');
    expect(source).toContain("window.dispatchEvent(new CustomEvent('paopao:quality-adapted'");
  });

  it('keeps arena reconnect, generation, liveness, and queue bounds explicit', () => {
    const source = readFileSync(new URL('../src/game/platform.ts', import.meta.url), 'utf8');
    expect(source).toContain('const ARENA_RECONNECT_DELAYS_MS = [500, 1_000, 2_000, 4_000]');
    expect(source).toContain('generation === this.generation && this.socket === socket');
    expect(source).toContain('Date.now() - this.lastServerMessageAt > ARENA_LIVENESS_TIMEOUT_MS');
    expect(source).toContain('this.outbound.length >= ARENA_MAX_OUTBOUND_QUEUE');
    expect(source).toContain('this.flushOutbound(socket, generation)');
  });

  it('installs browser reconnection hooks that schedule a new sync', () => {
    const source = readFileSync(new URL('../src/game/online.ts', import.meta.url), 'utf8');
    expect(source).toContain("window.addEventListener('online'");
    expect(source).toContain('scheduleOnlineSync(180)');
    expect(source).toContain("window.addEventListener('offline'");
    expect(source).toContain("document.addEventListener('visibilitychange'");
  });

  it('keeps legacy bearer credentials out of the browser runtime', () => {
    const online = readFileSync(new URL('../src/game/online.ts', import.meta.url), 'utf8');
    const account = readFileSync(new URL('../src/scenes/AccountScene.ts', import.meta.url), 'utf8');
    const platform = readFileSync(new URL('../src/game/platform.ts', import.meta.url), 'utf8');
    expect(online).not.toMatch(/Authorization\s*:|Bearer\s|online-session|SESSION_KEY/);
    expect(account).not.toMatch(/LEGACY CLOUD SYNC|RESTORE CLOUD ACCOUNT|COPY RECOVERY CODE/);
    expect(platform).toContain("credentials: 'include'");
    expect(platform).toContain("'X-CSRF-Token': csrf");
  });

  it('does not let a stale sync generation overwrite newer connection state', () => {
    const source = readFileSync(new URL('../src/game/online.ts', import.meta.url), 'utf8');
    const staleCatch = source.slice(
      source.indexOf('  } catch (error) {', source.indexOf('async function performSync')),
      source.indexOf('  } finally {', source.indexOf('async function performSync')),
    );
    expect(staleCatch).toContain('if (!isCurrentOnlineSync()) return');
    expect(staleCatch).not.toContain("setConnection('guest')");
  });
});

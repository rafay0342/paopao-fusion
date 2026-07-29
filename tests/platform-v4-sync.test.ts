import { beforeEach, describe, expect, it, vi } from 'vitest';

class MemoryStorage {
  private readonly values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
  removeItem(key: string): void { this.values.delete(key); }
  clear(): void { this.values.clear(); }
}

function progress(overrides: Record<string, unknown> = {}) {
  return {
    unlocked: 1,
    bestScores: Array(30).fill(0),
    stars: Array(30).fill(0),
    cleared: [], mastered: [], claimedFirstClears: [],
    ...overrides,
  };
}

function envelope(revision: number, progressValue = progress(), overrides: Record<string, unknown> = {}) {
  const updatedAt = `2026-07-22T10:00:0${Math.min(9, revision)}.000Z`;
  return {
    saveVersion: 4, revision, updatedAt, client: 'classic', progress: progressValue,
    clientIdentity: {
      id: 'classic', platform: 'web', build: 'server-classic-old', installId: '', lastSeenAt: updatedAt,
    },
    campaign: { progress: progressValue, activeWorld: 0, activeLevel: 0, storyFlags: ['server-story'] },
    endless: { seasonId: 'season-008', bestWave: 3, bestScore: 4000, seasonPoints: 80, completedRunIds: ['server-run'] },
    liveEvent: { seasonId: 'season-008', rewardTrackTier: 0, claimedRewardIds: [], completedChallengeIds: [] },
    entitlements: { revision: 1, ids: ['skin:server-owned'] },
    deviceSettings: {
      quality: 'balanced', targetFps: 60, reducedMotion: false, highContrast: false,
      subtitles: true, musicVolume: 0.8, effectsVolume: 0.9,
    },
    handProfile: {
      enabled: true, handedness: 'right', aimSensitivity: 1.2, smoothing: 0.6,
      pinchContactRatio: 0.26, pinchReleaseRatio: 0.34, calibrationRevision: 2,
    },
    ...overrides,
  };
}

function response(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

beforeEach(() => {
  vi.resetModules();
  Object.defineProperty(globalThis, 'localStorage', { value: new MemoryStorage(), configurable: true });
  Object.defineProperty(globalThis, 'sessionStorage', { value: new MemoryStorage(), configurable: true });
  Object.defineProperty(globalThis, 'window', {
    value: { dispatchEvent: vi.fn(), addEventListener: vi.fn() }, configurable: true,
  });
  localStorage.setItem('paopao-fusion-progress-v2', JSON.stringify(progress({
    unlocked: 2, bestScores: [9000], stars: [3], cleared: [0],
  })));
  localStorage.setItem('paopao-fusion-meta-v1', JSON.stringify({
    coins: 8_888_888, lifetimeCoins: 8_888_888, quality: 'ultra',
  }));
});

describe('Classic cookie-session V4 progress sync', () => {
  it('retries one revision conflict, merges progress, and never uploads coins or entitlements', async () => {
    let serverEnvelope = envelope(2, progress({ bestScores: [100, 5000], stars: [1, 2], cleared: [1] }));
    const conflictEnvelope = envelope(4, progress({
      unlocked: 3, bestScores: [200, 7000, 6000], stars: [1, 3, 2], cleared: [1, 2],
    }), { error: 'revision-conflict' });
    const requests: Array<{ url: string; method: string; headers: Record<string, string>; body?: string }> = [];
    let putCount = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = String(input);
      const method = init.method ?? 'GET';
      requests.push({
        url, method,
        headers: (init.headers ?? {}) as Record<string, string>,
        ...(typeof init.body === 'string' ? { body: init.body } : {}),
      });
      if (url === '/api/auth/otp/verify') {
        return response(200, {
          userId: 'user-v4', displayName: 'RAFAY', updatedAt: '2026-07-22T10:00:00.000Z',
          csrfToken: 'csrf-v4-token', wallet: { coins: 600, diamonds: 0, revision: 0, updatedAt: '2026-07-22T10:00:00.000Z' },
        });
      }
      if (url === '/api/account/status') {
        return response(200, {
          authenticated: true, userId: 'user-v4', displayName: 'RAFAY', updatedAt: '2026-07-22T10:00:00.000Z',
          csrfToken: 'csrf-v4-token', wallet: { coins: 600, diamonds: 0, revision: 0, updatedAt: '2026-07-22T10:00:00.000Z' },
        });
      }
      if (url === '/api/inventory/v2') return response(200, {
        revision: 4,
        items: [{ itemId: 'bomb', quantity: 5 }, { itemId: 'rainbow', quantity: 4 }],
        entitlements: [{ entitlementId: 'artifact:phoenix', source: 'order-test', createdAt: '2026-07-22T10:00:00.000Z' }],
      });
      if (url === '/api/v3/progress' && method === 'GET') return response(200, serverEnvelope);
      if (url === '/api/v3/progress' && method === 'PUT') {
        putCount += 1;
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        if (putCount === 1) return response(409, conflictEnvelope);
        serverEnvelope = envelope(5, body.progress as Record<string, unknown>, {
          clientIdentity: { ...(body.clientIdentity as Record<string, unknown>), lastSeenAt: '2026-07-22T10:00:05.000Z' },
          campaign: { ...(body.campaign as Record<string, unknown>), progress: body.progress },
          deviceSettings: body.deviceSettings,
          handProfile: body.handProfile,
          endless: conflictEnvelope.endless,
          liveEvent: conflictEnvelope.liveEvent,
          entitlements: conflictEnvelope.entitlements,
        });
        return response(200, serverEnvelope);
      }
      throw new Error(`unexpected request ${method} ${url}`);
    });
    Object.defineProperty(globalThis, 'fetch', { value: fetchMock, configurable: true });

    const { getPlatformAccount, isPlatformApiAvailable, verifyEmailOtp } = await import('../src/game/platform');
    const account = await verifyEmailOtp('otp-challenge-v4', '123456', 'RAFAY');
    expect(account.userId).toBe('user-v4');
    expect(isPlatformApiAvailable()).toBe(true);
    expect(putCount).toBe(2);

    const putRequests = requests.filter(({ url, method }) => url === '/api/v3/progress' && method === 'PUT');
    const first = JSON.parse(putRequests[0].body ?? '{}') as Record<string, unknown>;
    const retry = JSON.parse(putRequests[1].body ?? '{}') as Record<string, unknown>;
    expect(first.revision).toBe(2);
    expect(retry.revision).toBe(4);
    expect(Object.keys(retry).sort()).toEqual([
      'campaign', 'clientIdentity', 'deviceSettings', 'handProfile', 'progress', 'revision',
    ]);
    for (const forbidden of ['coins', 'meta', 'inventory', 'entitlements', 'endless', 'liveEvent']) {
      expect(retry).not.toHaveProperty(forbidden);
    }
    expect(JSON.stringify(retry)).not.toContain('8888888');
    expect((retry.progress as { bestScores: number[] }).bestScores.slice(0, 3)).toEqual([9000, 7000, 6000]);
    expect(putRequests.every(({ headers }) => headers['X-CSRF-Token'] === 'csrf-v4-token')).toBe(true);

    const stored = JSON.parse(localStorage.getItem('paopao-fusion-save-v4') ?? '{}') as Record<string, unknown>;
    expect(stored).toMatchObject({
      version: 4, revision: 5,
      entitlements: { revision: 1, ids: ['skin:server-owned'] },
      endless: { seasonId: 'season-008', bestWave: 3 },
      meta: { coins: 600 },
    });
    expect(JSON.parse(localStorage.getItem('paopao-fusion-meta-v1') ?? '{}')).toMatchObject({
      coins: 600,
      ownedArtifacts: expect.arrayContaining(['chrono', 'phoenix']),
    });
    const inventory = JSON.parse(localStorage.getItem('paopao-fusion-inventory-v1') ?? '{}') as { transactions: Array<{ id: string }> };
    expect(inventory.transactions.filter(({ id }) => id.startsWith('server-authority-v2-'))).toHaveLength(2);

    const writesBeforeRefresh = putCount;
    expect((await getPlatformAccount(true))?.userId).toBe('user-v4');
    expect(requests.some(({ url }) => url === '/api/account/status')).toBe(true);
    expect(requests.filter(({ url }) => url === '/api/inventory/v2')).toHaveLength(2);
    expect(requests.filter(({ url, method }) => url === '/api/v3/progress' && method === 'GET')).toHaveLength(2);
    expect(putCount).toBe(writesBeforeRefresh);
  });

  it('does not treat a static HTML fallback payload as a mounted platform API', async () => {
    Object.defineProperty(globalThis, 'fetch', {
      value: vi.fn(async () => response(200, {})),
      configurable: true,
    });
    const { getPlatformAccount, isPlatformApiAvailable } = await import('../src/game/platform');
    await expect(getPlatformAccount(true)).resolves.toBeNull();
    expect(isPlatformApiAvailable()).toBe(false);
  });
});

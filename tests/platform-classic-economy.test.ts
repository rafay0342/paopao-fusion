import { beforeEach, describe, expect, it, vi } from 'vitest';

class MemoryStorage {
  private readonly values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
  removeItem(key: string): void { this.values.delete(key); }
}

function response(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

const userId = 'usr_abcdefghijklmnop';
const account = {
  userId,
  displayName: 'KEEPER',
  updatedAt: '2026-07-22T10:00:00.000Z',
  csrfToken: 'csrf-classic-economy',
  wallet: { coins: 600, diamonds: 0, revision: 0, updatedAt: '2026-07-22T10:00:00.000Z' },
};

beforeEach(() => {
  vi.resetModules();
  Object.defineProperty(globalThis, 'localStorage', { value: new MemoryStorage(), configurable: true });
  Object.defineProperty(globalThis, 'sessionStorage', { value: new MemoryStorage(), configurable: true });
  Object.defineProperty(globalThis, 'window', {
    value: { dispatchEvent: vi.fn(), addEventListener: vi.fn() }, configurable: true,
  });
});

describe('classic authoritative economy client bridge', () => {
  it('queues before send, retries the same runId, and applies only the committed wallet balance', async () => {
    let runOnline = false;
    const submitted: Array<Record<string, unknown>> = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = String(input);
      if (url === '/api/auth/otp/verify') return response(200, account);
      if (url === '/api/v3/progress') return response(503, { error: 'progress-temporarily-unavailable' });
      if (url === '/api/inventory/v2') return response(200, {
        revision: 1,
        items: [{ itemId: 'bomb', quantity: 5 }, { itemId: 'rainbow', quantity: 3 }],
        entitlements: [],
      });
      if (url === '/api/v3/runs') {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        submitted.push(body);
        if (!runOnline) throw new Error('network-unavailable');
        return response(200, {
          accepted: true,
          duplicate: false,
          runId: body.runId,
          serverAcceptedAt: '2026-07-22T10:01:00.000Z',
          validation: {},
          reward: {
            source: 'classic-first-clear', level: 0, granted: true, alreadyClaimed: false,
            currency: 'coins', amount: 120, balance: 720,
          },
        });
      }
      throw new Error(`unexpected request ${init.method ?? 'GET'} ${url}`);
    });
    Object.defineProperty(globalThis, 'fetch', { value: fetchMock, configurable: true });

    const platform = await import('../src/game/platform');
    const { getMeta } = await import('../src/game/meta');
    await platform.verifyEmailOtp('otp-classic-economy', '123456', 'KEEPER');
    const submission = platform.createClassicRunSubmissionV3({
      runId: 'classic-client-run-0001', level: 0, mode: 'classic', score: 1_500,
      durationMs: 2_000, won: true, shots: 5, hits: 4,
      createdAt: '2026-07-22T10:00:30.000Z',
    });

    await expect(platform.settleClassicRunV3(submission)).rejects.toThrow('network-unavailable');
    expect(platform.pendingClassicRunCount(userId)).toBe(1);
    expect(getMeta().coins).toBe(600);
    expect(JSON.parse(localStorage.getItem(platform.CLASSIC_RUN_QUEUE_KEY) ?? '[]')[0].submission.runId)
      .toBe('classic-client-run-0001');

    runOnline = true;
    await Promise.resolve();
    const flushed = await platform.flushPendingClassicRunsV3(userId);
    expect(flushed).toMatchObject({ settled: 1, remaining: 0 });
    expect(flushed.receipts[0].runId).toBe('classic-client-run-0001');
    expect(platform.pendingClassicRunCount(userId)).toBe(0);
    expect(getMeta().coins).toBe(720);
    expect(submitted).toHaveLength(2);
    expect(submitted[0]).toEqual(submitted[1]);
  });

  it('does not decrement local supplies when the authoritative consume fails offline', async () => {
    let consumeOnline = false;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/auth/otp/verify') return response(200, account);
      if (url === '/api/v3/progress') return response(503, { error: 'progress-temporarily-unavailable' });
      if (url === '/api/inventory/v2') return response(200, {
        revision: 8,
        items: [{ itemId: 'bomb', quantity: 5 }, { itemId: 'rainbow', quantity: 3 }],
        entitlements: [{ entitlementId: 'artifact:phoenix', source: 'order-1', createdAt: '2026-07-22T10:00:00.000Z' }],
      });
      if (url === '/api/inventory/v2/consume') {
        if (!consumeOnline) throw new Error('network-unavailable');
        return response(200, {
          duplicate: false,
          entryId: 'inv_consume_test',
          inventory: {
            revision: 9,
            items: [{ itemId: 'bomb', quantity: 4 }, { itemId: 'rainbow', quantity: 3 }],
            entitlements: [{ entitlementId: 'artifact:phoenix', source: 'order-1', createdAt: '2026-07-22T10:00:00.000Z' }],
          },
        });
      }
      throw new Error(`unexpected request ${url}`);
    });
    Object.defineProperty(globalThis, 'fetch', { value: fetchMock, configurable: true });

    const platform = await import('../src/game/platform');
    const { getInventory } = await import('../src/game/inventory');
    const { getMeta } = await import('../src/game/meta');
    await platform.verifyEmailOtp('otp-classic-inventory', '123456', 'KEEPER');
    expect(getInventory().balances).toMatchObject({ bomb: 5, rainbow: 3 });
    expect(getMeta().ownedArtifacts).toContain('phoenix');

    await expect(platform.consumeInventoryV2('bomb', 1)).rejects.toThrow('network-unavailable');
    expect(getInventory().balances.bomb).toBe(5);
    consumeOnline = true;
    const consumed = await platform.consumeInventoryV2('bomb', 1);
    expect(consumed.local.balances.bomb).toBe(4);
    expect(getInventory().balances.bomb).toBe(4);
  });

  it('replays a committed receipt without advancing the cached wallet revision twice', async () => {
    const submission = {
      runId: 'classic-recovered-run-0001', client: 'classic', level: 0, mode: 'classic',
      score: 1_500, durationMs: 2_000, won: true, shots: 5, hits: 4,
      createdAt: '2026-07-22T10:00:30.000Z',
    };
    localStorage.setItem('paopao-fusion-classic-run-queue-v1', JSON.stringify([{
      ownerUserId: userId, submission, queuedAt: '2026-07-22T10:00:31.000Z',
    }]));
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/auth/otp/verify') return response(200, {
        ...account,
        wallet: { ...account.wallet, coins: 720, revision: 1 },
      });
      if (url === '/api/v3/progress') return response(503, { error: 'progress-temporarily-unavailable' });
      if (url === '/api/inventory/v2') return response(200, { revision: 0, items: [], entitlements: [] });
      if (url === '/api/v3/runs') return response(200, {
        accepted: false, duplicate: true, replayed: true, runId: submission.runId,
        serverAcceptedAt: '2026-07-22T10:01:00.000Z', validation: {},
        reward: {
          source: 'classic-first-clear', level: 0, granted: true, alreadyClaimed: false,
          currency: 'coins', amount: 120, balance: 720,
        },
      });
      throw new Error(`unexpected request ${url}`);
    });
    Object.defineProperty(globalThis, 'fetch', { value: fetchMock, configurable: true });

    const platform = await import('../src/game/platform');
    await platform.verifyEmailOtp('otp-classic-recovered', '123456', 'KEEPER');
    await platform.flushPendingClassicRunsV3(userId);
    expect(await platform.getPlatformAccount()).toMatchObject({
      wallet: { coins: 720, revision: 1 },
    });
    expect(platform.pendingClassicRunCount(userId)).toBe(0);
  });

  it('drops a permanent run-id conflict so later queued rewards can settle', async () => {
    const runs = [
      {
        runId: 'classic-conflicting-run-01', client: 'classic', level: 0, mode: 'classic',
        score: 900, durationMs: 2_000, won: true, shots: 4, hits: 3,
        createdAt: '2026-07-22T10:00:30.000Z',
      },
      {
        runId: 'classic-following-run-0002', client: 'classic', level: 1, mode: 'classic',
        score: 1_100, durationMs: 2_500, won: true, shots: 5, hits: 4,
        createdAt: '2026-07-22T10:01:30.000Z',
      },
    ];
    localStorage.setItem('paopao-fusion-classic-run-queue-v1', JSON.stringify(runs.map((submission, index) => ({
      ownerUserId: userId, submission, queuedAt: `2026-07-22T10:0${index}:31.000Z`,
    }))));
    const submitted: string[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = String(input);
      if (url === '/api/auth/otp/verify') return response(200, account);
      if (url === '/api/v3/progress') return response(503, { error: 'progress-temporarily-unavailable' });
      if (url === '/api/inventory/v2') return response(200, { revision: 0, items: [], entitlements: [] });
      if (url === '/api/v3/runs') {
        const body = JSON.parse(String(init.body)) as { runId: string };
        submitted.push(body.runId);
        if (body.runId === runs[0].runId) return response(409, { error: 'run-id-conflict' });
        return response(200, {
          accepted: true, duplicate: false, runId: body.runId,
          serverAcceptedAt: '2026-07-22T10:02:00.000Z', validation: {},
          reward: {
            source: 'classic-first-clear', level: 1, granted: true, alreadyClaimed: false,
            currency: 'coins', amount: 128, balance: 728,
          },
        });
      }
      throw new Error(`unexpected request ${url}`);
    });
    Object.defineProperty(globalThis, 'fetch', { value: fetchMock, configurable: true });

    const platform = await import('../src/game/platform');
    await platform.verifyEmailOtp('otp-classic-conflict', '123456', 'KEEPER');
    const result = await platform.flushPendingClassicRunsV3(userId);
    expect(result).toMatchObject({ settled: 1, remaining: 0 });
    expect(result.receipts[0].runId).toBe(runs[1].runId);
    expect(submitted).toEqual(runs.map(({ runId }) => runId));
  });
});

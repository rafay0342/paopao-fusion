import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import Database from 'better-sqlite3';
import { installPlatform } from '../server/platform.mjs';

describe('server-authoritative platform', () => {
  let app: ReturnType<typeof Fastify>;
  let db: Database.Database;
  let cookie = '';
  let csrf = '';
  let previousDevelopmentOtp: string | undefined;

  beforeEach(async () => {
    previousDevelopmentOtp = process.env.PAOPAO_ALLOW_DEV_OTP;
    process.env.PAOPAO_ALLOW_DEV_OTP = '1';
    app = Fastify({ logger: false }); db = new Database(':memory:'); db.pragma('foreign_keys = ON');
    installPlatform({ app, db }); await app.ready();
    const requested = await app.inject({ method: 'POST', url: '/api/auth/otp/request', payload: { email: 'keeper@example.com' } });
    expect(requested.statusCode).toBe(200);
    const challenge = requested.json();
    const verified = await app.inject({ method: 'POST', url: '/api/auth/otp/verify', payload: { challengeId: challenge.challengeId, code: challenge.developmentCode, displayName: 'Keeper' } });
    expect(verified.statusCode).toBe(200);
    cookie = String(verified.headers['set-cookie']).split(';')[0]; csrf = verified.json().csrfToken;
  });
  afterEach(async () => {
    await app.close(); db.close();
    if (previousDevelopmentOtp === undefined) delete process.env.PAOPAO_ALLOW_DEV_OTP;
    else process.env.PAOPAO_ALLOW_DEV_OTP = previousDevelopmentOtp;
  });

  const auth = () => ({ cookie, 'x-csrf-token': csrf });

  it('creates a verified account, durable wallet and public catalog', async () => {
    const account = await app.inject({ method: 'GET', url: '/api/account', headers: { cookie } });
    expect(account.statusCode).toBe(200); expect(account.json().wallet).toMatchObject({ coins: 600, diamonds: 0 });
    const catalog = await app.inject({ method: 'GET', url: '/api/catalog' });
    expect(catalog.json().offers).toEqual(expect.arrayContaining([expect.objectContaining({ offerId: 'bomb_pack_3', price: 180 })]));
  });

  it('[AT-PF-security-004][shared] settles an atomic purchase exactly once for an idempotency key', async () => {
    const request = { method: 'POST' as const, url: '/api/purchases', headers: { ...auth(), 'idempotency-key': 'purchase-0001' }, payload: { offerId: 'bomb_pack_3' } };
    const first = await app.inject(request); const second = await app.inject(request);
    expect(first.statusCode).toBe(200); expect(second.statusCode).toBe(200);
    expect(second.json().receiptId).toBe(first.json().receiptId);
    const wallet = await app.inject({ method: 'GET', url: '/api/wallet', headers: { cookie } });
    expect(wallet.json().coins).toBe(420);
    const inventory = await app.inject({ method: 'GET', url: '/api/inventory/v2', headers: { cookie } });
    expect(inventory.json().items).toContainEqual({ itemId: 'bomb', quantity: 6 });
    expect(inventory.json().items).toContainEqual({ itemId: 'rainbow', quantity: 2 });

    const consumeRequest = {
      method: 'POST' as const,
      url: '/api/inventory/v2/consume',
      headers: auth(),
      payload: { itemId: 'bomb', quantity: 1, idempotencyKey: 'consume-bomb-0001' },
    };
    const consumed = await app.inject(consumeRequest);
    const duplicateConsume = await app.inject(consumeRequest);
    expect(consumed.statusCode).toBe(200);
    expect(consumed.json().duplicate).toBe(false);
    expect(consumed.json().inventory.items).toContainEqual({ itemId: 'bomb', quantity: 5 });
    expect(duplicateConsume.json()).toMatchObject({ duplicate: true, entryId: consumed.json().entryId });
    expect(db.prepare("SELECT COUNT(*) AS count FROM inventory_ledger WHERE reason='gameplay'").get().count).toBe(1);

    const conflict = await app.inject({
      method: 'POST', url: '/api/purchases', headers: { ...auth(), 'idempotency-key': 'purchase-0001' }, payload: { offerId: 'rainbow_pack_2' },
    });
    expect(conflict.statusCode).toBe(409); expect(conflict.json().error).toBe('idempotency-key-conflict');
  });

  it('fails classic rewards closed even after forged progress and a structurally valid trace', async () => {
    const trace = [300, 700, 1_100, 1_800].map((atMs, sequence) => ({ sequence, atMs, angleMilliDegrees: 0 }));
    const base = {
      client: 'classic', mode: 'classic', durationMs: 2_500, shots: 4, hits: 3,
      score: 1_200, won: true, replayVersion: 1, shotTrace: trace,
      createdAt: '2026-07-22T00:00:00.000Z',
    };
    const forged = await app.inject({
      method: 'POST', url: '/api/v3/runs', headers: auth(),
      payload: { ...base, runId: 'classic-run-forged-0000', level: 0, replayVersion: undefined, shotTrace: undefined },
    });
    expect(forged.json()).toMatchObject({
      replayVerification: { authoritative: false, rewardEligible: false, reason: 'authoritative-shot-trace-required' },
      reward: { granted: false, amount: 0, balance: 600 },
    });

    const committed = await app.inject({
      method: 'PUT', url: '/api/v3/progress', headers: auth(),
      payload: { revision: 0, progress: { unlocked: 2, cleared: [0], bestScores: [1_200], stars: [2] } },
    });
    expect(committed.statusCode).toBe(200);
    const firstRequest = { ...base, runId: 'classic-run-reward-0001', level: 0 };
    const first = await app.inject({ method: 'POST', url: '/api/v3/runs', headers: auth(), payload: firstRequest });
    const duplicate = await app.inject({ method: 'POST', url: '/api/v3/runs', headers: auth(), payload: firstRequest });
    expect(first.statusCode).toBe(422);
    expect(first.json()).toEqual({ error: 'classic-authority-proof-required' });
    expect(duplicate.statusCode).toBe(422);
    expect(duplicate.json()).toEqual({ error: 'classic-authority-proof-required' });

    const repeatedLevel = await app.inject({
      method: 'POST', url: '/api/v3/runs', headers: auth(),
      payload: { ...base, runId: 'classic-run-reward-0002', level: 0 },
    });
    expect(repeatedLevel.statusCode).toBe(422);
    expect(repeatedLevel.json()).toEqual({ error: 'classic-authority-proof-required' });

    // A maximized /runs claim cannot create either a clear or a reward.
    const highClaim = await app.inject({
      method: 'POST', url: '/api/v3/runs', headers: auth(),
      payload: {
        ...base, runId: 'classic-run-reward-0003', level: 1, score: 50_000,
      },
    });
    expect(highClaim.statusCode).toBe(422);
    expect(highClaim.json()).toEqual({ error: 'classic-authority-proof-required' });

    const loss = await app.inject({
      method: 'POST', url: '/api/v3/runs', headers: auth(),
      payload: { ...base, runId: 'classic-run-reward-0004', level: 2, won: false, replayVersion: undefined, shotTrace: undefined },
    });
    expect(loss.json().reward).toMatchObject({
      granted: false, alreadyClaimed: false, amount: 0, balance: 600,
      reason: 'authoritative-shot-trace-required',
    });
    expect(db.prepare("SELECT COUNT(*) AS count FROM wallet_ledger WHERE kind='classic-first-clear'").get().count).toBe(0);
    expect((await app.inject({ method: 'GET', url: '/api/wallet', headers: { cookie } })).json().coins).toBe(600);
  });

  it('[AT-PF-security-001][shared] enforces the session CSRF boundary and wallet transaction limits', async () => {
    const userId = (await app.inject({ method: 'GET', url: '/api/account', headers: { cookie } })).json().userId;
    db.prepare('UPDATE wallets SET coins=5000 WHERE user_id=?').run(userId);
    for (const [index, expected] of [[1, 50], [2, 100]] as const) {
      const response = await app.inject({ method: 'POST', url: '/api/wallet/exchange', headers: auth(), payload: { packs: 1, idempotencyKey: `exchange-${index}` } });
      expect(response.statusCode).toBe(200); expect(response.json().exchangedThisWeek).toBe(expected);
    }
    const capped = await app.inject({ method: 'POST', url: '/api/wallet/exchange', headers: auth(), payload: { packs: 1, idempotencyKey: 'exchange-3' } });
    expect(capped.statusCode).toBe(409); expect(capped.json().error).toBe('weekly-exchange-cap');
    const missingCsrf = await app.inject({ method: 'POST', url: '/api/wallet/exchange', headers: { cookie }, payload: { packs: 1, idempotencyKey: 'exchange-4' } });
    expect(missingCsrf.statusCode).toBe(403);
  });

  it('invalidates web sessions and rejects OTP re-login when an account is disabled', async () => {
    const current = await app.inject({ method: 'GET', url: '/api/account', headers: { cookie } });
    const userId = current.json().userId as string;
    db.prepare("UPDATE users SET status='disabled' WHERE user_id=?").run(userId);

    const staleSession = await app.inject({ method: 'GET', url: '/api/account', headers: { cookie } });
    expect(staleSession.statusCode).toBe(401);
    expect(staleSession.json()).toEqual({ error: 'authentication-required' });

    const requested = await app.inject({
      method: 'POST', url: '/api/auth/otp/request', payload: { email: 'keeper@example.com' },
    });
    expect(requested.statusCode).toBe(200);
    const challenge = requested.json();
    const relogin = await app.inject({
      method: 'POST', url: '/api/auth/otp/verify',
      payload: { challengeId: challenge.challengeId, code: challenge.developmentCode, displayName: 'Keeper' },
    });
    expect(relogin.statusCode).toBe(403);
    expect(relogin.json()).toEqual({ error: 'account-disabled' });
    expect(db.prepare('SELECT consumed_at AS consumedAt FROM otp_challenges WHERE challenge_id=?').get(challenge.challengeId).consumedAt).toBeNull();
  });

  it('merges legacy progress but never trusts client-minted coin imports', async () => {
    const first = await app.inject({ method: 'POST', url: '/api/progress/sync', headers: auth(), payload: { progress: { stars: [3], bestScores: [9000], cleared: [0] }, legacyCoins: 2200, legacyImportHash: 'legacy-one' } });
    expect(first.json()).toMatchObject({
      wallet: { coins: 600 },
      legacyCurrencyImport: { accepted: false, reason: 'server-issued-proof-required' },
    });
    const second = await app.inject({ method: 'POST', url: '/api/progress/sync', headers: auth(), payload: { progress: { stars: [1, 2], bestScores: [100, 8000], cleared: [1] }, legacyCoins: 999999, legacyImportHash: 'legacy-two' } });
    expect(second.json().wallet.coins).toBe(600);
    expect(second.json().progress.stars.slice(0, 2)).toEqual([3, 2]);
    expect(second.json().progress.cleared).toEqual(expect.arrayContaining([0, 1]));
    expect(db.prepare("SELECT COUNT(*) AS count FROM wallet_ledger WHERE kind='legacy-import'").get().count).toBe(0);
    expect(db.prepare('SELECT legacy_import_hash AS legacyImportHash FROM player_profiles').get().legacyImportHash).toBeNull();
  });

  it('never exposes a development OTP without the explicit loopback flag', async () => {
    const enabled = process.env.PAOPAO_ALLOW_DEV_OTP;
    delete process.env.PAOPAO_ALLOW_DEV_OTP;
    const secureApp = Fastify({ logger: false }); const secureDb = new Database(':memory:'); secureDb.pragma('foreign_keys = ON');
    try {
      installPlatform({ app: secureApp, db: secureDb }); await secureApp.ready();
      const response = await secureApp.inject({ method: 'POST', url: '/api/auth/otp/request', payload: { email: 'private@example.com' } });
      expect(response.statusCode).toBe(503);
      expect(response.json()).toEqual({ error: 'email-provider-unconfigured' });
      expect(secureDb.prepare('SELECT COUNT(*) AS count FROM otp_challenges').get().count).toBe(0);
    } finally {
      await secureApp.close(); secureDb.close();
      if (enabled === undefined) delete process.env.PAOPAO_ALLOW_DEV_OTP; else process.env.PAOPAO_ALLOW_DEV_OTP = enabled;
    }
  });

  it('[AT-PF-security-007][shared] rate limits OTP recovery requests by source IP even when emails differ', async () => {
    for (let index = 0; index < 4; index += 1) {
      const response = await app.inject({ method: 'POST', url: '/api/auth/otp/request', payload: { email: `keeper-${index}@example.com` } });
      expect(response.statusCode).toBe(200);
    }
    const limited = await app.inject({ method: 'POST', url: '/api/auth/otp/request', payload: { email: 'keeper-limited@example.com' } });
    expect(limited.statusCode).toBe(429); expect(limited.json().error).toBe('otp-rate-limited');
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('safely rejects malformed cookies and deeply validates progress shapes', async () => {
    const malformedCookie = await app.inject({ method: 'GET', url: '/api/account/status', headers: { cookie: 'paopao_session=%' } });
    expect(malformedCookie.statusCode).toBe(200); expect(malformedCookie.json()).toEqual({ authenticated: false });

    const malformedProgress = await app.inject({
      method: 'POST', url: '/api/progress/sync', headers: auth(), payload: { progress: { bestScores: { length: 1_000_000_000 } } },
    });
    expect(malformedProgress.statusCode).toBe(400);

    const userId = (await app.inject({ method: 'GET', url: '/api/account', headers: { cookie } })).json().userId;
    db.prepare('UPDATE player_progress SET progress_json=? WHERE user_id=?').run(JSON.stringify({ bestScores: { length: 1_000_000_000 }, cleared: 3 }), userId);
    const recovered = await app.inject({ method: 'POST', url: '/api/progress/sync', headers: auth(), payload: { progress: { bestScores: [500], stars: [2], cleared: [0] } } });
    expect(recovered.statusCode).toBe(200);
    expect(recovered.json().progress.bestScores).toHaveLength(30);
    expect(recovered.json().progress.bestScores[0]).toBe(500);
    expect(recovered.json().progress.stars[0]).toBe(2);
    expect(recovered.json().progress.cleared).toEqual([0]);
  });

  it('reports database-backed readiness', async () => {
    const health = await app.inject({ method: 'GET', url: '/api/health' });
    const ready = await app.inject({ method: 'GET', url: '/api/ready' });
    expect(health.statusCode).toBe(200); expect(health.json()).toMatchObject({ ok: true, database: 'ready', schemaVersion: 20 });
    expect(ready.statusCode).toBe(200); expect(ready.json()).toMatchObject({ ok: true, database: 'ready' });
  });
});

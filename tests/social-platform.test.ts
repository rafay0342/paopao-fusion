import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import Database from 'better-sqlite3';
import { installPlatform } from '../server/platform.mjs';

interface Session { cookie: string; csrf: string; userId: string }

describe('connected social platform', () => {
  let app: ReturnType<typeof Fastify>;
  let db: Database.Database;
  const environment = { ...process.env };

  async function createAccount(email: string, displayName: string): Promise<Session> {
    const requested = await app.inject({ method: 'POST', url: '/api/auth/otp/request', payload: { email } });
    const challenge = requested.json();
    const verified = await app.inject({
      method: 'POST', url: '/api/auth/otp/verify',
      payload: { challengeId: challenge.challengeId, code: challenge.developmentCode, displayName },
    });
    return {
      cookie: String(verified.headers['set-cookie']).split(';')[0],
      csrf: verified.json().csrfToken,
      userId: verified.json().userId,
    };
  }

  beforeEach(async () => {
    process.env.PAOPAO_ALLOW_DEV_OTP = '1';
    delete process.env.PAOPAO_GOOGLE_CLIENT_ID;
    delete process.env.PAOPAO_GOOGLE_CLIENT_SECRET;
    delete process.env.PAOPAO_FACEBOOK_APP_ID;
    delete process.env.PAOPAO_FACEBOOK_APP_SECRET;
    app = Fastify({ logger: false });
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    installPlatform({ app, db, signingSecret: 'social-platform-focused-test-signing-secret' });
    await app.ready();
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await app.close();
    db.close();
    process.env = { ...environment };
  });

  it('reports provider activation without exposing provider secrets', async () => {
    const providers = await app.inject({ method: 'GET', url: '/api/auth/providers' });
    expect(providers.statusCode).toBe(200);
    expect(providers.json().providers).toEqual([
      { provider: 'google', configured: false },
      { provider: 'facebook', configured: false },
    ]);
    expect(JSON.stringify(providers.json())).not.toContain('clientSecret');
    expect((await app.inject({ method: 'GET', url: '/api/auth/google/start' })).statusCode).toBe(503);
  });

  it('completes a state-bound Google authorization-code login and creates a secure web session', async () => {
    process.env.PAOPAO_GOOGLE_CLIENT_ID = 'google-client-id';
    process.env.PAOPAO_GOOGLE_CLIENT_SECRET = 'google-client-secret';
    const start = await app.inject({ method: 'GET', url: '/api/auth/google/start?returnTo=%2F' });
    expect(start.statusCode).toBe(302);
    const authorization = new URL(String(start.headers.location));
    expect(authorization.hostname).toBe('accounts.google.com');
    expect(authorization.searchParams.get('code_challenge_method')).toBe('S256');
    const state = authorization.searchParams.get('state');
    expect(state).toBeTruthy();

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'provider-access-token' }), { status: 200, headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ sub: 'google-subject-001', name: 'Prism Keeper', email: 'keeper@google.test', email_verified: true }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    const callback = await app.inject({ method: 'GET', url: `/api/auth/google/callback?code=authorization-code&state=${encodeURIComponent(String(state))}` });
    expect(callback.statusCode).toBe(302);
    expect(callback.headers.location).toBe('/?auth=google&connected=1');
    const cookie = String(callback.headers['set-cookie']).split(';')[0];
    const account = await app.inject({ method: 'GET', url: '/api/account/status', headers: { cookie } });
    expect(account.json()).toMatchObject({ authenticated: true, displayName: 'Prism Keeper' });
    expect(db.prepare("SELECT kind,identifier FROM auth_identities WHERE kind='google'").get()).toEqual({
      kind: 'google', identifier: 'google:google-subject-001',
    });

    const replay = await app.inject({ method: 'GET', url: `/api/auth/google/callback?code=other&state=${encodeURIComponent(String(state))}` });
    expect(replay.statusCode).toBe(400);
    expect(replay.json()).toEqual({ error: 'oauth-state-invalid' });
  });

  it('connects keepers and settles a gift hamper exactly once', async () => {
    const sender = await createAccount('sender@example.com', 'Sender');
    const recipient = await createAccount('recipient@example.com', 'Recipient');
    db.prepare('UPDATE wallets SET coins=2000,diamonds=200 WHERE user_id=?').run(sender.userId);
    const senderHeaders = { cookie: sender.cookie, 'x-csrf-token': sender.csrf };
    const recipientHeaders = { cookie: recipient.cookie, 'x-csrf-token': recipient.csrf };
    const recipientSocial = await app.inject({ method: 'GET', url: '/api/social/me', headers: { cookie: recipient.cookie } });
    const friendCode = recipientSocial.json().friendCode;
    const connected = await app.inject({
      method: 'POST', url: '/api/social/connect', headers: senderHeaders, payload: { friendCode },
    });
    expect(connected.statusCode).toBe(200);
    expect(connected.json().social.friends).toEqual(expect.arrayContaining([expect.objectContaining({ userId: recipient.userId })]));

    const giftRequest = {
      method: 'POST' as const, url: '/api/social/gifts', headers: senderHeaders,
      payload: { recipientUserId: recipient.userId, offerId: 'friendship_hamper', message: 'For the next realm', idempotencyKey: 'gift-social-0001' },
    };
    const first = await app.inject(giftRequest);
    const duplicate = await app.inject(giftRequest);
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({ duplicate: false, balance: 1580, currency: 'coins' });
    expect(duplicate.json()).toMatchObject({ duplicate: true, giftId: first.json().giftId });
    expect(db.prepare("SELECT COUNT(*) AS count FROM wallet_ledger WHERE kind='social-gift'").get().count).toBe(1);

    const inbox = await app.inject({ method: 'GET', url: '/api/social/gifts', headers: { cookie: recipient.cookie } });
    expect(inbox.json().gifts[0]).toMatchObject({ giftId: first.json().giftId, senderName: 'Sender', status: 'pending' });
    const claimRequest = { method: 'POST' as const, url: `/api/social/gifts/${first.json().giftId}/claim`, headers: recipientHeaders, payload: {} };
    const claimed = await app.inject(claimRequest);
    const claimedAgain = await app.inject(claimRequest);
    expect(claimed.json()).toMatchObject({ duplicate: false, grants: [
      { itemId: 'bomb', quantity: 2 }, { itemId: 'rainbow', quantity: 1 }, { itemId: 'storyShard', quantity: 3 },
    ] });
    expect(claimedAgain.json()).toMatchObject({ duplicate: true, giftId: first.json().giftId });
    const inventory = await app.inject({ method: 'GET', url: '/api/inventory/v2', headers: { cookie: recipient.cookie } });
    expect(inventory.json().items).toEqual(expect.arrayContaining([
      { itemId: 'bomb', quantity: 5 }, { itemId: 'rainbow', quantity: 3 }, { itemId: 'storyShard', quantity: 3 },
    ]));
  });
});

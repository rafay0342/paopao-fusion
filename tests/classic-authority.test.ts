import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import Database from 'better-sqlite3';
import { installPlatform } from '../server/platform.mjs';

const delay = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

describe('classic server-observed run authority', () => {
  let app: ReturnType<typeof Fastify>;
  let db: Database.Database;
  let cookie = '';
  let csrf = '';
  let previousDevelopmentOtp: string | undefined;

  beforeEach(async () => {
    previousDevelopmentOtp = process.env.PAOPAO_ALLOW_DEV_OTP;
    process.env.PAOPAO_ALLOW_DEV_OTP = '1';
    app = Fastify({ logger: false });
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    installPlatform({ app, db, signingSecret: 'classic-authority-focused-test-secret-2026' });
    await app.ready();
    const requested = await app.inject({
      method: 'POST', url: '/api/auth/otp/request', payload: { email: 'classic-authority@example.com' },
    });
    const challenge = requested.json();
    const verified = await app.inject({
      method: 'POST',
      url: '/api/auth/otp/verify',
      payload: { challengeId: challenge.challengeId, code: challenge.developmentCode, displayName: 'Keeper' },
    });
    cookie = String(verified.headers['set-cookie']).split(';')[0];
    csrf = verified.json().csrfToken;
  });

  afterEach(async () => {
    await app.close();
    db.close();
    if (previousDevelopmentOtp === undefined) delete process.env.PAOPAO_ALLOW_DEV_OTP;
    else process.env.PAOPAO_ALLOW_DEV_OTP = previousDevelopmentOtp;
  });

  const auth = () => ({ cookie, 'x-csrf-token': csrf });

  async function start(level = 0, idempotencyKey = `classic-start-${level}-0001`) {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v3/classic/runs/start',
      headers: auth(),
      payload: { level, mode: 'classic', idempotencyKey },
    });
    expect(response.statusCode).toBe(200);
    return response.json();
  }

  async function append(ticket: Record<string, any>, sequence: number, atMs: number, angleMilliDegrees: number, previousAck = '') {
    const response = await app.inject({
      method: 'POST',
      url: `/api/v3/classic/runs/${ticket.ticketId}/shots`,
      headers: auth(),
      payload: {
        ticketToken: ticket.ticketToken,
        ...(previousAck ? { previousAck } : {}),
        sequence,
        atMs,
        angleMilliDegrees,
      },
    });
    return response;
  }

  it('grants and records a legitimate first clear exactly once from persisted sequential inputs', async () => {
    const ticket = await start();
    expect(ticket).toMatchObject({ requiredShots: 2, requiredProofHits: 1, duplicate: false });
    const duplicateStart = await start(0, 'classic-start-0-0001');
    expect(duplicateStart).toMatchObject({ duplicate: true, ticketId: ticket.ticketId, runId: ticket.runId });

    const first = await append(ticket, 0, 250, ticket.target.angleMilliDegrees);
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({ accepted: true, proofHit: true, completed: false });
    await delay(110);
    const second = await append(ticket, 1, 600, first.json().nextTarget.angleMilliDegrees, first.json().ack);
    expect(second.statusCode).toBe(200);
    expect(second.json()).toMatchObject({ accepted: true, completed: true });
    expect(second.json().terminalChallenge).toEqual(expect.any(String));

    const elapsed = Date.now() - Date.parse(ticket.startedAt);
    if (elapsed < ticket.minimumDurationMs + 20) await delay(ticket.minimumDurationMs + 20 - elapsed);
    const payload = {
      runId: ticket.runId,
      client: 'classic',
      level: 0,
      mode: 'classic',
      score: 1_250,
      durationMs: Math.max(ticket.minimumDurationMs, Date.now() - Date.parse(ticket.startedAt)),
      won: true,
      shots: 2,
      hits: 2,
      replayVersion: 1,
      shotTrace: [
        { sequence: 0, atMs: 250, angleMilliDegrees: ticket.target.angleMilliDegrees },
        { sequence: 1, atMs: 600, angleMilliDegrees: first.json().nextTarget.angleMilliDegrees },
      ],
      classicTicketId: ticket.ticketId,
      classicTicketToken: ticket.ticketToken,
      classicTerminalChallenge: second.json().terminalChallenge,
      createdAt: new Date().toISOString(),
    };
    const settled = await app.inject({ method: 'POST', url: '/api/v3/runs', headers: auth(), payload });
    expect(settled.statusCode).toBe(200);
    expect(settled.json()).toMatchObject({
      accepted: true,
      duplicate: false,
      replayVerification: {
        status: 'authoritative',
        authoritative: true,
        rewardEligible: true,
        reason: 'classic-server-input-proof-verified',
        scope: 'server-observed-input-proof',
      },
      reward: {
        source: 'classic-first-clear', level: 0, granted: true, alreadyClaimed: false,
        amount: 120, balance: 720,
      },
    });
    const duplicate = await app.inject({ method: 'POST', url: '/api/v3/runs', headers: auth(), payload });
    expect(duplicate.statusCode).toBe(200);
    expect(duplicate.json()).toMatchObject({
      accepted: false, duplicate: true, replayed: true,
      reward: { granted: true, amount: 120, balance: 720 },
    });
    expect(db.prepare("SELECT COUNT(*) AS count FROM wallet_ledger WHERE kind='classic-first-clear'").get().count).toBe(1);
    expect(db.prepare('SELECT status FROM classic_run_tickets WHERE ticket_id=?').get(ticket.ticketId).status).toBe('consumed');
    expect(db.prepare('SELECT COUNT(*) AS count FROM classic_authority_clears WHERE user_id=(SELECT user_id FROM users LIMIT 1) AND level=0').get().count).toBe(1);
    const progress = (await app.inject({ method: 'GET', url: '/api/v3/progress', headers: { cookie } })).json().progress;
    expect(progress).toMatchObject({ unlocked: 2 });
    expect(progress.cleared).toContain(0);
    expect(progress.claimedFirstClears).toContain(0);
  });

  it('rejects forged win/progress/trace claims and cannot mint without a completed ticket challenge', async () => {
    const forgedProgress = await app.inject({
      method: 'PUT',
      url: '/api/v3/progress',
      headers: auth(),
      payload: { revision: 0, progress: { unlocked: 30, cleared: Array.from({ length: 30 }, (_, index) => index) } },
    });
    expect(forgedProgress.statusCode).toBe(200);
    const directTrace = [
      { sequence: 0, atMs: 250, angleMilliDegrees: 0 },
      { sequence: 1, atMs: 600, angleMilliDegrees: 0 },
    ];
    const forged = await app.inject({
      method: 'POST',
      url: '/api/v3/runs',
      headers: auth(),
      payload: {
        runId: 'classic-forged-no-ticket-0001', client: 'classic', level: 29, mode: 'classic',
        score: 50_000, durationMs: 2_000, won: true, shots: 2, hits: 2,
        replayVersion: 1, shotTrace: directTrace, createdAt: new Date().toISOString(),
      },
    });
    expect(forged.statusCode).toBe(422);
    expect(forged.json()).toEqual({ error: 'classic-authority-proof-required' });

    const ticket = await start(0, 'classic-forgery-ticket-0001');
    const first = await append(ticket, 0, 250, ticket.target.angleMilliDegrees);
    expect(first.statusCode).toBe(200);
    const incomplete = await app.inject({
      method: 'POST',
      url: '/api/v3/runs',
      headers: auth(),
      payload: {
        runId: ticket.runId, client: 'classic', level: 0, mode: 'classic', score: 9_999,
        durationMs: 2_000, won: true, shots: 1, hits: 1, replayVersion: 1,
        shotTrace: [{ sequence: 0, atMs: 250, angleMilliDegrees: ticket.target.angleMilliDegrees }],
        classicTicketId: ticket.ticketId, classicTicketToken: ticket.ticketToken,
        classicTerminalChallenge: 'x'.repeat(64), createdAt: new Date().toISOString(),
      },
    });
    expect(incomplete.statusCode).toBe(422);
    expect(incomplete.json()).toEqual({ error: 'classic-authority-input-proof-incomplete' });

    const traceMismatch = await app.inject({
      method: 'POST',
      url: '/api/v3/runs',
      headers: auth(),
      payload: {
        runId: ticket.runId, client: 'classic', level: 0, mode: 'classic', score: 9_999,
        durationMs: 2_000, won: true, shots: 1, hits: 1, replayVersion: 1,
        shotTrace: [{ sequence: 0, atMs: 251, angleMilliDegrees: ticket.target.angleMilliDegrees }],
        classicTicketId: ticket.ticketId, classicTicketToken: ticket.ticketToken,
        classicTerminalChallenge: 'x'.repeat(64), createdAt: new Date().toISOString(),
      },
    });
    expect(traceMismatch.statusCode).toBe(422);
    expect(traceMismatch.json()).toEqual({ error: 'classic-authority-trace-mismatch' });
    expect(db.prepare("SELECT COUNT(*) AS count FROM wallet_ledger WHERE kind='classic-first-clear'").get().count).toBe(0);
    expect((await app.inject({ method: 'GET', url: '/api/wallet', headers: { cookie } })).json().coins).toBe(600);
  });

  it('enforces shot ordering, token chaining, live receipt cadence and verified level prerequisites', async () => {
    const blocked = await app.inject({
      method: 'POST', url: '/api/v3/classic/runs/start', headers: auth(),
      payload: { level: 1, mode: 'classic', idempotencyKey: 'classic-level-one-blocked' },
    });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json()).toEqual({ error: 'classic-authority-prerequisite-required' });

    const ticket = await start(0, 'classic-chain-ticket-0001');
    const outOfOrder = await append(ticket, 1, 500, 0);
    expect(outOfOrder.statusCode).toBe(422);
    expect(outOfOrder.json()).toEqual({ error: 'classic-authority-shot-order-invalid' });
    const first = await append(ticket, 0, 250, ticket.target.angleMilliDegrees);
    expect(first.statusCode).toBe(200);
    await delay(110);
    const missingChain = await append(ticket, 1, 600, first.json().nextTarget.angleMilliDegrees);
    expect(missingChain.statusCode).toBe(422);
    expect(missingChain.json()).toEqual({ error: 'classic-authority-shot-chain-invalid' });
    const conflictingDuplicate = await append(ticket, 0, 251, ticket.target.angleMilliDegrees);
    expect(conflictingDuplicate.statusCode).toBe(409);
    expect(conflictingDuplicate.json()).toEqual({ error: 'classic-authority-shot-conflict' });
    expect(db.prepare("SELECT COUNT(*) AS count FROM wallet_ledger WHERE kind='classic-first-clear'").get().count).toBe(0);
  });
});

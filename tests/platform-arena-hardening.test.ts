import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import Database from 'better-sqlite3';
import WebSocket from 'ws';
import { installPlatform } from '../server/platform.mjs';
import { buildArenaTargetSequence, simulateArenaReplay } from '../shared/runtime/arena-replay.mjs';

const platformSource = () => readFileSync(fileURLToPath(new URL('../server/platform.mjs', import.meta.url)), 'utf8');

type ArenaPayload = Record<string, unknown> & { type: string };

class SocketProbe {
  readonly socket: WebSocket;
  readonly messages: ArenaPayload[] = [];
  userId = '';
  private readonly inbox: ArenaPayload[] = [];
  private readonly waiters: Array<{ predicate: (message: ArenaPayload) => boolean; resolve: (message: ArenaPayload) => void }> = [];

  constructor(url: string, cookie: string) {
    this.socket = new WebSocket(url, { headers: { Cookie: cookie, Origin: new URL(url).origin.replace(/^ws/, 'http') } });
    this.socket.on('message', (data) => {
      const message = JSON.parse(String(data)) as ArenaPayload;
      this.messages.push(message);
      const index = this.waiters.findIndex((waiter) => waiter.predicate(message));
      if (index >= 0) this.waiters.splice(index, 1)[0].resolve(message);
      else this.inbox.push(message);
    });
  }

  async open(): Promise<void> {
    if (this.socket.readyState === WebSocket.OPEN) return;
    await new Promise<void>((resolve, reject) => {
      this.socket.once('open', resolve); this.socket.once('error', reject);
    });
  }

  next(predicate: (message: ArenaPayload) => boolean, timeoutMs = 2_000): Promise<ArenaPayload> {
    const existing = this.inbox.findIndex(predicate);
    if (existing >= 0) return Promise.resolve(this.inbox.splice(existing, 1)[0]);
    return new Promise((resolve, reject) => {
      const waiter = { predicate, resolve: (message: ArenaPayload) => { clearTimeout(timeout); resolve(message); } };
      const timeout = setTimeout(() => {
        const index = this.waiters.indexOf(waiter); if (index >= 0) this.waiters.splice(index, 1);
        reject(new Error('arena message timeout'));
      }, timeoutMs);
      this.waiters.push(waiter);
    });
  }

  close(): void {
    if (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING) this.socket.close();
  }
}

describe('arena transport hardening', () => {
  let app: ReturnType<typeof Fastify>;
  let db: Database.Database;
  let url = '';
  let previousDevelopmentOtp: string | undefined;
  const probes: SocketProbe[] = [];

  beforeEach(async () => {
    previousDevelopmentOtp = process.env.PAOPAO_ALLOW_DEV_OTP;
    process.env.PAOPAO_ALLOW_DEV_OTP = '1';
    app = Fastify({ logger: false }); db = new Database(':memory:'); db.pragma('foreign_keys = ON');
    installPlatform({
      app,
      db,
      arena: { startDelayMs: 0, matchTimeoutMs: 750, finishGraceMs: 60, disconnectGraceMs: 60, resultRetentionMs: 250 },
      otpRate: { maxKeys: 3, sweepMs: 25 },
    });
    await app.listen({ host: '127.0.0.1', port: 0 });
    const address = app.server.address();
    if (!address || typeof address === 'string') throw new Error('test server did not bind TCP');
    url = `ws://127.0.0.1:${address.port}/api/arena`;
  });

  afterEach(async () => {
    probes.forEach((probe) => probe.close());
    await app.close(); db.close();
    if (previousDevelopmentOtp === undefined) delete process.env.PAOPAO_ALLOW_DEV_OTP;
    else process.env.PAOPAO_ALLOW_DEV_OTP = previousDevelopmentOtp;
  });

  async function account(email: string): Promise<string> {
    const requested = await app.inject({ method: 'POST', url: '/api/auth/otp/request', payload: { email } });
    expect(requested.statusCode).toBe(200);
    const challenge = requested.json();
    const verified = await app.inject({ method: 'POST', url: '/api/auth/otp/verify', payload: { challengeId: challenge.challengeId, code: challenge.developmentCode, displayName: email.split('@')[0] } });
    expect(verified.statusCode).toBe(200);
    return String(verified.headers['set-cookie']).split(';')[0];
  }

  async function connect(cookie: string): Promise<SocketProbe> {
    const probe = new SocketProbe(url, cookie); probes.push(probe); await probe.open();
    const ready = await probe.next((message) => message.type === 'arena-ready');
    probe.userId = String(ready.userId);
    return probe;
  }

  async function startMatch(first: SocketProbe, second: SocketProbe): Promise<string> {
    first.socket.send(JSON.stringify({ type: 'queue' }));
    await first.next((message) => message.type === 'queued');
    second.socket.send(JSON.stringify({ type: 'queue' }));
    const found = await first.next((message) => message.type === 'match-found');
    await second.next((message) => message.type === 'match-found');
    return String(found.matchId);
  }

  it('survives malformed cookies, non-object JSON and oversized frames', async () => {
    const rejected = await new Promise<number>((resolve) => {
      const socket = new WebSocket(url, { headers: { Cookie: 'paopao_session=%' } });
      socket.once('unexpected-response', (_request, response) => { resolve(response.statusCode ?? 0); response.resume(); });
      socket.once('error', () => resolve(0));
    });
    expect(rejected).toBe(401);

    const cookie = await account('transport@example.com');
    const probe = await connect(cookie);
    probe.socket.send('null');
    expect(await probe.next((message) => message.type === 'error')).toMatchObject({ error: 'invalid-message' });

    const closed = new Promise<number>((resolve) => probe.socket.once('close', resolve));
    probe.socket.send(Buffer.alloc(8 * 1024 + 1));
    expect(await closed).toBe(1009);
    const health = await app.inject({ method: 'GET', url: '/api/health' });
    expect(health.statusCode).toBe(200); expect(health.json().ok).toBe(true);
  });

  it('bounds unique OTP rate-limit keys instead of retaining attacker-controlled keys forever', async () => {
    const request = (email: string, remoteAddress: string) => app.inject({
      method: 'POST', url: '/api/auth/otp/request', remoteAddress, payload: { email },
    });
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect((await request('locked@example.com', '10.0.0.1')).statusCode).toBe(503);
    }
    expect((await request('locked@example.com', '10.0.0.1')).statusCode).toBe(429);
    for (let key = 2; key <= 4; key += 1) {
      expect((await request(`unique-${key}@example.com`, `10.0.0.${key}`)).statusCode).toBe(503);
    }
    expect((await request('locked@example.com', '10.0.0.1')).statusCode).toBe(503);
  });

  it('replaces an old socket and freezes a player score after finish', async () => {
    const firstCookie = await account('first@example.com'); const secondCookie = await account('second@example.com');
    const original = await connect(firstCookie);
    const replaced = new Promise<number>((resolve) => original.socket.once('close', resolve));
    const first = await connect(firstCookie);
    expect(await replaced).toBe(4001);
    const second = await connect(secondCookie);

    const matchId = await startMatch(first, second);

    first.socket.send(JSON.stringify({ type: 'finish', matchId }));
    await first.next((message) => message.type === 'player-finished');
    first.socket.send(JSON.stringify({ type: 'input', matchId, seq: 1, atMs: 120, angleMilliDegrees: 0 }));
    const rejected = await first.next((message) => message.type === 'input-rejected');
    expect(rejected).toMatchObject({ error: 'player-finished', seq: 1, expected: 1 });
  });

  it('[AT-PF-security-008][shared] authoritatively persists arena results and rejects invalid replay traces', async () => {
    const first = await connect(await account('winner@example.com'));
    const second = await connect(await account('runner-up@example.com'));
    const matchId = await startMatch(first, second);
    const fixture = db.prepare('SELECT seed,level FROM matches WHERE match_id=?').get(matchId) as { seed: number; level: number };
    const target = buildArenaTargetSequence({ ...fixture, shotCount: 1 })[0];
    const missAngle = target.lane < 5 ? 30_000 : -30_000;
    const expectedWinner = simulateArenaReplay({
      ...fixture,
      shotTrace: [{ seq: 1, atMs: 120, angleMilliDegrees: target.angleMilliDegrees }],
    });
    expect(expectedWinner.ok).toBe(true);

    // Outcome claims are not part of the protocol, even when every value is
    // otherwise bounded and the claimed score would be plausible.
    first.socket.send(JSON.stringify({ type: 'input', matchId, seq: 1, atMs: 120, angleMilliDegrees: target.angleMilliDegrees, popped: 20, dropped: 30 }));
    expect(await first.next((message) => message.type === 'input-rejected'))
      .toMatchObject({ matchId, error: 'invalid-message', expected: 1 });

    first.socket.send(JSON.stringify({ type: 'input', matchId, seq: 1, atMs: 120, angleMilliDegrees: target.angleMilliDegrees }));
    await first.next((message) => message.type === 'match-state'
      && (message.players as Array<{ userId: string; score: number }>).some((player) => (
        player.userId === first.userId && player.score === (expectedWinner.ok ? expectedWinner.result.score : -1)
      )));

    first.socket.send(JSON.stringify({ type: 'input', matchId, seq: 1, atMs: 300, angleMilliDegrees: target.angleMilliDegrees }));
    expect(await first.next((message) => message.type === 'input-rejected'))
      .toMatchObject({ matchId, error: 'arena-replay-order-invalid', expected: 2 });
    first.socket.send(JSON.stringify({ type: 'input', matchId, seq: 2, atMs: 250, angleMilliDegrees: target.angleMilliDegrees }));
    expect(await first.next((message) => message.type === 'input-rejected'))
      .toMatchObject({ matchId, error: 'arena-replay-cadence-invalid', expected: 2 });
    first.socket.send(JSON.stringify({ type: 'input', matchId, seq: 2, atMs: 5_000, angleMilliDegrees: target.angleMilliDegrees }));
    expect(await first.next((message) => message.type === 'input-rejected'))
      .toMatchObject({ matchId, error: 'input-from-future', expected: 2 });

    second.socket.send(JSON.stringify({ type: 'input', matchId, seq: 1, atMs: 120, angleMilliDegrees: missAngle }));
    await first.next((message) => message.type === 'match-state'
      && (message.players as Array<{ userId: string; score: number }>).some((player) => player.userId === second.userId && player.score === 0));

    first.socket.send(JSON.stringify({ type: 'finish', matchId }));
    await first.next((message) => message.type === 'player-finished');
    second.socket.send(JSON.stringify({ type: 'finish', matchId }));
    const firstResult = await first.next((message) => message.type === 'match-result');
    const secondResult = await second.next((message) => message.type === 'match-result');
    expect(firstResult).toMatchObject({ matchId, reason: 'completed', winnerUserId: first.userId, isTie: false, tiedUserIds: [] });
    expect(secondResult).toMatchObject({ matchId, winnerUserId: first.userId });

    const persisted = db.prepare('SELECT status,winner_user_id AS winnerUserId,finished_at AS finishedAt FROM matches WHERE match_id=?').get(matchId);
    expect(persisted).toMatchObject({ status: 'finished', winnerUserId: first.userId });
    expect(Number.isNaN(Date.parse(String(persisted.finishedAt)))).toBe(false);

    first.socket.send(JSON.stringify({ type: 'input', matchId, seq: 2, atMs: 300, angleMilliDegrees: target.angleMilliDegrees }));
    expect(await first.next((message) => message.type === 'input-rejected')).toMatchObject({ error: 'match-finished', seq: 2, expected: 2 });
    first.socket.send(JSON.stringify({ type: 'finish', matchId }));
    expect(await first.next((message) => message.type === 'finish-ack')).toMatchObject({ duplicate: true, finalized: true });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(first.messages.filter((message) => message.type === 'match-result')).toHaveLength(1);
    expect(second.messages.filter((message) => message.type === 'match-result')).toHaveLength(1);
    const storedResults = db.prepare('SELECT result_json AS resultJson FROM match_results WHERE match_id=?').all(matchId);
    expect(storedResults).toHaveLength(1);
    const storedResult = JSON.parse(String(storedResults[0].resultJson));
    expect(storedResult).toMatchObject({ matchId, reason: 'completed', winnerUserId: first.userId });
    expect(storedResult.players).toHaveLength(2);
    for (const player of storedResult.players) {
      expect(player.replayProof.stateChecksum).toMatch(/^[a-f0-9]{16}$/);
      expect(player.replayProof.traceChecksum).toMatch(/^[a-f0-9]{64}$/);
      expect(player.replayProof.shotTrace).toHaveLength(1);
    }

    expect(simulateArenaReplay({ seed: 99, level: 0, shotTrace: [{ seq: 1, atMs: 50, angleMilliDegrees: 0 }] }))
      .toMatchObject({ ok: false, error: 'arena-replay-cadence-invalid' });
    const source = platformSource();
    expect(source).toContain('appendArenaShot({');
    expect(source).not.toContain("new Set(['type', 'matchId', 'seq', 'popped', 'dropped'])");
    expect(source).toContain('CREATE TABLE IF NOT EXISTS v3_replay_claims');
    expect(source).toContain("'replay-proof-reused'");
  });

  it('records an exact score-and-shot tie without selecting an arbitrary winner', async () => {
    const first = await connect(await account('tie-a@example.com'));
    const second = await connect(await account('tie-b@example.com'));
    const matchId = await startMatch(first, second);
    first.socket.send(JSON.stringify({ type: 'finish', matchId }));
    await first.next((message) => message.type === 'player-finished');
    second.socket.send(JSON.stringify({ type: 'finish', matchId }));
    const result = await first.next((message) => message.type === 'match-result');
    expect(result).toMatchObject({ matchId, reason: 'completed', winnerUserId: null, isTie: true });
    expect(result.tiedUserIds).toEqual([first.userId, second.userId].sort());
    expect(db.prepare('SELECT status,winner_user_id AS winnerUserId FROM matches WHERE match_id=?').get(matchId))
      .toEqual({ status: 'finished', winnerUserId: null });
  });

  it('finalizes when only one player finishes instead of leaving the match hanging', async () => {
    const first = await connect(await account('finisher@example.com'));
    const second = await connect(await account('stalled@example.com'));
    const matchId = await startMatch(first, second);
    first.socket.send(JSON.stringify({ type: 'finish', matchId }));
    await first.next((message) => message.type === 'player-finished');
    const result = await first.next((message) => message.type === 'match-result');
    expect(result).toMatchObject({ matchId, reason: 'finish-timeout', winnerUserId: first.userId, isTie: false });
    expect(db.prepare('SELECT status,winner_user_id AS winnerUserId FROM matches WHERE match_id=?').get(matchId))
      .toEqual({ status: 'finished', winnerUserId: first.userId });
  });

  it('settles a disconnected player by forfeit after a reconnect grace period', async () => {
    const first = await connect(await account('connected@example.com'));
    const secondCookie = await account('disconnected@example.com');
    const second = await connect(secondCookie);
    const matchId = await startMatch(first, second);
    const closed = new Promise<void>((resolve) => second.socket.once('close', () => resolve()));
    second.socket.close(); await closed;
    const result = await first.next((message) => message.type === 'match-result');
    expect(result).toMatchObject({ matchId, reason: 'disconnect-timeout', winnerUserId: first.userId, isTie: false });
    expect(db.prepare('SELECT status,winner_user_id AS winnerUserId FROM matches WHERE match_id=?').get(matchId))
      .toEqual({ status: 'finished', winnerUserId: first.userId });
    const reconnected = await connect(secondCookie);
    expect(await reconnected.next((message) => message.type === 'match-result'))
      .toMatchObject({ matchId, winnerUserId: first.userId, replayed: true });
  });

  it('settles every active match at its hard deadline', async () => {
    const first = await connect(await account('deadline-a@example.com'));
    const second = await connect(await account('deadline-b@example.com'));
    const matchId = await startMatch(first, second);
    const result = await first.next((message) => message.type === 'match-result');
    expect(result).toMatchObject({ matchId, reason: 'match-timeout', winnerUserId: null, isTie: true });
    expect(result.tiedUserIds).toEqual([first.userId, second.userId].sort());
    expect(db.prepare('SELECT status,finished_at AS finishedAt FROM matches WHERE match_id=?').get(matchId))
      .toMatchObject({ status: 'finished' });
  });
});

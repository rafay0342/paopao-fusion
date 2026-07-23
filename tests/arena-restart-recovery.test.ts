import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import Database from 'better-sqlite3';
import WebSocket from 'ws';
import { installPlatform } from '../server/platform.mjs';
import { buildArenaTargetSequence } from '../shared/runtime/arena-replay.mjs';

type ArenaPayload = Record<string, unknown> & { type: string };

class SocketProbe {
  readonly socket: WebSocket;
  private readonly inbox: ArenaPayload[] = [];
  private readonly waiters: Array<{ predicate: (message: ArenaPayload) => boolean; resolve: (message: ArenaPayload) => void }> = [];

  constructor(url: string, cookie: string) {
    this.socket = new WebSocket(url, { headers: { Cookie: cookie, Origin: new URL(url).origin.replace(/^ws/, 'http') } });
    this.socket.on('message', (data) => {
      const message = JSON.parse(String(data)) as ArenaPayload;
      const index = this.waiters.findIndex((waiter) => waiter.predicate(message));
      if (index >= 0) this.waiters.splice(index, 1)[0].resolve(message);
      else this.inbox.push(message);
    });
  }

  async open(): Promise<void> {
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

  send(payload: Record<string, unknown>): void { this.socket.send(JSON.stringify(payload)); }

  close(): void { this.socket.terminate(); }
}

const arenaOptions = {
  startDelayMs: 50,
  matchTimeoutMs: 5_000,
  finishGraceMs: 1_000,
  disconnectGraceMs: 1_000,
  resultRetentionMs: 4_000,
};

async function startServer(databasePath: string) {
  const db = new Database(databasePath); db.pragma('foreign_keys = ON');
  const app = Fastify({ logger: false });
  installPlatform({ app, db, arena: arenaOptions });
  await app.listen({ host: '127.0.0.1', port: 0 });
  const address = app.server.address();
  if (!address || typeof address === 'string') throw new Error('test server did not bind TCP');
  return {
    app,
    db,
    url: `ws://127.0.0.1:${address.port}/api/arena`,
    close: async () => { await app.close(); db.close(); },
  };
}

async function account(app: ReturnType<typeof Fastify>, email: string): Promise<string> {
  const requested = await app.inject({ method: 'POST', url: '/api/auth/otp/request', payload: { email } });
  const challenge = requested.json();
  const verified = await app.inject({
    method: 'POST', url: '/api/auth/otp/verify',
    payload: { challengeId: challenge.challengeId, code: challenge.developmentCode, displayName: email.split('@')[0] },
  });
  expect(verified.statusCode).toBe(200);
  return String(verified.headers['set-cookie']).split(';')[0];
}

async function connect(url: string, cookie: string): Promise<SocketProbe> {
  const probe = new SocketProbe(url, cookie); await probe.open();
  await probe.next((message) => message.type === 'arena-ready');
  return probe;
}

async function createMatch(first: SocketProbe, second: SocketProbe): Promise<ArenaPayload> {
  first.send({ type: 'queue' }); await first.next((message) => message.type === 'queued');
  second.send({ type: 'queue' });
  const found = await first.next((message) => message.type === 'match-found');
  await second.next((message) => message.type === 'match-found');
  return found;
}

describe('arena restart persistence', () => {
  let directory = '';
  let previousDevelopmentOtp: string | undefined;

  beforeEach(() => {
    previousDevelopmentOtp = process.env.PAOPAO_ALLOW_DEV_OTP;
    process.env.PAOPAO_ALLOW_DEV_OTP = '1';
    directory = mkdtempSync(join(tmpdir(), 'paopao-arena-restart-'));
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
    if (previousDevelopmentOtp === undefined) delete process.env.PAOPAO_ALLOW_DEV_OTP;
    else process.env.PAOPAO_ALLOW_DEV_OTP = previousDevelopmentOtp;
  });

  it('reconstructs accepted replay state, future start time and finished flags in a new app instance', async () => {
    const databasePath = join(directory, 'arena.sqlite');
    const firstServer = await startServer(databasePath);
    const firstCookie = await account(firstServer.app, 'restart-a@example.com');
    const secondCookie = await account(firstServer.app, 'restart-b@example.com');
    const first = await connect(firstServer.url, firstCookie); const second = await connect(firstServer.url, secondCookie);
    const found = await createMatch(first, second); const matchId = String(found.matchId);
    const storedStart = firstServer.db.prepare('SELECT started_at AS startedAt,created_at AS createdAt,seed,level FROM matches WHERE match_id=?')
      .get(matchId) as { startedAt: string; createdAt: string; seed: number; level: number };
    expect(Date.parse(storedStart.startedAt)).toBe(Number(found.startsAt));
    expect(Date.parse(storedStart.startedAt)).toBeGreaterThan(Date.parse(storedStart.createdAt));
    await new Promise((resolve) => setTimeout(resolve, 55));
    const target = buildArenaTargetSequence({ seed: storedStart.seed, level: storedStart.level, shotCount: 1 })[0];
    first.send({ type: 'input', matchId, seq: 1, atMs: 120, angleMilliDegrees: target.angleMilliDegrees });
    const state = await first.next((message) => message.type === 'match-state');
    expect(state.players).toEqual(expect.arrayContaining([expect.objectContaining({ shots: 1 })]));
    first.send({ type: 'finish', matchId });
    await first.next((message) => message.type === 'player-finished');
    expect(JSON.parse(String((firstServer.db.prepare('SELECT replay_json AS replayJson FROM arena_match_replays WHERE match_id=? AND user_id=(SELECT user_id FROM match_players WHERE match_id=? AND shots=1)')
      .get(matchId, matchId) as { replayJson: string }).replayJson)).shotTrace).toHaveLength(1);
    first.close(); second.close();
    await firstServer.close();

    const secondServer = await startServer(databasePath);
    const recoveredFirst = await connect(secondServer.url, firstCookie); const recoveredSecond = await connect(secondServer.url, secondCookie);
    const resumed = await recoveredFirst.next((message) => message.type === 'match-resumed');
    await recoveredSecond.next((message) => message.type === 'match-resumed');
    expect(resumed).toMatchObject({ matchId, startsAt: Number(found.startsAt) });
    expect(resumed.players).toEqual(expect.arrayContaining([expect.objectContaining({ shots: 1 })]));
    recoveredFirst.send({ type: 'finish', matchId });
    expect(await recoveredFirst.next((message) => message.type === 'finish-ack')).toMatchObject({ duplicate: true });
    recoveredSecond.send({ type: 'finish', matchId });
    expect(await recoveredFirst.next((message) => message.type === 'match-result')).toMatchObject({ matchId, reason: 'completed' });
    recoveredFirst.close(); recoveredSecond.close();
    await secondServer.close();
  });

  it('reloads and replays a recent persisted result after a new app instance starts', async () => {
    const databasePath = join(directory, 'arena.sqlite');
    const firstServer = await startServer(databasePath);
    const firstCookie = await account(firstServer.app, 'result-a@example.com');
    const secondCookie = await account(firstServer.app, 'result-b@example.com');
    const first = await connect(firstServer.url, firstCookie); const second = await connect(firstServer.url, secondCookie);
    const found = await createMatch(first, second); const matchId = String(found.matchId);
    first.send({ type: 'finish', matchId }); await first.next((message) => message.type === 'player-finished');
    second.send({ type: 'finish', matchId });
    const original = await first.next((message) => message.type === 'match-result');
    expect(original).toMatchObject({ matchId, reason: 'completed' });
    first.close(); second.close();
    await firstServer.close();

    const secondServer = await startServer(databasePath);
    const recovered = await connect(secondServer.url, firstCookie);
    expect(await recovered.next((message) => message.type === 'match-result'))
      .toMatchObject({ matchId, reason: 'completed', replayed: true });
    recovered.close();
    await secondServer.close();
  });

  it('fails closed and expires an active match whose persisted replay is corrupt', async () => {
    const databasePath = join(directory, 'arena.sqlite');
    const firstServer = await startServer(databasePath);
    const firstCookie = await account(firstServer.app, 'corrupt-a@example.com');
    const secondCookie = await account(firstServer.app, 'corrupt-b@example.com');
    const first = await connect(firstServer.url, firstCookie); const second = await connect(firstServer.url, secondCookie);
    const found = await createMatch(first, second); const matchId = String(found.matchId);
    firstServer.db.prepare('UPDATE arena_match_replays SET replay_json=? WHERE match_id=?').run('{', matchId);
    first.close(); second.close(); await firstServer.close();

    const secondServer = await startServer(databasePath);
    expect(secondServer.db.prepare('SELECT status FROM matches WHERE match_id=?').get(matchId)).toEqual({ status: 'expired' });
    const recovered = await connect(secondServer.url, firstCookie);
    recovered.send({ type: 'input', matchId, seq: 1, atMs: 120, angleMilliDegrees: 0 });
    expect(await recovered.next((message) => message.type === 'error')).toMatchObject({ error: 'match-not-found' });
    recovered.close(); await secondServer.close();
  });
});

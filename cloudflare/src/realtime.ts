import {
  ARENA_REPLAY_RULES,
  appendArenaShot,
  simulateArenaReplay,
} from '../../shared/runtime/arena-replay.mjs';

interface Env { DB: D1Database }
type SocketMode = 'social' | 'arena';
interface SocketAttachment { userId: string; mode: SocketMode }
interface ArenaShot { seq: number; atMs: number; angleMilliDegrees: number }
interface ArenaPlayer { userId: string; score: number; shots: number; hits: number; maxCombo: number; stateChecksum: string; shotTrace: ArenaShot[]; finishedAt?: number }
interface ArenaMatch { matchId: string; seed: number; level: number; startsAt: number; deadlineAt: number; players: ArenaPlayer[]; result?: Record<string, unknown> }
interface HubState { waiting: string[]; matches: Record<string, ArenaMatch> }

const emptyState = (): HubState => ({ waiting: [], matches: {} });
const id = (prefix: string): string => `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`;

function json(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
}

function socketAttachment(socket: WebSocket): SocketAttachment | null {
  try { return socket.deserializeAttachment() as SocketAttachment; } catch { return null; }
}

export class RealtimeHub implements DurableObject {
  constructor(private readonly state: DurableObjectState, private readonly env: Env) {}

  private async data(): Promise<HubState> {
    return (await this.state.storage.get<HubState>('hub')) ?? emptyState();
  }

  private async save(data: HubState): Promise<void> {
    await this.state.storage.put('hub', data);
    const deadlines = Object.values(data.matches)
      .filter((match) => !match.result)
      .map((match) => Math.min(match.deadlineAt, ...match.players.filter((player) => player.finishedAt).map((player) => Number(player.finishedAt) + 20_000)))
      .filter(Number.isFinite);
    if (deadlines.length) await this.state.storage.setAlarm(Math.min(...deadlines));
  }

  private sockets(userId?: string, mode?: SocketMode): WebSocket[] {
    return this.state.getWebSockets().filter((socket) => {
      const attachment = socketAttachment(socket);
      return attachment && (!userId || attachment.userId === userId) && (!mode || attachment.mode === mode);
    });
  }

  private send(socket: WebSocket, payload: unknown): void {
    try { socket.send(JSON.stringify(payload)); } catch { /* closed between lookup and send */ }
  }

  private sendUser(userId: string, mode: SocketMode, payload: unknown): void {
    for (const socket of this.sockets(userId, mode)) this.send(socket, payload);
  }

  private broadcastMatch(match: ArenaMatch, payload: unknown): void {
    for (const player of match.players) this.sendUser(player.userId, 'arena', payload);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/presence' && request.method === 'POST') {
      const body: { userIds?: unknown } = await request.json<{ userIds?: unknown }>().catch(() => ({}));
      const ids = Array.isArray(body.userIds) ? body.userIds.filter((item): item is string => typeof item === 'string').slice(0, 100) : [];
      const online = ids.filter((userId) => this.sockets(userId).length > 0);
      return json({ online });
    }
    if (url.pathname === '/notify' && request.method === 'POST') {
      const body: { userId?: unknown; message?: unknown } = await request.json<{ userId?: unknown; message?: unknown }>().catch(() => ({}));
      if (typeof body.userId !== 'string') return json({ error: 'user-id-required' }, 400);
      this.sendUser(body.userId, 'social', body.message);
      return json({ delivered: this.sockets(body.userId, 'social').length });
    }
    const userId = request.headers.get('X-PaoPao-User');
    const mode = request.headers.get('X-PaoPao-Mode') as SocketMode | null;
    if (!userId || (mode !== 'social' && mode !== 'arena')) return json({ error: 'unauthorized' }, 401);
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return json({ error: 'websocket-required' }, 426);
    for (const existing of this.sockets(userId, mode)) try { existing.close(4001, 'replaced'); } catch { /* already closed */ }
    const pair = new WebSocketPair();
    const client = pair[0]; const server = pair[1];
    server.serializeAttachment({ userId, mode } satisfies SocketAttachment);
    this.state.acceptWebSocket(server);
    if (mode === 'social') {
      this.send(server, { type: 'social-ready', userId, serverTime: Date.now() });
    } else {
      this.send(server, { type: 'arena-ready', userId, serverTime: Date.now() });
      const data = await this.data();
      const match = Object.values(data.matches).find((candidate) => !candidate.result && candidate.players.some((player) => player.userId === userId));
      if (match) this.send(server, { type: 'match-resumed', ...this.publicMatch(match), serverTime: Date.now() });
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(socket: WebSocket, messageValue: string | ArrayBuffer): Promise<void> {
    const attachment = socketAttachment(socket);
    if (!attachment || typeof messageValue !== 'string' || messageValue.length > 8_192) {
      socket.close(1008, 'invalid-message'); return;
    }
    let message: Record<string, unknown>;
    try { message = JSON.parse(messageValue) as Record<string, unknown>; } catch { this.send(socket, { type: 'error', error: 'invalid-json' }); return; }
    if (!message || typeof message !== 'object' || typeof message.type !== 'string') { this.send(socket, { type: 'error', error: 'invalid-message' }); return; }
    if (message.type === 'heartbeat') { this.send(socket, { type: 'heartbeat', serverTime: Date.now() }); return; }
    if (attachment.mode === 'social') {
      if (message.type === 'refresh-social') this.send(socket, { type: 'social-refresh-required', serverTime: Date.now() });
      else this.send(socket, { type: 'error', error: 'unsupported-message' });
      return;
    }
    await this.arenaMessage(socket, attachment.userId, message);
  }

  async webSocketClose(_socket: WebSocket): Promise<void> {}
  async webSocketError(_socket: WebSocket): Promise<void> {}

  private publicPlayers(match: ArenaMatch): Array<Record<string, unknown>> {
    return match.players.map(({ userId, score, shots, hits, maxCombo, stateChecksum }) => ({ userId, score, shots, hits, maxCombo, stateChecksum }));
  }

  private publicMatch(match: ArenaMatch): Record<string, unknown> {
    return { matchId: match.matchId, seed: match.seed, level: match.level, startsAt: match.startsAt, players: this.publicPlayers(match) };
  }

  private async arenaMessage(socket: WebSocket, userId: string, message: Record<string, unknown>): Promise<void> {
    const data = await this.data();
    const active = Object.values(data.matches).find((match) => !match.result && match.players.some((player) => player.userId === userId));
    if (message.type === 'queue') {
      if (active) { this.send(socket, { type: 'error', error: 'match-already-active' }); return; }
      data.waiting = data.waiting.filter((candidate) => candidate !== userId && this.sockets(candidate, 'arena').length > 0);
      const opponent = data.waiting.shift();
      if (!opponent) {
        data.waiting.push(userId); await this.save(data);
        this.send(socket, { type: 'queued', position: data.waiting.length }); return;
      }
      const seed = crypto.getRandomValues(new Uint32Array(1))[0] & 0x7fffffff;
      const match: ArenaMatch = {
        matchId: id('match'), seed, level: seed % 30, startsAt: Date.now() + 3_000, deadlineAt: Date.now() + 12 * 60_000,
        players: [opponent, userId].map((playerId) => ({ userId: playerId, score: 0, shots: 0, hits: 0, maxCombo: 0, stateChecksum: '0000000000000000', shotTrace: [] })),
      };
      data.matches[match.matchId] = match; await this.save(data);
      this.broadcastMatch(match, { type: 'match-found', ...this.publicMatch(match), serverTime: Date.now() }); return;
    }
    if (message.type === 'cancel-queue') {
      data.waiting = data.waiting.filter((candidate) => candidate !== userId); await this.save(data);
      this.send(socket, { type: 'queue-cancelled' }); return;
    }
    const matchId = typeof message.matchId === 'string' ? message.matchId : '';
    const match = data.matches[matchId];
    const player = match?.players.find((candidate) => candidate.userId === userId);
    if (!match || !player || match.result) { this.send(socket, { type: 'error', error: 'match-not-found' }); return; }
    if (message.type === 'input') {
      const seq = Number(message.seq); const atMs = Number(message.atMs); const angleMilliDegrees = Number(message.angleMilliDegrees);
      const reject = (error: string): void => this.send(socket, { type: 'input-rejected', matchId, error, seq, expected: player.shots + 1 });
      if (!Number.isInteger(seq) || !Number.isInteger(atMs) || !Number.isInteger(angleMilliDegrees) || seq !== player.shots + 1 || player.finishedAt) { reject('invalid-input'); return; }
      const elapsed = Date.now() - match.startsAt;
      if (elapsed < 0 || atMs > elapsed + ARENA_REPLAY_RULES.maximumFutureLeadMs || elapsed - atMs > ARENA_REPLAY_RULES.maximumReconnectAgeMs) { reject('input-time-invalid'); return; }
      const appended = appendArenaShot({ seed: match.seed, level: match.level, shotTrace: player.shotTrace, shot: { seq, atMs, angleMilliDegrees } });
      if (!appended.ok) { reject(appended.error); return; }
      Object.assign(player, { shotTrace: appended.shotTrace, score: appended.result.score, shots: appended.result.shots, hits: appended.result.hits, maxCombo: appended.result.maxCombo, stateChecksum: appended.result.stateChecksum });
      await this.save(data);
      this.broadcastMatch(match, { type: 'match-state', matchId, serverTime: Date.now(), players: this.publicPlayers(match) }); return;
    }
    if (message.type === 'finish') {
      if (!player.finishedAt) player.finishedAt = Date.now();
      if (match.players.every((candidate) => candidate.finishedAt)) await this.finalize(data, match, 'completed');
      else {
        await this.save(data);
        this.broadcastMatch(match, { type: 'player-finished', matchId, userId });
        this.send(socket, { type: 'finish-ack', matchId });
      }
      return;
    }
    this.send(socket, { type: 'error', error: 'unsupported-message' });
  }

  private async finalize(data: HubState, match: ArenaMatch, reason: string): Promise<void> {
    if (match.result) return;
    const ranked = [...match.players].sort((a, b) => b.score - a.score || a.shots - b.shots || a.userId.localeCompare(b.userId));
    const tied = ranked.length === 2 && ranked[0].score === ranked[1].score && ranked[0].shots === ranked[1].shots;
    const result = {
      type: 'match-result', matchId: match.matchId, reason, finishedAt: new Date().toISOString(), serverTime: Date.now(),
      winnerUserId: tied ? null : ranked[0].userId, isTie: tied, tiedUserIds: tied ? ranked.map((player) => player.userId).sort() : [],
      players: match.players.map((player) => {
        const replay = simulateArenaReplay({ seed: match.seed, level: match.level, shotTrace: player.shotTrace });
        return { userId: player.userId, score: player.score, shots: player.shots, hits: player.hits, finished: Boolean(player.finishedAt), replayProof: replay.ok ? { replayVersion: replay.result.replayVersion, rulesVersion: replay.result.rulesVersion, shotCount: replay.result.shots, hits: replay.result.hits, maxCombo: replay.result.maxCombo, stateChecksum: replay.result.stateChecksum, shotTrace: player.shotTrace } : undefined };
      }),
    };
    match.result = result; await this.save(data); this.broadcastMatch(match, result);
  }

  async alarm(): Promise<void> {
    const data = await this.data(); const now = Date.now();
    for (const match of Object.values(data.matches)) {
      if (match.result) continue;
      const firstFinish = Math.min(...match.players.filter((player) => player.finishedAt).map((player) => Number(player.finishedAt)));
      if (now >= match.deadlineAt) await this.finalize(data, match, 'match-timeout');
      else if (Number.isFinite(firstFinish) && now >= firstFinish + 20_000) await this.finalize(data, match, 'finish-timeout');
    }
    await this.save(data);
  }
}

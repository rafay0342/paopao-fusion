import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import Database from 'better-sqlite3';
import { installPlatform } from './platform.mjs';
import { installSecurityAdmin } from './security-admin.mjs';
import { createSigningKeyring } from './signing-keyring.mjs';
import { SqliteBackendCapabilityRepository } from './backend-capabilities.mjs';
import { createBackendCapabilityService } from '../shared/runtime/backend-capabilities.mjs';

const host = process.env.HOST ?? '127.0.0.1';
const port = Number(process.env.PORT ?? 8189);
function selectedClientRoot() {
  if (process.env.PAOPAO_DIST) return { path: resolve(process.env.PAOPAO_DIST), release: 'explicit' };
  const releasesDirectory = resolve(process.env.PAOPAO_RELEASES_DIR ?? 'releases');
  try {
    const state = JSON.parse(readFileSync(resolve(releasesDirectory, 'state.json'), 'utf8'));
    if (typeof state.active === 'string' && /^r[1-5]-[a-z0-9][a-z0-9.-]{1,62}$/.test(state.active)) {
      const candidate = resolve(releasesDirectory, state.active, 'client');
      if (existsSync(resolve(candidate, 'index.html'))) return { path: candidate, release: state.active };
    }
  } catch { /* no active immutable release; serve the working build */ }
  return { path: resolve('dist'), release: 'working' };
}
const selectedRelease = selectedClientRoot();
const root = selectedRelease.path;
const dataDir = resolve(process.env.PAOPAO_DATA_DIR ?? 'data');
mkdirSync(dataDir, { recursive: true });
const db = new Database(resolve(dataDir, 'paopao.sqlite'));
db.pragma('busy_timeout = 5000');
db.exec(`
  PRAGMA journal_mode=WAL;
  PRAGMA foreign_keys=ON;
  CREATE TABLE IF NOT EXISTS players (
    player_id TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    recovery_hash TEXT NOT NULL,
    save_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS runs (
    run_id TEXT PRIMARY KEY,
    player_id TEXT NOT NULL REFERENCES players(player_id),
    challenge_id TEXT,
    score INTEGER NOT NULL,
    level INTEGER NOT NULL,
    mode TEXT NOT NULL,
    duration_ms INTEGER NOT NULL,
    won INTEGER NOT NULL,
    summary_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS runs_challenge_score ON runs(challenge_id, score DESC, duration_ms ASC);
`);

function durableServerSecret() {
  const configured = process.env.PAOPAO_SESSION_SECRET;
  if (configured && Buffer.byteLength(configured) >= 32) return configured;
  const secretPath = resolve(dataDir, '.session-secret');
  try {
    const stored = readFileSync(secretPath, 'utf8').trim();
    if (Buffer.byteLength(stored) >= 32) return stored;
  } catch { /* create a new installation-scoped secret below */ }
  const generated = randomBytes(48).toString('base64url');
  try { writeFileSync(secretPath, `${generated}\n`, { flag: 'wx', mode: 0o600 }); }
  catch {
    const raced = readFileSync(secretPath, 'utf8').trim();
    if (Buffer.byteLength(raced) >= 32) return raced;
    throw new Error('PaoPao server secret could not be initialized securely');
  }
  return generated;
}
const secret = durableServerSecret();
const signingKeyring = createSigningKeyring({
  path: resolve(dataDir, '.content-signing-keyring.json'),
  seedSecret: process.env.PAOPAO_CONTENT_SIGNING_SECRET ?? secret,
  maxRetiredKeys: 8,
});
const app = Fastify({ logger: true, bodyLimit: 5_000_000 });
const platform = installPlatform({ app, db, signingSecret: secret, signingKeyring });
const backendCapabilityRepository = new SqliteBackendCapabilityRepository(db);
const backendCapabilities = createBackendCapabilityService({ repository: backendCapabilityRepository });
installSecurityAdmin({
  app, db, dataDir, signingKeyring, liveConfigAdmin: platform.liveConfigAdmin, backendCapabilities,
});

function cleanName(value) {
  return String(value ?? 'PLAYER').trim().slice(0, 14).toUpperCase().replace(/[^A-Z0-9 _-]/g, '') || 'PLAYER';
}

function hash(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function sign(value) {
  return createHmac('sha256', secret).update(String(value)).digest('base64url');
}

function safeEqual(first, second) {
  const a = Buffer.from(String(first));
  const b = Buffer.from(String(second));
  return a.length === b.length && timingSafeEqual(a, b);
}

const inventoryItems = new Set(['bomb', 'rainbow', 'storyShard']);
const inventoryReasons = new Set(['starter', 'store', 'gameplay', 'story', 'reward', 'artifact-purchase']);
const starterInventoryTransactions = [
  { id: 'starter-bombs-v1', item: 'bomb', delta: 3, coinDelta: 0, reason: 'starter', createdAt: '2026-07-20T00:00:00.000Z' },
  { id: 'starter-rainbows-v1', item: 'rainbow', delta: 2, coinDelta: 0, reason: 'starter', createdAt: '2026-07-20T00:00:00.000Z' },
];

function integer(value, minimum, maximum) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, Math.trunc(parsed))) : 0;
}

function plainRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype ? value : {};
}

function stringSet(value, maximum = 100, length = 96) {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.slice(0, maximum)
    .filter((entry) => typeof entry === 'string')
    .map((entry) => entry.trim().slice(0, length))
    .filter(Boolean)));
}

function mergeNumberArray(first, second, maximum = 30, valueMaximum = 10000000) {
  const left = Array.isArray(first) ? first.slice(0, maximum) : [];
  const right = Array.isArray(second) ? second.slice(0, maximum) : [];
  return Array.from({ length: maximum }, (_, index) => Math.max(
    integer(left[index], 0, valueMaximum),
    integer(right[index], 0, valueMaximum),
  ));
}

function numberSet(value, maximum = 30, valueMaximum = 29) {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.slice(0, maximum)
    .filter((entry) => Number.isInteger(entry) && entry >= 0 && entry <= valueMaximum)));
}

function numericRecord(value, maximum = 32) {
  return Object.fromEntries(Object.entries(plainRecord(value)).slice(0, maximum)
    .filter(([key]) => /^[A-Za-z0-9_-]{1,40}$/.test(key))
    .map(([key, entry]) => [key, integer(entry, 0, 1000000000)]));
}

function cleanInventoryTransaction(raw = {}) {
  const candidate = plainRecord(raw);
  const id = typeof candidate.id === 'string' ? candidate.id.trim().slice(0, 96) : '';
  if (!id) return null;
  const item = inventoryItems.has(candidate.item) ? candidate.item : undefined;
  const delta = item ? integer(candidate.delta, -999, 999) : 0;
  const coinDelta = integer(candidate.coinDelta, -1000000, 0);
  if (!item && coinDelta === 0) return null;
  return {
    id, ...(item ? { item } : {}), delta, coinDelta,
    reason: inventoryReasons.has(candidate.reason) ? candidate.reason : 'reward',
    createdAt: typeof candidate.createdAt === 'string' && !Number.isNaN(Date.parse(candidate.createdAt)) ? candidate.createdAt : new Date().toISOString(),
  };
}

function normalizeInventory(raw = {}) {
  const candidate = plainRecord(raw);
  const byId = new Map(starterInventoryTransactions.map((entry) => [entry.id, entry]));
  if (Array.isArray(candidate.transactions)) {
    for (const transaction of candidate.transactions.slice(-500)) {
      const cleaned = cleanInventoryTransaction(transaction);
      if (cleaned && !byId.has(cleaned.id)) byId.set(cleaned.id, cleaned);
    }
  }
  const transactions = Array.from(byId.values())
    .sort((first, second) => first.createdAt.localeCompare(second.createdAt) || first.id.localeCompare(second.id));
  return {
    version: 1,
    revision: Math.max(integer(candidate.revision, 0, Number.MAX_SAFE_INTEGER), transactions.length),
    transactions,
    updatedAt: typeof candidate.updatedAt === 'string' && !Number.isNaN(Date.parse(candidate.updatedAt)) ? candidate.updatedAt : transactions.at(-1)?.createdAt ?? new Date().toISOString(),
    lastSyncedAt: typeof candidate.lastSyncedAt === 'string' && !Number.isNaN(Date.parse(candidate.lastSyncedAt)) ? candidate.lastSyncedAt : '',
  };
}

function mergeInventory(first = {}, second = {}, syncedAt = '') {
  const left = normalizeInventory(first);
  const right = normalizeInventory(second);
  const byId = new Map();
  for (const entry of [...left.transactions, ...right.transactions]) if (!byId.has(entry.id)) byId.set(entry.id, entry);
  return normalizeInventory({
    version: 1,
    revision: Math.max(left.revision, right.revision, byId.size),
    transactions: Array.from(byId.values()),
    updatedAt: left.updatedAt > right.updatedAt ? left.updatedAt : right.updatedAt,
    lastSyncedAt: syncedAt || left.lastSyncedAt || right.lastSyncedAt,
  });
}

function inventorySpent(inventory = {}) {
  return normalizeInventory(inventory).transactions.reduce((sum, entry) => sum + Math.max(0, -entry.coinDelta), 0);
}

function parseSave(raw) {
  try { return raw ? JSON.parse(raw) : {}; } catch { return {}; }
}

function sessionToken(playerId) {
  const expires = Date.now() + 1000 * 60 * 60 * 24 * 90;
  const payload = Buffer.from(JSON.stringify({ playerId, expires })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

async function authenticated(request, reply) {
  const raw = String(request.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
  const [payload, signature] = raw.split('.');
  if (!payload || !signature || !safeEqual(sign(payload), signature)) return reply.code(401).send({ error: 'unauthorized' });
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!parsed.playerId || parsed.expires < Date.now()) return reply.code(401).send({ error: 'expired' });
    if (!db.prepare('SELECT 1 FROM players WHERE player_id=?').get(parsed.playerId)) {
      return reply.code(401).send({ error: 'account-not-found' });
    }
    request.playerId = parsed.playerId;
  } catch { return reply.code(401).send({ error: 'unauthorized' }); }
}

function fnv(text) {
  let value = 2166136261;
  for (let i = 0; i < text.length; i += 1) value = Math.imul(value ^ text.charCodeAt(i), 16777619);
  return value >>> 0;
}

function dateKey(now = new Date()) { return now.toISOString().slice(0, 10); }

function isoWeek(now = new Date()) {
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const start = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return `${date.getUTCFullYear()}-W${String(Math.ceil((((date - start) / 86400000) + 1) / 7)).padStart(2, '0')}`;
}

function challenge(kind = 'daily') {
  const key = kind === 'weekly' ? isoWeek() : dateKey();
  const seed = fnv(`paopao-${key}`);
  const modes = ['classic', 'rush', 'precision'];
  const modifiers = ['score_frenzy', 'precision_plus', 'short_fuse'];
  const id = `${kind}-${key}`;
  return {
    id,
    date: key,
    seed,
    level: seed % 12,
    mode: modes[(seed >>> 4) % modes.length],
    modifier: modifiers[(seed >>> 8) % modifiers.length],
    rewardCoins: kind === 'weekly' ? 1500 : 500,
    submissionToken: sign(id),
  };
}

app.post('/api/session', {
  schema: { body: { type: 'object', required: ['playerId'], properties: {
    playerId: { type: 'string', minLength: 8, maxLength: 96 }, displayName: { type: 'string', maxLength: 32 }, recoveryCode: { type: 'string', maxLength: 64 },
  }, additionalProperties: false } },
}, async (request, reply) => {
  const { playerId, displayName, recoveryCode } = request.body;
  const found = db.prepare('SELECT recovery_hash,display_name FROM players WHERE player_id=?').get(playerId);
  let issuedCode = recoveryCode;
  const now = new Date().toISOString();
  if (found) {
    if (!recoveryCode || !safeEqual(found.recovery_hash, hash(recoveryCode))) return reply.code(401).send({ error: 'recovery-code-required' });
    db.prepare('UPDATE players SET display_name=?, updated_at=? WHERE player_id=?').run(cleanName(displayName), now, playerId);
  } else {
    issuedCode = randomBytes(9).toString('base64url').toUpperCase();
    db.prepare('INSERT INTO players(player_id,display_name,recovery_hash,created_at,updated_at) VALUES(?,?,?,?,?)')
      .run(playerId, cleanName(displayName), hash(issuedCode), now, now);
  }
  return { token: sessionToken(playerId), recoveryCode: issuedCode, playerId, displayName: cleanName(displayName || found?.display_name) };
});

app.post('/api/account/restore', {
  schema: { body: { type: 'object', required: ['recoveryCode'], properties: {
    recoveryCode: { type: 'string', minLength: 8, maxLength: 64 },
  }, additionalProperties: false } },
}, async (request, reply) => {
  const recoveryCode = String(request.body.recoveryCode).trim().toUpperCase().replace(/\s+/g, '');
  const row = db.prepare('SELECT player_id,display_name,save_json,created_at,updated_at FROM players WHERE recovery_hash=?').get(hash(recoveryCode));
  if (!row) return reply.code(404).send({ error: 'account-not-found' });
  return {
    token: sessionToken(row.player_id), recoveryCode, playerId: row.player_id, displayName: row.display_name,
    createdAt: row.created_at, updatedAt: row.updated_at, save: parseSave(row.save_json),
  };
});

app.get('/api/profile', { preHandler: authenticated }, async (request, reply) => {
  const row = db.prepare('SELECT player_id,display_name,save_json,created_at,updated_at FROM players WHERE player_id=?').get(request.playerId);
  if (!row) return reply.code(404).send({ error: 'account-not-found' });
  return {
    playerId: row.player_id, displayName: row.display_name, createdAt: row.created_at,
    updatedAt: row.updated_at, save: parseSave(row.save_json),
  };
});

app.patch('/api/profile', { preHandler: authenticated, schema: { body: {
  type: 'object', required: ['displayName'], properties: { displayName: { type: 'string', minLength: 1, maxLength: 32 } }, additionalProperties: false,
} } }, async (request, reply) => {
  const displayName = cleanName(request.body.displayName);
  const row = db.prepare('SELECT save_json,created_at FROM players WHERE player_id=?').get(request.playerId);
  if (!row) return reply.code(404).send({ error: 'account-not-found' });
  const save = parseSave(row.save_json);
  save.player = { ...(save.player ?? {}), playerId: request.playerId, displayName };
  const updatedAt = new Date().toISOString();
  db.prepare('UPDATE players SET display_name=?,save_json=?,updated_at=? WHERE player_id=?')
    .run(displayName, JSON.stringify(save), updatedAt, request.playerId);
  return { playerId: request.playerId, displayName, createdAt: row.created_at, updatedAt, save };
});

app.get('/api/inventory', { preHandler: authenticated }, async (request, reply) => {
  const row = db.prepare('SELECT save_json,updated_at FROM players WHERE player_id=?').get(request.playerId);
  if (!row) return reply.code(404).send({ error: 'account-not-found' });
  const save = parseSave(row.save_json);
  return { inventory: normalizeInventory(save.inventory), meta: save.meta ?? {}, updatedAt: row.updated_at };
});

app.get('/api/challenges/current', async () => challenge('daily'));
app.get('/api/challenges/weekly', async () => challenge('weekly'));

app.post('/api/runs', { preHandler: authenticated, bodyLimit: 256_000, schema: { body: {
  type: 'object', required: ['id', 'level', 'mode', 'score', 'won', 'hits', 'misses', 'durationMs', 'createdAt'],
  properties: {
    id: { type: 'string', minLength: 8, maxLength: 96 }, level: { type: 'integer', minimum: 0, maximum: 17 },
    mode: { enum: ['classic', 'rush', 'precision'] }, score: { type: 'integer', minimum: 0, maximum: 10000000 },
    won: { type: 'boolean' }, hits: { type: 'integer', minimum: 0, maximum: 5000 }, misses: { type: 'integer', minimum: 0, maximum: 5000 },
    specialHits: { type: 'integer', minimum: 0, maximum: 5000 }, maxCombo: { type: 'integer', minimum: 0, maximum: 5000 },
    accuracy: { type: 'number', minimum: 0, maximum: 100 }, durationMs: { type: 'integer', minimum: 500, maximum: 14400000 },
    artifact: { type: 'string', maxLength: 40 }, challengeId: { type: 'string', maxLength: 80 }, challengeToken: { type: 'string', maxLength: 128 },
    ghost: { type: 'array', maxItems: 250, items: {
      type: 'object', required: ['atMs', 'angle', 'color'], properties: {
        atMs: { type: 'integer', minimum: 0, maximum: 14400000 },
        angle: { type: 'number', minimum: -180, maximum: 0 },
        color: { enum: ['red', 'blue', 'green', 'yellow', 'purple', 'orange'] },
      }, additionalProperties: false,
    } }, createdAt: { type: 'string', format: 'date-time', maxLength: 40 },
  }, additionalProperties: false,
} } }, async (request, reply) => {
  const run = request.body;
  if (run.challengeId && (!run.challengeToken || !safeEqual(sign(run.challengeId), run.challengeToken))) {
    return reply.code(403).send({ error: 'invalid-challenge-token' });
  }
  if (run.ghost?.some((shot, index) => (
    shot.atMs > run.durationMs || (index > 0 && shot.atMs < run.ghost[index - 1].atMs)
  ))) {
    return reply.code(422).send({ error: 'invalid-ghost-trace' });
  }
  if (run.hits + run.misses > 5000 || run.score > Math.max(50000, (run.hits + (run.specialHits ?? 0) + 1) * 50000)) {
    return reply.code(422).send({ error: 'implausible-run' });
  }
  const inserted = db.prepare(`INSERT OR IGNORE INTO runs
    (run_id,player_id,challenge_id,score,level,mode,duration_ms,won,summary_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)`)
    .run(run.id, request.playerId, run.challengeId ?? null, run.score, run.level, run.mode, run.durationMs, run.won ? 1 : 0, JSON.stringify(run), run.createdAt);
  return { accepted: inserted.changes === 1, duplicate: inserted.changes === 0 };
});

app.get('/api/leaderboards/:challengeId', async (request) => {
  const rows = db.prepare(`SELECT r.run_id AS runId,r.player_id AS playerId,p.display_name AS displayName,
    r.score,r.level,r.mode,r.duration_ms AS durationMs,r.created_at AS createdAt
    FROM runs r JOIN players p ON p.player_id=r.player_id WHERE r.challenge_id=? AND r.won=1
    ORDER BY r.score DESC,r.duration_ms ASC LIMIT 50`).all(request.params.challengeId);
  return { entries: rows };
});

app.get('/api/ghosts/:runId', async (request, reply) => {
  const row = db.prepare('SELECT summary_json FROM runs WHERE run_id=?').get(request.params.runId);
  if (!row) return reply.code(404).send({ error: 'not-found' });
  const run = JSON.parse(row.summary_json);
  return { id: run.id, ghost: run.ghost ?? [], score: run.score, durationMs: run.durationMs };
});

app.post('/api/sync', { preHandler: authenticated, bodyLimit: 512_000, schema: { body: {
  type: 'object', required: ['save'], properties: { save: { type: 'object' } }, additionalProperties: false,
} } }, async (request) => {
  const row = db.prepare('SELECT save_json FROM players WHERE player_id=?').get(request.playerId);
  const remote = plainRecord(parseSave(row?.save_json));
  const local = plainRecord(request.body.save);
  const remotePlayer = plainRecord(remote.player);
  const localPlayer = plainRecord(local.player);
  const remoteMeta = plainRecord(remote.meta);
  const localMeta = plainRecord(local.meta);
  const remoteProgress = plainRecord(remote.progress);
  const localProgress = plainRecord(local.progress);
  const syncedAt = new Date().toISOString();
  const mergedInventory = mergeInventory(remote.inventory, local.inventory, syncedAt);
  const remoteGrossCoins = integer(remoteMeta.coins, 0, 1000000000) + inventorySpent(remote.inventory);
  const localGrossCoins = integer(localMeta.coins, 0, 1000000000) + inventorySpent(local.inventory);
  const mergedSpend = inventorySpent(mergedInventory);
  const remoteOpenedBoxes = integer(remoteMeta.openedMysteryBoxes, 0, 1000000);
  const localOpenedBoxes = integer(localMeta.openedMysteryBoxes, 0, 1000000);
  const mergedOpenedBoxes = Math.max(remoteOpenedBoxes, localOpenedBoxes);
  const grossMysteryKeys = Math.max(
    integer(remoteMeta.mysteryKeys, 0, 1000000) + remoteOpenedBoxes,
    integer(localMeta.mysteryKeys, 0, 1000000) + localOpenedBoxes,
  );
  const merged = {
    player: {
      ...remotePlayer, ...localPlayer, playerId: request.playerId,
      badges: stringSet([...stringSet(remotePlayer.badges, 100, 64), ...stringSet(localPlayer.badges, 100, 64)], 100, 64),
      claimedChallengeIds: stringSet([...stringSet(remotePlayer.claimedChallengeIds, 90), ...stringSet(localPlayer.claimedChallengeIds, 90)], 90),
      totals: Object.fromEntries(Array.from(new Set([...Object.keys(numericRecord(remotePlayer.totals)), ...Object.keys(numericRecord(localPlayer.totals))]))
        .slice(0, 32).map((key) => [key, Math.max(numericRecord(remotePlayer.totals)[key] ?? 0, numericRecord(localPlayer.totals)[key] ?? 0)])),
      recentRuns: (Array.isArray(localPlayer.recentRuns) ? localPlayer.recentRuns : Array.isArray(remotePlayer.recentRuns) ? remotePlayer.recentRuns : []).slice(0, 20),
      pendingRuns: (Array.isArray(localPlayer.pendingRuns) ? localPlayer.pendingRuns : []).slice(-50),
    },
    meta: {
      ...remoteMeta, ...localMeta,
      // Purchases are represented by idempotent inventory transaction IDs.
      // Merge gross earned currency first, then debit the union exactly once.
      coins: Math.max(0, Math.max(remoteGrossCoins, localGrossCoins) - mergedSpend),
      lifetimeCoins: Math.max(integer(remoteMeta.lifetimeCoins, 0, 1000000000), integer(localMeta.lifetimeCoins, 0, 1000000000)),
      totalHits: Math.max(integer(remoteMeta.totalHits, 0, 1000000000), integer(localMeta.totalHits, 0, 1000000000)),
      completedRuns: Math.max(integer(remoteMeta.completedRuns, 0, 1000000000), integer(localMeta.completedRuns, 0, 1000000000)),
      openedMysteryBoxes: mergedOpenedBoxes,
      mysteryKeys: Math.max(0, grossMysteryKeys - mergedOpenedBoxes),
      ownedArtifacts: stringSet([...stringSet(remoteMeta.ownedArtifacts, 16, 40), ...stringSet(localMeta.ownedArtifacts, 16, 40)], 16, 40),
      ownedSkins: stringSet([...stringSet(remoteMeta.ownedSkins, 32, 64), ...stringSet(localMeta.ownedSkins, 32, 64)], 32, 64),
    },
    progress: {
      unlocked: Math.max(1, integer(remoteProgress.unlocked, 1, 30), integer(localProgress.unlocked, 1, 30)),
      bestScores: mergeNumberArray(remoteProgress.bestScores, localProgress.bestScores, 30, 10000000),
      stars: mergeNumberArray(remoteProgress.stars, localProgress.stars, 30, 3),
      cleared: Array.from(new Set([...numberSet(remoteProgress.cleared), ...numberSet(localProgress.cleared)])),
      mastered: Array.from(new Set([...numberSet(remoteProgress.mastered), ...numberSet(localProgress.mastered)])),
      claimedFirstClears: Array.from(new Set([...numberSet(remoteProgress.claimedFirstClears), ...numberSet(localProgress.claimedFirstClears)])),
    },
    inventory: mergedInventory,
  };
  db.prepare('UPDATE players SET save_json=?,display_name=?,updated_at=? WHERE player_id=?')
    .run(JSON.stringify(merged), cleanName(merged.player.displayName), syncedAt, request.playerId);
  return { save: merged, syncedAt };
});

app.addHook('onSend', async (request, reply, payload) => {
  const path = request.raw.url?.split('?')[0] ?? '';
  reply.header('X-PaoPao-Release', selectedRelease.release);
  reply.header('X-Content-Type-Options', 'nosniff');
  reply.header('Referrer-Policy', 'same-origin');
  reply.header('Permissions-Policy', 'camera=(self), microphone=(), geolocation=()');
  reply.header('Cross-Origin-Resource-Policy', 'same-origin');
  reply.header('X-Frame-Options', 'DENY');
  reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  reply.header('Content-Security-Policy', "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; img-src 'self' data: blob:; media-src 'self' blob:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; worker-src 'self' blob:; connect-src 'self' blob: ws: wss:");
  if (path.startsWith('/api/')) reply.header('Cache-Control', 'no-store');
  else if (/\/assets\/[^/]+-[A-Za-z0-9_-]{8,}\.(?:js|css)$/.test(path)) reply.header('Cache-Control', 'public,max-age=31536000,immutable');
  else if (path === '/' || path.endsWith('/index.html') || path.endsWith('/sw.js')) reply.header('Cache-Control', 'no-cache');
  return payload;
});

// Reject the retired client route explicitly so the Phaser SPA fallback can
// never impersonate /3d/.
app.get('/3d', async (_request, reply) => reply.code(410).send({ error: 'client-retired', supportedClient: '/classic/' }));
app.get('/3d/*', async (_request, reply) => reply.code(410).send({ error: 'client-retired', supportedClient: '/classic/' }));
await app.register(fastifyStatic, { root, prefix: '/', wildcard: true, maxAge: '1h', immutable: false });
app.setNotFoundHandler((request, reply) => {
  if (request.raw.url?.startsWith('/api/')) return reply.code(404).send({ error: 'not-found' });
  if (request.raw.url?.startsWith('/3d')) return reply.code(410).send({ error: 'client-retired', supportedClient: '/classic/' });
  return reply.sendFile('index.html', { cacheControl: false });
});

let shutdownStarted = false;
async function shutdown(signal) {
  if (shutdownStarted) return;
  shutdownStarted = true;
  const forcedExit = setTimeout(() => {
    app.log.error({ signal }, 'graceful shutdown timed out');
    process.exit(1);
  }, 10_000);
  forcedExit.unref?.();
  try {
    app.log.info({ signal }, 'graceful shutdown started');
    await app.close();
    if (db.open) {
      db.pragma('wal_checkpoint(TRUNCATE)');
      db.close();
    }
    clearTimeout(forcedExit);
    app.log.info({ signal }, 'graceful shutdown complete');
  } catch (error) {
    clearTimeout(forcedExit);
    app.log.error({ err: error, signal }, 'graceful shutdown failed');
    try { if (db.open) db.close(); } catch { /* best effort after shutdown failure */ }
    process.exitCode = 1;
  }
}

process.once('SIGINT', () => { void shutdown('SIGINT'); });
process.once('SIGTERM', () => { void shutdown('SIGTERM'); });

await app.listen({ host, port });

import { createHash, createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import Database from 'better-sqlite3';
import WebSocket from 'ws';
import { canonicalLiveEventChallengePayload, installPlatform } from '../server/platform.mjs';
import { verifyPublicPayload } from '../server/signing-keyring.mjs';
import { buildPerfectEndlessTrace, simulateEndlessReplay } from '../shared/runtime/endless-replay.mjs';
import { parsePlayerSaveV4 } from '../src/game/contracts';

const SIGNING_SECRET = 'v4-test-signing-secret-with-32-bytes';

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  const raw = value as Record<string, unknown>;
  return Object.fromEntries(Object.keys(raw).sort().map((key) => [key, canonicalize(raw[key])]));
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

describe('Phaser-only V4 backend contract', () => {
  let app: ReturnType<typeof Fastify>;
  let db: Database.Database;
  let previousDevelopmentOtp: string | undefined;

  beforeEach(async () => {
    previousDevelopmentOtp = process.env.PAOPAO_ALLOW_DEV_OTP;
    process.env.PAOPAO_ALLOW_DEV_OTP = '1';
    app = Fastify({ logger: false });
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    installPlatform({ app, db, signingSecret: SIGNING_SECRET });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    db.close();
    if (previousDevelopmentOtp === undefined) delete process.env.PAOPAO_ALLOW_DEV_OTP;
    else process.env.PAOPAO_ALLOW_DEV_OTP = previousDevelopmentOtp;
  });

  async function authenticate(email = 'v4-contract@example.com') {
    const requested = await app.inject({ method: 'POST', url: '/api/auth/otp/request', payload: { email } });
    const challenge = requested.json();
    const verified = await app.inject({
      method: 'POST', url: '/api/auth/otp/verify',
      payload: { challengeId: challenge.challengeId, code: challenge.developmentCode },
    });
    return {
      cookie: String(verified.headers['set-cookie']).split(';')[0],
      csrf: verified.json().csrfToken as string,
    };
  }

  it('[AT-PF-security-002][shared] publishes a signed bootstrap with an explicit compatible Phaser client', async () => {
    const manifestResponse = await app.inject({ method: 'GET', url: '/api/v3/content/manifest' });
    const manifest = manifestResponse.json();
    expect(manifest.clients).toEqual({
      classic: { route: '/classic/', engine: 'phaser-3.90.0', status: 'production', platforms: ['web'] },
    });
    expect(manifestResponse.headers.etag).toBe(`"sha256-${manifest.integrity.contentHash}"`);
    const unsignedManifest = { ...manifest }; delete unsignedManifest.integrity;
    const manifestHash = createHash('sha256').update(canonicalJson(unsignedManifest)).digest('hex');
    expect(manifest.integrity.contentHash).toBe(manifestHash);
    expect(manifest.integrity.algorithm).toBe('Ed25519');
    expect(verifyPublicPayload(unsignedManifest, manifest.integrity)).toBe(true);

    const live = (await app.inject({ method: 'GET', url: '/api/v3/live/config' })).json();
    expect(live.endless).toMatchObject({ seasonId: live.season, rulesVersion: 1 });
    expect(live.events[0].submissionToken).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    const event = live.events[0] as Record<string, unknown>;
    const eventPayload = canonicalLiveEventChallengePayload(event, live.endless);
    expect(live.events[0].submissionToken).toBe(
      createHmac('sha256', SIGNING_SECRET).update(eventPayload).digest('base64url'),
    );
    const changedEventFields: Array<[string, Record<string, unknown>, Record<string, unknown>]> = [
      ['id', { ...event, id: `${event.id}-forged` }, live.endless],
      ['kind', { ...event, kind: 'forged-kind' }, live.endless],
      ['boss', { ...event, boss: `${event.boss}-forged` }, live.endless],
      ['level', { ...event, level: Number(event.level) + 1 }, live.endless],
      ['seed', { ...event, seed: Number(event.seed) + 1 }, live.endless],
      ['modifier', { ...event, modifier: `${event.modifier}-forged` }, live.endless],
      ['reward', { ...event, reward: { currency: 'coins', amount: 751 } }, live.endless],
      ['startsAt', { ...event, startsAt: '2026-01-01T00:00:00.000Z' }, live.endless],
      ['endsAt', { ...event, endsAt: '2027-01-01T00:00:00.000Z' }, live.endless],
      ['seasonId', event, { ...live.endless, seasonId: `${live.endless.seasonId}-forged` }],
      ['rulesVersion', event, { ...live.endless, rulesVersion: Number(live.endless.rulesVersion) + 1 }],
    ];
    for (const [field, candidateEvent, candidateEndless] of changedEventFields) {
      const candidatePayload = canonicalLiveEventChallengePayload(candidateEvent, candidateEndless);
      expect(candidatePayload, field).not.toBe(eventPayload);
      expect(createHmac('sha256', SIGNING_SECRET).update(candidatePayload).digest('base64url'), field)
        .not.toBe(live.events[0].submissionToken);
    }
    const unsignedLive = { ...live };
    delete unsignedLive.integrity;
    const liveHash = createHash('sha256').update(canonicalJson(unsignedLive)).digest('hex');
    expect(live.integrity.contentHash).toBe(liveHash);
    expect(live.integrity.algorithm).toBe('Ed25519');
    expect(verifyPublicPayload(unsignedLive, live.integrity)).toBe(true);

    const bootstrap = (await app.inject({ method: 'GET', url: '/api/v3/bootstrap' })).json();
    expect(bootstrap.content).toEqual(manifest);
    expect(bootstrap.live).toEqual(live);
  });

  it('[AT-PF-security-003][shared] enforces save revisions, normalized migration and entitlement anti-rollback', async () => {
    const migrated = parsePlayerSaveV4({
      version: 4, revision: 2, updatedAt: '2026-07-22T00:00:00.000Z', client: 'classic',
      player: { version: 3 }, progress: { unlocked: 2 }, meta: { quality: 'balanced' }, inventory: { version: 1 },
    });
    expect(migrated).toMatchObject({
      clientIdentity: { id: 'classic', platform: 'web', build: 'legacy-v4' },
      campaign: { activeLevel: 1 }, endless: { bestWave: 0 }, handProfile: { handedness: 'auto' },
    });

    const auth = await authenticate();
    const headers = { cookie: auth.cookie, 'x-csrf-token': auth.csrf };
    const read = (await app.inject({ method: 'GET', url: '/api/v3/progress', headers: { cookie: auth.cookie } })).json();
    expect(read).toMatchObject({ saveVersion: 4, revision: 0, entitlements: { revision: 0, ids: [] } });
    expect(read.campaign.progress).toEqual(read.progress);

    const forgedEntitlement = await app.inject({
      method: 'PUT', url: '/api/v3/progress', headers,
      payload: { revision: 0, progress: { unlocked: 1 }, entitlements: { revision: 99, ids: ['skin:all'] } },
    });
    expect(forgedEntitlement.statusCode).toBe(400);

    const update = await app.inject({
      method: 'PUT', url: '/api/v3/progress', headers,
      payload: {
        revision: 0,
        progress: { unlocked: 3, stars: [3, 2], cleared: [0, 1] },
        clientIdentity: { id: 'classic', platform: 'web', build: 'phaser-3.80.1-r1', installId: 'install-v4-a' },
        campaign: { activeWorld: 1, activeLevel: 2, storyFlags: ['crown-awakened'] },
        deviceSettings: { quality: 'ultra', targetFps: 60, reducedMotion: false, subtitles: true },
        handProfile: { enabled: true, handedness: 'right', smoothing: 0.65, pinchContactRatio: 0.24, pinchReleaseRatio: 0.34 },
      },
    });
    expect(update.statusCode).toBe(200);
    expect(update.json()).toMatchObject({
      revision: 1,
      client: 'classic',
      clientIdentity: { id: 'classic', platform: 'web', installId: 'install-v4-a' },
      campaign: { activeWorld: 1, activeLevel: 2, storyFlags: ['crown-awakened'] },
      handProfile: { handedness: 'right', pinchContactRatio: 0.24, pinchReleaseRatio: 0.34 },
      entitlements: { revision: 0, ids: [] },
    });
    const reread = (await app.inject({ method: 'GET', url: '/api/v3/progress', headers: { cookie: auth.cookie } })).json();
    expect(reread.clientIdentity).toMatchObject({ id: 'classic', platform: 'web', build: 'phaser-3.80.1-r1' });
    expect(reread.progress.stars.slice(0, 2)).toEqual([3, 2]);
  });

  it('settles deterministic endless progression and one idempotent live-event reward', async () => {
    const auth = await authenticate('endless@example.com');
    const headers = { cookie: auth.cookie, 'x-csrf-token': auth.csrf };
    const live = (await app.inject({ method: 'GET', url: '/api/v3/live/config' })).json();
    const manifest = (await app.inject({ method: 'GET', url: '/api/v3/content/manifest' })).json();
    const event = live.events[0];
    const baseRun = {
      client: 'classic', level: event.level, mode: 'endless', score: 1200, durationMs: 5000,
      won: true, shots: 5, hits: 4, contentVersion: manifest.contentVersion,
      seasonId: live.endless.seasonId, seed: event.seed, wave: 2,
      eventId: event.id, challengeToken: event.submissionToken, createdAt: new Date().toISOString(),
    };
    const forgedToken = await app.inject({
      method: 'POST', url: '/api/v3/runs', headers,
      payload: {
        ...baseRun,
        runId: 'classic-event-token-forged',
        replayHash: 'a'.repeat(64),
        challengeToken: `${event.submissionToken.slice(0, -1)}${event.submissionToken.endsWith('A') ? 'B' : 'A'}`,
      },
    });
    expect(forgedToken.statusCode).toBe(422);
    expect(forgedToken.json()).toEqual({ error: 'event-proof-invalid' });
    const forgedLevel = await app.inject({
      method: 'POST', url: '/api/v3/runs', headers,
      payload: { ...baseRun, runId: 'classic-event-level-forged', replayHash: 'a'.repeat(64), level: (event.level + 1) % 30 },
    });
    expect(forgedLevel.statusCode).toBe(422);
    expect(forgedLevel.json()).toEqual({ error: 'event-proof-invalid' });
    const forgedEventId = await app.inject({
      method: 'POST', url: '/api/v3/runs', headers,
      payload: { ...baseRun, runId: 'classic-event-id-forged', replayHash: 'a'.repeat(64), eventId: `${event.id}-forged` },
    });
    expect(forgedEventId.statusCode).toBe(422);
    expect(forgedEventId.json()).toEqual({ error: 'event-not-active' });
    const outsideEventWindow = await app.inject({
      method: 'POST', url: '/api/v3/runs', headers,
      payload: {
        ...baseRun,
        runId: 'classic-event-window-forged',
        replayHash: 'a'.repeat(64),
        createdAt: new Date(Date.parse(event.startsAt) - 1).toISOString(),
      },
    });
    expect(outsideEventWindow.statusCode).toBe(422);
    expect(outsideEventWindow.json()).toEqual({ error: 'event-window-invalid' });
    const firstPayload = { ...baseRun, runId: 'classic-event-0001', replayHash: 'a'.repeat(64) };
    const first = await app.inject({ method: 'POST', url: '/api/v3/runs', headers, payload: firstPayload });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({
      accepted: true, duplicate: false,
      validation: { algorithm: 'Ed25519' },
      replayVerification: {
        status: 'unverified', authoritative: false, rewardEligible: false,
        reason: 'authoritative-shot-trace-required',
      },
      progression: { applied: false, reason: 'authoritative-shot-trace-required' },
      reward: {
        granted: false, alreadyClaimed: false, currency: 'coins', amount: 0,
        balance: 600, reason: 'authoritative-shot-trace-required',
      },
      rewardProof: { algorithm: 'Ed25519' },
    });
    const duplicate = await app.inject({ method: 'POST', url: '/api/v3/runs', headers, payload: firstPayload });
    expect(duplicate.json()).toMatchObject({
      accepted: false, duplicate: true, replayed: true,
      validation: { algorithm: 'Ed25519' }, reward: { granted: false, amount: 0 },
    });

    const shotCount = Math.ceil((8 + (event.level % 5)) / 2);
    const shotTrace = buildPerfectEndlessTrace({ seed: event.seed, shotCount, modifier: event.modifier });
    const durationMs = shotTrace.at(-1)!.atMs + 500;
    const simulation = simulateEndlessReplay({
      seed: event.seed, level: event.level, durationMs, shotTrace,
      modifier: event.modifier, eventBoss: true,
    });
    if (!simulation.ok) throw new Error(simulation.error);
    const replayPayload = {
      replayVersion: 1, rulesVersion: 1, contentVersion: baseRun.contentVersion, seasonId: baseRun.seasonId,
      seed: baseRun.seed, level: baseRun.level, mode: baseRun.mode, wave: simulation.result.wave,
      durationMs, shotTrace, eventId: event.id,
    };
    const replayHash = createHash('sha256').update(canonicalJson(replayPayload)).digest('hex');
    const verifiedIntegrityPayload = {
      ...baseRun,
      runId: 'classic-event-0002',
      score: simulation.result.score,
      durationMs,
      won: simulation.result.won,
      shots: simulation.result.shots,
      hits: simulation.result.hits,
      wave: simulation.result.wave,
      replayVersion: 1,
      shotTrace,
      replayHash,
    };
    const second = await app.inject({
      method: 'POST', url: '/api/v3/runs', headers,
      payload: verifiedIntegrityPayload,
    });
    expect(second.json()).toMatchObject({
      accepted: true,
      replayVerification: {
        status: 'authoritative', authoritative: true, rewardEligible: true,
        reason: 'authoritative-replay-verified', canonicalHash: replayHash,
        replayVersion: 1, shotCount,
        result: {
          score: simulation.result.score,
          hits: simulation.result.hits,
          shots: simulation.result.shots,
          wave: simulation.result.wave,
          won: true,
          seasonPoints: simulation.result.seasonPoints,
          stateChecksum: simulation.result.stateChecksum,
        },
      },
      progression: {
        applied: true,
        runPoints: simulation.result.seasonPoints,
        bestWave: simulation.result.wave,
        bestScore: simulation.result.score,
        seasonPoints: simulation.result.seasonPoints,
      },
      reward: { granted: true, alreadyClaimed: false, amount: 750, balance: 1350 },
    });
    const replayedReceipt = await app.inject({
      method: 'POST', url: '/api/v3/runs', headers, payload: verifiedIntegrityPayload,
    });
    expect(replayedReceipt.json()).toMatchObject({
      accepted: false, duplicate: true, replayed: true,
      reward: { granted: true, amount: 750, balance: 1350 },
    });
    const forgedHash = await app.inject({
      method: 'POST', url: '/api/v3/runs', headers,
      payload: { ...verifiedIntegrityPayload, runId: 'classic-event-0003', replayHash: 'b'.repeat(64) },
    });
    expect(forgedHash.statusCode).toBe(422);
    expect(forgedHash.json()).toEqual({ error: 'replay-hash-mismatch' });
    const forgedResult = await app.inject({
      method: 'POST', url: '/api/v3/runs', headers,
      payload: { ...verifiedIntegrityPayload, runId: 'classic-event-0004', score: verifiedIntegrityPayload.score + 1 },
    });
    expect(forgedResult.statusCode).toBe(422);
    expect(forgedResult.json()).toEqual({ error: 'replay-result-mismatch' });
    const reusedProof = await app.inject({
      method: 'POST', url: '/api/v3/runs', headers,
      payload: { ...verifiedIntegrityPayload, runId: 'classic-event-0005' },
    });
    expect(reusedProof.statusCode).toBe(409);
    expect(reusedProof.json()).toEqual({ error: 'replay-proof-reused', originalRunId: 'classic-event-0002' });
    expect(db.prepare("SELECT COUNT(*) AS count FROM security_audit WHERE event_type='endless-replay-reused'").get().count).toBe(1);

    const secondTrace = buildPerfectEndlessTrace({
      seed: event.seed, shotCount, modifier: event.modifier, firstAtMs: 600, cadenceMs: 700,
    });
    const secondDurationMs = secondTrace.at(-1)!.atMs + 500;
    const secondSimulation = simulateEndlessReplay({
      seed: event.seed, level: event.level, durationMs: secondDurationMs, shotTrace: secondTrace,
      modifier: event.modifier, eventBoss: true,
    });
    if (!secondSimulation.ok) throw new Error(secondSimulation.error);
    const secondReplayPayload = {
      replayVersion: 1, rulesVersion: 1, contentVersion: baseRun.contentVersion, seasonId: baseRun.seasonId,
      seed: baseRun.seed, level: baseRun.level, mode: baseRun.mode, wave: secondSimulation.result.wave,
      durationMs: secondDurationMs, shotTrace: secondTrace, eventId: event.id,
    };
    const secondReplayHash = createHash('sha256').update(canonicalJson(secondReplayPayload)).digest('hex');
    const secondWin = await app.inject({
      method: 'POST', url: '/api/v3/runs', headers,
      payload: {
        ...baseRun,
        runId: 'classic-event-0006',
        score: secondSimulation.result.score,
        durationMs: secondDurationMs,
        won: true,
        shots: secondSimulation.result.shots,
        hits: secondSimulation.result.hits,
        wave: secondSimulation.result.wave,
        replayVersion: 1,
        shotTrace: secondTrace,
        replayHash: secondReplayHash,
      },
    });
    expect(secondWin.statusCode).toBe(200);
    expect(secondWin.json()).toMatchObject({
      replayVerification: { status: 'authoritative', authoritative: true },
      reward: { granted: false, alreadyClaimed: true, amount: 0, balance: 1350 },
      progression: {
        applied: true,
        seasonPoints: simulation.result.seasonPoints + secondSimulation.result.seasonPoints,
      },
    });
    const invalidSeed = await app.inject({
      method: 'POST', url: '/api/v3/runs', headers,
      payload: { ...baseRun, runId: 'classic-event-0007', seed: event.seed + 1, replayHash: 'c'.repeat(64) },
    });
    expect(invalidSeed.statusCode).toBe(422);
    expect(invalidSeed.json()).toEqual({ error: 'seed-mismatch' });

    const progress = (await app.inject({ method: 'GET', url: '/api/v3/progress', headers: { cookie: auth.cookie } })).json();
    expect(progress.endless).toMatchObject({
      bestWave: simulation.result.wave,
      bestScore: simulation.result.score,
      seasonPoints: simulation.result.seasonPoints + secondSimulation.result.seasonPoints,
      completedRunIds: ['classic-event-0002', 'classic-event-0006'],
    });
    expect(progress.liveEvent.completedChallengeIds).toEqual([event.id]);
    expect(progress.liveEvent.claimedRewardIds).toEqual([event.id]);
    const wallet = (await app.inject({ method: 'GET', url: '/api/wallet', headers: { cookie: auth.cookie } })).json();
    expect(wallet.coins).toBe(1350);
    expect(db.prepare("SELECT COUNT(*) AS count FROM wallet_ledger WHERE kind='live-event-reward'").get().count).toBe(1);
    expect(db.prepare('SELECT COUNT(*) AS count FROM v3_replay_claims').get().count).toBe(2);
  });

  it('strictly bounds and orders canonical endless shot traces', async () => {
    const auth = await authenticate('trace-bounds@example.com');
    const headers = { cookie: auth.cookie, 'x-csrf-token': auth.csrf };
    const live = (await app.inject({ method: 'GET', url: '/api/v3/live/config' })).json();
    const manifest = (await app.inject({ method: 'GET', url: '/api/v3/content/manifest' })).json();
    const baseRun = {
      runId: 'trace-bounds-0001', client: 'classic', level: 0, mode: 'endless', score: 0,
      durationMs: 5000, won: false, shots: 2, hits: 0, contentVersion: manifest.contentVersion,
      seasonId: live.endless.seasonId, seed: live.endless.seed, wave: 1,
      replayHash: 'a'.repeat(64), replayVersion: 1, createdAt: new Date().toISOString(),
    };
    const unordered = await app.inject({
      method: 'POST', url: '/api/v3/runs', headers,
      payload: {
        ...baseRun,
        shotTrace: [
          { sequence: 0, atMs: 1000, angleMilliDegrees: 0 },
          { sequence: 1, atMs: 900, angleMilliDegrees: 1000 },
        ],
      },
    });
    expect(unordered.statusCode).toBe(422);
    expect(unordered.json()).toEqual({ error: 'replay-trace-order-invalid' });

    const tooMany = await app.inject({
      method: 'POST', url: '/api/v3/runs', headers,
      payload: {
        ...baseRun, runId: 'trace-bounds-0002', shots: 251,
        shotTrace: Array.from({ length: 251 }, (_, sequence) => ({ sequence, atMs: sequence * 10, angleMilliDegrees: 0 })),
      },
    });
    expect(tooMany.statusCode).toBe(400);
    expect(db.prepare('SELECT COUNT(*) AS count FROM v3_runs').get().count).toBe(0);
  });

  it('authoritatively records a season run without minting an event reward', async () => {
    const auth = await authenticate('season-run@example.com');
    const headers = { cookie: auth.cookie, 'x-csrf-token': auth.csrf };
    const live = (await app.inject({ method: 'GET', url: '/api/v3/live/config' })).json();
    const manifest = (await app.inject({ method: 'GET', url: '/api/v3/content/manifest' })).json();
    const shotTrace = buildPerfectEndlessTrace({ seed: live.endless.seed, shotCount: 7 });
    const durationMs = shotTrace.at(-1)!.atMs + 500;
    const simulation = simulateEndlessReplay({
      seed: live.endless.seed, level: 0, durationMs, shotTrace,
    });
    if (!simulation.ok) throw new Error(simulation.error);
    const canonicalReplay = {
      replayVersion: 1,
      rulesVersion: 1,
      contentVersion: manifest.contentVersion,
      seasonId: live.endless.seasonId,
      seed: live.endless.seed,
      level: 0,
      mode: 'endless',
      wave: simulation.result.wave,
      durationMs,
      shotTrace,
    };
    const replayHash = createHash('sha256').update(canonicalJson(canonicalReplay)).digest('hex');
    const payload = {
      runId: 'season-authority-0001', client: 'classic', level: 0, mode: 'endless',
      score: simulation.result.score, durationMs, won: false,
      shots: simulation.result.shots, hits: simulation.result.hits,
      contentVersion: manifest.contentVersion, seasonId: live.endless.seasonId,
      seed: live.endless.seed, wave: simulation.result.wave,
      replayVersion: 1, shotTrace, replayHash, createdAt: new Date().toISOString(),
    };
    const accepted = await app.inject({ method: 'POST', url: '/api/v3/runs', headers, payload });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json()).toMatchObject({
      replayVerification: {
        status: 'authoritative', authoritative: true, rewardEligible: false,
        result: { stateChecksum: simulation.result.stateChecksum },
      },
      progression: {
        applied: true, runPoints: simulation.result.seasonPoints,
        bestWave: simulation.result.wave, bestScore: simulation.result.score,
      },
    });
    expect(accepted.json()).not.toHaveProperty('reward');
    expect((await app.inject({ method: 'GET', url: '/api/wallet', headers: { cookie: auth.cookie } })).json().coins).toBe(600);

    const unexpectedToken = await app.inject({
      method: 'POST', url: '/api/v3/runs', headers,
      payload: { ...payload, runId: 'season-authority-0002', challengeToken: 'x'.repeat(40) },
    });
    expect(unexpectedToken.statusCode).toBe(422);
    expect(unexpectedToken.json()).toEqual({ error: 'endless-challenge-token-unexpected' });

    const outsideSeason = await app.inject({
      method: 'POST', url: '/api/v3/runs', headers,
      payload: {
        ...payload,
        runId: 'season-authority-0003',
        createdAt: new Date(Date.parse(live.endless.startsAt) - 1).toISOString(),
      },
    });
    expect(outsideSeason.statusCode).toBe(422);
    expect(outsideSeason.json()).toEqual({ error: 'season-window-invalid' });
  });

  it('issues short-lived native access tokens and detects refresh-token reuse', async () => {
    const requested = await app.inject({ method: 'POST', url: '/api/auth/otp/request', payload: { email: 'native@example.com' } });
    const challenge = requested.json();
    const verified = await app.inject({
      method: 'POST', url: '/api/auth/otp/verify',
      payload: { challengeId: challenge.challengeId, code: challenge.developmentCode, nativeClient: 'windows' },
    });
    expect(verified.headers['set-cookie']).toBeUndefined();
    const credentials = verified.json();
    expect(credentials).toMatchObject({ authentication: 'native', tokenType: 'Bearer', client: 'windows' });
    expect(db.prepare('SELECT COUNT(*) AS count FROM sessions').get().count).toBe(0);
    expect(Date.parse(credentials.accessExpiresAt) - Date.now()).toBeLessThanOrEqual(15 * 60_000);

    const account = await app.inject({ method: 'GET', url: '/api/account', headers: { authorization: `Bearer ${credentials.accessToken}` } });
    expect(account.statusCode).toBe(200);
    expect(account.json()).toMatchObject({ authentication: 'native', nativeClient: 'windows' });
    expect(account.json()).not.toHaveProperty('csrfToken');

    const rotated = await app.inject({
      method: 'POST', url: '/api/v3/auth/native/refresh', payload: { refreshToken: credentials.refreshToken },
    });
    expect(rotated.statusCode).toBe(200);
    expect(rotated.json().refreshToken).not.toBe(credentials.refreshToken);
    const reuse = await app.inject({
      method: 'POST', url: '/api/v3/auth/native/refresh', payload: { refreshToken: credentials.refreshToken },
    });
    expect(reuse.statusCode).toBe(401);
    expect(reuse.json()).toEqual({ error: 'refresh-reuse-detected' });
    const revokedFamily = await app.inject({
      method: 'POST', url: '/api/v3/auth/native/refresh', payload: { refreshToken: rotated.json().refreshToken },
    });
    expect(revokedFamily.statusCode).toBe(401);
    expect(revokedFamily.json()).toEqual({ error: 'refresh-revoked' });
    const compromisedAccess = await app.inject({
      method: 'GET', url: '/api/account', headers: { authorization: `Bearer ${rotated.json().accessToken}` },
    });
    expect(compromisedAccess.statusCode).toBe(401);
    expect(db.prepare("SELECT COUNT(*) AS count FROM security_audit WHERE event_type='native-refresh-reuse'").get().count).toBe(1);
  });

  it('rejects changed content behind an existing Phaser run id', async () => {
    const auth = await authenticate('idempotency@example.com');
    const headers = { cookie: auth.cookie, 'x-csrf-token': auth.csrf };
    const payload = {
      runId: 'shared-run-id-0001', client: 'classic', level: 0, mode: 'classic', score: 1000,
      durationMs: 2000, won: true, shots: 2, hits: 2, createdAt: new Date().toISOString(),
    };
    expect((await app.inject({ method: 'POST', url: '/api/v3/runs', headers, payload })).statusCode).toBe(200);
    const conflict = await app.inject({ method: 'POST', url: '/api/v3/runs', headers, payload: { ...payload, score: 1001 } });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json()).toEqual({ error: 'run-id-conflict', runId: payload.runId });
  });

  it('serves the versioned arena WebSocket alias beside the legacy path', async () => {
    const auth = await authenticate('arena-alias@example.com');
    await app.listen({ host: '127.0.0.1', port: 0 });
    const address = app.server.address();
    if (!address || typeof address === 'string') throw new Error('test server did not bind TCP');
    for (const path of ['/api/arena', '/ws/v3/arena']) {
      const url = `ws://127.0.0.1:${address.port}${path}`;
      const socket = new WebSocket(url, { headers: { Cookie: auth.cookie, Origin: `http://127.0.0.1:${address.port}` } });
      const ready = await new Promise<Record<string, unknown>>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error(`arena-ready timeout for ${path}`)), 2_000);
        socket.once('error', reject);
        socket.on('message', (payload) => {
          const message = JSON.parse(String(payload)) as Record<string, unknown>;
          if (message.type === 'arena-ready') { clearTimeout(timeout); resolve(message); }
        });
      });
      expect(ready).toMatchObject({ type: 'arena-ready' });
      socket.close();
      await new Promise<void>((resolve) => socket.once('close', () => resolve()));
    }
  });
});

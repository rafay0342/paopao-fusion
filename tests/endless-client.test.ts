import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { BootstrapV3 } from '../src/game/contracts';
import {
  EndlessTraceRecorder,
  createEndlessHexGrid,
  endlessLaneForBoardX,
  resolveEndlessSessionV3,
  verifySignedPayloadV3,
} from '../src/game/endless';
import { signPublicPayload } from '../server/signing-keyring.mjs';

const SERVER_TIME = '2026-07-22T12:00:00.000Z';

function integrity(seed: string): BootstrapV3['content']['integrity'] {
  return {
    algorithm: 'Ed25519',
    keyId: `test-key-${seed}`,
    publicKey: seed.repeat(59).slice(0, 59),
    contentHash: seed.repeat(64).slice(0, 64),
    signature: `${seed.toUpperCase()}bcdefghijklmnopqrstuvwxyz0123456789_-`.repeat(3).slice(0, 86),
  };
}

function signedBootstrap(): BootstrapV3 {
  return {
    apiVersion: 3,
    serverTime: SERVER_TIME,
    content: {
      schemaVersion: 3,
      contentVersion: '2026.07.22-r4',
      saveVersion: 4,
      clients: {
        classic: {
          route: '/classic/',
          engine: 'Phaser',
          status: 'production',
          platforms: ['web', 'windows', 'android'],
        },
      },
      worlds: 6,
      levels: 30,
      modes: ['classic', 'rush', 'precision', 'endless'],
      artifacts: ['chrono', 'phoenix', 'void', 'fortune'],
      compatibility: { minimumApiVersion: 3, legacyAdaptersThroughRelease: 2 },
      integrity: integrity('a'),
    },
    live: {
      schemaVersion: 3,
      season: 'Crownfall',
      minimumFps: 30,
      preferredFps: 60,
      handTracking: { targetFps: 30, adaptive: true, workerInference: true, framesUploaded: false },
      features: { endless: true, liveEvents: true },
      endless: {
        seasonId: 'season-008',
        seed: 305_419_896,
        rulesVersion: 1,
        replayVersion: 1,
        maximumShots: 250,
        aimMilliDegrees: { minimum: -30_000, maximum: 30_000 },
        pointsPerRewardTier: 2_500,
        startsAt: '2026-07-20T00:00:00.000Z',
        endsAt: '2026-08-20T00:00:00.000Z',
        modifiers: ['mirror-orbs', 'short-fuse', 'precision-plus'],
      },
      events: [{
        id: 'event-crownfall-01',
        kind: 'event-boss',
        boss: 'astral-sentinel',
        level: 17,
        seed: 111_222_333,
        modifier: 'precision-plus',
        reward: { currency: 'coins', amount: 750 },
        startsAt: '2026-07-20T00:00:00.000Z',
        endsAt: '2026-07-27T00:00:00.000Z',
        submissionToken: 'signed-event-submission-token-value-000000000000',
      }],
      integrity: integrity('b'),
    },
    account: { authenticated: true, csrfToken: 'csrf-session-value' },
  };
}

describe('Phaser endless session gate', () => {
  it('cryptographically verifies browser-consumable Ed25519 envelopes and rejects tampering', async () => {
    const payload = { schemaVersion: 3, season: 'Crownfall', features: { endless: true } };
    const signed = { ...payload, integrity: signPublicPayload(payload, 'browser-verifiable-signing-secret-0001') };
    expect(await verifySignedPayloadV3(signed)).toBe(true);
    expect(await verifySignedPayloadV3({ ...signed, season: 'forged' })).toBe(false);
    expect(await verifySignedPayloadV3({ ...signed, integrity: { ...signed.integrity, signature: `A${signed.integrity.signature.slice(1)}` } })).toBe(false);
  });

  it('resolves the current signed season without substituting client state', () => {
    const resolved = resolveEndlessSessionV3(signedBootstrap(), false, Date.parse(SERVER_TIME));
    expect(resolved).toEqual({
      ok: true,
      session: {
        contentVersion: '2026.07.22-r4',
        seasonId: 'season-008',
        seed: 305_419_896,
        level: 6,
        maximumShots: 250,
        pointsPerRewardTier: 2_500,
        serverTimeOffsetMs: 0,
        startsAt: '2026-07-20T00:00:00.000Z',
        endsAt: '2026-08-20T00:00:00.000Z',
        modifier: null,
      },
    });
  });

  it('binds an event run to the signed event seed, level, modifier and token', () => {
    const bootstrap = signedBootstrap();
    const resolved = resolveEndlessSessionV3(bootstrap, true, Date.parse(SERVER_TIME));
    expect(resolved).toMatchObject({
      ok: true,
      session: {
        seed: 111_222_333,
        level: 17,
        modifier: 'precision-plus',
        startsAt: '2026-07-20T00:00:00.000Z',
        endsAt: '2026-07-27T00:00:00.000Z',
        event: {
          id: 'event-crownfall-01',
          submissionToken: 'signed-event-submission-token-value-000000000000',
        },
      },
    });
  });

  it('fails closed for anonymous, unsigned, incompatible, and inactive event data', () => {
    const anonymous = signedBootstrap();
    anonymous.account = { authenticated: false };
    expect(resolveEndlessSessionV3(anonymous, false)).toEqual({ ok: false, error: 'authentication-required' });

    const unsigned = signedBootstrap();
    unsigned.live.integrity.signature = 'invalid';
    expect(resolveEndlessSessionV3(unsigned, false)).toEqual({ ok: false, error: 'signed-config-required' });

    const incompatible = signedBootstrap();
    incompatible.live.endless.maximumShots = 249;
    expect(resolveEndlessSessionV3(incompatible, false)).toEqual({ ok: false, error: 'endless-rules-incompatible' });

    const inactive = signedBootstrap();
    inactive.live.events[0].endsAt = '2026-07-21T00:00:00.000Z';
    expect(resolveEndlessSessionV3(inactive, true)).toEqual({ ok: false, error: 'live-event-unavailable' });
  });
});

describe('Phaser endless field and trace', () => {
  it('uses an exact eleven-column staggered mathematical hex grid', () => {
    const grid = createEndlessHexGrid(720, 244, 7);
    expect(grid).toMatchObject({ columns: 11, rows: 7, horizontalSpacing: 60 });
    expect(grid.cells).toHaveLength(77);
    expect(grid.cells.filter(({ row }) => row === 0).map(({ lane }) => lane)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(grid.cells.find(({ row, lane }) => row === 1 && lane === 0)?.x).toBe(75);
    expect(endlessLaneForBoardX(grid, -1_000)).toBe(0);
    expect(endlessLaneForBoardX(grid, 1_000)).toBe(10);
    expect(endlessLaneForBoardX(grid, 345)).toBe(5);
  });

  it('records only monotonic, cadence-valid exact lane timestamps and seals once', () => {
    const recorder = new EndlessTraceRecorder(1_000);
    expect(recorder.recordLane(0, 1_100)).toEqual({
      ok: false, error: 'replay-shot-too-soon', retryAfterMs: 20,
    });
    expect(recorder.recordLane(0, 1_120)).toEqual({
      ok: true,
      shot: { sequence: 0, atMs: 120, angleMilliDegrees: -30_000 },
    });
    expect(recorder.recordLane(10, 1_299)).toEqual({
      ok: false, error: 'replay-shot-too-soon', retryAfterMs: 1,
    });
    expect(recorder.recordLane(10, 1_300)).toEqual({
      ok: true,
      shot: { sequence: 1, atMs: 300, angleMilliDegrees: 30_000 },
    });
    expect(recorder.seal(1_549)).toEqual({
      ok: false, error: 'replay-settlement-pending', retryAfterMs: 1,
    });
    expect(recorder.seal(1_550)).toEqual({
      ok: true,
      durationMs: 550,
      shotTrace: [
        { sequence: 0, atMs: 120, angleMilliDegrees: -30_000 },
        { sequence: 1, atMs: 300, angleMilliDegrees: 30_000 },
      ],
    });
    expect(recorder.recordLane(5, 1_800)).toEqual({ ok: false, error: 'replay-already-sealed' });
  });
});

describe('Endless scene authority wiring', () => {
  it('registers both entry points and keeps rewards behind the V3 authority bridge', () => {
    const scene = readFileSync(new URL('../src/scenes/EndlessScene.ts', import.meta.url), 'utf8');
    const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
    const modes = readFileSync(new URL('../src/scenes/ModeSelectScene.ts', import.meta.url), 'utf8');
    const challenges = readFileSync(new URL('../src/scenes/ChallengesScene.ts', import.meta.url), 'utf8');
    const platform = readFileSync(new URL('../src/game/platform.ts', import.meta.url), 'utf8');

    for (const required of [
      'PinchDoubleTapControl',
      'getBootstrapV3',
      'resolveEndlessSessionV3',
      'simulateEndlessReplay',
      'finalizeEndlessRunSubmission',
      'submitRunV3',
      'syncClassicProgressV4',
      'RETRY SAME TRACE',
      'NO CLIENT-MINTED WALLET CHANGE',
    ]) expect(scene).toContain(required);
    expect(scene).not.toMatch(/\b(?:addCoins|grantCoins|claimChallengeReward|claimQuest|setCoins)\s*\(/);
    expect(main).toContain("import { EndlessScene } from './scenes/EndlessScene';");
    expect(main).toMatch(/completeGameplay \? \[[\s\S]*CompetitiveScene/);
    expect(main).toContain('endlessLiveOperations ? [EndlessScene]');
    expect(modes).toContain("this.scene.start('Endless', { event: false })");
    expect(challenges).toContain("this.scene.start('Endless', { event: true })");
    expect(platform).toMatch(/getBootstrapV3[\s\S]*\/api\/v3\/bootstrap[\s\S]*saveCsrfToken/);
    expect(platform).toMatch(/submitRunV3[\s\S]*\/api\/v3\/runs/);
  });
});

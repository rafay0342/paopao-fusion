import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import fixture from '../shared/fixtures/determinism-v1.json';
import {
  buildPerfectEndlessTrace,
  simulateEndlessReplay,
  validateEndlessShotTrace,
} from '../shared/runtime/endless-replay.mjs';
import {
  canonicalEndlessReplayJson,
  finalizeEndlessRunSubmission,
} from '../src/game/endless';

describe('authoritative endless replay runtime', () => {
  it('pins one cross-runtime event-boss replay to an exact result and checksum', () => {
    const corpus = fixture.endlessReplay;
    const shotTrace = buildPerfectEndlessTrace({
      seed: corpus.seed,
      shotCount: corpus.shotTrace.length,
      modifier: corpus.modifier,
    });
    expect(shotTrace).toEqual(corpus.shotTrace);
    const replay = simulateEndlessReplay({
      seed: corpus.seed,
      level: corpus.level,
      durationMs: corpus.durationMs,
      shotTrace,
      modifier: corpus.modifier,
      eventBoss: corpus.eventBoss,
    });
    expect(replay).toMatchObject({
      ok: true,
      result: corpus.result,
    });
  });

  it('fails closed for impossible cadence, cone escape, and shots after terminal state', () => {
    expect(validateEndlessShotTrace([
      { sequence: 0, atMs: 50, angleMilliDegrees: 0 },
    ], 500)).toMatchObject({ ok: false, error: 'replay-shot-cadence-invalid' });
    expect(validateEndlessShotTrace([
      { sequence: 0, atMs: 500, angleMilliDegrees: 30_001 },
    ], 1_000)).toMatchObject({ ok: false, error: 'replay-aim-out-of-bounds' });

    const terminalTrace = buildPerfectEndlessTrace({ seed: 305_419_896, shotCount: 6 });
    expect(simulateEndlessReplay({
      seed: 305_419_896,
      level: 17,
      durationMs: 4_000,
      shotTrace: terminalTrace,
      eventBoss: true,
    })).toMatchObject({ ok: false, error: 'replay-after-terminal', sequence: 5 });
  });

  it('builds Phaser submissions from the shared result and canonical SHA-256 payload', async () => {
    const shotTrace = buildPerfectEndlessTrace({ seed: 305_419_896, shotCount: 5, modifier: 'precision-plus' });
    const submission = await finalizeEndlessRunSubmission({
      runId: 'client-authority-0001',
      client: 'classic',
      level: 17,
      durationMs: 3_400,
      contentVersion: '2026.07.22-r1',
      seasonId: 'season-008',
      seed: 305_419_896,
      shotTrace,
      event: {
        id: 'event-fixture',
        kind: 'event-boss',
        boss: 'astral-sentinel',
        level: 17,
        seed: 305_419_896,
        modifier: 'precision-plus',
        reward: { currency: 'coins', amount: 750 },
        startsAt: '2026-07-20T00:00:00.000Z',
        endsAt: '2026-07-27T00:00:00.000Z',
        submissionToken: 'signed-event-submission-token-value-000000000000',
      },
      createdAt: '2026-07-22T00:00:00.000Z',
    });
    expect(submission).toMatchObject({
      mode: 'endless', score: 1_300, hits: 5, shots: 5, wave: 2, won: true,
      replayVersion: 1, eventId: 'event-fixture',
    });
    expect(submission.replayHash).toBe(
      createHash('sha256').update(canonicalEndlessReplayJson(submission)).digest('hex'),
    );
  });
});

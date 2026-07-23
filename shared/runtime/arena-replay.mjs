/**
 * Streaming deterministic authority for ranked arena shots.
 *
 * The browser submits only a sequence number, a monotonic run timestamp and
 * its quantized aim angle. Outcomes are derived here from the server-owned
 * seed. Client-reported pop/drop counts are deliberately not part of the
 * protocol.
 */
import {
  ENDLESS_REPLAY_RULES,
  buildEndlessTargetSequence,
  simulateEndlessReplay,
} from './endless-replay.mjs';

export const ARENA_REPLAY_RULES = Object.freeze({
  replayVersion: 1,
  rulesVersion: 1,
  aimMinimumMilliDegrees: ENDLESS_REPLAY_RULES.aimMinimumMilliDegrees,
  aimMaximumMilliDegrees: ENDLESS_REPLAY_RULES.aimMaximumMilliDegrees,
  maximumShots: ENDLESS_REPLAY_RULES.maximumShots,
  minimumFirstShotMs: ENDLESS_REPLAY_RULES.minimumFirstShotMs,
  minimumShotIntervalMs: ENDLESS_REPLAY_RULES.minimumShotIntervalMs,
  maximumShotIntervalMs: ENDLESS_REPLAY_RULES.maximumShotIntervalMs,
  maximumFutureLeadMs: 750,
  maximumReconnectAgeMs: 15_000,
});

const arenaSeed = (seed, level) => (
  (Number(seed) ^ Math.imul(Number(level) + 1, 0x45d9f3b)) >>> 0
) & 0x7fffffff;

export function validateArenaShotTrace(shotTrace) {
  if (!Array.isArray(shotTrace)) return { ok: false, error: 'arena-replay-trace-required' };
  if (shotTrace.length > ARENA_REPLAY_RULES.maximumShots) {
    return { ok: false, error: 'arena-replay-shot-limit-exceeded' };
  }
  let previousAtMs = 0;
  for (let index = 0; index < shotTrace.length; index += 1) {
    const shot = shotTrace[index];
    if (!shot || typeof shot !== 'object' || Array.isArray(shot)
      || !Number.isInteger(shot.seq) || !Number.isInteger(shot.atMs)
      || !Number.isInteger(shot.angleMilliDegrees)) {
      return { ok: false, error: 'arena-replay-shape-invalid', sequence: index + 1 };
    }
    if (shot.seq !== index + 1 || shot.atMs <= previousAtMs) {
      return { ok: false, error: 'arena-replay-order-invalid', sequence: index + 1 };
    }
    if (shot.angleMilliDegrees < ARENA_REPLAY_RULES.aimMinimumMilliDegrees
      || shot.angleMilliDegrees > ARENA_REPLAY_RULES.aimMaximumMilliDegrees) {
      return { ok: false, error: 'arena-replay-aim-invalid', sequence: index + 1 };
    }
    const intervalMs = shot.atMs - previousAtMs;
    const minimumMs = index === 0
      ? ARENA_REPLAY_RULES.minimumFirstShotMs
      : ARENA_REPLAY_RULES.minimumShotIntervalMs;
    if (intervalMs < minimumMs || intervalMs > ARENA_REPLAY_RULES.maximumShotIntervalMs) {
      return { ok: false, error: 'arena-replay-cadence-invalid', sequence: index + 1 };
    }
    previousAtMs = shot.atMs;
  }
  return { ok: true };
}

export function buildArenaTargetSequence({ seed, level, shotCount }) {
  return buildEndlessTargetSequence({
    seed: arenaSeed(seed, level),
    shotCount,
    modifier: null,
  });
}

export function simulateArenaReplay({ seed, level, shotTrace }) {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0x7fffffff) {
    return { ok: false, error: 'arena-replay-seed-invalid' };
  }
  if (!Number.isInteger(level) || level < 0 || level > 29) {
    return { ok: false, error: 'arena-replay-level-invalid' };
  }
  const validation = validateArenaShotTrace(shotTrace);
  if (!validation.ok) return validation;
  if (shotTrace.length === 0) {
    return {
      ok: true,
      result: {
        replayVersion: ARENA_REPLAY_RULES.replayVersion,
        rulesVersion: ARENA_REPLAY_RULES.rulesVersion,
        score: 0,
        hits: 0,
        shots: 0,
        maxCombo: 0,
        stateChecksum: '0000000000000000',
      },
      outcomes: [],
    };
  }
  const replay = simulateEndlessReplay({
    seed: arenaSeed(seed, level),
    level,
    durationMs: Math.max(
      500,
      shotTrace[shotTrace.length - 1].atMs + ENDLESS_REPLAY_RULES.minimumSettlementMs,
    ),
    shotTrace: shotTrace.map((shot, index) => ({
      sequence: index,
      atMs: shot.atMs,
      angleMilliDegrees: shot.angleMilliDegrees,
    })),
    modifier: null,
    eventBoss: false,
  });
  if (!replay.ok) return { ok: false, error: replay.error, sequence: replay.sequence };
  return {
    ok: true,
    result: {
      replayVersion: ARENA_REPLAY_RULES.replayVersion,
      rulesVersion: ARENA_REPLAY_RULES.rulesVersion,
      score: replay.result.score,
      hits: replay.result.hits,
      shots: replay.result.shots,
      maxCombo: replay.result.maxCombo,
      stateChecksum: replay.result.stateChecksum,
    },
    outcomes: replay.outcomes,
  };
}

export function appendArenaShot({ seed, level, shotTrace, shot }) {
  const nextTrace = [...shotTrace, shot];
  const simulation = simulateArenaReplay({ seed, level, shotTrace: nextTrace });
  return simulation.ok ? { ...simulation, shotTrace: nextTrace } : simulation;
}

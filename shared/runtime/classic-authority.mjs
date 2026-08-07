import {
  ENDLESS_REPLAY_RULES,
  aimLaneForMilliDegrees,
  buildEndlessTargetSequence,
} from './endless-replay.mjs';

/**
 * Server-observed proof rules for classic campaign settlement.
 *
 * The Phaser board predates the shared deterministic replay engine, so this
 * proof deliberately does not pretend to reproduce board state. It provides a
 * bounded, level-seeded input challenge that the server can evaluate without
 * accepting client hit/score claims. A completed proof plus a claimed board
 * win is required for settlement; a win claim on its own has no authority.
 */
export const CLASSIC_AUTHORITY_RULES = Object.freeze({
  rulesVersion: 1,
  ticketTtlMs: 4 * 60 * 60 * 1_000,
  maximumShots: ENDLESS_REPLAY_RULES.maximumShots,
  minimumFirstShotMs: ENDLESS_REPLAY_RULES.minimumFirstShotMs,
  minimumShotIntervalMs: ENDLESS_REPLAY_RULES.minimumShotIntervalMs,
  maximumShotIntervalMs: ENDLESS_REPLAY_RULES.maximumShotIntervalMs,
  maximumFutureLeadMs: 1_500,
  minimumServerReceiptIntervalMs: 100,
  targetToleranceLanes: 4,
});

export function classicAuthorityRequiredShots(level) {
  const normalized = Math.max(0, Math.min(41, Math.trunc(Number(level) || 0)));
  return 2 + Math.floor(normalized / 10);
}

export function classicAuthorityMinimumDurationMs(level) {
  const normalized = Math.max(0, Math.min(41, Math.trunc(Number(level) || 0)));
  return 1_000 + normalized * 50;
}

const authoritySeed = (seed, level) => (
  (Number(seed) ^ Math.imul(Number(level) + 1, 0x27d4eb2d)) >>> 0
) & 0x7fffffff;

export function classicAuthorityTarget({ seed, level, sequence }) {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0x7fffffff) {
    return { ok: false, error: 'classic-authority-seed-invalid' };
  }
  if (!Number.isInteger(level) || level < 0 || level > 41) {
    return { ok: false, error: 'classic-authority-level-invalid' };
  }
  if (!Number.isInteger(sequence) || sequence < 0 || sequence >= CLASSIC_AUTHORITY_RULES.maximumShots) {
    return { ok: false, error: 'classic-authority-sequence-invalid' };
  }
  const target = buildEndlessTargetSequence({
    seed: authoritySeed(seed, level),
    shotCount: sequence + 1,
    modifier: null,
  })[sequence];
  return {
    ok: true,
    target: {
      sequence,
      lane: target.lane,
      angleMilliDegrees: target.angleMilliDegrees,
      toleranceLanes: CLASSIC_AUTHORITY_RULES.targetToleranceLanes,
    },
  };
}

export function evaluateClassicAuthorityTrace({ seed, level, shotTrace }) {
  if (!Array.isArray(shotTrace)) return { ok: false, error: 'classic-authority-trace-required' };
  if (shotTrace.length > CLASSIC_AUTHORITY_RULES.maximumShots) {
    return { ok: false, error: 'classic-authority-shot-limit-exceeded' };
  }
  let previousAtMs = 0;
  let proofHits = 0;
  const outcomes = [];
  for (let sequence = 0; sequence < shotTrace.length; sequence += 1) {
    const shot = shotTrace[sequence];
    if (!shot || typeof shot !== 'object' || Array.isArray(shot)
      || shot.sequence !== sequence || !Number.isInteger(shot.atMs)
      || !Number.isInteger(shot.angleMilliDegrees)) {
      return { ok: false, error: 'classic-authority-trace-shape-invalid', sequence };
    }
    const intervalMs = shot.atMs - previousAtMs;
    const minimumMs = sequence === 0
      ? CLASSIC_AUTHORITY_RULES.minimumFirstShotMs
      : CLASSIC_AUTHORITY_RULES.minimumShotIntervalMs;
    if (intervalMs < minimumMs || intervalMs > CLASSIC_AUTHORITY_RULES.maximumShotIntervalMs) {
      return { ok: false, error: 'classic-authority-cadence-invalid', sequence };
    }
    if (shot.angleMilliDegrees < ENDLESS_REPLAY_RULES.aimMinimumMilliDegrees
      || shot.angleMilliDegrees > ENDLESS_REPLAY_RULES.aimMaximumMilliDegrees) {
      return { ok: false, error: 'classic-authority-aim-invalid', sequence };
    }
    const targetResult = classicAuthorityTarget({ seed, level, sequence });
    if (!targetResult.ok) return targetResult;
    const lane = aimLaneForMilliDegrees(shot.angleMilliDegrees);
    const hit = Math.abs(lane - targetResult.target.lane) <= targetResult.target.toleranceLanes;
    if (hit) proofHits += 1;
    outcomes.push({
      sequence,
      lane,
      targetLane: targetResult.target.lane,
      hit,
    });
    previousAtMs = shot.atMs;
  }
  const requiredShots = classicAuthorityRequiredShots(level);
  const requiredProofHits = 1;
  return {
    ok: true,
    result: {
      rulesVersion: CLASSIC_AUTHORITY_RULES.rulesVersion,
      shots: shotTrace.length,
      proofHits,
      requiredShots,
      requiredProofHits,
      completed: shotTrace.length >= requiredShots && proofHits >= requiredProofHits,
      outcomes,
    },
  };
}

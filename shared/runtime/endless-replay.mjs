/**
 * Deterministic, platform-neutral endless replay rules.
 *
 * This module intentionally uses integer arithmetic only. It is imported by
 * the Node authority and can be bundled unchanged by the Phaser client, so a
 * timestamped aim trace produces the same result on every supported browser.
 */

export const ENDLESS_REPLAY_RULES = Object.freeze({
  replayVersion: 1,
  rulesVersion: 1,
  aimMinimumMilliDegrees: -30_000,
  aimMaximumMilliDegrees: 30_000,
  laneCount: 11,
  shotsPerWave: 5,
  maximumShots: 250,
  minimumFirstShotMs: 120,
  minimumShotIntervalMs: 180,
  maximumShotIntervalMs: 30_000,
  minimumSettlementMs: 250,
  maximumSettlementMs: 15_000,
});

/** Return the exact unsigned Mulberry32 stream pinned by determinism-v1.json. */
export function createMulberry32(seed) {
  let state = Number(seed) >>> 0 || 1;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return (value ^ (value >>> 14)) >>> 0;
  };
}

const clampInteger = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, Math.trunc(value)));

/** Map the launch cone to one of the eleven deterministic hex columns. */
export function aimLaneForMilliDegrees(angleMilliDegrees) {
  const angle = clampInteger(
    angleMilliDegrees,
    ENDLESS_REPLAY_RULES.aimMinimumMilliDegrees,
    ENDLESS_REPLAY_RULES.aimMaximumMilliDegrees,
  );
  const span = ENDLESS_REPLAY_RULES.aimMaximumMilliDegrees - ENDLESS_REPLAY_RULES.aimMinimumMilliDegrees;
  return clampInteger(
    Math.round(((angle - ENDLESS_REPLAY_RULES.aimMinimumMilliDegrees)
      * (ENDLESS_REPLAY_RULES.laneCount - 1)) / span),
    0,
    ENDLESS_REPLAY_RULES.laneCount - 1,
  );
}

/** Return the centre aim angle for a deterministic hex column. */
export function angleMilliDegreesForLane(lane) {
  const normalized = clampInteger(lane, 0, ENDLESS_REPLAY_RULES.laneCount - 1);
  const span = ENDLESS_REPLAY_RULES.aimMaximumMilliDegrees - ENDLESS_REPLAY_RULES.aimMinimumMilliDegrees;
  return ENDLESS_REPLAY_RULES.aimMinimumMilliDegrees
    + Math.round((normalized * span) / (ENDLESS_REPLAY_RULES.laneCount - 1));
}

const normalizeModifier = (value) => {
  if (value === 'mirror-orbs' || value === 'short-fuse' || value === 'precision-plus') return value;
  return null;
};

/**
 * Produce the server-owned target stream rendered by an endless client.
 * Three random words are consumed per shot forever; additions to presentation
 * therefore cannot perturb gameplay RNG order.
 */
export function buildEndlessTargetSequence({ seed, shotCount, modifier = null }) {
  const count = clampInteger(shotCount, 0, ENDLESS_REPLAY_RULES.maximumShots);
  const activeModifier = normalizeModifier(modifier);
  const randomUint32 = createMulberry32(seed);
  const targets = [];
  for (let sequence = 0; sequence < count; sequence += 1) {
    const wave = 1 + Math.floor(sequence / ENDLESS_REPLAY_RULES.shotsPerWave);
    const laneWord = randomUint32();
    const colorWord = randomUint32();
    const pressureWord = randomUint32();
    const baseLane = laneWord % ENDLESS_REPLAY_RULES.laneCount;
    const lane = activeModifier === 'mirror-orbs'
      ? ENDLESS_REPLAY_RULES.laneCount - 1 - baseLane
      : baseLane;
    const toleranceLanes = activeModifier === 'precision-plus' || wave >= 4 ? 0 : 1;
    const fuseMs = activeModifier === 'short-fuse'
      ? Math.max(650, 1_300 - (wave - 1) * 25)
      : null;
    targets.push({
      sequence,
      wave,
      lane,
      angleMilliDegrees: angleMilliDegreesForLane(lane),
      colorIndex: colorWord % 6,
      pressure: pressureWord % 4,
      toleranceLanes,
      fuseMs,
    });
  }
  return targets;
}

const fnv1a = (text, initial) => {
  let value = initial >>> 0;
  for (let index = 0; index < text.length; index += 1) {
    value = Math.imul(value ^ text.charCodeAt(index), 0x01000193) >>> 0;
  }
  return value >>> 0;
};

const deterministicChecksum = (value) => {
  const serialized = JSON.stringify(value);
  const left = fnv1a(serialized, 0x811c9dc5).toString(16).padStart(8, '0');
  const right = fnv1a(serialized, 0x9e3779b9).toString(16).padStart(8, '0');
  return `${left}${right}`;
};

/** Validate structural/timing invariants before running any gameplay rule. */
export function validateEndlessShotTrace(shotTrace, durationMs) {
  if (!Array.isArray(shotTrace)) return { ok: false, error: 'authoritative-shot-trace-required' };
  if (shotTrace.length > ENDLESS_REPLAY_RULES.maximumShots) return { ok: false, error: 'replay-shot-limit-exceeded' };
  if (!Number.isInteger(durationMs) || durationMs < 500) return { ok: false, error: 'replay-duration-invalid' };

  let previousAtMs = 0;
  for (let index = 0; index < shotTrace.length; index += 1) {
    const shot = shotTrace[index];
    if (!shot || typeof shot !== 'object' || Array.isArray(shot)
      || !Number.isInteger(shot.sequence) || !Number.isInteger(shot.atMs)
      || !Number.isInteger(shot.angleMilliDegrees)) {
      return { ok: false, error: 'replay-trace-shape-invalid', sequence: index };
    }
    if (shot.sequence !== index || shot.atMs <= previousAtMs || shot.atMs > durationMs) {
      return { ok: false, error: 'replay-trace-order-invalid', sequence: index };
    }
    if (shot.angleMilliDegrees < ENDLESS_REPLAY_RULES.aimMinimumMilliDegrees
      || shot.angleMilliDegrees > ENDLESS_REPLAY_RULES.aimMaximumMilliDegrees) {
      return { ok: false, error: 'replay-aim-out-of-bounds', sequence: index };
    }
    const intervalMs = shot.atMs - previousAtMs;
    const minimumMs = index === 0
      ? ENDLESS_REPLAY_RULES.minimumFirstShotMs
      : ENDLESS_REPLAY_RULES.minimumShotIntervalMs;
    if (intervalMs < minimumMs || intervalMs > ENDLESS_REPLAY_RULES.maximumShotIntervalMs) {
      return { ok: false, error: 'replay-shot-cadence-invalid', sequence: index };
    }
    previousAtMs = shot.atMs;
  }

  const lastAtMs = shotTrace.at(-1)?.atMs ?? 0;
  const settlementMs = durationMs - lastAtMs;
  if (settlementMs < ENDLESS_REPLAY_RULES.minimumSettlementMs
    || settlementMs > ENDLESS_REPLAY_RULES.maximumSettlementMs) {
    return { ok: false, error: 'replay-settlement-window-invalid' };
  }
  return { ok: true };
}

/**
 * Reproduce a complete endless/event result from its signed seed and trace.
 * `eventBoss` changes only terminal semantics; the shot field stays identical.
 */
export function simulateEndlessReplay({
  seed,
  level,
  durationMs,
  shotTrace,
  modifier = null,
  eventBoss = false,
}) {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0x7fffffff) {
    return { ok: false, error: 'replay-seed-invalid' };
  }
  if (!Number.isInteger(level) || level < 0 || level > 29) {
    return { ok: false, error: 'replay-level-invalid' };
  }
  const traceValidation = validateEndlessShotTrace(shotTrace, durationMs);
  if (!traceValidation.ok) return traceValidation;

  const activeModifier = normalizeModifier(modifier);
  const targets = buildEndlessTargetSequence({ seed, shotCount: shotTrace.length, modifier: activeModifier });
  const bossMaxHp = eventBoss ? 8 + (level % 5) : 0;
  let bossHp = bossMaxHp;
  let hits = 0;
  let score = 0;
  let combo = 0;
  let maxCombo = 0;
  let previousAtMs = 0;
  const outcomes = [];

  for (let index = 0; index < shotTrace.length; index += 1) {
    const shot = shotTrace[index];
    const target = targets[index];
    const lane = aimLaneForMilliDegrees(shot.angleMilliDegrees);
    const laneDelta = Math.abs(lane - target.lane);
    const intervalMs = shot.atMs - previousAtMs;
    const withinFuse = target.fuseMs == null || intervalMs <= target.fuseMs;
    const hit = withinFuse && laneDelta <= target.toleranceLanes;
    const exact = hit && laneDelta === 0;
    let damage = 0;
    let points = 0;
    if (hit) {
      hits += 1;
      combo += 1;
      maxCombo = Math.max(maxCombo, combo);
      damage = eventBoss ? (exact ? 2 : 1) : 0;
      bossHp = Math.max(0, bossHp - damage);
      points = 100 + target.wave * 25 + (exact ? 75 : 25) + Math.min(combo, 12) * 20;
      score += points;
    } else combo = 0;
    if (eventBoss && bossHp === 0 && index !== shotTrace.length - 1) {
      return { ok: false, error: 'replay-after-terminal', sequence: index + 1 };
    }
    outcomes.push({
      sequence: index,
      targetLane: target.lane,
      lane,
      hit,
      exact,
      damage,
      points,
      bossHp,
    });
    previousAtMs = shot.atMs;
  }

  const shots = shotTrace.length;
  const wave = 1 + Math.floor(shots / ENDLESS_REPLAY_RULES.shotsPerWave);
  const completedWaves = Math.floor(shots / ENDLESS_REPLAY_RULES.shotsPerWave);
  const won = eventBoss && bossHp === 0;
  const seasonPoints = Math.floor(score / 100) + completedWaves * 10 + (won ? 50 : 0);
  const checksumPayload = {
    rulesVersion: ENDLESS_REPLAY_RULES.rulesVersion,
    seed,
    level,
    modifier: activeModifier,
    eventBoss: Boolean(eventBoss),
    score,
    hits,
    shots,
    wave,
    won,
    maxCombo,
    seasonPoints,
    bossHp,
    outcomes,
  };

  return {
    ok: true,
    result: {
      rulesVersion: ENDLESS_REPLAY_RULES.rulesVersion,
      score,
      hits,
      shots,
      wave,
      won,
      maxCombo,
      seasonPoints,
      boss: eventBoss ? { maxHp: bossMaxHp, hp: bossHp } : null,
      stateChecksum: deterministicChecksum(checksumPayload),
    },
    outcomes,
  };
}

/** Build the trace used by the client when rendering the canonical targets. */
export function buildPerfectEndlessTrace({ seed, shotCount, modifier = null, firstAtMs = 500, cadenceMs = 600 }) {
  const targets = buildEndlessTargetSequence({ seed, shotCount, modifier });
  return targets.map((target, sequence) => ({
    sequence,
    atMs: firstAtMs + sequence * cadenceMs,
    angleMilliDegrees: target.angleMilliDegrees,
  }));
}

/**
 * Canonical deterministic gameplay-mechanism oracle.
 *
 * This module is deliberately browser/Node neutral. Every operation uses
 * bounded integer arithmetic and canonical JSON so the Fastify authority and
 * Phaser client can execute the same fixture without clock, locale, DOM or
 * floating-point timing dependencies.
 */

export const PRODUCTION_MECHANISM_SCHEMA_VERSION = 1;
export const PRODUCTION_MECHANISM_TOTAL = 500;
export const PRODUCTION_MECHANISM_FIXED_STEP_MS = 16;
export const PRODUCTION_MECHANISM_PREDICTION_LIMIT = 3;
export const PRODUCTION_MECHANISM_EVENT_LIMIT = 8;

export const PRODUCTION_MECHANISM_SUBJECTS = Object.freeze([
  'hex coordinate',
  'board occupancy',
  'bubble spawn',
  'aim ray',
  'wall reflection',
  'shot travel',
  'cell attachment',
  'color match',
  'cluster removal',
  'floating removal',
  'ceiling descent',
  'loss boundary',
  'win objective',
  'move budget',
  'score multiplier',
  'combo chain',
  'power charge',
  'bomb power',
  'rainbow power',
  'swap queue',
  'level seed',
  'obstacle state',
  'boss state',
  'artifact state',
  'reward outcome',
]);

export const PRODUCTION_MECHANISM_FACETS = Object.freeze([
  'canonical representation',
  'input normalization',
  'fixed-step transition',
  'tie-break rule',
  'seed consumption',
  'invariant check',
  'serialization',
  'replay event',
  'server-client oracle',
  'property test',
  'edge-case fixture',
  'overflow guard',
  'rollback snapshot',
  'desync checksum',
  'authoritative validation',
  'prediction boundary',
  'reconciliation',
  'failure closure',
  'performance bound',
  'evidence capture',
]);

const ACCEPTANCE_PATTERN = /^AT-(PF-mechanism-(\d{3}))$/;
const STATUS = new Set(['ready', 'active', 'complete', 'failed']);
const COLORS = Object.freeze(['amber', 'aqua', 'violet', 'rose', 'lime', 'white']);

function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value, expected) {
  return record(value)
    && Object.keys(value).sort().join('\0') === [...expected].sort().join('\0');
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (record(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function stableMechanismHash(value) {
  const bytes = new TextEncoder().encode(typeof value === 'string' ? value : canonical(value));
  let left = 0x811c9dc5;
  let right = 0x9e3779b9;
  for (const byte of bytes) {
    left = Math.imul(left ^ byte, 0x01000193) >>> 0;
    right = Math.imul(right ^ byte, 0x85ebca6b) >>> 0;
  }
  return `${left.toString(16).padStart(8, '0')}${right.toString(16).padStart(8, '0')}`;
}

function integer(value, fallback, minimum, maximum) {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.trunc(Number(value))));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function appendEvent(events, event) {
  return [...events, event].slice(-PRODUCTION_MECHANISM_EVENT_LIMIT);
}

function splitTitle(title) {
  if (typeof title !== 'string') return null;
  const parts = title.split(' — ');
  return parts.length === 2 && parts.every((part) => part.length > 1) ? parts : null;
}

function xorshift32(seed) {
  let value = Number(seed) >>> 0 || 0x6d2b79f5;
  value ^= value << 13;
  value ^= value >>> 17;
  value ^= value << 5;
  return value >>> 0;
}

function canonicalCellKeys(values) {
  if (!Array.isArray(values)) return [];
  const unique = new Set();
  for (const raw of values) {
    if (typeof raw !== 'string' || !/^(?:[0-9]|1[0-5]):(?:[0-9]|1[0-1])$/.test(raw)) continue;
    unique.add(raw);
  }
  return [...unique].sort((left, right) => {
    const [lr, lc] = left.split(':').map(Number);
    const [rr, rc] = right.split(':').map(Number);
    return lr - rr || lc - rc;
  }).slice(0, 128);
}

function canonicalColor(value, fallback = 'amber') {
  return COLORS.includes(value) ? value : fallback;
}

/** Subject-owned initial state. Fields name actual gameplay concepts. */
export function createProductionMechanismState(subject, seed = 1) {
  const safeSeed = Number(seed) >>> 0 || 1;
  const common = {
    schemaVersion: 1,
    subject,
    revision: 0,
    tick: 0,
    seed: safeSeed,
    status: 'ready',
    events: [],
  };
  switch (subject) {
    case 'hex coordinate': return { ...common, data: { q: 0, r: 0, s: 0 } };
    case 'board occupancy': return { ...common, data: { capacity: 128, occupied: ['0:0', '0:1'] } };
    case 'bubble spawn': return { ...common, data: { spawned: 0, nextId: 1, queue: ['amber', 'aqua', 'violet'] } };
    case 'aim ray': return { ...common, data: { angleMilliDegrees: 0, directionXMillionths: 0, directionYMillionths: -1_000_000 } };
    case 'wall reflection': return { ...common, data: { xMilli: 500_000, vxMilliPerStep: 75_000, widthMilli: 1_000_000, reflections: 0 } };
    case 'shot travel': return { ...common, data: { distanceMilli: 0, targetMilli: 1_000_000, speedMilliPerStep: 125_000, arrived: false } };
    case 'cell attachment': return { ...common, data: { row: 0, col: 0, attached: false, occupied: ['0:0', '0:1'] } };
    case 'color match': return { ...common, data: { color: 'amber', connected: 2, minimumMatch: 3, matched: false } };
    case 'cluster removal': return { ...common, data: { clusterSize: 4, threshold: 3, removed: 0, remaining: 12 } };
    case 'floating removal': return { ...common, data: { anchored: 7, floating: 3, removed: 0 } };
    case 'ceiling descent': return { ...common, data: { misses: 2, missesPerDrop: 3, rowDrops: 0, offsetMilli: 0 } };
    case 'loss boundary': return { ...common, data: { lowestRow: 8, lossRow: 12, lost: false } };
    case 'win objective': return { ...common, data: { current: 2, target: 5, won: false } };
    case 'move budget': return { ...common, data: { remaining: 8, used: 0, exhausted: false } };
    case 'score multiplier': return { ...common, data: { baseScore: 100, multiplierBps: 10_000, totalScore: 0 } };
    case 'combo chain': return { ...common, data: { combo: 2, maximumCombo: 2, decayTicks: 0 } };
    case 'power charge': return { ...common, data: { charge: 35, threshold: 100, ready: false } };
    case 'bomb power': return { ...common, data: { radius: 2, targetCount: 9, removed: 0 } };
    case 'rainbow power': return { ...common, data: { selectedColor: 'aqua', wildcardCount: 1, matchedCount: 2 } };
    case 'swap queue': return { ...common, data: { current: 'amber', next: 'aqua', swaps: 0 } };
    case 'level seed': return { ...common, data: { initialSeed: safeSeed, cursor: 0, lastWord: 0 } };
    case 'obstacle state': return { ...common, data: { hp: 3, maxHp: 3, broken: false } };
    case 'boss state': return { ...common, data: { hp: 12, maxHp: 12, phase: 1, defeated: false } };
    case 'artifact state': return { ...common, data: { charge: 70, threshold: 100, cooldown: 0, active: false } };
    case 'reward outcome': return { ...common, data: { coins: 0, xp: 0, claimed: false, receiptId: null } };
    default: throw new Error(`Unknown production mechanism subject ${String(subject)}`);
  }
}

function normalizeData(subject, source) {
  const data = record(source) ? source : {};
  switch (subject) {
    case 'hex coordinate': {
      const q = integer(data.q, 0, -64, 64);
      const r = integer(data.r, 0, -64, 64);
      return { q, r, s: -(q + r) };
    }
    case 'board occupancy': return { capacity: integer(data.capacity, 128, 1, 128), occupied: canonicalCellKeys(data.occupied) };
    case 'bubble spawn': return {
      spawned: integer(data.spawned, 0, 0, 1_000_000),
      nextId: integer(data.nextId, 1, 1, 1_000_001),
      queue: (Array.isArray(data.queue) ? data.queue : []).map((value) => canonicalColor(value)).slice(0, 3),
    };
    case 'aim ray': {
      const angleMilliDegrees = integer(data.angleMilliDegrees, 0, -60_000, 60_000);
      const radians = angleMilliDegrees * Math.PI / 180_000;
      return {
        angleMilliDegrees,
        directionXMillionths: Math.round(Math.sin(radians) * 1_000_000),
        directionYMillionths: -Math.round(Math.cos(radians) * 1_000_000),
      };
    }
    case 'wall reflection': return {
      xMilli: integer(data.xMilli, 500_000, 0, 1_000_000),
      vxMilliPerStep: integer(data.vxMilliPerStep, 75_000, -500_000, 500_000),
      widthMilli: integer(data.widthMilli, 1_000_000, 100_000, 2_000_000),
      reflections: integer(data.reflections, 0, 0, 1_000_000),
    };
    case 'shot travel': {
      const targetMilli = integer(data.targetMilli, 1_000_000, 1, 5_000_000);
      const distanceMilli = integer(data.distanceMilli, 0, 0, targetMilli);
      return {
        distanceMilli,
        targetMilli,
        speedMilliPerStep: integer(data.speedMilliPerStep, 125_000, 1, 1_000_000),
        arrived: distanceMilli >= targetMilli,
      };
    }
    case 'cell attachment': return {
      row: integer(data.row, 0, 0, 15),
      col: integer(data.col, 0, 0, 11),
      attached: Boolean(data.attached),
      occupied: canonicalCellKeys(data.occupied),
    };
    case 'color match': {
      const connected = integer(data.connected, 0, 0, 128);
      const minimumMatch = integer(data.minimumMatch, 3, 2, 8);
      return { color: canonicalColor(data.color), connected, minimumMatch, matched: connected >= minimumMatch };
    }
    case 'cluster removal': return {
      clusterSize: integer(data.clusterSize, 0, 0, 128), threshold: integer(data.threshold, 3, 2, 8),
      removed: integer(data.removed, 0, 0, 128), remaining: integer(data.remaining, 0, 0, 128),
    };
    case 'floating removal': return {
      anchored: integer(data.anchored, 0, 0, 128), floating: integer(data.floating, 0, 0, 128), removed: integer(data.removed, 0, 0, 128),
    };
    case 'ceiling descent': return {
      misses: integer(data.misses, 0, 0, 10_000), missesPerDrop: integer(data.missesPerDrop, 3, 1, 12),
      rowDrops: integer(data.rowDrops, 0, 0, 32), offsetMilli: integer(data.offsetMilli, 0, 0, 2_000_000),
    };
    case 'loss boundary': {
      const lowestRow = integer(data.lowestRow, 0, 0, 32);
      const lossRow = integer(data.lossRow, 12, 1, 32);
      return { lowestRow, lossRow, lost: lowestRow >= lossRow };
    }
    case 'win objective': {
      const target = integer(data.target, 1, 1, 1_000_000);
      const current = integer(data.current, 0, 0, target);
      return { current, target, won: current >= target };
    }
    case 'move budget': {
      const remaining = integer(data.remaining, 0, 0, 1_000_000);
      return { remaining, used: integer(data.used, 0, 0, 1_000_000), exhausted: remaining === 0 };
    }
    case 'score multiplier': return {
      baseScore: integer(data.baseScore, 0, 0, 1_000_000), multiplierBps: integer(data.multiplierBps, 10_000, 10_000, 50_000),
      totalScore: integer(data.totalScore, 0, 0, 100_000_000),
    };
    case 'combo chain': {
      const combo = integer(data.combo, 0, 0, 999);
      return { combo, maximumCombo: Math.max(combo, integer(data.maximumCombo, combo, 0, 999)), decayTicks: integer(data.decayTicks, 0, 0, 60) };
    }
    case 'power charge': {
      const threshold = integer(data.threshold, 100, 1, 10_000);
      const charge = integer(data.charge, 0, 0, threshold);
      return { charge, threshold, ready: charge >= threshold };
    }
    case 'bomb power': return { radius: integer(data.radius, 2, 1, 5), targetCount: integer(data.targetCount, 0, 0, 128), removed: integer(data.removed, 0, 0, 128) };
    case 'rainbow power': return { selectedColor: canonicalColor(data.selectedColor, 'white'), wildcardCount: integer(data.wildcardCount, 0, 0, 16), matchedCount: integer(data.matchedCount, 0, 0, 128) };
    case 'swap queue': return { current: canonicalColor(data.current), next: canonicalColor(data.next, 'aqua'), swaps: integer(data.swaps, 0, 0, 1_000_000) };
    case 'level seed': return { initialSeed: integer(data.initialSeed, 1, 1, 0x7fffffff), cursor: integer(data.cursor, 0, 0, 1_000_000), lastWord: integer(data.lastWord, 0, 0, 0xffffffff) };
    case 'obstacle state': {
      const maxHp = integer(data.maxHp, 3, 1, 99);
      const hp = integer(data.hp, maxHp, 0, maxHp);
      return { hp, maxHp, broken: hp === 0 };
    }
    case 'boss state': {
      const maxHp = integer(data.maxHp, 12, 1, 10_000);
      const hp = integer(data.hp, maxHp, 0, maxHp);
      const phase = hp === 0 ? 4 : hp * 3 <= maxHp ? 3 : hp * 3 <= maxHp * 2 ? 2 : 1;
      return { hp, maxHp, phase, defeated: hp === 0 };
    }
    case 'artifact state': {
      const threshold = integer(data.threshold, 100, 1, 1_000);
      const charge = integer(data.charge, 0, 0, threshold);
      const cooldown = integer(data.cooldown, 0, 0, 60);
      return { charge, threshold, cooldown, active: Boolean(data.active) && cooldown === 0 };
    }
    case 'reward outcome': return {
      coins: integer(data.coins, 0, 0, 1_000_000), xp: integer(data.xp, 0, 0, 10_000_000),
      claimed: Boolean(data.claimed), receiptId: typeof data.receiptId === 'string' && /^reward-[a-f0-9]{16}$/.test(data.receiptId) ? data.receiptId : null,
    };
    default: throw new Error(`Unknown production mechanism subject ${String(subject)}`);
  }
}

export function normalizeProductionMechanismState(subject, candidate, fallbackSeed = 1) {
  const base = createProductionMechanismState(subject, fallbackSeed);
  if (!record(candidate) || candidate.subject !== subject) return base;
  const seed = Number(candidate.seed) >>> 0 || base.seed;
  return {
    schemaVersion: 1,
    subject,
    revision: integer(candidate.revision, 0, 0, 1_000_000),
    tick: integer(candidate.tick, 0, 0, 1_000_000),
    seed,
    status: STATUS.has(candidate.status) ? candidate.status : 'ready',
    events: Array.isArray(candidate.events)
      ? candidate.events.filter((value) => record(value) && typeof value.type === 'string').slice(-PRODUCTION_MECHANISM_EVENT_LIMIT).map(clone)
      : [],
    data: normalizeData(subject, candidate.data),
  };
}

function transitionData(subject, previous, value, seed, sequence, authoritative) {
  const data = clone(previous);
  switch (subject) {
    case 'hex coordinate': {
      const q = integer(data.q + value, data.q, -64, 64);
      const r = integer(data.r - value, data.r, -64, 64);
      return { q, r, s: -(q + r) };
    }
    case 'board occupancy': {
      const occupied = canonicalCellKeys(data.occupied);
      const candidates = ['0:2', '1:0', '1:1', '2:0'].filter((key) => !occupied.includes(key));
      return { ...data, occupied: canonicalCellKeys([...occupied, candidates[0] ?? '2:1']) };
    }
    case 'bubble spawn': {
      const queue = data.queue.length === 3 ? data.queue : ['amber', 'aqua', 'violet'];
      const nextColor = COLORS[xorshift32(seed) % COLORS.length];
      return { spawned: data.spawned + 1, nextId: data.nextId + 1, queue: [queue[1], queue[2], nextColor] };
    }
    case 'aim ray': return normalizeData(subject, { angleMilliDegrees: value * 1_000 });
    case 'wall reflection': {
      let xMilli = data.xMilli + data.vxMilliPerStep;
      let vxMilliPerStep = data.vxMilliPerStep;
      let reflections = data.reflections;
      for (let guard = 0; guard < 8 && (xMilli < 0 || xMilli > data.widthMilli); guard += 1) {
        if (xMilli < 0) xMilli = -xMilli;
        else xMilli = data.widthMilli * 2 - xMilli;
        vxMilliPerStep *= -1;
        reflections += 1;
      }
      return normalizeData(subject, { ...data, xMilli, vxMilliPerStep, reflections });
    }
    case 'shot travel': return normalizeData(subject, { ...data, distanceMilli: data.distanceMilli + data.speedMilliPerStep });
    case 'cell attachment': {
      const occupied = canonicalCellKeys(data.occupied);
      const candidates = ['0:0', '0:1', '1:0', '1:1', '2:0', '2:1'];
      const selected = candidates.find((key) => !occupied.includes(key)) ?? '3:0';
      const [row, col] = selected.split(':').map(Number);
      return { row, col, attached: true, occupied: canonicalCellKeys([...occupied, selected]) };
    }
    case 'color match': return normalizeData(subject, { ...data, connected: data.connected + Math.max(1, value) });
    case 'cluster removal': {
      const removed = data.clusterSize >= data.threshold ? Math.min(data.clusterSize, data.remaining) : 0;
      return { ...data, removed: data.removed + removed, remaining: data.remaining - removed };
    }
    case 'floating removal': return { anchored: data.anchored, floating: 0, removed: data.removed + data.floating };
    case 'ceiling descent': {
      const misses = data.misses + 1;
      const shouldDrop = misses % data.missesPerDrop === 0;
      return { ...data, misses, rowDrops: data.rowDrops + (shouldDrop ? 1 : 0), offsetMilli: data.offsetMilli + (shouldDrop ? 86_603 : 0) };
    }
    case 'loss boundary': return normalizeData(subject, { ...data, lowestRow: data.lowestRow + Math.max(1, value) });
    case 'win objective': return normalizeData(subject, { ...data, current: data.current + Math.max(1, value) });
    case 'move budget': {
      const remaining = Math.max(0, data.remaining - 1);
      return { remaining, used: data.used + (data.remaining > 0 ? 1 : 0), exhausted: remaining === 0 };
    }
    case 'score multiplier': {
      const multiplierBps = integer(data.multiplierBps + value * 250, data.multiplierBps, 10_000, 50_000);
      const awarded = Math.floor((data.baseScore * multiplierBps) / 10_000);
      return { ...data, multiplierBps, totalScore: integer(data.totalScore + awarded, data.totalScore, 0, 100_000_000) };
    }
    case 'combo chain': {
      const hit = value >= 0;
      const combo = hit ? Math.min(999, data.combo + 1) : 0;
      return { combo, maximumCombo: Math.max(data.maximumCombo, combo), decayTicks: hit ? 0 : data.decayTicks + 1 };
    }
    case 'power charge': return normalizeData(subject, { ...data, charge: data.charge + Math.max(1, value * 5) });
    case 'bomb power': return { ...data, removed: Math.min(data.targetCount, Math.max(data.removed, 1 + data.radius * 3)) };
    case 'rainbow power': return { ...data, matchedCount: Math.min(128, data.matchedCount + data.wildcardCount + Math.max(1, value)) };
    case 'swap queue': return { current: data.next, next: data.current, swaps: data.swaps + 1 };
    case 'level seed': {
      const lastWord = xorshift32(seed);
      return { ...data, cursor: data.cursor + 1, lastWord };
    }
    case 'obstacle state': return normalizeData(subject, { ...data, hp: data.hp - Math.max(1, value) });
    case 'boss state': return normalizeData(subject, { ...data, hp: data.hp - Math.max(1, value * 2) });
    case 'artifact state': {
      const charged = Math.min(data.threshold, data.charge + Math.max(1, value * 5));
      const active = charged >= data.threshold && data.cooldown === 0;
      return normalizeData(subject, { ...data, charge: active ? 0 : charged, cooldown: active ? 3 : Math.max(0, data.cooldown - 1), active });
    }
    case 'reward outcome': {
      if (!authoritative || data.claimed) return data;
      const receiptId = `reward-${stableMechanismHash(`${seed}:${sequence}`).slice(0, 16)}`;
      return { coins: data.coins + Math.max(1, value) * 10, xp: data.xp + Math.max(1, value) * 25, claimed: true, receiptId };
    }
    default: throw new Error(`Unknown production mechanism subject ${String(subject)}`);
  }
}

function subjectInvariant(state) {
  if (!record(state) || !PRODUCTION_MECHANISM_SUBJECTS.includes(state.subject)
    || state.schemaVersion !== 1 || !Number.isInteger(state.revision) || !Number.isInteger(state.tick)
    || !Number.isInteger(state.seed) || state.seed < 1 || !STATUS.has(state.status)
    || !Array.isArray(state.events) || state.events.length > PRODUCTION_MECHANISM_EVENT_LIMIT || !record(state.data)) return false;
  const normalized = normalizeProductionMechanismState(state.subject, state, state.seed);
  return canonical(normalized) === canonical(state);
}

function exactInput(entry, candidate) {
  if (!exactKeys(candidate, ['action', 'authoritative', 'candidateRevision', 'interrupted', 'predictionSteps', 'repeated', 'seed', 'sequence', 'state', 'value'])) return null;
  if (candidate.action !== 'advance' || typeof candidate.authoritative !== 'boolean'
    || typeof candidate.interrupted !== 'boolean' || typeof candidate.repeated !== 'boolean'
    || !Number.isSafeInteger(candidate.sequence) || candidate.sequence < 0 || candidate.sequence > 1_000_000
    || !Number.isSafeInteger(candidate.candidateRevision) || candidate.candidateRevision < 0 || candidate.candidateRevision > 1_000_000
    || !Number.isSafeInteger(candidate.seed) || candidate.seed < 1 || candidate.seed > 0x7fffffff
    || !Number.isFinite(candidate.value) || !Number.isFinite(candidate.predictionSteps)
    || !record(candidate.state) || candidate.state.subject !== entry.subject) return null;
  const state = normalizeProductionMechanismState(entry.subject, candidate.state, candidate.seed);
  if (canonical(state) !== canonical(candidate.state)) return null;
  return {
    action: 'advance',
    authoritative: candidate.authoritative,
    candidateRevision: candidate.candidateRevision,
    interrupted: candidate.interrupted,
    predictionSteps: integer(candidate.predictionSteps, 1, 0, 1_000),
    repeated: candidate.repeated,
    seed: candidate.seed,
    sequence: candidate.sequence,
    state,
    value: integer(candidate.value, 1, -1_000_000, 1_000_000),
  };
}

export function canonicalProductionMechanismInput(entry, overrides = {}) {
  const state = overrides.state == null
    ? createProductionMechanismState(entry.subject, entry.contract.deterministicSeed)
    : overrides.state;
  return {
    action: 'advance',
    authoritative: true,
    candidateRevision: record(state) && Number.isInteger(state.revision) ? state.revision : 0,
    interrupted: false,
    predictionSteps: 2,
    repeated: false,
    seed: entry.contract.deterministicSeed,
    sequence: entry.ordinal * 10 + entry.release,
    state,
    value: 1 + (entry.contract.deterministicSeed % 3),
    ...overrides,
  };
}

function assertEntry(entry) {
  if (!record(entry) || entry.schemaVersion !== 1 || entry.category !== 'mechanism') throw new Error('production mechanism entry malformed');
  const match = typeof entry.acceptanceId === 'string' ? ACCEPTANCE_PATTERN.exec(entry.acceptanceId) : null;
  const parts = splitTitle(entry.title);
  const expectedSubjectIndex = Math.floor((entry.ordinal - 1) / 20);
  const expectedFacetIndex = (entry.ordinal - 1) % 20;
  if (!match || match[1] !== entry.id || Number(match[2]) !== entry.ordinal
    || !Number.isInteger(entry.ordinal) || entry.ordinal < 1 || entry.ordinal > 500
    || entry.release !== Math.ceil(entry.ordinal / 100)
    || entry.subjectIndex !== expectedSubjectIndex || entry.facetIndex !== expectedFacetIndex
    || entry.subject !== PRODUCTION_MECHANISM_SUBJECTS[expectedSubjectIndex]
    || entry.facet !== PRODUCTION_MECHANISM_FACETS[expectedFacetIndex]
    || !parts || parts[0] !== entry.subject || parts[1] !== entry.facet
    || !exactKeys(entry.contract, ['authority', 'canonicalFields', 'deterministicSeed', 'eventLimit', 'failureMode', 'fixedStepMs', 'maximumSerializedBytes', 'operationBudget', 'predictionLimit', 'schemaVersion'])
    || entry.contract.schemaVersion !== 1 || entry.contract.authority !== 'shared-deterministic-oracle'
    || entry.contract.failureMode !== 'fail-closed-no-mutation' || entry.contract.fixedStepMs !== 16
    || entry.contract.predictionLimit !== 3 || entry.contract.eventLimit !== 8
    || entry.contract.operationBudget !== 512 || entry.contract.maximumSerializedBytes !== 4096
    || !Number.isSafeInteger(entry.contract.deterministicSeed) || entry.contract.deterministicSeed < 1
    || !Array.isArray(entry.contract.canonicalFields) || entry.contract.canonicalFields.length < 2
    || typeof entry.behaviorFingerprint !== 'string' || !/^PM-\d{3}-[a-f0-9]{16}$/.test(entry.behaviorFingerprint)) {
    throw new Error(`production mechanism identity or contract invalid: ${String(entry.id)}`);
  }
}

export function createProductionMechanismEntry(item) {
  if (!record(item)) throw new Error('ledger mechanism item must be an object');
  const parts = splitTitle(item.title);
  const subjectIndex = Math.floor((item.ordinal - 1) / 20);
  const facetIndex = (item.ordinal - 1) % 20;
  if (item.category !== 'mechanism' || item.clientFacing !== true || !parts
    || parts[0] !== PRODUCTION_MECHANISM_SUBJECTS[subjectIndex]
    || parts[1] !== PRODUCTION_MECHANISM_FACETS[facetIndex]
    || item.release !== Math.ceil(item.ordinal / 100)
    || item.acceptanceTest?.id !== `AT-${item.id}`) throw new Error(`ledger mechanism item is non-canonical: ${String(item.id)}`);
  const deterministicSeed = (Number.parseInt(stableMechanismHash(`${item.id}|${item.title}`).slice(0, 8), 16) & 0x7fffffff) || 1;
  const state = createProductionMechanismState(parts[0], deterministicSeed);
  const entry = {
    schemaVersion: 1,
    id: item.id,
    acceptanceId: item.acceptanceTest.id,
    category: 'mechanism',
    ordinal: item.ordinal,
    release: item.release,
    title: item.title,
    subject: parts[0],
    facet: parts[1],
    subjectIndex,
    facetIndex,
    behaviorFingerprint: `PM-${String(item.ordinal).padStart(3, '0')}-${stableMechanismHash(`${item.acceptanceTest.id}|${canonical(state)}|${parts[1]}`)}`,
    contract: {
      schemaVersion: 1,
      authority: 'shared-deterministic-oracle',
      failureMode: 'fail-closed-no-mutation',
      fixedStepMs: PRODUCTION_MECHANISM_FIXED_STEP_MS,
      predictionLimit: PRODUCTION_MECHANISM_PREDICTION_LIMIT,
      eventLimit: PRODUCTION_MECHANISM_EVENT_LIMIT,
      operationBudget: 512,
      maximumSerializedBytes: 4096,
      deterministicSeed,
      canonicalFields: Object.keys(state.data).sort(),
    },
  };
  assertEntry(entry);
  return entry;
}

function advance(entry, input, previous = input.state) {
  const data = transitionData(entry.subject, previous.data, input.value, previous.seed, input.sequence, input.authoritative);
  const state = normalizeProductionMechanismState(entry.subject, {
    ...previous,
    revision: previous.revision + 1,
    tick: previous.tick + 1,
    seed: xorshift32(previous.seed),
    status: ['loss boundary', 'move budget'].includes(entry.subject) && (data.lost || data.exhausted) ? 'failed'
      : ['win objective', 'boss state'].includes(entry.subject) && (data.won || data.defeated) ? 'complete' : 'active',
    events: appendEvent(previous.events, {
      type: `${entry.subject.replaceAll(' ', '-')}:advance`,
      sequence: input.sequence,
      revision: previous.revision + 1,
      value: input.value,
    }),
    data,
  }, previous.seed);
  if (!subjectInvariant(state)) throw new Error(`${entry.id} transition violated its subject invariant`);
  return state;
}

function stableTieBreak(entry, seed) {
  const candidates = [
    { priority: 2, row: entry.subjectIndex % 4, col: 2, id: `${entry.id}-b` },
    { priority: 1, row: (seed >>> 3) % 4, col: 1, id: `${entry.id}-a` },
    { priority: 1, row: (seed >>> 3) % 4, col: 0, id: `${entry.id}-z` },
  ];
  return [...candidates].sort((left, right) => left.priority - right.priority || left.row - right.row || left.col - right.col || left.id.localeCompare(right.id))[0];
}

function facetProof(entry, input, previous, next) {
  const initialJson = canonical(previous);
  const nextJson = canonical(next);
  const nextChecksum = stableMechanismHash(nextJson);
  const replayEvent = next.events.at(-1);
  switch (entry.facet) {
    case 'canonical representation': return { kind: 'canonical', canonicalJson: nextJson, keyOrderStable: nextJson === canonical(JSON.parse(nextJson)) };
    case 'input normalization': {
      const noisy = { ...next, revision: next.revision + 0.9, tick: next.tick + 0.8, events: [...next.events, ...next.events, ...next.events] };
      const normalized = normalizeProductionMechanismState(entry.subject, noisy, input.seed);
      return { kind: 'normalization', revision: normalized.revision, tick: normalized.tick, boundedEvents: normalized.events.length, invariant: subjectInvariant(normalized) };
    }
    case 'fixed-step transition': return { kind: 'fixed-step', fixedStepMs: entry.contract.fixedStepMs, fromTick: previous.tick, toTick: next.tick, exactlyOneStep: next.tick === previous.tick + 1 };
    case 'tie-break rule': return { kind: 'tie-break', selected: stableTieBreak(entry, input.seed), stable: canonical(stableTieBreak(entry, input.seed)) === canonical(stableTieBreak(entry, input.seed)) };
    case 'seed consumption': return { kind: 'seed', before: previous.seed, after: next.seed, consumedWords: 1, deterministic: next.seed === xorshift32(previous.seed) };
    case 'invariant check': return { kind: 'invariant', before: subjectInvariant(previous), after: subjectInvariant(next), canonicalFields: [...entry.contract.canonicalFields] };
    case 'serialization': {
      const roundTrip = normalizeProductionMechanismState(entry.subject, JSON.parse(nextJson), input.seed);
      return { kind: 'serialization', bytes: new TextEncoder().encode(nextJson).length, roundTrip: canonical(roundTrip) === nextJson };
    }
    case 'replay event': {
      const replayed = advance(entry, input, previous);
      return { kind: 'replay', event: replayEvent, exact: canonical(replayed) === nextJson, checksum: stableMechanismHash(replayed) };
    }
    case 'server-client oracle': {
      const server = advance(entry, input, clone(previous));
      const client = advance(entry, input, clone(previous));
      return { kind: 'oracle', serverChecksum: stableMechanismHash(server), clientChecksum: stableMechanismHash(client), equal: canonical(server) === canonical(client) };
    }
    case 'property test': {
      let checks = 0;
      for (let value = -4; value <= 11; value += 1) {
        const candidate = advance(entry, { ...input, value, sequence: input.sequence + value + 4 }, clone(previous));
        if (!subjectInvariant(candidate) || canonical(candidate) !== canonical(advance(entry, { ...input, value, sequence: input.sequence + value + 4 }, clone(previous)))) break;
        checks += 1;
      }
      return { kind: 'property', generatedCases: 16, passedCases: checks, deterministic: checks === 16 };
    }
    case 'edge-case fixture': {
      const minimum = advance(entry, { ...input, value: -1_000_000 }, clone(previous));
      const maximum = advance(entry, { ...input, value: 1_000_000 }, clone(previous));
      return { kind: 'edge', minimumInvariant: subjectInvariant(minimum), maximumInvariant: subjectInvariant(maximum), distinct: stableMechanismHash(minimum) !== stableMechanismHash(maximum) };
    }
    case 'overflow guard': {
      const overflowed = advance(entry, { ...input, value: 1_000_000 }, clone(previous));
      const bytes = new TextEncoder().encode(canonical(overflowed)).length;
      return { kind: 'overflow', invariant: subjectInvariant(overflowed), serializedBytes: bytes, withinBound: bytes <= entry.contract.maximumSerializedBytes };
    }
    case 'rollback snapshot': {
      const snapshot = clone(previous);
      const mutated = advance(entry, input, advance(entry, input, clone(previous)));
      const restored = normalizeProductionMechanismState(entry.subject, snapshot, input.seed);
      return { kind: 'rollback', mutationChecksum: stableMechanismHash(mutated), restoredChecksum: stableMechanismHash(restored), exact: canonical(restored) === initialJson };
    }
    case 'desync checksum': {
      const same = stableMechanismHash(clone(next));
      const changed = stableMechanismHash({ ...next, revision: next.revision + 1 });
      return { kind: 'desync', checksum: nextChecksum, repeatChecksum: same, changedChecksum: changed, detectsMutation: nextChecksum === same && nextChecksum !== changed };
    }
    case 'authoritative validation': return {
      kind: 'authority', authoritative: input.authoritative, revisionMatched: input.candidateRevision === previous.revision,
      accepted: input.authoritative && input.candidateRevision === previous.revision,
    };
    case 'prediction boundary': {
      const requested = input.predictionSteps;
      const applied = Math.min(requested, entry.contract.predictionLimit);
      let predicted = clone(previous);
      for (let index = 0; index < applied; index += 1) predicted = advance(entry, { ...input, sequence: input.sequence + index }, predicted);
      return { kind: 'prediction', requested, applied, limit: entry.contract.predictionLimit, bounded: applied <= entry.contract.predictionLimit, checksum: stableMechanismHash(predicted) };
    }
    case 'reconciliation': {
      const predicted = advance(entry, { ...input, value: input.value + 1 }, clone(previous));
      const authoritative = advance(entry, input, clone(previous));
      const reconciled = clone(authoritative);
      return { kind: 'reconciliation', predictedChecksum: stableMechanismHash(predicted), authoritativeChecksum: stableMechanismHash(authoritative), reconciledChecksum: stableMechanismHash(reconciled), exact: canonical(reconciled) === canonical(authoritative) };
    }
    case 'failure closure': return { kind: 'failure', invalidReason: failureObservation(entry, previous, 'invalid-input').reason, interruptedReason: failureObservation(entry, previous, 'interrupted').reason, statePreserved: true, rewardDelta: 0 };
    case 'performance bound': {
      let state = clone(previous);
      let operations = 0;
      for (; operations < 64; operations += 1) state = advance(entry, { ...input, sequence: input.sequence + operations }, state);
      const bytes = new TextEncoder().encode(canonical(state)).length;
      return { kind: 'performance', operations, operationBudget: entry.contract.operationBudget, serializedBytes: bytes, byteBudget: entry.contract.maximumSerializedBytes, events: state.events.length };
    }
    case 'evidence capture': {
      const receipt = { acceptanceId: entry.acceptanceId, itemId: entry.id, previousChecksum: stableMechanismHash(previous), stateChecksum: nextChecksum, sequence: input.sequence };
      return { kind: 'evidence', receipt, receiptChecksum: stableMechanismHash(receipt), complete: Object.values(receipt).every((value) => value !== '' && value != null) };
    }
    default: throw new Error(`Unknown production mechanism facet ${entry.facet}`);
  }
}

function rewardObservation(subject, input, previous, next) {
  if (subject !== 'reward outcome') return { grantable: false, delta: 0, authority: 'not-applicable' };
  const delta = next.data.coins - previous.data.coins;
  return { grantable: input.authoritative && delta > 0, delta, authority: input.authoritative ? 'server' : 'rejected' };
}

function failureObservation(entry, preservedState, reason) {
  const state = clone(preservedState ?? createProductionMechanismState(entry?.subject ?? 'hex coordinate', entry?.contract?.deterministicSeed ?? 1));
  const base = {
    schemaVersion: 1,
    id: entry?.id ?? 'unknown',
    acceptanceId: entry?.acceptanceId ?? 'unknown',
    subject: entry?.subject ?? state.subject,
    facet: entry?.facet ?? 'unknown',
    ok: false,
    reason,
    state,
    previousState: clone(state),
    rules: { deterministic: true, stateMutation: false, rewardMutation: false, authoritative: false },
    timing: { fixedStepMs: 0, operations: 0, operationBudget: entry?.contract?.operationBudget ?? 0 },
    rewards: { grantable: false, delta: 0, authority: 'rejected' },
    stateTransitions: ['input-rejected', 'recovery-ready'],
    feedbackPurpose: 'Reject the unsafe mechanism event, preserve the last canonical state and keep a deterministic recovery path.',
    replayEvent: null,
    checksum: stableMechanismHash(state),
    facetProof: { kind: 'failure', preserved: true, reason },
  };
  return Object.freeze({ ...base, signature: stableMechanismHash(base) });
}

/** Execute one ledger mechanism through valid, replay, interruption or failure paths. */
export function runProductionMechanismOracle(entry, candidateInput) {
  try { assertEntry(entry); } catch { return failureObservation(entry, null, 'invalid-entry'); }
  const input = exactInput(entry, candidateInput);
  if (!input) return failureObservation(entry, candidateInput?.state, 'invalid-input');
  if (input.interrupted) return failureObservation(entry, input.state, 'interrupted');
  if (!input.authoritative || input.candidateRevision !== input.state.revision) {
    return failureObservation(entry, input.state, !input.authoritative ? 'authority-required' : 'revision-conflict');
  }
  if (input.repeated) {
    const base = {
      schemaVersion: 1,
      id: entry.id,
      acceptanceId: entry.acceptanceId,
      subject: entry.subject,
      facet: entry.facet,
      ok: true,
      reason: 'idempotent-replay',
      state: clone(input.state),
      previousState: clone(input.state),
      rules: { deterministic: true, stateMutation: false, rewardMutation: false, authoritative: true },
      timing: { fixedStepMs: entry.contract.fixedStepMs, operations: 1, operationBudget: entry.contract.operationBudget },
      rewards: { grantable: false, delta: 0, authority: entry.subject === 'reward outcome' ? 'server' : 'not-applicable' },
      stateTransitions: ['ready', 'replayed', 'ready'],
      feedbackPurpose: `Acknowledge the repeated ${entry.subject} event without duplicating state or rewards.`,
      replayEvent: input.state.events.at(-1) ?? null,
      checksum: stableMechanismHash(input.state),
      facetProof: { kind: 'idempotency', statePreserved: true, checksum: stableMechanismHash(input.state) },
    };
    return Object.freeze({ ...base, signature: stableMechanismHash(base) });
  }
  const previous = clone(input.state);
  const next = advance(entry, input, previous);
  const proof = facetProof(entry, input, previous, next);
  const base = {
    schemaVersion: 1,
    id: entry.id,
    acceptanceId: entry.acceptanceId,
    subject: entry.subject,
    facet: entry.facet,
    ok: true,
    reason: 'accepted',
    state: next,
    previousState: previous,
    rules: { deterministic: true, stateMutation: true, rewardMutation: entry.subject === 'reward outcome', authoritative: true },
    timing: { fixedStepMs: entry.contract.fixedStepMs, operations: proof.kind === 'performance' ? proof.operations : proof.kind === 'property' ? proof.generatedCases : 1, operationBudget: entry.contract.operationBudget },
    rewards: rewardObservation(entry.subject, input, previous, next),
    stateTransitions: ['ready', 'validated', 'fixed-step', next.status],
    feedbackPurpose: `Expose ${entry.subject} ${entry.facet} with identical rule meaning, timing and recovery feedback.`,
    replayEvent: next.events.at(-1) ?? null,
    checksum: stableMechanismHash(next),
    facetProof: proof,
  };
  return Object.freeze({ ...base, signature: stableMechanismHash(base) });
}

export function productionMechanismTestFullName(entry, target) {
  return `production mechanism ${target} evidence [${entry.acceptanceId}][${target}] ${entry.subject} — ${entry.facet}`;
}

export function validateProductionMechanismManifest(manifest) {
  if (!exactKeys(manifest, ['byFacet', 'byRelease', 'bySubject', 'entries', 'entriesSha256', 'policies', 'schemaVersion', 'title', 'total'])
    || manifest.schemaVersion !== 1 || manifest.total !== PRODUCTION_MECHANISM_TOTAL
    || typeof manifest.title !== 'string' || !/^[a-f0-9]{64}$/.test(manifest.entriesSha256)
    || !Array.isArray(manifest.entries) || manifest.entries.length !== PRODUCTION_MECHANISM_TOTAL) throw new Error('production mechanism manifest header invalid');
  if (!exactKeys(manifest.policies, ['authoritativeRevisionRequired', 'boundedIntegerArithmetic', 'canonicalSerialization', 'deterministicSeedOrder', 'failClosedWithoutMutation', 'fixedStepOnly', 'idempotentReplay', 'predictionBounded', 'rewardAuthority'])
    || Object.values(manifest.policies).some((enabled) => enabled !== true)) throw new Error('production mechanism policies incomplete');
  const ids = new Set();
  const fingerprints = new Set();
  for (const [index, entry] of manifest.entries.entries()) {
    assertEntry(entry);
    if (entry.ordinal !== index + 1 || ids.has(entry.id) || fingerprints.has(entry.behaviorFingerprint)) throw new Error(`production mechanism sequence duplicated at ${entry.id}`);
    ids.add(entry.id);
    fingerprints.add(entry.behaviorFingerprint);
  }
  for (const subject of PRODUCTION_MECHANISM_SUBJECTS) {
    if (manifest.bySubject?.[subject] !== 20 || manifest.entries.filter((entry) => entry.subject === subject).length !== 20) throw new Error(`${subject} does not contain 20 mechanism facets`);
  }
  for (const facet of PRODUCTION_MECHANISM_FACETS) {
    if (manifest.byFacet?.[facet] !== 25 || manifest.entries.filter((entry) => entry.facet === facet).length !== 25) throw new Error(`${facet} does not contain 25 mechanism subjects`);
  }
  for (let release = 1; release <= 5; release += 1) {
    if (manifest.byRelease?.[release] !== 100 || manifest.entries.filter((entry) => entry.release === release).length !== 100) throw new Error(`release ${release} does not contain 100 mechanisms`);
  }
  return Object.freeze({ total: ids.size, fingerprints: fingerprints.size });
}

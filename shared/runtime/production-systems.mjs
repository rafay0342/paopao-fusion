const CATEGORY_COUNTS = Object.freeze({
  upgrade: 100,
  improvement: 100,
  ui: 100,
  frontend: 150,
  flow: 200,
  rendering: 100,
  control: 100,
});

const QUALITY_TIERS = new Set(['performance', 'balanced', 'ultra']);
const INPUT_MODES = new Set(['mouse', 'keyboard', 'touch', 'controller', 'hand', 'switch', 'replay']);

function plainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (plainObject(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

/** Browser-safe FNV-1a checksum used for deterministic runtime observations. */
export function stableSystemHash(value) {
  const bytes = new TextEncoder().encode(canonical(value));
  let hash = 0x811c9dc5;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

function finite(value, fallback, minimum, maximum) {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(maximum, Math.max(minimum, Number(value)));
}

function integer(value, fallback, minimum, maximum) {
  return Math.round(finite(value, fallback, minimum, maximum));
}

function exactInput(input) {
  if (!plainObject(input)) return null;
  const keys = Object.keys(input).sort().join(',');
  if (keys !== 'available,inputMode,interrupted,quality,reducedMotion,repeated,sequence,value,viewportHeight,viewportWidth') return null;
  if (!Number.isSafeInteger(input.sequence) || input.sequence < 0 || input.sequence > 1_000_000) return null;
  if (![input.available, input.interrupted, input.repeated, input.reducedMotion].every((value) => typeof value === 'boolean')) return null;
  if (!QUALITY_TIERS.has(input.quality) || !INPUT_MODES.has(input.inputMode)) return null;
  if (![input.value, input.viewportWidth, input.viewportHeight].every(Number.isFinite)) return null;
  return {
    sequence: input.sequence,
    value: finite(input.value, 0.5, -1, 1),
    available: input.available,
    interrupted: input.interrupted,
    repeated: input.repeated,
    viewportWidth: integer(input.viewportWidth, 720, 240, 7680),
    viewportHeight: integer(input.viewportHeight, 1280, 320, 4320),
    quality: input.quality,
    inputMode: input.inputMode,
    reducedMotion: input.reducedMotion,
  };
}

export function canonicalSystemInput(entry, overrides = {}) {
  const controlMode = entry.category === 'control'
    ? ({
      mouse: 'mouse', keyboard: 'keyboard', touch: 'touch', controller: 'controller',
      'single hand': 'hand', 'two hand': 'hand', 'camera pointer': 'hand',
      'assistive switch': 'switch', 'replay input': 'replay', 'input remapping': 'keyboard',
    }[entry.subject] ?? 'keyboard')
    : null;
  const base = {
    sequence: entry.ordinal * 10 + entry.release,
    value: Number((((entry.ordinal % 17) + 1) / 18).toFixed(4)),
    available: true,
    interrupted: false,
    repeated: false,
    viewportWidth: 720,
    viewportHeight: 1280,
    quality: /** @type {'performance'|'balanced'|'ultra'} */ (['performance', 'balanced', 'ultra'][entry.ordinal % 3]),
    inputMode: /** @type {'mouse'|'keyboard'|'touch'|'controller'|'hand'|'switch'|'replay'} */ (controlMode ?? ['mouse', 'keyboard', 'touch', 'controller', 'hand', 'switch', 'replay'][entry.ordinal % 7]),
    reducedMotion: entry.ordinal % 4 === 0,
  };
  return { ...base, ...overrides };
}

function assertEntry(entry) {
  if (!plainObject(entry) || typeof entry.id !== 'string' || typeof entry.acceptanceId !== 'string') throw new Error('production system entry is malformed');
  if (!(entry.category in CATEGORY_COUNTS) || entry.acceptanceId !== `AT-${entry.id}`) throw new Error(`production system ${entry.id} has invalid identity`);
  if (!Number.isInteger(entry.ordinal) || entry.ordinal < 1 || entry.ordinal > CATEGORY_COUNTS[entry.category]) throw new Error(`production system ${entry.id} has invalid ordinal`);
  if (!Number.isInteger(entry.release) || entry.release !== Math.ceil(entry.ordinal / (CATEGORY_COUNTS[entry.category] / 5))) throw new Error(`production system ${entry.id} has invalid release`);
  if (!plainObject(entry.contract) || entry.contract.schemaVersion !== 1 || entry.contract.failureMode !== 'fail-closed-with-recovery') throw new Error(`production system ${entry.id} has invalid contract`);
}

function platformDetail(entry, input) {
  const supported = input.available && input.viewportWidth >= 320;
  const cacheGeneration = `${entry.release}-${entry.ordinal}-${input.quality}`;
  return {
    supported,
    runtime: entry.subject,
    capability: entry.facet,
    profile: input.quality,
    cacheGeneration,
    artifactChannel: entry.release === 5 ? 'production' : `gate-${entry.release}`,
    compatibility: supported ? 'compatible' : 'unsupported',
  };
}

function measurementDetail(entry, input) {
  const baseline = 8 + entry.ordinal % 29;
  const observed = Number((baseline * (0.72 + Math.abs(input.value) * 0.2)).toFixed(3));
  const ceiling = baseline * 1.05;
  return {
    metric: entry.subject,
    audit: entry.facet,
    baseline,
    observed,
    ceiling,
    regression: observed > ceiling,
    sampleWindow: Math.min(600, 60 + entry.ordinal * 3),
  };
}

function interfaceDetail(entry, input) {
  const compact = input.viewportWidth < 640;
  const requested = entry.facet.replaceAll(' ', '-');
  return {
    surface: entry.subject,
    requestedState: requested,
    visibleState: input.available ? requested : 'error-state',
    columns: compact ? 1 : Math.min(4, 2 + entry.ordinal % 3),
    focusIndex: input.inputMode === 'touch' || input.inputMode === 'hand' ? -1 : entry.ordinal % 5,
    ariaRole: entry.contract.accessibilityRole,
    livePriority: entry.facet.includes('error') ? 'assertive' : 'polite',
  };
}

function frontendDetail(entry, input) {
  const phase = input.interrupted ? 'cancelled' : input.available ? 'ready' : 'offline';
  return {
    capability: entry.subject,
    contract: entry.facet,
    phase,
    requestRevision: input.sequence,
    cacheEpoch: Math.floor(input.sequence / 10),
    abortable: true,
    retryable: phase !== 'ready',
    queueDepth: phase === 'offline' ? 1 : 0,
  };
}

function flowDetail(entry, input) {
  const allowed = input.available && !input.interrupted;
  return {
    journey: entry.subject,
    affordance: entry.facet,
    from: 'entered',
    to: allowed ? 'completed' : 'recovery',
    checkpoint: `flow-${entry.release}-${String(entry.ordinal).padStart(3, '0')}`,
    preservesState: true,
    exitGuaranteed: true,
    inputHandoff: input.inputMode,
  };
}

function renderingDetail(entry, input) {
  const tier = input.quality;
  const textureMax = tier === 'performance' ? 1024 : tier === 'balanced' ? 2048 : 4096;
  const particles = input.reducedMotion ? 0 : tier === 'performance' ? 24 : tier === 'balanced' ? 64 : 128;
  return {
    pipeline: entry.subject,
    policy: entry.facet,
    tier,
    textureMax,
    particleBudget: particles,
    dynamicLights: tier === 'ultra' ? 4 : tier === 'balanced' ? 2 : 0,
    postProcessing: tier !== 'performance' && !input.reducedMotion,
    degradedWithoutRuleChange: !input.available,
  };
}

function controlDetail(entry, input) {
  const deadZone = 0.04 + (entry.ordinal % 5) * 0.01;
  const clamped = finite(input.value, 0, -1, 1);
  const normalized = Math.abs(clamped) < deadZone ? 0 : Math.sign(clamped) * ((Math.abs(clamped) - deadZone) / (1 - deadZone));
  const smoothing = 0.18 + (entry.ordinal % 7) * 0.04;
  return {
    source: entry.subject,
    refinement: entry.facet,
    inputMode: input.inputMode,
    normalized: Number(normalized.toFixed(6)),
    deadZone: Number(deadZone.toFixed(3)),
    smoothed: Number((normalized * (1 - smoothing)).toFixed(6)),
    cancelled: input.interrupted || !input.available,
    feedbackAtMs: entry.contract.durationMs,
  };
}

const detailFor = {
  upgrade: platformDetail,
  improvement: measurementDetail,
  ui: interfaceDetail,
  frontend: frontendDetail,
  flow: flowDetail,
  rendering: renderingDetail,
  control: controlDetail,
};

function failureObservation(entry, reason) {
  const base = {
    schemaVersion: 1,
    id: entry?.id ?? 'unknown',
    acceptanceId: entry?.acceptanceId ?? 'unknown',
    ok: false,
    reason,
    content: null,
    rules: Object.freeze({ stateMutation: false, rewardMutation: false }),
    timing: Object.freeze({ frameBudgetMs: 0, durationMs: 0 }),
    rewards: Object.freeze({ grantable: false, delta: 0 }),
    stateTransitions: Object.freeze(['input-rejected', 'recovery-ready']),
    feedbackPurpose: 'Explain the blocked operation and preserve a safe recovery route.',
    detail: Object.freeze({ blocked: true }),
  };
  return Object.freeze({ ...base, signature: stableSystemHash(base) });
}

/** Execute one canonical production outcome without Phaser or DOM dependencies. */
export function executeProductionSystem(entry, candidateInput) {
  try { assertEntry(entry); } catch { return failureObservation(entry, 'invalid-entry'); }
  const input = exactInput(candidateInput);
  if (!input) return failureObservation(entry, 'invalid-input');
  if (!input.available || input.interrupted) return failureObservation(entry, input.interrupted ? 'interrupted' : 'unavailable');

  const detail = detailFor[entry.category](entry, input);
  const base = {
    schemaVersion: 1,
    id: entry.id,
    acceptanceId: entry.acceptanceId,
    ok: true,
    reason: input.repeated ? 'idempotent-replay' : 'accepted',
    content: Object.freeze({ subject: entry.subject, facet: entry.facet, release: entry.release }),
    rules: Object.freeze({ deterministic: true, sequence: input.sequence, idempotent: input.repeated }),
    timing: Object.freeze({ frameBudgetMs: entry.contract.frameBudgetMs, durationMs: input.reducedMotion ? 0 : entry.contract.durationMs }),
    rewards: Object.freeze({ grantable: false, delta: 0 }),
    stateTransitions: Object.freeze(input.repeated ? ['ready', 'replayed', 'ready'] : ['ready', 'active', 'complete']),
    feedbackPurpose: `Make ${entry.subject} ${entry.facet} observable without changing gameplay rules.`,
    detail: Object.freeze(detail),
  };
  return Object.freeze({ ...base, signature: stableSystemHash(base) });
}

export function validateProductionSystemsManifest(manifest) {
  if (!plainObject(manifest) || manifest.schemaVersion !== 1 || manifest.total !== 850 || !Array.isArray(manifest.entries)) throw new Error('production systems manifest shape is invalid');
  if (manifest.entries.length !== 850 || new Set(manifest.entries.map(({ id }) => id)).size !== 850) throw new Error('production systems manifest must contain 850 unique entries');
  for (const [category, count] of Object.entries(CATEGORY_COUNTS)) {
    if (manifest.byCategory?.[category] !== count || manifest.entries.filter((entry) => entry.category === category).length !== count) throw new Error(`production systems category ${category} is incomplete`);
  }
  for (let release = 1; release <= 5; release += 1) {
    if (manifest.byRelease?.[release] !== 170 || manifest.entries.filter((entry) => entry.release === release).length !== 170) throw new Error(`production systems release ${release} is incomplete`);
  }
  for (const entry of manifest.entries) assertEntry(entry);
  return Object.freeze({ total: 850, byCategory: Object.freeze({ ...manifest.byCategory }), byRelease: Object.freeze({ ...manifest.byRelease }) });
}

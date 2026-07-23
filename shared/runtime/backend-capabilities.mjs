import { createHash, timingSafeEqual } from 'node:crypto';

export const BACKEND_CAPABILITY_SCHEMA_VERSION = 1;
export const BACKEND_CAPABILITY_FACETS = Object.freeze([
  'schema contract',
  'validation',
  'authorization',
  'idempotency',
  'revision control',
  'persistence',
  'rate limit',
  'observability',
  'fault recovery',
  'integration fixture',
]);

const MAX_AUDIT_EVENTS = 64;
const IDEMPOTENCY_PATTERN = /^[a-z0-9][a-z0-9._:-]{7,95}$/i;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (record(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return createHash('sha256').update(typeof value === 'string' ? value : canonicalJson(value)).digest('hex');
}

function clone(value) {
  return structuredClone(value);
}

function exactKeys(value, expected, label) {
  if (!record(value)) throw new BackendCapabilityError('invalid-input', `${label} must be an object`, 400);
  const actual = Object.keys(value).sort().join('\0');
  const wanted = [...expected].sort().join('\0');
  if (actual !== wanted) throw new BackendCapabilityError('invalid-input', `${label} has an invalid shape`, 400);
}

function stringField({ min = 1, max = 96, pattern = null, alternate }) {
  return Object.freeze({
    alternate,
    validate: (value) => typeof value === 'string' && value.length >= min && value.length <= max
      && (!pattern || pattern.test(value)),
  });
}

function integerField({ min = 0, max = 1_000_000, alternate }) {
  return Object.freeze({
    alternate,
    validate: (value) => Number.isInteger(value) && value >= min && value <= max,
  });
}

function booleanField({ alternate }) {
  return Object.freeze({ alternate, validate: (value) => typeof value === 'boolean' });
}

const S = stringField;
const I = integerField;
const B = booleanField;

function capability({
  key,
  title,
  auth,
  mutable,
  rateLimit,
  input,
  fixture,
  resultKeys,
  execute,
}) {
  const fixtureResult = execute(clone(fixture), { operationId: '0'.repeat(64), revision: 1 });
  exactKeys(fixtureResult, resultKeys, `${key} result contract`);
  const resultTypes = Object.fromEntries(Object.entries(fixtureResult).map(([field, value]) => [field, typeof value]));
  return Object.freeze({
    key,
    title,
    auth,
    mutable,
    rateLimit,
    input: Object.freeze(input),
    fixture: Object.freeze(fixture),
    resultKeys: Object.freeze(resultKeys),
    resultTypes: Object.freeze(resultTypes),
    execute,
  });
}

function digestLabel(...parts) {
  return sha256(parts.join('|'));
}

const CAPABILITIES = Object.freeze([
  capability({
    key: 'bootstrap', title: 'bootstrap', auth: 'compatible-client', mutable: false, rateLimit: 4,
    input: { clientVersion: S({ min: 5, max: 24, pattern: /^\d+\.\d+\.\d+$/, alternate: '1.1.0' }), locale: S({ min: 2, max: 12, pattern: /^[a-z]{2}(?:-[A-Z]{2})?$/, alternate: 'ur-PK' }) },
    fixture: { clientVersion: '1.0.0', locale: 'en' }, resultKeys: ['compatible', 'saveSchema', 'manifestRevision'],
    execute: ({ clientVersion }) => ({ compatible: clientVersion.startsWith('1.'), saveSchema: 4, manifestRevision: 1 }),
  }),
  capability({
    key: 'content-manifest', title: 'content manifest', auth: 'compatible-client', mutable: false, rateLimit: 5,
    input: { channel: S({ min: 3, max: 16, pattern: /^(stable|preview)$/, alternate: 'preview' }), knownRevision: I({ min: 0, max: 10_000, alternate: 1 }) },
    fixture: { channel: 'stable', knownRevision: 0 }, resultKeys: ['revision', 'digest', 'bundleCount'],
    execute: ({ channel }) => ({ revision: 1, digest: digestLabel('manifest', channel, '1'), bundleCount: channel === 'stable' ? 6 : 7 }),
  }),
  capability({
    key: 'live-configuration', title: 'live configuration', auth: 'compatible-client', mutable: false, rateLimit: 5,
    input: { season: S({ min: 3, max: 32, pattern: /^[a-z0-9-]+$/, alternate: 'season-beta' }), locale: S({ min: 2, max: 12, pattern: /^[a-z]{2}(?:-[A-Z]{2})?$/, alternate: 'sd-PK' }) },
    fixture: { season: 'season-alpha', locale: 'en' }, resultKeys: ['configRevision', 'modifierCount', 'eventId'],
    execute: ({ season }) => ({ configRevision: 1, modifierCount: 3, eventId: `${season}-opening` }),
  }),
  capability({
    key: 'progress', title: 'progress', auth: 'session', mutable: true, rateLimit: 4,
    input: { saveRevision: I({ min: 0, max: 1_000_000, alternate: 8 }), campaignLevel: I({ min: 1, max: 30, alternate: 8 }), endlessPoints: I({ min: 0, max: 10_000_000, alternate: 1500 }) },
    fixture: { saveRevision: 7, campaignLevel: 6, endlessPoints: 1200 }, resultKeys: ['acceptedRevision', 'campaignLevel', 'endlessPoints'],
    execute: ({ saveRevision, campaignLevel, endlessPoints }) => ({ acceptedRevision: saveRevision + 1, campaignLevel, endlessPoints }),
  }),
  capability({
    key: 'run-intake', title: 'run intake', auth: 'session', mutable: true, rateLimit: 3,
    input: { runId: S({ min: 8, max: 64, pattern: /^[a-z0-9-]+$/, alternate: 'run-0002' }), mode: S({ min: 5, max: 12, pattern: /^(classic|endless|arena)$/, alternate: 'endless' }), score: I({ min: 0, max: 100_000_000, alternate: 4600 }), replayDigest: S({ min: 64, max: 64, pattern: SHA256_PATTERN, alternate: 'b'.repeat(64) }) },
    fixture: { runId: 'run-0001', mode: 'classic', score: 4200, replayDigest: 'a'.repeat(64) }, resultKeys: ['accepted', 'runStatus', 'rewardPreview'],
    execute: ({ score, replayDigest }) => ({ accepted: true, runStatus: replayDigest[0] === '0' ? 'review' : 'verified', rewardPreview: Math.floor(score / 100) }),
  }),
  capability({
    key: 'telemetry', title: 'telemetry', auth: 'device-session', mutable: true, rateLimit: 5,
    input: { batchId: S({ min: 8, max: 64, pattern: /^[a-z0-9-]+$/, alternate: 'batch-0002' }), eventCount: I({ min: 1, max: 200, alternate: 25 }), firstTimestamp: I({ min: 1_700_000_000_000, max: 4_000_000_000_000, alternate: 1_800_000_000_001 }) },
    fixture: { batchId: 'batch-0001', eventCount: 20, firstTimestamp: 1_800_000_000_000 }, resultKeys: ['acceptedEvents', 'droppedEvents', 'batchDigest'],
    execute: ({ batchId, eventCount, firstTimestamp }) => ({ acceptedEvents: eventCount, droppedEvents: 0, batchDigest: digestLabel(batchId, eventCount, firstTimestamp) }),
  }),
  capability({
    key: 'arena-gateway', title: 'arena gateway', auth: 'session', mutable: true, rateLimit: 5,
    input: { matchId: S({ min: 8, max: 64, pattern: /^[a-z0-9-]+$/, alternate: 'match-0002' }), action: S({ min: 4, max: 16, pattern: /^(join|shoot|settle)$/, alternate: 'shoot' }), sequence: I({ min: 0, max: 1_000_000, alternate: 12 }) },
    fixture: { matchId: 'match-0001', action: 'join', sequence: 11 }, resultKeys: ['acknowledgedSequence', 'serverTick', 'authoritative'],
    execute: ({ sequence }) => ({ acknowledgedSequence: sequence, serverTick: sequence * 2 + 1, authoritative: true }),
  }),
  capability({
    key: 'account-session', title: 'account session', auth: 'session', mutable: false, rateLimit: 4,
    input: { sessionId: S({ min: 12, max: 96, pattern: /^[a-z0-9-]+$/, alternate: 'session-00000002' }), deviceLabel: S({ min: 3, max: 64, alternate: 'Android handset' }) },
    fixture: { sessionId: 'session-00000001', deviceLabel: 'Windows browser' }, resultKeys: ['active', 'csrfRequired', 'idleTtlSeconds'],
    execute: () => ({ active: true, csrfRequired: true, idleTtlSeconds: 1800 }),
  }),
  capability({
    key: 'native-token', title: 'native token', auth: 'native-device', mutable: true, rateLimit: 3,
    input: { deviceId: S({ min: 8, max: 64, pattern: /^[a-z0-9-]+$/, alternate: 'device-0002' }), platform: S({ min: 7, max: 10, pattern: /^(windows|android)$/, alternate: 'android' }), attestation: S({ min: 16, max: 128, pattern: /^[a-z0-9._-]+$/, alternate: 'attestation-proof-02' }) },
    fixture: { deviceId: 'device-0001', platform: 'windows', attestation: 'attestation-proof-01' }, resultKeys: ['accessTtlSeconds', 'refreshFamily', 'tokenBinding'],
    execute: ({ deviceId, platform }) => ({ accessTtlSeconds: 900, refreshFamily: digestLabel('family', deviceId).slice(0, 24), tokenBinding: digestLabel(deviceId, platform) }),
  }),
  capability({
    key: 'refresh-token', title: 'refresh token', auth: 'native-device', mutable: true, rateLimit: 3,
    input: { familyId: S({ min: 12, max: 64, pattern: /^[a-z0-9-]+$/, alternate: 'family-00000002' }), rotation: I({ min: 0, max: 10_000, alternate: 4 }), nonce: S({ min: 12, max: 96, pattern: /^[a-z0-9-]+$/, alternate: 'nonce-00000002' }) },
    fixture: { familyId: 'family-00000001', rotation: 3, nonce: 'nonce-00000001' }, resultKeys: ['nextRotation', 'reuseDetected', 'familyDigest'],
    execute: ({ familyId, rotation, nonce }) => ({ nextRotation: rotation + 1, reuseDetected: false, familyDigest: digestLabel(familyId, nonce) }),
  }),
  capability({
    key: 'wallet', title: 'wallet', auth: 'session', mutable: true, rateLimit: 4,
    input: { currency: S({ min: 4, max: 8, pattern: /^(coins|gems)$/, alternate: 'gems' }), delta: I({ min: 1, max: 100_000, alternate: 250 }), reason: S({ min: 4, max: 48, pattern: /^[a-z0-9-]+$/, alternate: 'event-reward' }) },
    fixture: { currency: 'coins', delta: 100, reason: 'level-reward' }, resultKeys: ['balanceDelta', 'currency', 'transactionId'],
    execute: ({ currency, delta, reason }, meta) => ({ balanceDelta: delta, currency, transactionId: digestLabel(meta.operationId, reason).slice(0, 32) }),
  }),
  capability({
    key: 'inventory', title: 'inventory', auth: 'session', mutable: true, rateLimit: 4,
    input: { itemId: S({ min: 3, max: 48, pattern: /^[a-z0-9-]+$/, alternate: 'rainbow' }), delta: I({ min: 1, max: 1000, alternate: 2 }), reason: S({ min: 4, max: 48, pattern: /^[a-z0-9-]+$/, alternate: 'shop-grant' }) },
    fixture: { itemId: 'bomb', delta: 1, reason: 'level-grant' }, resultKeys: ['itemId', 'quantityDelta', 'ledgerEntry'],
    execute: ({ itemId, delta }, meta) => ({ itemId, quantityDelta: delta, ledgerEntry: digestLabel(meta.operationId, itemId).slice(0, 32) }),
  }),
  capability({
    key: 'purchase', title: 'purchase', auth: 'session', mutable: true, rateLimit: 3,
    input: { sku: S({ min: 4, max: 48, pattern: /^[a-z0-9-]+$/, alternate: 'rainbow-pack' }), quantity: I({ min: 1, max: 20, alternate: 2 }), quoteRevision: I({ min: 1, max: 10_000, alternate: 4 }) },
    fixture: { sku: 'bomb-pack', quantity: 1, quoteRevision: 3 }, resultKeys: ['purchaseId', 'debitCoins', 'grantCount'],
    execute: ({ sku, quantity, quoteRevision }, meta) => ({ purchaseId: digestLabel(meta.operationId, sku).slice(0, 32), debitCoins: quantity * quoteRevision * 25, grantCount: quantity }),
  }),
  capability({
    key: 'entitlement', title: 'entitlement', auth: 'session', mutable: true, rateLimit: 4,
    input: { entitlementId: S({ min: 4, max: 64, pattern: /^[a-z0-9-]+$/, alternate: 'skin-aurora' }), action: S({ min: 5, max: 8, pattern: /^(grant|revoke)$/, alternate: 'revoke' }), source: S({ min: 4, max: 32, pattern: /^[a-z0-9-]+$/, alternate: 'admin-grant' }) },
    fixture: { entitlementId: 'skin-lumi', action: 'grant', source: 'story-reward' }, resultKeys: ['entitlementId', 'active', 'sourceDigest'],
    execute: ({ entitlementId, action, source }) => ({ entitlementId, active: action === 'grant', sourceDigest: digestLabel(source, entitlementId) }),
  }),
  capability({
    key: 'campaign', title: 'campaign', auth: 'session', mutable: true, rateLimit: 4,
    input: { levelId: I({ min: 1, max: 30, alternate: 8 }), outcome: S({ min: 3, max: 8, pattern: /^(won|lost)$/, alternate: 'lost' }), stars: I({ min: 0, max: 3, alternate: 3 }) },
    fixture: { levelId: 7, outcome: 'won', stars: 2 }, resultKeys: ['unlockedLevel', 'awardedStars', 'completed'],
    execute: ({ levelId, outcome, stars }) => ({ unlockedLevel: outcome === 'won' ? Math.min(30, levelId + 1) : levelId, awardedStars: stars, completed: outcome === 'won' }),
  }),
  capability({
    key: 'endless-season', title: 'endless season', auth: 'session', mutable: true, rateLimit: 3,
    input: { seasonId: S({ min: 4, max: 32, pattern: /^[a-z0-9-]+$/, alternate: 'season-beta' }), runScore: I({ min: 0, max: 100_000_000, alternate: 12500 }), seed: I({ min: 1, max: 2_147_483_647, alternate: 98766 }) },
    fixture: { seasonId: 'season-alpha', runScore: 12000, seed: 98765 }, resultKeys: ['rankPoints', 'rewardTier', 'seedAccepted'],
    execute: ({ runScore, seed }) => ({ rankPoints: Math.floor(runScore / 100), rewardTier: Math.min(100, Math.floor(runScore / 1000)), seedAccepted: seed > 0 }),
  }),
  capability({
    key: 'live-event', title: 'live event', auth: 'signed-challenge', mutable: true, rateLimit: 3,
    input: { eventId: S({ min: 4, max: 48, pattern: /^[a-z0-9-]+$/, alternate: 'event-eclipse' }), challengeId: S({ min: 8, max: 64, pattern: /^[a-z0-9-]+$/, alternate: 'challenge-0002' }), score: I({ min: 0, max: 100_000_000, alternate: 8800 }) },
    fixture: { eventId: 'event-aurora', challengeId: 'challenge-0001', score: 8400 }, resultKeys: ['accepted', 'eventPoints', 'challengeReceipt'],
    execute: ({ eventId, challengeId, score }) => ({ accepted: true, eventPoints: Math.floor(score / 80), challengeReceipt: digestLabel(eventId, challengeId, score) }),
  }),
  capability({
    key: 'signed-challenge', title: 'signed challenge', auth: 'signed-challenge', mutable: false, rateLimit: 3,
    input: { challengeId: S({ min: 8, max: 64, pattern: /^[a-z0-9-]+$/, alternate: 'challenge-0002' }), nonce: S({ min: 12, max: 96, pattern: /^[a-z0-9-]+$/, alternate: 'challenge-nonce-02' }), payloadDigest: S({ min: 64, max: 64, pattern: SHA256_PATTERN, alternate: 'd'.repeat(64) }) },
    fixture: { challengeId: 'challenge-0001', nonce: 'challenge-nonce-01', payloadDigest: 'c'.repeat(64) }, resultKeys: ['verified', 'keyId', 'receiptDigest'],
    execute: ({ challengeId, nonce, payloadDigest }) => ({ verified: true, keyId: 'event-signing-current', receiptDigest: digestLabel(challengeId, nonce, payloadDigest) }),
  }),
  capability({
    key: 'remote-configuration', title: 'remote configuration', auth: 'admin', mutable: true, rateLimit: 3,
    input: { namespace: S({ min: 4, max: 48, pattern: /^[a-z0-9-]+$/, alternate: 'economy-live' }), revision: I({ min: 1, max: 100_000, alternate: 13 }), changeDigest: S({ min: 64, max: 64, pattern: SHA256_PATTERN, alternate: 'f'.repeat(64) }) },
    fixture: { namespace: 'season-live', revision: 12, changeDigest: 'e'.repeat(64) }, resultKeys: ['publishedRevision', 'rolloutPercent', 'publicationDigest'],
    execute: ({ namespace, revision, changeDigest }) => ({ publishedRevision: revision, rolloutPercent: 100, publicationDigest: digestLabel(namespace, changeDigest) }),
  }),
  capability({
    key: 'admin-console', title: 'admin console', auth: 'admin', mutable: true, rateLimit: 3,
    input: { command: S({ min: 5, max: 32, pattern: /^(rotate-keys|publish-config|verify-backup)$/, alternate: 'publish-config' }), requestId: S({ min: 8, max: 64, pattern: /^[a-z0-9-]+$/, alternate: 'admin-0002' }), reason: S({ min: 8, max: 96, alternate: 'scheduled release approval' }) },
    fixture: { command: 'verify-backup', requestId: 'admin-0001', reason: 'scheduled integrity drill' }, resultKeys: ['accepted', 'auditId', 'requiresSecondFactor'],
    execute: ({ command, requestId }) => ({ accepted: true, auditId: digestLabel(command, requestId).slice(0, 32), requiresSecondFactor: true }),
  }),
  capability({
    key: 'audit-trail', title: 'audit trail', auth: 'service', mutable: false, rateLimit: 5,
    input: { cursor: I({ min: 0, max: 10_000_000, alternate: 100 }), limit: I({ min: 1, max: 100, alternate: 25 }), filter: S({ min: 3, max: 24, pattern: /^(all|security|economy)$/, alternate: 'security' }) },
    fixture: { cursor: 0, limit: 20, filter: 'all' }, resultKeys: ['count', 'nextCursor', 'chainHead'],
    execute: ({ cursor, limit, filter }) => ({ count: Math.min(limit, 7), nextCursor: cursor + Math.min(limit, 7), chainHead: digestLabel('audit', filter, cursor) }),
  }),
  capability({
    key: 'backup', title: 'backup', auth: 'service', mutable: true, rateLimit: 3,
    input: { backupId: S({ min: 8, max: 64, pattern: /^[a-z0-9-]+$/, alternate: 'backup-0002' }), scope: S({ min: 4, max: 16, pattern: /^(full|state|keys)$/, alternate: 'state' }), encryption: S({ min: 7, max: 16, pattern: /^aes-256-gcm$/, alternate: 'aes-256-gcm' }) },
    fixture: { backupId: 'backup-0001', scope: 'full', encryption: 'aes-256-gcm' }, resultKeys: ['state', 'entryCount', 'archiveDigest'],
    execute: ({ backupId, scope, encryption }) => ({ state: 'sealed', entryCount: scope === 'full' ? 4 : 2, archiveDigest: digestLabel(backupId, scope, encryption) }),
  }),
  capability({
    key: 'restore', title: 'restore', auth: 'service', mutable: true, rateLimit: 3,
    input: { backupId: S({ min: 8, max: 64, pattern: /^[a-z0-9-]+$/, alternate: 'backup-0002' }), target: S({ min: 4, max: 16, pattern: /^(staging|isolated)$/, alternate: 'staging' }), dryRun: B({ alternate: false }) },
    fixture: { backupId: 'backup-0001', target: 'isolated', dryRun: true }, resultKeys: ['verified', 'restoredEntries', 'targetDigest'],
    execute: ({ backupId, target, dryRun }) => ({ verified: true, restoredEntries: dryRun ? 0 : 4, targetDigest: digestLabel(backupId, target) }),
  }),
  capability({
    key: 'compatibility-adapter', title: 'compatibility adapter', auth: 'service', mutable: true, rateLimit: 4,
    input: { sourceVersion: I({ min: 1, max: 4, alternate: 2 }), targetVersion: I({ min: 2, max: 4, alternate: 4 }), recordCount: I({ min: 1, max: 10_000, alternate: 20 }) },
    fixture: { sourceVersion: 3, targetVersion: 4, recordCount: 16 }, resultKeys: ['converted', 'rejected', 'migrationDigest'],
    execute: ({ sourceVersion, targetVersion, recordCount }) => ({ converted: sourceVersion <= targetVersion ? recordCount : 0, rejected: sourceVersion <= targetVersion ? 0 : recordCount, migrationDigest: digestLabel(sourceVersion, targetVersion, recordCount) }),
  }),
  capability({
    key: 'health-reporting', title: 'health reporting', auth: 'service', mutable: false, rateLimit: 5,
    input: { component: S({ min: 3, max: 32, pattern: /^(api|database|arena|storage)$/, alternate: 'database' }), sampleWindow: I({ min: 5, max: 300, alternate: 60 }), verbose: B({ alternate: true }) },
    fixture: { component: 'api', sampleWindow: 30, verbose: false }, resultKeys: ['status', 'latencyMs', 'pendingOperations'],
    execute: ({ component, sampleWindow }) => ({ status: 'healthy', latencyMs: Math.max(1, Math.floor(sampleWindow / 6) + component.length), pendingOperations: 0 }),
  }),
]);

export const BACKEND_CAPABILITY_SUBJECTS = Object.freeze(CAPABILITIES.map(({ key, title, auth, mutable, rateLimit }) => Object.freeze({
  key, title, auth, mutable, rateLimit,
})));

const CAPABILITY_BY_KEY = new Map(CAPABILITIES.map((entry) => [entry.key, entry]));

export class BackendCapabilityError extends Error {
  constructor(code, message, statusCode = 400) {
    super(message);
    this.name = 'BackendCapabilityError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

export class TransientBackendRepositoryError extends Error {
  constructor() {
    super('transient repository commit failure');
    this.name = 'TransientBackendRepositoryError';
  }
}

export class MemoryBackendCapabilityRepository {
  #states = new Map();
  #failNext = new Set();

  #state(subject) {
    if (!this.#states.has(subject)) {
      this.#states.set(subject, { revision: 1, receipts: new Map(), commits: 0, publications: 0 });
    }
    return this.#states.get(subject);
  }

  revision(subject) {
    return this.#state(subject).revision;
  }

  receipt(subject, idempotencyKey) {
    const value = this.#state(subject).receipts.get(idempotencyKey);
    return value ? clone(value) : null;
  }

  failNextCommit(subject) {
    this.#failNext.add(subject);
  }

  publish(subject) {
    const state = this.#state(subject);
    state.revision += 1;
    state.publications += 1;
    return state.revision;
  }

  commit({ subject, idempotencyKey, fingerprint, expectedRevision, mutable, response }) {
    const state = this.#state(subject);
    if (this.#failNext.delete(subject)) throw new TransientBackendRepositoryError();
    const existing = state.receipts.get(idempotencyKey);
    if (existing) {
      if (existing.fingerprint !== fingerprint) throw new BackendCapabilityError('idempotency-conflict', 'idempotency key was used with a different request', 409);
      return clone(existing.response);
    }
    if (state.revision !== expectedRevision) throw new BackendCapabilityError('revision-conflict', 'expected revision is stale', 409);
    if (mutable) state.revision += 1;
    const committed = { ...response, revision: state.revision };
    state.receipts.set(idempotencyKey, { fingerprint, response: clone(committed) });
    state.commits += 1;
    return clone(committed);
  }

  stats(subject) {
    const state = this.#state(subject);
    return {
      revision: state.revision,
      receipts: state.receipts.size,
      commits: state.commits,
      publications: state.publications,
    };
  }
}

function authorized(policy, context) {
  const capabilities = new Set(context?.capabilities ?? []);
  if (policy.auth === 'compatible-client') {
    return context?.client?.name === 'phaser' && context.client.signed === true
      && /^1\./.test(context.client.version ?? '');
  }
  if (policy.auth === 'session') return context?.principal?.kind === 'user' && context.csrfValid === true;
  if (policy.auth === 'device-session') {
    return context?.principal?.kind === 'user' && context.deviceProof === true && context.csrfValid === true;
  }
  if (policy.auth === 'native-device') return context?.principal?.kind === 'user' && context.nativeAttested === true;
  if (policy.auth === 'signed-challenge') {
    return context?.principal?.kind === 'user' && context.csrfValid === true && context.challengeVerified === true;
  }
  if (policy.auth === 'admin') {
    return context?.principal?.kind === 'admin' && context.tailnet === true && context.webauthnVerified === true
      && capabilities.has('backend:admin');
  }
  return context?.principal?.kind === 'service' && context.mtlsVerified === true
    && capabilities.has('backend:service');
}

function safePrincipal(context) {
  return typeof context?.principal?.id === 'string' && context.principal.id.length > 0
    ? context.principal.id.slice(0, 64)
    : 'anonymous';
}

function validateRequest(policy, input) {
  exactKeys(input, Object.keys(policy.input), `${policy.key} request`);
  for (const [field, contract] of Object.entries(policy.input)) {
    if (!contract.validate(input[field])) throw new BackendCapabilityError('invalid-input', `${policy.key}.${field} is invalid`, 400);
  }
}

function validateResult(policy, result) {
  exactKeys(result, policy.resultKeys, `${policy.key} result`);
  for (const [field, value] of Object.entries(result)) {
    if (typeof value !== policy.resultTypes[field]
      || value === undefined
      || (typeof value === 'number' && (!Number.isFinite(value) || !Number.isSafeInteger(value)))
      || (typeof value === 'string' && (value.length < 1 || value.length > 256))) {
      throw new BackendCapabilityError('invalid-result', `${policy.key} adapter produced an invalid value`, 500);
    }
  }
}

export function validateBackendCapabilityEnvelope(policyKey, value) {
  const policy = CAPABILITY_BY_KEY.get(policyKey);
  if (!policy) throw new BackendCapabilityError('unknown-capability', `unknown backend capability ${String(policyKey)}`, 404);
  exactKeys(value, ['schemaVersion', 'subject', 'operationId', 'revision', 'attempts', 'recovered', 'result'], `${policy.key} envelope`);
  if (value.schemaVersion !== BACKEND_CAPABILITY_SCHEMA_VERSION || value.subject !== policy.key
    || typeof value.operationId !== 'string' || !SHA256_PATTERN.test(value.operationId)
    || !Number.isInteger(value.revision) || value.revision < 1
    || !Number.isInteger(value.attempts) || value.attempts < 1 || value.attempts > 2
    || typeof value.recovered !== 'boolean') {
    throw new BackendCapabilityError('invalid-result', `${policy.key} envelope violates the production contract`, 500);
  }
  validateResult(policy, value.result);
  return value;
}

export function createAuthorizedBackendContext(policyKey, overrides = {}) {
  const policy = CAPABILITY_BY_KEY.get(policyKey);
  if (!policy) throw new BackendCapabilityError('unknown-capability', `unknown backend capability ${String(policyKey)}`, 404);
  const contexts = {
    'compatible-client': { principal: { kind: 'client', id: 'phaser-web' }, client: { name: 'phaser', version: '1.0.0', signed: true } },
    session: { principal: { kind: 'user', id: 'user-1001' }, csrfValid: true },
    'device-session': { principal: { kind: 'user', id: 'user-1001' }, csrfValid: true, deviceProof: true },
    'native-device': { principal: { kind: 'user', id: 'user-1001' }, nativeAttested: true },
    'signed-challenge': { principal: { kind: 'user', id: 'user-1001' }, csrfValid: true, challengeVerified: true },
    admin: { principal: { kind: 'admin', id: 'admin-1001' }, tailnet: true, webauthnVerified: true, capabilities: ['backend:admin'] },
    service: { principal: { kind: 'service', id: 'paopao-ops' }, mtlsVerified: true, capabilities: ['backend:service'] },
  };
  return { ...clone(contexts[policy.auth]), ...clone(overrides) };
}

function deniedContext(policy) {
  const valid = createAuthorizedBackendContext(policy.key);
  if (policy.auth === 'compatible-client') return { ...valid, client: { ...valid.client, signed: false } };
  if (policy.auth === 'session') return { ...valid, csrfValid: false };
  if (policy.auth === 'device-session') return { ...valid, deviceProof: false };
  if (policy.auth === 'native-device') return { ...valid, nativeAttested: false };
  if (policy.auth === 'signed-challenge') return { ...valid, challengeVerified: false };
  if (policy.auth === 'admin') return { ...valid, tailnet: false };
  return { ...valid, mtlsVerified: false };
}

export function createBackendCapabilityService({ repository = new MemoryBackendCapabilityRepository(), clock = () => Date.now() } = {}) {
  const audit = [];
  const metrics = new Map();
  const rateWindows = new Map();

  const metric = (subject) => {
    if (!metrics.has(subject)) metrics.set(subject, { accepted: 0, rejected: 0, replayed: 0, recovered: 0, rateLimited: 0 });
    return metrics.get(subject);
  };

  const observe = (subject, outcome, context, extra = {}) => {
    const event = {
      sequence: audit.length ? audit[audit.length - 1].sequence + 1 : 1,
      subject,
      outcome,
      principal: sha256(safePrincipal(context)).slice(0, 16),
      code: extra.code ?? 'ok',
      attempts: extra.attempts ?? 0,
    };
    audit.push(event);
    if (audit.length > MAX_AUDIT_EVENTS) audit.splice(0, audit.length - MAX_AUDIT_EVENTS);
  };

  const reject = (policy, error, context) => {
    const current = metric(policy.key);
    current.rejected += 1;
    if (error.code === 'rate-limited') current.rateLimited += 1;
    observe(policy.key, 'rejected', context, { code: error.code });
    throw error;
  };

  const enforceRate = (policy, context) => {
    const principal = safePrincipal(context);
    const key = `${policy.key}\0${principal}`;
    const now = clock();
    const previous = rateWindows.get(key);
    const window = !previous || now - previous.startedAt >= 60_000
      ? { startedAt: now, count: 0 }
      : previous;
    window.count += 1;
    rateWindows.set(key, window);
    if (window.count > policy.rateLimit) {
      throw new BackendCapabilityError('rate-limited', `${policy.key} request budget exceeded`, 429);
    }
  };

  const invoke = (policyKey, input, context = {}) => {
    const policy = CAPABILITY_BY_KEY.get(policyKey);
    if (!policy) throw new BackendCapabilityError('unknown-capability', `unknown backend capability ${String(policyKey)}`, 404);
    try {
      validateRequest(policy, input);
      if (!authorized(policy, context)) throw new BackendCapabilityError('forbidden', `${policy.key} authorization failed`, 403);
      if (typeof context.idempotencyKey !== 'string' || !IDEMPOTENCY_PATTERN.test(context.idempotencyKey)) {
        throw new BackendCapabilityError('invalid-idempotency-key', `${policy.key} requires a bounded idempotency key`, 400);
      }
      enforceRate(policy, context);
      const fingerprint = sha256({ policy: policy.key, input, principal: safePrincipal(context) });
      const cached = repository.receipt(policy.key, context.idempotencyKey);
      if (cached) {
        const actual = Buffer.from(cached.fingerprint, 'hex');
        const expected = Buffer.from(fingerprint, 'hex');
        if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
          throw new BackendCapabilityError('idempotency-conflict', 'idempotency key was used with a different request', 409);
        }
        metric(policy.key).replayed += 1;
        observe(policy.key, 'replayed', context, { attempts: cached.response.attempts });
        return clone(cached.response);
      }
      const revision = repository.revision(policy.key);
      if (!Number.isInteger(context.expectedRevision) || context.expectedRevision !== revision) {
        throw new BackendCapabilityError('revision-conflict', `${policy.key} expected revision is stale`, 409);
      }
      const operationId = sha256(`${policy.key}|${context.idempotencyKey}|${fingerprint}`);
      if (context.injectTransientCommit === true) repository.failNextCommit(policy.key);
      for (let attempt = 1; attempt <= 2; attempt += 1) {
        try {
          const result = policy.execute(clone(input), { operationId, revision });
          validateResult(policy, result);
          const response = {
            schemaVersion: BACKEND_CAPABILITY_SCHEMA_VERSION,
            subject: policy.key,
            operationId,
            revision,
            attempts: attempt,
            recovered: attempt > 1,
            result,
          };
          const committed = repository.commit({
            subject: policy.key,
            idempotencyKey: context.idempotencyKey,
            fingerprint,
            expectedRevision: revision,
            mutable: policy.mutable,
            response,
          });
          validateBackendCapabilityEnvelope(policy.key, committed);
          const current = metric(policy.key);
          current.accepted += 1;
          if (attempt > 1) current.recovered += 1;
          observe(policy.key, attempt > 1 ? 'recovered' : 'accepted', context, { attempts: attempt });
          return committed;
        } catch (error) {
          if (error instanceof TransientBackendRepositoryError && attempt === 1) continue;
          throw error;
        }
      }
      throw new BackendCapabilityError('unavailable', `${policy.key} could not recover`, 503);
    } catch (error) {
      if (error instanceof BackendCapabilityError) return reject(policy, error, context);
      return reject(policy, new BackendCapabilityError('unavailable', `${policy.key} adapter failed closed`, 503), context);
    }
  };

  const diagnostics = (context = {}) => {
    const diagnosticCapability = new Set(context.capabilities ?? []).has('backend:diagnostics');
    const authenticatedOperator = (context?.principal?.kind === 'service' && context.mtlsVerified === true)
      || (context?.principal?.kind === 'admin' && context.tailnet === true && context.webauthnVerified === true);
    if (!diagnosticCapability || !authenticatedOperator) {
      throw new BackendCapabilityError('forbidden', 'backend diagnostics capability is required', 403);
    }
    return {
      schemaVersion: BACKEND_CAPABILITY_SCHEMA_VERSION,
      auditLimit: MAX_AUDIT_EVENTS,
      subjects: CAPABILITIES.map((policy) => ({
        key: policy.key,
        revision: repository.revision(policy.key),
        rateLimitPerMinute: policy.rateLimit,
        metrics: clone(metric(policy.key)),
      })),
      audit: clone(audit),
    };
  };

  return Object.freeze({ invoke, diagnostics, repository });
}

function alternateFixture(policy) {
  const next = clone(policy.fixture);
  const first = Object.keys(policy.input)[0];
  next[first] = policy.input[first].alternate;
  return next;
}

function errorCode(operation) {
  try {
    operation();
    return null;
  } catch (error) {
    return error instanceof BackendCapabilityError ? error.code : 'unexpected-error';
  }
}

function invocationContext(service, policy, suffix, overrides = {}) {
  return createAuthorizedBackendContext(policy.key, {
    idempotencyKey: `${policy.key}:${suffix}:0001`,
    expectedRevision: service.repository.revision(policy.key),
    ...overrides,
  });
}

export function backendCapabilityCoordinates(ordinal) {
  if (!Number.isInteger(ordinal) || ordinal < 1 || ordinal > 250) {
    throw new BackendCapabilityError('invalid-ledger-coordinate', 'backend ordinal must be in 1..250', 400);
  }
  const subjectIndex = Math.floor((ordinal - 1) / 10);
  const facetIndex = (ordinal - 1) % 10;
  return { subject: CAPABILITIES[subjectIndex], facet: BACKEND_CAPABILITY_FACETS[facetIndex] };
}

export function backendCapabilityTestFullName(item) {
  const { subject, facet } = backendCapabilityCoordinates(item.ordinal);
  const expectedId = `PF-backend-${String(item.ordinal).padStart(3, '0')}`;
  const acceptanceId = `AT-${expectedId}`;
  if (item.id !== expectedId || item.acceptanceTest?.id !== acceptanceId
    || item.category !== 'backend' || item.title !== `${subject.title} — ${facet}`) {
    throw new BackendCapabilityError('invalid-ledger-coordinate', `backend ledger identity is invalid for ordinal ${item.ordinal}`, 400);
  }
  return `backend capability evidence ${subject.key} [${acceptanceId}][shared] executes ${facet}`;
}

export function runBackendCapabilityProbe(item, options = {}) {
  const { subject: policy, facet } = backendCapabilityCoordinates(item.ordinal);
  backendCapabilityTestFullName(item);
  let repository = options.repository ?? new MemoryBackendCapabilityRepository();
  let now = 1_800_000_000_000;
  const service = createBackendCapabilityService({ repository, clock: () => now });
  const valid = () => clone(policy.fixture);
  const context = (suffix, overrides = {}) => invocationContext(service, policy, suffix, overrides);
  const diagnosticContext = {
    principal: { kind: 'service', id: 'paopao-observability' },
    mtlsVerified: true,
    capabilities: ['backend:diagnostics'],
  };
  const common = { itemId: item.id, acceptanceId: item.acceptanceTest.id, subject: policy.key, facet };

  if (facet === 'schema contract') {
    const response = service.invoke(policy.key, valid(), context('schema'));
    validateBackendCapabilityEnvelope(policy.key, response);
    return { ...common, proof: { schemaVersion: response.schemaVersion, resultKeys: Object.keys(response.result).sort(), operationId: response.operationId } };
  }
  if (facet === 'validation') {
    const invalid = { ...valid(), untrustedField: 'must-be-rejected' };
    const rejectedCode = errorCode(() => service.invoke(policy.key, invalid, context('validation-bad')));
    const accepted = service.invoke(policy.key, valid(), context('validation-good'));
    return { ...common, proof: { rejectedCode, acceptedSubject: accepted.subject, commits: repository.stats(policy.key).commits } };
  }
  if (facet === 'authorization') {
    const denied = deniedContext(policy);
    const deniedCode = errorCode(() => service.invoke(policy.key, valid(), {
      ...denied,
      idempotencyKey: `${policy.key}:auth-denied`,
      expectedRevision: repository.revision(policy.key),
    }));
    const allowed = service.invoke(policy.key, valid(), context('auth-allowed'));
    return { ...common, proof: { deniedCode, allowedOperation: allowed.operationId, authMode: policy.auth } };
  }
  if (facet === 'idempotency') {
    const firstContext = context('idempotency');
    const first = service.invoke(policy.key, valid(), firstContext);
    const repeated = service.invoke(policy.key, valid(), firstContext);
    const conflictCode = errorCode(() => service.invoke(policy.key, alternateFixture(policy), firstContext));
    return { ...common, proof: { stable: canonicalJson(first) === canonicalJson(repeated), conflictCode, commits: repository.stats(policy.key).commits } };
  }
  if (facet === 'revision control') {
    const initialRevision = repository.revision(policy.key);
    service.invoke(policy.key, valid(), context('revision-first'));
    if (!policy.mutable) repository.publish(policy.key);
    const currentRevision = repository.revision(policy.key);
    const staleCode = errorCode(() => service.invoke(policy.key, alternateFixture(policy), createAuthorizedBackendContext(policy.key, {
      idempotencyKey: `${policy.key}:revision-stale`, expectedRevision: initialRevision,
    })));
    const accepted = service.invoke(policy.key, alternateFixture(policy), createAuthorizedBackendContext(policy.key, {
      idempotencyKey: `${policy.key}:revision-current`, expectedRevision: currentRevision,
    }));
    return { ...common, proof: { initialRevision, currentRevision, acceptedRevision: accepted.revision, staleCode } };
  }
  if (facet === 'persistence') {
    const firstContext = context('persistence');
    const first = service.invoke(policy.key, valid(), firstContext);
    if (typeof options.restartRepository === 'function') repository = options.restartRepository(repository);
    const restarted = createBackendCapabilityService({ repository, clock: () => now + 1 });
    const afterRestart = restarted.invoke(policy.key, valid(), firstContext);
    return { ...common, proof: { sameReceipt: canonicalJson(first) === canonicalJson(afterRestart), receipts: repository.stats(policy.key).receipts, revision: repository.revision(policy.key) } };
  }
  if (facet === 'rate limit') {
    const accepted = [];
    for (let index = 0; index < policy.rateLimit; index += 1) {
      accepted.push(service.invoke(policy.key, valid(), context(`rate-${index}`)).operationId);
    }
    const rejectedCode = errorCode(() => service.invoke(policy.key, valid(), context('rate-overflow')));
    now += 60_001;
    const resumed = service.invoke(policy.key, valid(), context('rate-resumed'));
    return { ...common, proof: { accepted: accepted.length, limit: policy.rateLimit, rejectedCode, resumed: SHA256_PATTERN.test(resumed.operationId) } };
  }
  if (facet === 'observability') {
    const secretContext = context('observe', { secret: 'never-export-this-value' });
    service.invoke(policy.key, valid(), secretContext);
    errorCode(() => service.invoke(policy.key, { ...valid(), injected: true }, context('observe-bad')));
    const diagnosticsDeniedCode = errorCode(() => service.diagnostics({ capabilities: ['backend:diagnostics'] }));
    const report = service.diagnostics(diagnosticContext);
    const entry = report.subjects.find(({ key }) => key === policy.key);
    const serialized = canonicalJson(report);
    return { ...common, proof: { accepted: entry.metrics.accepted, rejected: entry.metrics.rejected, auditEvents: report.audit.length, auditLimit: report.auditLimit, redacted: !serialized.includes('never-export-this-value'), diagnosticsDeniedCode } };
  }
  if (facet === 'fault recovery') {
    const response = service.invoke(policy.key, valid(), context('recovery', { injectTransientCommit: true }));
    return { ...common, proof: { recovered: response.recovered, attempts: response.attempts, commits: repository.stats(policy.key).commits, receipts: repository.stats(policy.key).receipts } };
  }
  const response = service.invoke(policy.key, valid(), context('integration'));
  validateBackendCapabilityEnvelope(policy.key, response);
  const stored = repository.receipt(policy.key, `${policy.key}:integration:0001`);
  const diagnostics = service.diagnostics(diagnosticContext);
  return { ...common, proof: { integrated: canonicalJson(stored.response) === canonicalJson(response), resultKeys: Object.keys(response.result).length, observed: diagnostics.audit.some((event) => event.subject === policy.key && event.outcome === 'accepted') } };
}

export function assertBackendCapabilityProbe(item, outcome) {
  const { subject, facet } = backendCapabilityCoordinates(item.ordinal);
  if (!record(outcome) || outcome.itemId !== item.id || outcome.acceptanceId !== item.acceptanceTest.id
    || outcome.subject !== subject.key || outcome.facet !== facet || !record(outcome.proof)) {
    throw new BackendCapabilityError('probe-failed', `${item.id} probe identity failed`, 500);
  }
  const proof = outcome.proof;
  let passed = false;
  if (facet === 'schema contract') passed = proof.schemaVersion === 1 && proof.resultKeys.join('\0') === [...subject.resultKeys].sort().join('\0') && SHA256_PATTERN.test(proof.operationId);
  else if (facet === 'validation') passed = proof.rejectedCode === 'invalid-input' && proof.acceptedSubject === subject.key && proof.commits === 1;
  else if (facet === 'authorization') passed = proof.deniedCode === 'forbidden' && proof.authMode === subject.auth && SHA256_PATTERN.test(proof.allowedOperation);
  else if (facet === 'idempotency') passed = proof.stable === true && proof.conflictCode === 'idempotency-conflict' && proof.commits === 1;
  else if (facet === 'revision control') passed = proof.currentRevision > proof.initialRevision && proof.acceptedRevision >= proof.currentRevision && proof.staleCode === 'revision-conflict';
  else if (facet === 'persistence') passed = proof.sameReceipt === true && proof.receipts === 1 && proof.revision >= 1;
  else if (facet === 'rate limit') passed = proof.accepted === proof.limit && proof.limit === subject.rateLimit && proof.rejectedCode === 'rate-limited' && proof.resumed === true;
  else if (facet === 'observability') passed = proof.accepted === 1 && proof.rejected === 1 && proof.auditEvents === 2 && proof.auditLimit === MAX_AUDIT_EVENTS && proof.redacted === true && proof.diagnosticsDeniedCode === 'forbidden';
  else if (facet === 'fault recovery') passed = proof.recovered === true && proof.attempts === 2 && proof.commits === 1 && proof.receipts === 1;
  else passed = proof.integrated === true && proof.resultKeys === subject.resultKeys.length && proof.observed === true;
  if (!passed) throw new BackendCapabilityError('probe-failed', `${item.id} ${facet} proof failed`, 500);
  return true;
}

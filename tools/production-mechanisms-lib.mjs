import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  PRODUCTION_MECHANISM_FACETS,
  PRODUCTION_MECHANISM_SUBJECTS,
  canonicalProductionMechanismInput,
  createProductionMechanismEntry,
  normalizeProductionMechanismState,
  runProductionMechanismOracle,
  validateProductionMechanismManifest,
} from '../shared/runtime/production-mechanisms.mjs';

export const PRODUCTION_MECHANISM_MANIFEST = 'shared/fixtures/production-mechanisms-v1.json';
export const PRODUCTION_MECHANISM_SHARED_TEST = 'tests/production-mechanism-shared-evidence.test.ts';
export const PRODUCTION_MECHANISM_PHASER_TEST = 'tests/production-mechanism-phaser-evidence.test.ts';

const FACET_KIND = Object.freeze({
  'canonical representation': 'canonical',
  'input normalization': 'normalization',
  'fixed-step transition': 'fixed-step',
  'tie-break rule': 'tie-break',
  'seed consumption': 'seed',
  'invariant check': 'invariant',
  serialization: 'serialization',
  'replay event': 'replay',
  'server-client oracle': 'oracle',
  'property test': 'property',
  'edge-case fixture': 'edge',
  'overflow guard': 'overflow',
  'rollback snapshot': 'rollback',
  'desync checksum': 'desync',
  'authoritative validation': 'authority',
  'prediction boundary': 'prediction',
  reconciliation: 'reconciliation',
  'failure closure': 'failure',
  'performance bound': 'performance',
  'evidence capture': 'evidence',
});

const canonical = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
};

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

function readJson(path, label) {
  try { return JSON.parse(readFileSync(path, 'utf8')); }
  catch (error) { throw new Error(`${label} is invalid JSON: ${error instanceof Error ? error.message : String(error)}`); }
}

function assertExecutedEntry(entry, observation, repeated, interrupted, invalid, input) {
  if (!observation.ok || observation.reason !== 'accepted' || observation.id !== entry.id
    || observation.acceptanceId !== entry.acceptanceId || observation.subject !== entry.subject
    || observation.facet !== entry.facet || observation.state.revision !== input.state.revision + 1
    || observation.state.tick !== input.state.tick + 1 || observation.state.events.length !== 1
    || observation.facetProof.kind !== FACET_KIND[entry.facet]
    || observation.timing.operations > observation.timing.operationBudget
    || observation.signature.length !== 16 || observation.checksum.length !== 16) {
    throw new Error(`${entry.id} valid execution failed its deterministic contract`);
  }
  if (!repeated.ok || repeated.reason !== 'idempotent-replay'
    || canonical(repeated.state) !== canonical(input.state) || repeated.rewards.delta !== 0
    || repeated.rules.stateMutation !== false || repeated.rules.rewardMutation !== false) {
    throw new Error(`${entry.id} repeated execution was not idempotent`);
  }
  if (interrupted.ok || interrupted.reason !== 'interrupted'
    || canonical(interrupted.state) !== canonical(input.state) || interrupted.rewards.delta !== 0) {
    throw new Error(`${entry.id} interrupted execution did not fail closed`);
  }
  if (invalid.ok || invalid.reason !== 'invalid-input' || invalid.rewards.delta !== 0 || invalid.rules.stateMutation !== false) {
    throw new Error(`${entry.id} invalid execution did not fail closed`);
  }
  if (entry.subject === 'reward outcome') {
    if (!observation.rewards.grantable || observation.rewards.authority !== 'server' || observation.rewards.delta <= 0) throw new Error(`${entry.id} reward authority failed`);
  } else if (observation.rewards.grantable || observation.rewards.delta !== 0) throw new Error(`${entry.id} mutated rewards outside reward outcome`);
  const normalized = normalizeProductionMechanismState(entry.subject, observation.state, input.seed);
  if (canonical(normalized) !== canonical(observation.state)) throw new Error(`${entry.id} returned a non-canonical state`);
}

export function loadProductionMechanismCatalog({ projectRoot, ledger }) {
  const manifestPath = resolve(projectRoot, PRODUCTION_MECHANISM_MANIFEST);
  const manifest = readJson(manifestPath, 'production mechanism manifest');
  const validation = validateProductionMechanismManifest(manifest);
  const computedSha256 = sha256(canonical(manifest.entries));
  if (computedSha256 !== manifest.entriesSha256) throw new Error('production mechanism entries SHA-256 is stale');

  const ledgerItems = ledger.items.filter(({ category }) => category === 'mechanism');
  if (ledgerItems.length !== 500 || ledgerItems.some(({ clientFacing }) => clientFacing !== true)) throw new Error(`ledger contains ${ledgerItems.length}/500 client-facing mechanism items`);
  const itemById = new Map(ledgerItems.map((item) => [item.id, item]));
  const outcomes = [];
  const signatures = new Set();
  for (const entry of manifest.entries) {
    const item = itemById.get(entry.id);
    if (!item || canonical(entry) !== canonical(createProductionMechanismEntry(item))) throw new Error(`${entry.id} differs from its source-locked ledger entry`);
    const input = canonicalProductionMechanismInput(entry);
    const inputBefore = canonical(input);
    const observation = runProductionMechanismOracle(entry, input);
    const repeated = runProductionMechanismOracle(entry, { ...input, repeated: true });
    const interrupted = runProductionMechanismOracle(entry, { ...input, interrupted: true });
    const invalid = runProductionMechanismOracle(entry, {});
    assertExecutedEntry(entry, observation, repeated, interrupted, invalid, input);
    if (canonical(input) !== inputBefore) throw new Error(`${entry.id} mutated its caller-owned input`);
    if (signatures.has(observation.signature)) throw new Error(`${entry.id} duplicated a mechanism execution signature`);
    signatures.add(observation.signature);
    outcomes.push({ entry, input, observation, repeated, interrupted, invalid });
  }
  if (outcomes.length !== 500 || signatures.size !== 500
    || PRODUCTION_MECHANISM_SUBJECTS.some((subject) => outcomes.filter(({ entry }) => entry.subject === subject).length !== 20)
    || PRODUCTION_MECHANISM_FACETS.some((facet) => outcomes.filter(({ entry }) => entry.facet === facet).length !== 25)) {
    throw new Error('production mechanism execution matrix is incomplete');
  }
  return {
    manifest,
    entries: manifest.entries,
    entryById: new Map(manifest.entries.map((entry) => [entry.id, entry])),
    outcomes,
    entriesSha256: computedSha256,
    signatures: signatures.size,
    validation,
    manifestPath: PRODUCTION_MECHANISM_MANIFEST,
  };
}

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { auditLedgerEvidence, loadLedgerEvidenceFiles } from './ledger-evidence-lib.mjs';

const projectRoot = resolve('.');
const ledger = JSON.parse(readFileSync(resolve(projectRoot, 'docs/production/upgrade-ledger.json'), 'utf8'));
const fail = (message) => { throw new Error(`upgrade ledger invalid: ${message}`); };
const nonEmpty = (value) => typeof value === 'string' && value.trim().length > 0;
const safeRelativePath = (value) => nonEmpty(value) && !value.startsWith('/') && !value.includes('..') && !/^[A-Za-z]:/.test(value);

if (ledger.schemaVersion !== 3) fail('schemaVersion must be 3');
if (ledger.title !== 'PaoPao Fusion Level-100 Phaser Production Ledger') fail('title must declare the Phaser-only production scope');
if (ledger.total !== 3710) fail('total must be exactly 3710');
if (ledger.releaseCount !== 5 || ledger.itemsPerRelease !== 742) fail('release partition must be exactly 5 x 742');
if (!Array.isArray(ledger.categories) || ledger.categories.length !== 15) fail('exactly 15 primary categories are required');
if (!Array.isArray(ledger.releases) || ledger.releases.length !== 5) fail('exactly five release gates are required');
if (!Array.isArray(ledger.items) || ledger.items.length !== 3710) fail(`items must be a literal 3710-entry array, received ${ledger.items?.length ?? 'none'}`);
if (ledger.countingPolicy?.primaryCategoryOnly !== true
  || ledger.countingPolicy?.duplicateImplementationsDoNotCount !== true
  || ledger.countingPolicy?.variantsAndCompressedCopiesDoNotCount !== true
  || ledger.countingPolicy?.uniqueAcceptanceAssertionRequired !== true) {
  fail('counting policy must reject duplicate implementations, variants, compressed-copy and generic-evidence inflation');
}
if (ledger.evidenceRegistry?.schemaVersion !== 1
  || ledger.evidenceRegistry?.claimsPath !== 'docs/production/evidence/claims.json'
  || ledger.evidenceRegistry?.receiptsPath !== 'docs/production/evidence/receipts.json'
  || !nonEmpty(ledger.evidenceRegistry?.binding)) fail('machine evidence registry contract is missing');
if (/\b(?:Unity|URP|Addressables|Timeline|dual-client|cross-client)\b/i.test(JSON.stringify(ledger))) {
  fail('Phaser-only ledger contains an excluded engine or dual-client claim');
}

const expectedCategories = new Map([
  ['upgrade', [100, 20, true]],
  ['improvement', [100, 20, true]],
  ['ui', [100, 20, true]],
  ['frontend', [150, 30, true]],
  ['backend', [250, 50, false]],
  ['mechanism', [500, 100, true]],
  ['flow', [200, 40, true]],
  ['security', [10, 2, false]],
  ['rendering', [100, 20, true]],
  ['ux-element', [500, 100, true]],
  ['animated-element', [500, 100, true]],
  ['animation', [500, 100, true]],
  ['asset', [500, 100, true]],
  ['control', [100, 20, true]],
  ['hand', [100, 20, true]],
]);

const categories = new Map();
for (const category of ledger.categories) {
  if (!expectedCategories.has(category.key)) fail(`unknown category ${category.key}`);
  if (categories.has(category.key)) fail(`duplicate category ${category.key}`);
  const [total, perRelease, clientFacing] = expectedCategories.get(category.key);
  if (category.total !== total || category.perRelease !== perRelease || category.clientFacing !== clientFacing) {
    fail(`category contract mismatch for ${category.key}`);
  }
  if (!nonEmpty(category.title)) fail(`missing category title for ${category.key}`);
  categories.set(category.key, category);
}

const releaseNumbers = new Set();
for (const release of ledger.releases) {
  if (!Number.isInteger(release.release) || release.release < 1 || release.release > 5 || releaseNumbers.has(release.release)) fail(`invalid release ${release.release}`);
  releaseNumbers.add(release.release);
  if (release.assignedItems !== 742 || release.requiredVerifiedItems !== 742) fail(`release ${release.release} must assign and require exactly 742 items`);
  if (!['planned', 'active', 'closed', 'blocked'].includes(release.state)) fail(`invalid release state ${release.state}`);
  for (const field of ['slug', 'title', 'objective', 'rollback', 'entryCriteria', 'exitCriteria']) {
    if (!nonEmpty(release[field])) fail(`release ${release.release} is missing ${field}`);
  }
}

const ids = new Set();
const acceptanceIds = new Set();
const categoryCounts = new Map([...expectedCategories.keys()].map((key) => [key, 0]));
const releaseCounts = new Map([1, 2, 3, 4, 5].map((release) => [release, 0]));
const releaseCategoryCounts = new Map();
const verifiedByRelease = new Map([1, 2, 3, 4, 5].map((release) => [release, 0]));
const seenCategoryOrdinals = new Map([...expectedCategories.keys()].map((key) => [key, new Set()]));
const evidenceStates = new Set(ledger.evidenceStatePolicy);
const statusPolicy = new Set(ledger.statusPolicy);

for (let index = 0; index < ledger.items.length; index += 1) {
  const item = ledger.items[index];
  if (!item || typeof item !== 'object' || Array.isArray(item)) fail(`item ${index + 1} is not an object`);
  if (item.globalOrdinal !== index + 1) fail(`globalOrdinal discontinuity at item ${index + 1}`);
  if (!expectedCategories.has(item.category)) fail(`unknown item category ${item.category}`);
  const [categoryTotal, perRelease, clientFacing] = expectedCategories.get(item.category);
  if (!Number.isInteger(item.ordinal) || item.ordinal < 1 || item.ordinal > categoryTotal) fail(`invalid ordinal for ${item.id}`);
  const expectedId = `PF-${item.category}-${String(item.ordinal).padStart(3, '0')}`;
  if (item.id !== expectedId) fail(`ID ${item.id} does not match ${expectedId}`);
  if (ids.has(item.id)) fail(`duplicate ID ${item.id}`);
  ids.add(item.id);
  if (seenCategoryOrdinals.get(item.category).has(item.ordinal)) fail(`duplicate ordinal ${item.category}/${item.ordinal}`);
  seenCategoryOrdinals.get(item.category).add(item.ordinal);
  if (!Number.isInteger(item.release) || item.release < 1 || item.release > 5) fail(`invalid release for ${item.id}`);
  if (item.release !== Math.ceil(item.ordinal / perRelease)) fail(`category release distribution mismatch for ${item.id}`);
  if (item.clientFacing !== clientFacing) fail(`clientFacing mismatch for ${item.id}`);
  if (!nonEmpty(item.title) || !nonEmpty(item.definition)) fail(`missing title or definition for ${item.id}`);
  if (!item.definition.includes('one Phaser production outcome') && clientFacing) fail(`client-facing counting boundary missing for ${item.id}`);
  if (!item.definition.includes('not duplicated by delivery channel') && !clientFacing) fail(`service counting boundary missing for ${item.id}`);

  const acceptance = item.acceptanceTest;
  if (!acceptance || !nonEmpty(acceptance.id) || !nonEmpty(acceptance.procedure) || !nonEmpty(acceptance.expected)) fail(`incomplete acceptance test for ${item.id}`);
  if (acceptance.id !== `AT-${item.id}`) fail(`acceptance ID mismatch for ${item.id}`);
  if (acceptanceIds.has(acceptance.id)) fail(`duplicate acceptance ID ${acceptance.id}`);
  acceptanceIds.add(acceptance.id);

  const evidence = item.evidence;
  if (!evidence || !statusPolicy.has(evidence.status)) fail(`invalid evidence status for ${item.id}`);
  if (Object.keys(evidence).sort().join(',') !== 'phaser,shared,status') fail(`evidence targets must be exactly shared and phaser for ${item.id}`);
  for (const target of ['shared', 'phaser']) {
    const entry = evidence[target];
    if (!entry || !evidenceStates.has(entry.state) || !Array.isArray(entry.paths) || !Array.isArray(entry.tests) || !nonEmpty(entry.note)) {
      fail(`invalid ${target} evidence shape for ${item.id}`);
    }
    if (entry.paths.some((path) => !safeRelativePath(path)) || entry.tests.some((path) => !safeRelativePath(path))) fail(`unsafe evidence path for ${item.id}`);
    if (['implemented', 'verified'].includes(entry.state) && entry.paths.length === 0) fail(`missing implementation path for ${target} evidence on ${item.id}`);
    if (entry.state === 'verified' && entry.tests.length === 0) fail(`missing verification test for ${target} evidence on ${item.id}`);
  }
  if (clientFacing && evidence.phaser.state === 'not-applicable') fail(`client-facing Phaser evidence omitted for ${item.id}`);
  if (!clientFacing && evidence.phaser.state !== 'not-applicable') fail(`server item incorrectly claims Phaser implementation for ${item.id}`);
  if (evidence.status === 'verified') {
    if (evidence.shared.state !== 'verified') fail(`verified ${item.id} lacks shared verification`);
    if (clientFacing && evidence.phaser.state !== 'verified') fail(`verified ${item.id} lacks Phaser web verification`);
    verifiedByRelease.set(item.release, verifiedByRelease.get(item.release) + 1);
  }

  categoryCounts.set(item.category, categoryCounts.get(item.category) + 1);
  releaseCounts.set(item.release, releaseCounts.get(item.release) + 1);
  const releaseCategoryKey = `${item.release}:${item.category}`;
  releaseCategoryCounts.set(releaseCategoryKey, (releaseCategoryCounts.get(releaseCategoryKey) ?? 0) + 1);
}

if (ids.size !== 3710 || acceptanceIds.size !== 3710) fail('ID coverage must be exactly 3710');
for (const [key, [total, perRelease]] of expectedCategories) {
  if (categoryCounts.get(key) !== total) fail(`${key} total is ${categoryCounts.get(key)}, expected ${total}`);
  if (seenCategoryOrdinals.get(key).size !== total) fail(`${key} ordinal coverage is incomplete`);
  for (let release = 1; release <= 5; release += 1) {
    const actual = releaseCategoryCounts.get(`${release}:${key}`) ?? 0;
    if (actual !== perRelease) fail(`release ${release} ${key} count is ${actual}, expected ${perRelease}`);
  }
}
for (let release = 1; release <= 5; release += 1) {
  if (releaseCounts.get(release) !== 742) fail(`release ${release} count is ${releaseCounts.get(release)}, expected 742`);
  const gate = ledger.releases.find((entry) => entry.release === release);
  if (gate.state === 'closed' && verifiedByRelease.get(release) !== 742) fail(`closed release ${release} has only ${verifiedByRelease.get(release)} verified items`);
}

const expectedAssetGroups = new Map([
  ['characters-orbs-bosses-rigs', [100, 20]],
  ['environment-models-props', [100, 20]],
  ['material-texture-vfx-packs', [100, 20]],
  ['ui-icons-illustrations', [80, 16]],
  ['music-ambience-sfx', [60, 12]],
  ['cinematic-sequences', [40, 8]],
  ['tutorial-accessibility-promotion', [20, 4]],
]);
const assetCounts = new Map([...expectedAssetGroups.keys()].map((key) => [key, 0]));
const assetReleaseCounts = new Map();
for (const item of ledger.items.filter(({ category }) => category === 'asset')) {
  if (!expectedAssetGroups.has(item.assetAllocation)) fail(`invalid asset allocation for ${item.id}`);
  assetCounts.set(item.assetAllocation, assetCounts.get(item.assetAllocation) + 1);
  const key = `${item.release}:${item.assetAllocation}`;
  assetReleaseCounts.set(key, (assetReleaseCounts.get(key) ?? 0) + 1);
}
for (const [key, [total, perRelease]] of expectedAssetGroups) {
  if (assetCounts.get(key) !== total) fail(`asset allocation ${key} count is ${assetCounts.get(key)}, expected ${total}`);
  for (let release = 1; release <= 5; release += 1) {
    if ((assetReleaseCounts.get(`${release}:${key}`) ?? 0) !== perRelease) fail(`release ${release} asset allocation ${key} mismatch`);
  }
}

let evidenceAudit;
try {
  const { claims, receipt } = loadLedgerEvidenceFiles(projectRoot, ledger);
  evidenceAudit = auditLedgerEvidence({ ledger, projectRoot, claims, receipt });
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
if (evidenceAudit.verifiedItems !== [...verifiedByRelease.values()].reduce((sum, count) => sum + count, 0)) {
  fail('ledger verified count differs from machine evidence receipts');
}

console.log(`ledger ok: ${ids.size} literal unique items; releases ${[1, 2, 3, 4, 5].map((release) => `${release}=${releaseCounts.get(release)}`).join(', ')}; verified=${evidenceAudit.verifiedItems}; acceptance-claims=${evidenceAudit.claims}`);

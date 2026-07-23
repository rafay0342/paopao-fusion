import { createHash } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  readFileSync,
  realpathSync,
} from 'node:fs';
import { relative, resolve, sep } from 'node:path';

export const EVIDENCE_RUNNER_VERSION = 1;
export const DEFAULT_CLAIMS_PATH = 'docs/production/evidence/claims.json';
export const DEFAULT_RECEIPTS_PATH = 'docs/production/evidence/receipts.json';

const nonEmpty = (value) => typeof value === 'string' && value.trim().length > 0;
const plainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (plainObject(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function sha256File(path) {
  return sha256(readFileSync(path));
}

export function isSafeRelativePath(value) {
  if (!nonEmpty(value) || value.startsWith('/') || value.includes('\\') || /^[A-Za-z]:/.test(value)) return false;
  const segments = value.split('/');
  return !segments.some((segment) => segment === '' || segment === '.' || segment === '..' || /[\u0000-\u001f]/.test(segment));
}

function isInside(parent, child) {
  const path = relative(parent, child);
  return path === '' || (!path.startsWith(`..${sep}`) && path !== '..' && !path.startsWith(sep));
}

export function resolveEvidenceFile(projectRoot, relativePath) {
  if (!isSafeRelativePath(relativePath)) throw new Error(`unsafe evidence path ${String(relativePath)}`);
  const absolute = resolve(projectRoot, relativePath);
  if (!isInside(projectRoot, absolute)) throw new Error(`evidence path escaped project root: ${relativePath}`);
  if (!existsSync(absolute) || !lstatSync(absolute).isFile()) throw new Error(`evidence file does not exist: ${relativePath}`);
  const realRoot = realpathSync(projectRoot);
  const realFile = realpathSync(absolute);
  if (!isInside(realRoot, realFile)) throw new Error(`evidence file resolves outside project root: ${relativePath}`);
  return absolute;
}

export function ledgerContract(ledger) {
  return {
    schemaVersion: ledger.schemaVersion,
    title: ledger.title,
    total: ledger.total,
    releaseCount: ledger.releaseCount,
    itemsPerRelease: ledger.itemsPerRelease,
    items: ledger.items.map((item) => ({
      id: item.id,
      category: item.category,
      ordinal: item.ordinal,
      title: item.title,
      definition: item.definition,
      release: item.release,
      clientFacing: item.clientFacing,
      acceptanceTest: item.acceptanceTest,
      ...(item.assetAllocation ? { assetAllocation: item.assetAllocation } : {}),
    })),
  };
}

export function ledgerContractSha256(ledger) {
  return sha256(canonicalJson(ledgerContract(ledger)));
}

export function acceptanceContractSha256(item) {
  return sha256(canonicalJson({
    id: item.id,
    category: item.category,
    release: item.release,
    clientFacing: item.clientFacing,
    definition: item.definition,
    acceptanceTest: item.acceptanceTest,
  }));
}

export function readJsonFile(path, label) {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  return parsed;
}

export function loadLedgerEvidenceFiles(projectRoot, ledger = null) {
  const registry = ledger?.evidenceRegistry;
  const claimsPath = registry?.claimsPath ?? DEFAULT_CLAIMS_PATH;
  const receiptsPath = registry?.receiptsPath ?? DEFAULT_RECEIPTS_PATH;
  return {
    claimsPath,
    receiptsPath,
    claims: readJsonFile(resolveEvidenceFile(projectRoot, claimsPath), 'ledger evidence claims'),
    receipt: readJsonFile(resolveEvidenceFile(projectRoot, receiptsPath), 'ledger evidence receipts'),
  };
}

function exactKeys(object, expected, label) {
  if (!plainObject(object)) throw new Error(`${label} must be an object`);
  const actual = Object.keys(object).sort();
  const wanted = [...expected].sort();
  if (actual.join('\0') !== wanted.join('\0')) {
    throw new Error(`${label} keys must be exactly ${wanted.join(', ')}`);
  }
}

function uniqueStrings(values, label, { allowEmpty = false } = {}) {
  if (!Array.isArray(values) || (!allowEmpty && values.length === 0)) throw new Error(`${label} must be a${allowEmpty ? '' : ' non-empty'} string array`);
  if (values.some((value) => !nonEmpty(value))) throw new Error(`${label} contains a blank value`);
  if (new Set(values).size !== values.length) throw new Error(`${label} contains a duplicate value`);
}

export function validateEvidenceClaims({ ledger, projectRoot, claims }) {
  exactKeys(claims, ['schemaVersion', 'ledgerSchemaVersion', 'policy', 'claims'], 'evidence claims registry');
  if (claims.schemaVersion !== 1) throw new Error('evidence claims schemaVersion must be 1');
  if (claims.ledgerSchemaVersion !== ledger.schemaVersion) throw new Error('evidence claims ledgerSchemaVersion does not match the ledger');
  exactKeys(claims.policy, ['oneClaimPerItemTarget', 'uniqueAssertionPerClaim', 'exactTestCaseRequired', 'sourceHashesRequired'], 'evidence claims policy');
  if (Object.values(claims.policy).some((value) => value !== true)) throw new Error('every evidence anti-inflation policy must be enabled');
  if (!Array.isArray(claims.claims)) throw new Error('evidence claims must be an array');

  const itemById = new Map(ledger.items.map((item) => [item.id, item]));
  const claimIds = new Set();
  const assertionIds = new Set();
  const itemTargets = new Set();
  const testCases = new Set();

  for (const [index, claim] of claims.claims.entries()) {
    const label = `evidence claim ${index + 1}`;
    exactKeys(claim, ['claimId', 'assertionId', 'itemId', 'acceptanceId', 'target', 'implementationPaths', 'test', 'note'], label);
    const item = itemById.get(claim.itemId);
    if (!item) throw new Error(`${label} references unknown item ${String(claim.itemId)}`);
    if (!['shared', 'phaser'].includes(claim.target)) throw new Error(`${label} has invalid target ${String(claim.target)}`);
    if (!item.clientFacing && claim.target === 'phaser') throw new Error(`${label} claims Phaser evidence for non-client item ${item.id}`);
    if (claim.acceptanceId !== item.acceptanceTest.id) throw new Error(`${label} acceptanceId does not match ${item.id}`);
    if (claim.claimId !== `EC-${item.id}-${claim.target}`) throw new Error(`${label} claimId must be EC-${item.id}-${claim.target}`);
    if (claim.assertionId !== `AE-${item.acceptanceTest.id}-${claim.target}`) {
      throw new Error(`${label} assertionId must be AE-${item.acceptanceTest.id}-${claim.target}`);
    }
    if (!nonEmpty(claim.note) || claim.note.trim().length < 24) throw new Error(`${label} needs a specific evidence note`);
    uniqueStrings(claim.implementationPaths, `${label} implementationPaths`);
    for (const path of claim.implementationPaths) resolveEvidenceFile(projectRoot, path);
    exactKeys(claim.test, ['path', 'fullName'], `${label} test`);
    if (!isSafeRelativePath(claim.test.path) || !/^tests\/.+\.test\.[cm]?[jt]sx?$/.test(claim.test.path)) {
      throw new Error(`${label} test.path must name a project test file`);
    }
    resolveEvidenceFile(projectRoot, claim.test.path);
    if (!nonEmpty(claim.test.fullName)) throw new Error(`${label} needs an exact test fullName`);
    const token = `[${item.acceptanceTest.id}][${claim.target}]`;
    if (!claim.test.fullName.includes(token)) throw new Error(`${label} test.fullName must include the unique token ${token}`);

    const itemTarget = `${item.id}\0${claim.target}`;
    const testCase = `${claim.test.path}\0${claim.test.fullName}`;
    if (claimIds.has(claim.claimId)) throw new Error(`duplicate evidence claimId ${claim.claimId}`);
    if (assertionIds.has(claim.assertionId)) throw new Error(`duplicate evidence assertionId ${claim.assertionId}`);
    if (itemTargets.has(itemTarget)) throw new Error(`multiple evidence claims target ${item.id}/${claim.target}`);
    if (testCases.has(testCase)) throw new Error(`one exact test case cannot verify multiple ledger claims: ${claim.test.fullName}`);
    claimIds.add(claim.claimId);
    assertionIds.add(claim.assertionId);
    itemTargets.add(itemTarget);
    testCases.add(testCase);
  }
  return { claimCount: claims.claims.length, itemById };
}

export function claimsSha256(claims) {
  return sha256(canonicalJson(claims));
}

function currentClaimResult({ ledger, projectRoot, claim, status }) {
  const item = ledger.items.find(({ id }) => id === claim.itemId);
  return {
    claimId: claim.claimId,
    assertionId: claim.assertionId,
    itemId: claim.itemId,
    acceptanceId: claim.acceptanceId,
    target: claim.target,
    status,
    acceptanceSha256: acceptanceContractSha256(item),
    implementation: claim.implementationPaths.map((path) => ({
      path,
      sha256: sha256File(resolveEvidenceFile(projectRoot, path)),
    })),
    test: {
      path: claim.test.path,
      fullName: claim.test.fullName,
      sha256: sha256File(resolveEvidenceFile(projectRoot, claim.test.path)),
    },
  };
}

export function buildEvidenceReceipt({ ledger, projectRoot, claims, outcomes, generatedAt = new Date().toISOString(), runner = null }) {
  validateEvidenceClaims({ ledger, projectRoot, claims });
  const outcomeFor = outcomes instanceof Map ? (id) => outcomes.get(id) : (id) => outcomes[id];
  const results = claims.claims.map((claim) => {
    const status = outcomeFor(claim.assertionId);
    if (!['passed', 'failed'].includes(status)) throw new Error(`missing passed/failed outcome for ${claim.assertionId}`);
    return currentClaimResult({ ledger, projectRoot, claim, status });
  });
  return {
    schemaVersion: 1,
    runner: runner ?? {
      name: 'paopao-ledger-evidence',
      version: EVIDENCE_RUNNER_VERSION,
      framework: 'vitest',
    },
    generatedAt,
    ledgerContractSha256: ledgerContractSha256(ledger),
    claimsSha256: claimsSha256(claims),
    results,
  };
}

export function validateEvidenceReceipt({ ledger, projectRoot, claims, receipt }) {
  validateEvidenceClaims({ ledger, projectRoot, claims });
  exactKeys(receipt, ['schemaVersion', 'runner', 'generatedAt', 'ledgerContractSha256', 'claimsSha256', 'results'], 'evidence receipt');
  if (receipt.schemaVersion !== 1) throw new Error('evidence receipt schemaVersion must be 1');
  exactKeys(receipt.runner, ['name', 'version', 'framework'], 'evidence receipt runner');
  if (receipt.runner.name !== 'paopao-ledger-evidence' || receipt.runner.version !== EVIDENCE_RUNNER_VERSION || receipt.runner.framework !== 'vitest') {
    throw new Error('evidence receipt was not produced by the supported runner');
  }
  if (!nonEmpty(receipt.generatedAt) || Number.isNaN(Date.parse(receipt.generatedAt))) throw new Error('evidence receipt generatedAt is invalid');
  if (receipt.ledgerContractSha256 !== ledgerContractSha256(ledger)) throw new Error('evidence receipt ledger contract hash is stale');
  if (receipt.claimsSha256 !== claimsSha256(claims)) throw new Error('evidence receipt claims hash is stale');
  if (!Array.isArray(receipt.results) || receipt.results.length !== claims.claims.length) throw new Error('evidence receipt must contain exactly one result per claim');

  const resultByClaim = new Map();
  for (const result of receipt.results) {
    if (!plainObject(result) || !nonEmpty(result.claimId) || resultByClaim.has(result.claimId)) throw new Error('evidence receipt has a missing or duplicate claim result');
    resultByClaim.set(result.claimId, result);
  }
  for (const claim of claims.claims) {
    const result = resultByClaim.get(claim.claimId);
    if (!result) throw new Error(`evidence receipt is missing ${claim.claimId}`);
    if (!['passed', 'failed'].includes(result.status)) throw new Error(`invalid result status for ${claim.claimId}`);
    const expected = currentClaimResult({ ledger, projectRoot, claim, status: result.status });
    if (canonicalJson(result) !== canonicalJson(expected)) throw new Error(`evidence receipt is stale or malformed for ${claim.claimId}`);
  }
  return {
    claims: claims.claims.length,
    passedClaims: receipt.results.filter(({ status }) => status === 'passed').length,
    failedClaims: receipt.results.filter(({ status }) => status === 'failed').length,
    resultByClaim,
  };
}

export function plannedEvidence(clientFacing) {
  const pending = (note) => ({ state: 'planned', paths: [], tests: [], note });
  return {
    status: 'planned',
    shared: pending('Acceptance evidence has not yet been attached; this item earns no release-gate credit.'),
    phaser: clientFacing
      ? pending('Phaser implementation and test evidence are required before verification.')
      : { state: 'not-applicable', paths: [], tests: [], note: 'This server or operational item is not implemented inside a client.' },
  };
}

export function materializeLedgerEvidence({ ledger, projectRoot, claims, receipt }) {
  const validation = validateEvidenceReceipt({ ledger, projectRoot, claims, receipt });
  const itemById = new Map(ledger.items.map((item) => [item.id, item]));
  for (const item of ledger.items) item.evidence = plannedEvidence(item.clientFacing);

  for (const claim of claims.claims) {
    const item = itemById.get(claim.itemId);
    const result = validation.resultByClaim.get(claim.claimId);
    const passed = result.status === 'passed';
    item.evidence[claim.target] = {
      state: passed ? 'verified' : 'implemented',
      paths: [...claim.implementationPaths],
      tests: [claim.test.path],
      note: passed
        ? `${claim.note} Verified by ${claim.assertionId}; current source hashes match the evidence receipt.`
        : `${claim.note} ${claim.assertionId} failed its current acceptance run, so this target earns no gate credit.`,
    };
  }

  for (const item of ledger.items) {
    const requiredTargets = item.clientFacing ? ['shared', 'phaser'] : ['shared'];
    if (requiredTargets.every((target) => item.evidence[target].state === 'verified')) item.evidence.status = 'verified';
    else if (requiredTargets.some((target) => ['implemented', 'verified'].includes(item.evidence[target].state))) item.evidence.status = 'implemented';
  }

  // A release gate is a derived evidence result, not an operator assertion.
  // This keeps `closed` impossible until every one of its 742 acceptance IDs
  // has a current passing receipt and automatically reopens a stale gate.
  if (Array.isArray(ledger.releases)) {
    for (const gate of ledger.releases) {
      const verified = ledger.items.filter((item) => item.release === gate.release
        && item.evidence.status === 'verified').length;
      if (verified === gate.requiredVerifiedItems && gate.requiredVerifiedItems === 742) gate.state = 'closed';
      else if (gate.state === 'closed') gate.state = 'planned';
    }
  }
  return ledger;
}

export function auditLedgerEvidence({ ledger, projectRoot, claims, receipt }) {
  const clone = JSON.parse(JSON.stringify(ledger));
  materializeLedgerEvidence({ ledger: clone, projectRoot, claims, receipt });
  for (let index = 0; index < ledger.items.length; index += 1) {
    if (canonicalJson(ledger.items[index].evidence) !== canonicalJson(clone.items[index].evidence)) {
      throw new Error(`ledger evidence does not match the machine receipt for ${ledger.items[index].id}`);
    }
  }
  const verifiedItems = ledger.items.filter(({ evidence }) => evidence.status === 'verified');
  const verifiedByRelease = Object.fromEntries([1, 2, 3, 4, 5].map((release) => [
    release,
    verifiedItems.filter((item) => item.release === release).length,
  ]));
  return {
    claims: claims.claims.length,
    passedClaims: receipt.results.filter(({ status }) => status === 'passed').length,
    verifiedItems: verifiedItems.length,
    verifiedByRelease,
  };
}

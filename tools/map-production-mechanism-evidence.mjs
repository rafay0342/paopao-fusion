import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { productionMechanismTestFullName } from '../shared/runtime/production-mechanisms.mjs';
import {
  loadLedgerEvidenceFiles,
  readJsonFile,
  validateEvidenceClaims,
} from './ledger-evidence-lib.mjs';
import {
  PRODUCTION_MECHANISM_MANIFEST,
  PRODUCTION_MECHANISM_PHASER_TEST,
  PRODUCTION_MECHANISM_SHARED_TEST,
  loadProductionMechanismCatalog,
} from './production-mechanisms-lib.mjs';

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const ledgerPath = resolve(projectRoot, 'docs/production/upgrade-ledger.json');
const command = process.argv[2] ?? 'check';

const normalizedRelative = (path) => relative(projectRoot, path).replaceAll('\\', '/');
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

function executeStrictTests(expectedNames) {
  const temporaryRoot = mkdtempSync(resolve(tmpdir(), 'paopao-production-mechanisms-'));
  const reportPath = resolve(temporaryRoot, 'vitest-report.json');
  try {
    const result = spawnSync(process.execPath, [
      resolve(projectRoot, 'node_modules/vitest/vitest.mjs'),
      'run',
      PRODUCTION_MECHANISM_SHARED_TEST,
      PRODUCTION_MECHANISM_PHASER_TEST,
      '--pool=threads',
      '--maxWorkers=1',
      '--reporter=json',
      `--outputFile=${reportPath}`,
    ], {
      cwd: projectRoot,
      encoding: 'utf8',
      windowsHide: true,
      maxBuffer: 64 * 1024 * 1024,
    });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`production mechanism tests failed with exit ${result.status}: ${result.stderr || result.stdout}`);
    let report;
    try { report = JSON.parse(readFileSync(reportPath, 'utf8')); }
    catch { throw new Error('production mechanism Vitest report is missing or invalid'); }
    const assertions = [];
    for (const testResult of report.testResults ?? []) {
      const path = normalizedRelative(testResult.name);
      if (![PRODUCTION_MECHANISM_SHARED_TEST, PRODUCTION_MECHANISM_PHASER_TEST].includes(path)) throw new Error(`unexpected mechanism evidence test file ${testResult.name}`);
      assertions.push(...(testResult.assertionResults ?? []));
    }
    const observed = new Map();
    for (const assertion of assertions) {
      const statuses = observed.get(assertion.fullName) ?? [];
      statuses.push(assertion.status);
      observed.set(assertion.fullName, statuses);
    }
    const expected = new Set(expectedNames);
    const missing = expectedNames.filter((name) => !observed.has(name));
    const unexpected = [...observed.keys()].filter((name) => !expected.has(name));
    const invalid = expectedNames.filter((name) => {
      const statuses = observed.get(name) ?? [];
      return statuses.length !== 1 || statuses[0] !== 'passed';
    });
    if (assertions.length !== 1000 || observed.size !== 1000 || expected.size !== 1000
      || missing.length || unexpected.length || invalid.length) {
      throw new Error(`mechanism evidence mismatch: ${assertions.length}/1000 assertions, ${missing.length} missing, ${unexpected.length} unexpected, ${invalid.length} failed or duplicated`);
    }
    return { assertions: assertions.length, files: report.testResults.length };
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

function buildClaims(entries) {
  const claims = [];
  for (const entry of entries) {
    for (const target of ['shared', 'phaser']) {
      claims.push({
        claimId: `EC-${entry.id}-${target}`,
        assertionId: `AE-${entry.acceptanceId}-${target}`,
        itemId: entry.id,
        acceptanceId: entry.acceptanceId,
        target,
        implementationPaths: target === 'shared'
          ? [
            PRODUCTION_MECHANISM_MANIFEST,
            'shared/runtime/production-mechanisms.mjs',
            'shared/runtime/production-mechanisms.d.mts',
          ]
          : [
            PRODUCTION_MECHANISM_MANIFEST,
            'shared/runtime/production-mechanisms.mjs',
            'shared/runtime/production-mechanisms.d.mts',
            'src/game/production-mechanisms.ts',
          ],
        test: {
          path: target === 'shared' ? PRODUCTION_MECHANISM_SHARED_TEST : PRODUCTION_MECHANISM_PHASER_TEST,
          fullName: productionMechanismTestFullName(entry, target),
        },
        note: target === 'shared'
          ? `${entry.id} executes ${entry.subject} ${entry.facet} with canonical fixed-step, valid, invalid, repeated and interrupted state paths in the shared authority oracle.`
          : `${entry.id} executes ${entry.subject} ${entry.facet} through the Phaser adapter and its live grid, matcher, projectile, objective, power or replay gameplay probe.`,
      });
    }
  }
  return claims;
}

function mergeClaimsOptimistically({ ledger, claimsPath, mapped }) {
  for (let attempt = 1; attempt <= 8; attempt += 1) {
    const before = readFileSync(claimsPath, 'utf8');
    const beforeHash = sha256(before);
    const current = JSON.parse(before);
    const retained = current.claims.filter(({ itemId }) => !itemId.startsWith('PF-mechanism-'));
    const next = { ...current, claims: [...retained, ...mapped].sort((left, right) => left.claimId.localeCompare(right.claimId)) };
    validateEvidenceClaims({ ledger, projectRoot, claims: next });
    const temporary = `${claimsPath}.${process.pid}.${Date.now()}.${attempt}.tmp`;
    mkdirSync(dirname(claimsPath), { recursive: true });
    writeFileSync(temporary, `${JSON.stringify(next, null, 2)}\n`, { flag: 'wx' });
    if (sha256(readFileSync(claimsPath, 'utf8')) !== beforeHash) {
      unlinkSync(temporary);
      continue;
    }
    renameSync(temporary, claimsPath);
    const after = JSON.parse(readFileSync(claimsPath, 'utf8'));
    const afterIds = new Set(after.claims.map(({ claimId }) => claimId));
    if (next.claims.length !== after.claims.length || next.claims.some(({ claimId }) => !afterIds.has(claimId))) {
      throw new Error('claims registry post-merge verification lost a retained or mechanism claim');
    }
    return { retainedClaims: retained.length, totalClaims: next.claims.length, attempt };
  }
  throw new Error('claims registry changed during every atomic mechanism merge attempt');
}

function comparable(claim) {
  return JSON.stringify(claim);
}

try {
  if (!['check', 'map'].includes(command)) throw new Error('use check or map');
  const ledger = readJsonFile(ledgerPath, 'upgrade ledger');
  const audit = loadProductionMechanismCatalog({ projectRoot, ledger });
  const mapped = buildClaims(audit.entries);
  if (mapped.length !== 1000 || new Set(mapped.map(({ claimId }) => claimId)).size !== 1000
    || new Set(mapped.map(({ assertionId }) => assertionId)).size !== 1000
    || new Set(mapped.map(({ test }) => `${test.path}\0${test.fullName}`)).size !== 1000) {
    throw new Error('mechanism evidence mapping is not exactly 1000 unique claims, assertions and test cases');
  }
  const execution = executeStrictTests(mapped.map(({ test }) => test.fullName));
  const { claims, claimsPath: relativeClaimsPath } = loadLedgerEvidenceFiles(projectRoot, ledger);
  const claimsPath = resolve(projectRoot, relativeClaimsPath);
  if (command === 'map') {
    const merged = mergeClaimsOptimistically({ ledger, claimsPath, mapped });
    console.log(JSON.stringify({
      command,
      mechanisms: audit.entries.length,
      mappedClaims: mapped.length,
      exactPassedAssertions: execution.assertions,
      subjects: 25,
      facets: 20,
      entriesSha256: audit.entriesSha256,
      ...merged,
      next: ['node tools/map-production-mechanism-evidence.mjs check', 'node tools/verify-ledger-evidence.mjs run'],
    }, null, 2));
  } else {
    const actual = claims.claims.filter(({ itemId }) => itemId.startsWith('PF-mechanism-')).sort((left, right) => left.claimId.localeCompare(right.claimId));
    const expected = [...mapped].sort((left, right) => left.claimId.localeCompare(right.claimId));
    if (actual.length !== 1000 || actual.some((claim, index) => comparable(claim) !== comparable(expected[index]))) {
      throw new Error(`claims registry contains ${actual.length}/1000 exact production mechanism claims; run map first`);
    }
    console.log(JSON.stringify({
      command,
      mechanisms: audit.entries.length,
      mappedClaims: actual.length,
      exactPassedAssertions: execution.assertions,
      behaviorFingerprints: audit.signatures,
      entriesSha256: audit.entriesSha256,
    }, null, 2));
  }
} catch (error) {
  console.error(`production-mechanism-evidence: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}

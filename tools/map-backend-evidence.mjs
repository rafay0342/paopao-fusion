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
import { backendCapabilityTestFullName } from '../shared/runtime/backend-capabilities.mjs';
import {
  loadLedgerEvidenceFiles,
  readJsonFile,
  validateEvidenceClaims,
} from './ledger-evidence-lib.mjs';

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const ledgerPath = resolve(projectRoot, 'docs/production/upgrade-ledger.json');
const testPath = 'tests/backend-capability-evidence.test.ts';
const command = process.argv[2] ?? 'check';

function normalizedRelative(path) {
  return relative(projectRoot, path).replaceAll('\\', '/');
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function executeStrictTests(expectedNames) {
  const temporaryRoot = mkdtempSync(resolve(tmpdir(), 'paopao-backend-capabilities-'));
  const reportPath = resolve(temporaryRoot, 'vitest-report.json');
  try {
    const result = spawnSync(process.execPath, [
      resolve(projectRoot, 'node_modules/vitest/vitest.mjs'),
      'run',
      testPath,
      '--pool=threads',
      '--maxWorkers=1',
      '--reporter=json',
      `--outputFile=${reportPath}`,
    ], {
      cwd: projectRoot,
      encoding: 'utf8',
      windowsHide: true,
      maxBuffer: 32 * 1024 * 1024,
    });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`backend capability tests failed with exit ${result.status}: ${result.stderr || result.stdout}`);
    let report;
    try { report = JSON.parse(readFileSync(reportPath, 'utf8')); }
    catch { throw new Error('backend capability Vitest report is missing or invalid'); }
    const assertions = [];
    for (const testResult of report.testResults ?? []) {
      if (normalizedRelative(testResult.name) !== testPath) throw new Error(`unexpected evidence test file ${testResult.name}`);
      assertions.push(...(testResult.assertionResults ?? []));
    }
    const observed = new Map();
    for (const assertion of assertions) {
      const values = observed.get(assertion.fullName) ?? [];
      values.push(assertion.status);
      observed.set(assertion.fullName, values);
    }
    const expected = new Set(expectedNames);
    const missing = expectedNames.filter((name) => !observed.has(name));
    const unexpected = [...observed.keys()].filter((name) => !expected.has(name));
    const invalid = expectedNames.filter((name) => {
      const statuses = observed.get(name) ?? [];
      return statuses.length !== 1 || statuses[0] !== 'passed';
    });
    if (assertions.length !== 250 || observed.size !== 250 || missing.length || unexpected.length || invalid.length) {
      throw new Error(`backend evidence mismatch: ${assertions.length}/250 assertions, ${missing.length} missing, ${unexpected.length} unexpected, ${invalid.length} failed or duplicated`);
    }
    return assertions.length;
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

function mergeClaimsOptimistically({ ledger, claimsPath, mapped }) {
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const before = readFileSync(claimsPath, 'utf8');
    const beforeHash = sha256(before);
    const current = JSON.parse(before);
    const retained = current.claims.filter(({ itemId, target }) => !(itemId.startsWith('PF-backend-') && target === 'shared'));
    const next = {
      ...current,
      claims: [...retained, ...mapped].sort((left, right) => left.claimId.localeCompare(right.claimId)),
    };
    validateEvidenceClaims({ ledger, projectRoot, claims: next });
    mkdirSync(dirname(claimsPath), { recursive: true });
    const temporary = `${claimsPath}.${process.pid}.${Date.now()}.${attempt}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(next, null, 2)}\n`, { flag: 'wx' });
    if (sha256(readFileSync(claimsPath, 'utf8')) !== beforeHash) {
      unlinkSync(temporary);
      continue;
    }
    renameSync(temporary, claimsPath);
    return { retainedClaims: retained.length, totalClaims: next.claims.length };
  }
  throw new Error('claims registry changed during every atomic merge attempt');
}

try {
  if (!['check', 'map'].includes(command)) throw new Error('use check or map');
  const ledger = readJsonFile(ledgerPath, 'upgrade ledger');
  const items = ledger.items.filter(({ category }) => category === 'backend');
  if (items.length !== 250) throw new Error(`ledger has ${items.length}/250 backend items`);
  for (let index = 0; index < items.length; index += 1) {
    if (items[index].ordinal !== index + 1 || items[index].clientFacing !== false) {
      throw new Error(`backend ledger sequence is invalid at ${items[index].id}`);
    }
  }
  const expectedNames = items.map(backendCapabilityTestFullName);
  if (new Set(expectedNames).size !== 250) throw new Error('backend evidence names are not 250 unique targets');
  const assertions = executeStrictTests(expectedNames);
  if (command === 'check') {
    console.log(JSON.stringify({ command, backendCapabilities: items.length, exactPassedAssertions: assertions }, null, 2));
  } else {
    const { claimsPath: relativeClaimsPath } = loadLedgerEvidenceFiles(projectRoot, ledger);
    const claimsPath = resolve(projectRoot, relativeClaimsPath);
    const mapped = items.map((item) => ({
      claimId: `EC-${item.id}-shared`,
      assertionId: `AE-${item.acceptanceTest.id}-shared`,
      itemId: item.id,
      acceptanceId: item.acceptanceTest.id,
      target: 'shared',
      implementationPaths: [
        'shared/runtime/backend-capabilities.mjs',
        'shared/runtime/backend-capabilities.d.mts',
        ...(item.title.endsWith(' — persistence') ? ['server/backend-capabilities.mjs'] : []),
      ],
      test: { path: testPath, fullName: backendCapabilityTestFullName(item) },
      note: item.title.endsWith(' — persistence')
        ? `${item.id} reopens its durable SQLite repository and verifies the same bounded operation receipt through the subject adapter.`
        : `${item.id} executes its bounded ${item.title} policy through the authoritative service repository and subject adapter.`,
    }));
    const merged = mergeClaimsOptimistically({ ledger, claimsPath, mapped });
    console.log(JSON.stringify({ command, mappedBackendClaims: mapped.length, exactPassedAssertions: assertions, ...merged }, null, 2));
  }
} catch (error) {
  console.error(`backend-evidence: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}

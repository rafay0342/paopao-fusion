import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadLedgerEvidenceFiles,
  readJsonFile,
  validateEvidenceClaims,
} from './ledger-evidence-lib.mjs';
import {
  PRODUCTION_RUNTIME_MANIFEST,
  PRODUCTION_RUNTIME_TEST,
  productionRuntimeTestFullName,
  validateProductionRuntime,
} from './production-runtime-lib.mjs';

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const ledgerPath = resolve(projectRoot, 'docs', 'production', 'upgrade-ledger.json');
const command = process.argv[2] ?? 'check';

function atomicJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
  renameSync(temporary, path);
}

function normalizedRelative(path) {
  return relative(projectRoot, path).replaceAll('\\', '/');
}

function executeStrictRuntimeTests(expectedNames) {
  const temporaryRoot = mkdtempSync(resolve(tmpdir(), 'paopao-production-runtime-'));
  const reportPath = resolve(temporaryRoot, 'vitest-report.json');
  try {
    const result = spawnSync(process.execPath, [
      resolve(projectRoot, 'node_modules', 'vitest', 'vitest.mjs'),
      'run',
      PRODUCTION_RUNTIME_TEST,
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
    if (result.status !== 0) {
      throw new Error(`runtime evidence tests failed with exit ${result.status}: ${result.stderr || result.stdout}`);
    }
    let report;
    try { report = JSON.parse(readFileSync(reportPath, 'utf8')); }
    catch { throw new Error('runtime evidence test report is missing or invalid'); }
    const assertions = [];
    for (const testResult of report.testResults ?? []) {
      if (normalizedRelative(testResult.name) !== PRODUCTION_RUNTIME_TEST) {
        throw new Error(`runtime evidence runner executed unexpected test file ${testResult.name}`);
      }
      assertions.push(...(testResult.assertionResults ?? []));
    }
    if (assertions.length !== expectedNames.length) {
      throw new Error(`runtime evidence emitted ${assertions.length}/${expectedNames.length} exact assertions`);
    }
    const observed = new Map();
    for (const assertion of assertions) {
      const statuses = observed.get(assertion.fullName) ?? [];
      statuses.push(assertion.status);
      observed.set(assertion.fullName, statuses);
    }
    const expected = new Set(expectedNames);
    const unexpected = [...observed.keys()].filter((name) => !expected.has(name));
    const missing = expectedNames.filter((name) => !observed.has(name));
    const invalid = expectedNames.filter((name) => {
      const statuses = observed.get(name) ?? [];
      return statuses.length !== 1 || statuses[0] !== 'passed';
    });
    if (unexpected.length || missing.length || invalid.length || observed.size !== expectedNames.length) {
      throw new Error(`runtime evidence mismatch: ${missing.length} missing, ${unexpected.length} unexpected, ${invalid.length} failed/duplicate`);
    }
    return { assertions: assertions.length, runnerExitCode: result.status };
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

try {
  if (!['check', 'map'].includes(command)) throw new Error('use check or map');
  const ledger = readJsonFile(ledgerPath, 'upgrade ledger');
  const audit = validateProductionRuntime({ ledger, projectRoot, requireComplete: true });
  const expectedNames = audit.manifest.entries.map(({ id }) => productionRuntimeTestFullName(id));
  if (new Set(expectedNames).size !== 500) throw new Error('runtime evidence names are not 500 unique acceptance targets');
  const execution = executeStrictRuntimeTests(expectedNames);

  if (command === 'check') {
    console.log(JSON.stringify({
      command,
      runtimeAssets: audit.total,
      runtimeBytes: audit.runtimeBytes,
      exactPassedAssertions: execution.assertions,
      manifestSha256: audit.manifestSha256,
    }, null, 2));
  } else {
    const { claims, claimsPath } = loadLedgerEvidenceFiles(projectRoot, ledger);
    const retained = claims.claims.filter(({ itemId, target }) => !(itemId.startsWith('PF-asset-') && target === 'phaser'));
    const mapped = audit.manifest.entries.map((entry) => ({
      claimId: `EC-${entry.id}-phaser`,
      assertionId: `AE-AT-${entry.id}-phaser`,
      itemId: entry.id,
      acceptanceId: `AT-${entry.id}`,
      target: 'phaser',
      implementationPaths: [
        `public${entry.runtime.path}`,
        PRODUCTION_RUNTIME_MANIFEST,
        'src/game/production-assets.ts',
        'src/scenes/ProductionArchiveScene.ts',
      ],
      test: {
        path: PRODUCTION_RUNTIME_TEST,
        fullName: productionRuntimeTestFullName(entry.id),
      },
      note: `${entry.id} is a bounded, integrity-verified runtime export reached through the paginated Phaser archive loader.`,
    }));
    const next = {
      ...claims,
      claims: [...retained, ...mapped].sort((a, b) => a.claimId.localeCompare(b.claimId)),
    };
    validateEvidenceClaims({ ledger, projectRoot, claims: next });
    atomicJson(resolve(projectRoot, claimsPath), next);
    console.log(JSON.stringify({
      command,
      mappedPhaserClaims: mapped.length,
      exactPassedAssertions: execution.assertions,
      retainedClaims: retained.length,
      next: ['npm run evidence:run', 'npm run evidence:apply', 'npm run validate:ledger'],
    }, null, 2));
  }
} catch (error) {
  console.error(`production-runtime-evidence: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}

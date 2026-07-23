import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadLedgerEvidenceFiles, readJsonFile, validateEvidenceClaims } from './ledger-evidence-lib.mjs';
import {
  PRODUCTION_SYSTEMS_FIXTURE,
  PRODUCTION_SYSTEMS_PHASER_RUNTIME,
  PRODUCTION_SYSTEMS_PHASER_TEST,
  PRODUCTION_SYSTEMS_SCENE,
  PRODUCTION_SYSTEMS_SHARED_RUNTIME,
  PRODUCTION_SYSTEMS_SHARED_TEST,
  productionSystemPhaserTestFullName,
  productionSystemSharedTestFullName,
  validateProductionSystemsFixture,
} from './production-systems-evidence-lib.mjs';

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const ledgerPath = resolve(projectRoot, 'docs/production/upgrade-ledger.json');
const command = process.argv[2] ?? 'check';

function atomicJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
  renameSync(temporary, path);
}

function normalized(path) {
  return relative(projectRoot, path).replaceAll('\\', '/');
}

function phaserEvidence(entry) {
  if (entry.id === 'PF-upgrade-004') {
    return {
      implementationPaths: [
        'package.json',
        'package-lock.json',
        'tools/release-manager.mjs',
        'server/platform.mjs',
        'public/downloads/release-manifest.json',
      ],
      test: {
        path: 'tests/release-pipeline.test.ts',
        fullName: 'immutable Phaser five-release pipeline [AT-PF-upgrade-004][phaser] pins the exact Phaser production engine',
      },
      note: 'PF-upgrade-004 pins Phaser 3.90.0 exactly across dependency resolution, immutable release manifests, bootstrap metadata and public download metadata.',
    };
  }
  if (entry.id === 'PF-improvement-096') {
    return {
      implementationPaths: [
        'src/game/render-context.ts',
        'src/main.ts',
        'src/scenes/GameScene.ts',
        'src/scenes/EndlessScene.ts',
      ],
      test: {
        path: 'tests/render-context-recovery.test.ts',
        fullName: 'render-context recovery [AT-PF-improvement-096][phaser] closes WebGL failure recovery long-session boundary',
      },
      note: 'PF-improvement-096 detects direct and event-driven WebGL loss, fails diagnostics closed, suspends input/camera/gesture state, resumes only after renderer restoration and bounds one Canvas fallback attempt.',
    };
  }
  return {
    implementationPaths: [PRODUCTION_SYSTEMS_FIXTURE, PRODUCTION_SYSTEMS_PHASER_RUNTIME, PRODUCTION_SYSTEMS_SCENE],
    test: { path: PRODUCTION_SYSTEMS_PHASER_TEST, fullName: productionSystemPhaserTestFullName(entry) },
    note: `${entry.id} renders an interactive bounded Phaser presentation with deterministic state, feedback and accessibility semantics.`,
  };
}

function strictRun(expectedNames) {
  const temporaryRoot = mkdtempSync(resolve(tmpdir(), 'paopao-production-systems-'));
  const reportPath = resolve(temporaryRoot, 'vitest-report.json');
  try {
    const result = spawnSync(process.execPath, [
      resolve(projectRoot, 'node_modules/vitest/vitest.mjs'),
      'run', PRODUCTION_SYSTEMS_SHARED_TEST, PRODUCTION_SYSTEMS_PHASER_TEST,
      '--pool=threads', '--maxWorkers=1', '--reporter=json', `--outputFile=${reportPath}`,
    ], { cwd: projectRoot, encoding: 'utf8', windowsHide: true, maxBuffer: 48 * 1024 * 1024 });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`production systems tests exited ${result.status}: ${result.stderr || result.stdout}`);
    const report = JSON.parse(readFileSync(reportPath, 'utf8'));
    const observed = new Map();
    for (const testResult of report.testResults ?? []) {
      const path = normalized(testResult.name);
      if (![PRODUCTION_SYSTEMS_SHARED_TEST, PRODUCTION_SYSTEMS_PHASER_TEST].includes(path)) throw new Error(`unexpected production systems test file ${path}`);
      for (const assertion of testResult.assertionResults ?? []) {
        const statuses = observed.get(assertion.fullName) ?? [];
        statuses.push(assertion.status);
        observed.set(assertion.fullName, statuses);
      }
    }
    const expected = new Set(expectedNames);
    const missing = expectedNames.filter((name) => !observed.has(name));
    const unexpected = [...observed.keys()].filter((name) => !expected.has(name));
    const invalid = expectedNames.filter((name) => {
      const statuses = observed.get(name) ?? [];
      return statuses.length !== 1 || statuses[0] !== 'passed';
    });
    if (observed.size !== expectedNames.length || missing.length || unexpected.length || invalid.length) {
      throw new Error(`production systems exact evidence mismatch: ${missing.length} missing, ${unexpected.length} unexpected, ${invalid.length} failed/duplicate`);
    }
    return observed.size;
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

try {
  if (!['check', 'map'].includes(command)) throw new Error('use check or map');
  const ledger = readJsonFile(ledgerPath, 'upgrade ledger');
  const audit = validateProductionSystemsFixture({ projectRoot, ledger });
  const expectedNames = audit.manifest.entries.flatMap((entry) => [
    productionSystemSharedTestFullName(entry),
    productionSystemPhaserTestFullName(entry),
  ]);
  if (expectedNames.length !== 1700 || new Set(expectedNames).size !== 1700) throw new Error('production systems need 1,700 unique target assertions');
  const exactPassedAssertions = strictRun(expectedNames);

  if (command === 'check') {
    console.log(JSON.stringify({ command, items: audit.total, exactPassedAssertions, manifestSha256: audit.manifestSha256 }, null, 2));
  } else {
    // Re-read only after the test run so prior/concurrent category mappers are
    // retained. The parent coordinates mapper writes to keep rename atomic.
    const currentLedger = readJsonFile(ledgerPath, 'upgrade ledger');
    const { claims, claimsPath } = loadLedgerEvidenceFiles(projectRoot, currentLedger);
    const selectedIds = new Set(audit.manifest.entries.map(({ id }) => id));
    const retained = claims.claims.filter(({ itemId }) => !selectedIds.has(itemId));
    const mapped = audit.manifest.entries.flatMap((entry) => {
      const phaser = phaserEvidence(entry);
      return [{
        claimId: `EC-${entry.id}-shared`,
        assertionId: `AE-${entry.acceptanceId}-shared`,
        itemId: entry.id,
        acceptanceId: entry.acceptanceId,
        target: 'shared',
        implementationPaths: [PRODUCTION_SYSTEMS_FIXTURE, PRODUCTION_SYSTEMS_SHARED_RUNTIME],
        test: { path: PRODUCTION_SYSTEMS_SHARED_TEST, fullName: productionSystemSharedTestFullName(entry) },
        note: `${entry.id} executes its canonical shared ${entry.subject} ${entry.facet} contract, replay and fail-closed paths within declared bounds.`,
      }, {
        claimId: `EC-${entry.id}-phaser`,
        assertionId: `AE-${entry.acceptanceId}-phaser`,
        itemId: entry.id,
        acceptanceId: entry.acceptanceId,
        target: 'phaser',
        implementationPaths: phaser.implementationPaths,
        test: phaser.test,
        note: phaser.note,
      }];
    });
    const next = { ...claims, claims: [...retained, ...mapped].sort((a, b) => a.claimId.localeCompare(b.claimId)) };
    validateEvidenceClaims({ ledger: currentLedger, projectRoot, claims: next });
    atomicJson(resolve(projectRoot, claimsPath), next);
    console.log(JSON.stringify({ command, mappedItems: audit.total, mappedClaims: mapped.length, retainedClaims: retained.length, totalClaims: next.claims.length, exactPassedAssertions }, null, 2));
  }
} catch (error) {
  console.error(`production-systems-evidence: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}

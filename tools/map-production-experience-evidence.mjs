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
import { productionExperienceTestFullName } from '../shared/runtime/production-experience.mjs';
import {
  loadLedgerEvidenceFiles,
  readJsonFile,
  validateEvidenceClaims,
} from './ledger-evidence-lib.mjs';
import {
  PRODUCTION_EXPERIENCE_MANIFEST,
  PRODUCTION_EXPERIENCE_PHASER_TEST,
  PRODUCTION_EXPERIENCE_SHARED_TEST,
  loadProductionExperienceCatalog,
} from './production-experience-lib.mjs';

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const ledgerPath = resolve(projectRoot, 'docs', 'production', 'upgrade-ledger.json');
const command = process.argv[2] ?? 'check';
const scopedCategories = new Set(['ux-element', 'animated-element', 'animation']);

function atomicJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
  renameSync(temporary, path);
}

function normalizedRelative(path) {
  return relative(projectRoot, path).replaceAll('\\', '/');
}

function executeStrictTests(expectedNames) {
  const temporaryRoot = mkdtempSync(resolve(tmpdir(), 'paopao-production-experience-'));
  const reportPath = resolve(temporaryRoot, 'vitest-report.json');
  try {
    const result = spawnSync(process.execPath, [
      resolve(projectRoot, 'node_modules', 'vitest', 'vitest.mjs'),
      'run',
      PRODUCTION_EXPERIENCE_SHARED_TEST,
      PRODUCTION_EXPERIENCE_PHASER_TEST,
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
    if (result.status !== 0) throw new Error(`production experience tests failed with exit ${result.status}: ${result.stderr || result.stdout}`);
    let report;
    try { report = JSON.parse(readFileSync(reportPath, 'utf8')); }
    catch { throw new Error('production experience Vitest report is missing or invalid'); }
    const assertions = [];
    for (const testResult of report.testResults ?? []) {
      const path = normalizedRelative(testResult.name);
      if (![PRODUCTION_EXPERIENCE_SHARED_TEST, PRODUCTION_EXPERIENCE_PHASER_TEST].includes(path)) {
        throw new Error(`experience evidence runner executed unexpected test file ${testResult.name}`);
      }
      assertions.push(...(testResult.assertionResults ?? []));
    }
    if (assertions.length !== expectedNames.length) {
      throw new Error(`experience evidence emitted ${assertions.length}/${expectedNames.length} exact assertions`);
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
      throw new Error(`experience evidence mismatch: ${missing.length} missing, ${unexpected.length} unexpected, ${invalid.length} failed/duplicate`);
    }
    return { assertions: assertions.length, runnerExitCode: result.status };
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

function buildClaims(audit) {
  const bindings = new Map(audit.manifest.pages.map((page) => [`${page.category}:${page.release}:${page.page}`, page]));
  const claims = [];
  for (const entry of audit.entries) {
    const page = Math.ceil((((entry.ordinal - 1) % 100) + 1) / 10);
    const binding = bindings.get(`${entry.category}:${entry.release}:${page}`);
    if (!binding) throw new Error(`missing page binding for ${entry.id}`);
    const pagePath = `public${binding.path}`;
    for (const target of ['shared', 'phaser']) {
      claims.push({
        claimId: `EC-${entry.id}-${target}`,
        assertionId: `AE-${entry.acceptanceId}-${target}`,
        itemId: entry.id,
        acceptanceId: entry.acceptanceId,
        target,
        implementationPaths: target === 'shared'
          ? [
            pagePath,
            PRODUCTION_EXPERIENCE_MANIFEST,
            'shared/runtime/production-experience.mjs',
          ]
          : [
            pagePath,
            PRODUCTION_EXPERIENCE_MANIFEST,
            'src/game/production-experience.ts',
            'src/scenes/ProductionExperienceScene.ts',
          ],
        test: {
          path: target === 'shared' ? PRODUCTION_EXPERIENCE_SHARED_TEST : PRODUCTION_EXPERIENCE_PHASER_TEST,
          fullName: productionExperienceTestFullName(entry, target),
        },
        note: target === 'shared'
          ? `${entry.id} executes its unique ledger-derived accessibility, interaction, timing, reduced-motion and reset behavior through the canonical bounded oracle.`
          : `${entry.id} executes through the lazy integrity-verified Phaser catalog, render plan and live transform adapter in the accessible Experience Lab.`,
      });
    }
  }
  return claims;
}

function claimComparable(claim) {
  return JSON.stringify(claim);
}

try {
  if (!['check', 'map'].includes(command)) throw new Error('use check or map');
  const ledger = readJsonFile(ledgerPath, 'upgrade ledger');
  const audit = loadProductionExperienceCatalog({ projectRoot, ledger });
  const mapped = buildClaims(audit);
  if (mapped.length !== 3000 || new Set(mapped.map(({ claimId }) => claimId)).size !== 3000
    || new Set(mapped.map(({ assertionId }) => assertionId)).size !== 3000
    || new Set(mapped.map(({ test }) => `${test.path}\0${test.fullName}`)).size !== 3000) {
    throw new Error('experience evidence mapping is not exactly 3000 unique claims/assertions/test cases');
  }
  const expectedNames = mapped.map(({ test }) => test.fullName);
  const execution = executeStrictTests(expectedNames);
  const { claims, claimsPath } = loadLedgerEvidenceFiles(projectRoot, ledger);

  if (command === 'map') {
    const retained = claims.claims.filter(({ itemId }) => {
      const item = ledger.items.find(({ id }) => id === itemId);
      return !item || !scopedCategories.has(item.category);
    });
    const next = { ...claims, claims: [...retained, ...mapped].sort((a, b) => a.claimId.localeCompare(b.claimId)) };
    validateEvidenceClaims({ ledger, projectRoot, claims: next });
    atomicJson(resolve(projectRoot, claimsPath), next);
    console.log(JSON.stringify({
      command,
      catalogEntries: audit.entries.length,
      lazyPages: audit.manifest.pages.length,
      mappedClaims: mapped.length,
      exactPassedAssertions: execution.assertions,
      retainedClaims: retained.length,
      catalogSha256: audit.catalogSha256,
      next: ['node tools/map-production-experience-evidence.mjs check', 'npm run evidence:run', 'npm run evidence:apply'],
    }, null, 2));
  } else {
    validateEvidenceClaims({ ledger, projectRoot, claims });
    const actual = claims.claims.filter(({ itemId }) => {
      const item = ledger.items.find(({ id }) => id === itemId);
      return item && scopedCategories.has(item.category);
    }).sort((a, b) => a.claimId.localeCompare(b.claimId));
    const expected = [...mapped].sort((a, b) => a.claimId.localeCompare(b.claimId));
    if (actual.length !== 3000 || actual.some((claim, index) => claimComparable(claim) !== claimComparable(expected[index]))) {
      throw new Error(`claims registry contains ${actual.length}/3000 exact production experience claims; run map first`);
    }
    console.log(JSON.stringify({
      command,
      catalogEntries: audit.entries.length,
      lazyPages: audit.manifest.pages.length,
      mappedClaims: actual.length,
      exactPassedAssertions: execution.assertions,
      behaviorFingerprints: new Set(audit.entries.map(({ behaviorFingerprint }) => behaviorFingerprint)).size,
      catalogSha256: audit.catalogSha256,
    }, null, 2));
  }
} catch (error) {
  console.error(`production-experience-evidence: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}

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
  auditLedgerEvidence,
  buildEvidenceReceipt,
  loadLedgerEvidenceFiles,
  materializeLedgerEvidence,
  readJsonFile,
  validateEvidenceClaims,
  validateEvidenceReceipt,
} from './ledger-evidence-lib.mjs';

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const ledgerPath = resolve(projectRoot, 'docs', 'production', 'upgrade-ledger.json');
const command = process.argv[2] ?? 'audit';

function atomicJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
  renameSync(temporary, path);
}

function normalizedRelative(path) {
  return relative(projectRoot, path).replaceAll('\\', '/');
}

function executeClaims(ledger, claims) {
  validateEvidenceClaims({ ledger, projectRoot, claims });
  if (claims.claims.length === 0) return { outcomes: new Map(), runnerExitCode: 0 };
  const testPaths = [...new Set(claims.claims.map((claim) => claim.test.path))];
  const temporaryRoot = mkdtempSync(resolve(tmpdir(), 'paopao-ledger-evidence-'));
  const reportPath = resolve(temporaryRoot, 'vitest-report.json');
  try {
    const result = spawnSync(process.execPath, [
      resolve(projectRoot, 'node_modules', 'vitest', 'vitest.mjs'),
      'run',
      ...testPaths,
      '--pool=threads',
      '--maxWorkers=1',
      '--reporter=json',
      `--outputFile=${reportPath}`,
    ], {
      cwd: projectRoot,
      encoding: 'utf8',
      windowsHide: true,
      maxBuffer: 20 * 1024 * 1024,
    });
    let report = null;
    try { report = JSON.parse(readFileSync(reportPath, 'utf8')); } catch { /* handled as failed assertions below */ }
    const observed = new Map();
    for (const testResult of report?.testResults ?? []) {
      const testPath = normalizedRelative(testResult.name);
      for (const assertion of testResult.assertionResults ?? []) {
        const key = `${testPath}\0${assertion.fullName}`;
        const statuses = observed.get(key) ?? [];
        statuses.push(assertion.status);
        observed.set(key, statuses);
      }
    }
    const outcomes = new Map(claims.claims.map((claim) => {
      const statuses = observed.get(`${claim.test.path}\0${claim.test.fullName}`) ?? [];
      return [claim.assertionId, statuses.length === 1 && statuses[0] === 'passed' ? 'passed' : 'failed'];
    }));
    if (result.error) throw result.error;
    return { outcomes, runnerExitCode: result.status ?? 1, stderr: result.stderr, stdout: result.stdout };
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

function load() {
  const ledger = readJsonFile(ledgerPath, 'upgrade ledger');
  const files = loadLedgerEvidenceFiles(projectRoot, ledger);
  return { ledger, ...files };
}

function run() {
  const { ledger, claims, receiptsPath } = load();
  const execution = executeClaims(ledger, claims);
  const receipt = buildEvidenceReceipt({ ledger, projectRoot, claims, outcomes: execution.outcomes });
  atomicJson(resolve(projectRoot, receiptsPath), receipt);
  const passed = receipt.results.filter(({ status }) => status === 'passed').length;
  console.log(JSON.stringify({ command: 'run', claims: receipt.results.length, passed, failed: receipt.results.length - passed }, null, 2));
  if (execution.runnerExitCode !== 0 || passed !== receipt.results.length) process.exitCode = 1;
}

function apply() {
  const { ledger, claims, receipt } = load();
  validateEvidenceReceipt({ ledger, projectRoot, claims, receipt });
  materializeLedgerEvidence({ ledger, projectRoot, claims, receipt });
  atomicJson(ledgerPath, ledger);
  const summary = auditLedgerEvidence({ ledger, projectRoot, claims, receipt });
  console.log(JSON.stringify({ command: 'apply', ...summary }, null, 2));
}

function audit() {
  const { ledger, claims, receipt } = load();
  const summary = auditLedgerEvidence({ ledger, projectRoot, claims, receipt });
  console.log(JSON.stringify({ command: 'audit', ...summary }, null, 2));
}

try {
  if (command === 'run') run();
  else if (command === 'apply') apply();
  else if (command === 'audit') audit();
  else throw new Error('use audit, run, or apply');
} catch (error) {
  console.error(`ledger-evidence: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}

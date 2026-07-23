import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadLedgerEvidenceFiles, readJsonFile } from './ledger-evidence-lib.mjs';
import {
  PRODUCTION_MASTER_MANIFEST,
  PRODUCTION_MASTER_TEST,
  productionMasterTestFullName,
  validateProductionMasterManifest,
} from './production-master-evidence-lib.mjs';

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const ledgerPath = resolve(projectRoot, 'docs', 'production', 'upgrade-ledger.json');
const command = process.argv[2] ?? 'check';

function atomicJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
  renameSync(temporary, path);
}

try {
  const ledger = readJsonFile(ledgerPath, 'upgrade ledger');
  const audit = validateProductionMasterManifest({ ledger, projectRoot, manifestPath: PRODUCTION_MASTER_MANIFEST, requireComplete: true });
  if (command === 'check') {
    console.log(JSON.stringify({ command, total: audit.total, uniqueHashes: audit.entryById.size, manifestSha256: audit.manifestSha256 }, null, 2));
  } else if (command === 'map') {
    const { claims, claimsPath } = loadLedgerEvidenceFiles(projectRoot, ledger);
    const retained = claims.claims.filter(({ itemId, target }) => !(itemId.startsWith('PF-asset-') && target === 'shared'));
    const mapped = audit.manifest.entries.map((entry) => ({
      claimId: `EC-${entry.id}-shared`,
      assertionId: `AE-AT-${entry.id}-shared`,
      itemId: entry.id,
      acceptanceId: `AT-${entry.id}`,
      target: 'shared',
      implementationPaths: [entry.path, PRODUCTION_MASTER_MANIFEST],
      test: {
        path: PRODUCTION_MASTER_TEST,
        fullName: productionMasterTestFullName(entry.id),
      },
      note: `Type-specific structure, exact bytes and unique authored SHA-256 are validated for ${entry.id}.`,
    }));
    const next = { ...claims, claims: [...retained, ...mapped].sort((a, b) => a.claimId.localeCompare(b.claimId)) };
    atomicJson(resolve(projectRoot, claimsPath), next);
    console.log(JSON.stringify({ command, mappedSharedClaims: mapped.length, retainedClaims: retained.length, next: ['npm run evidence:run', 'npm run evidence:apply', 'npm run validate:ledger'] }, null, 2));
  } else {
    throw new Error('use check or map');
  }
} catch (error) {
  console.error(`production-master-evidence: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}

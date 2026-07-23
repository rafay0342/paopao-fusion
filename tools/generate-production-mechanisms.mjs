import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PRODUCTION_MECHANISM_FACETS,
  PRODUCTION_MECHANISM_SUBJECTS,
  createProductionMechanismEntry,
  validateProductionMechanismManifest,
} from '../shared/runtime/production-mechanisms.mjs';

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const ledgerPath = resolve(projectRoot, 'docs/production/upgrade-ledger.json');
const outputPath = resolve(projectRoot, 'shared/fixtures/production-mechanisms-v1.json');

const canonical = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
};

try {
  const ledger = JSON.parse(readFileSync(ledgerPath, 'utf8'));
  const items = ledger.items.filter(({ category }) => category === 'mechanism');
  if (items.length !== 500) throw new Error(`ledger contains ${items.length}/500 mechanisms`);
  const entries = items.map(createProductionMechanismEntry);
  const bySubject = Object.fromEntries(PRODUCTION_MECHANISM_SUBJECTS.map((subject) => [subject, entries.filter((entry) => entry.subject === subject).length]));
  const byFacet = Object.fromEntries(PRODUCTION_MECHANISM_FACETS.map((facet) => [facet, entries.filter((entry) => entry.facet === facet).length]));
  const byRelease = Object.fromEntries([1, 2, 3, 4, 5].map((release) => [release, entries.filter((entry) => entry.release === release).length]));
  const manifest = {
    schemaVersion: 1,
    title: 'PaoPao Fusion deterministic production mechanism catalog',
    total: entries.length,
    policies: {
      authoritativeRevisionRequired: true,
      boundedIntegerArithmetic: true,
      canonicalSerialization: true,
      deterministicSeedOrder: true,
      failClosedWithoutMutation: true,
      fixedStepOnly: true,
      idempotentReplay: true,
      predictionBounded: true,
      rewardAuthority: true,
    },
    bySubject,
    byFacet,
    byRelease,
    entriesSha256: createHash('sha256').update(canonical(entries)).digest('hex'),
    entries,
  };
  validateProductionMechanismManifest(manifest);
  mkdirSync(dirname(outputPath), { recursive: true });
  const temporary = `${outputPath}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
  renameSync(temporary, outputPath);
  console.log(JSON.stringify({
    generated: entries.length,
    subjects: Object.keys(bySubject).length,
    facets: Object.keys(byFacet).length,
    byRelease,
    entriesSha256: manifest.entriesSha256,
    output: 'shared/fixtures/production-mechanisms-v1.json',
  }, null, 2));
} catch (error) {
  console.error(`production-mechanism generation failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}

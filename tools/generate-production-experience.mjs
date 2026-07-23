import { createHash } from 'node:crypto';
import {
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PRODUCTION_EXPERIENCE_CATEGORIES,
  PRODUCTION_EXPERIENCE_PAGE_SIZE,
  createProductionExperienceEntry,
} from '../shared/runtime/production-experience.mjs';

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const ledgerPath = resolve(projectRoot, 'docs', 'production', 'upgrade-ledger.json');
const outputRoot = resolve(projectRoot, 'public', 'assets', 'production-experience');
const temporaryRoot = `${outputRoot}.build-${process.pid}-${Date.now()}`;

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const jsonBytes = (value) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');

function atomicReplaceDirectory(from, to) {
  const previous = `${to}.previous-${process.pid}-${Date.now()}`;
  try {
    renameSync(to, previous);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  try {
    renameSync(from, to);
    rmSync(previous, { recursive: true, force: true });
  } catch (error) {
    try { renameSync(previous, to); } catch { /* preserve original error */ }
    throw error;
  }
}

try {
  const ledger = JSON.parse(readFileSync(ledgerPath, 'utf8'));
  const selected = ledger.items.filter(({ category }) => PRODUCTION_EXPERIENCE_CATEGORIES.includes(category));
  if (selected.length !== 1500) throw new Error(`ledger contains ${selected.length}/1500 production experience items`);
  mkdirSync(resolve(temporaryRoot, 'pages'), { recursive: true });

  const pages = [];
  const categoryTotals = {};
  const releaseTotals = { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 };
  for (const category of PRODUCTION_EXPERIENCE_CATEGORIES) {
    const categoryItems = selected.filter((item) => item.category === category);
    categoryTotals[category] = categoryItems.length;
    for (let release = 1; release <= 5; release += 1) {
      const releaseItems = categoryItems.filter((item) => item.release === release);
      if (releaseItems.length !== 100) throw new Error(`${category}/R${release} has ${releaseItems.length}/100 items`);
      for (let offset = 0; offset < releaseItems.length; offset += PRODUCTION_EXPERIENCE_PAGE_SIZE) {
        const entries = releaseItems.slice(offset, offset + PRODUCTION_EXPERIENCE_PAGE_SIZE)
          .map(createProductionExperienceEntry);
        const page = offset / PRODUCTION_EXPERIENCE_PAGE_SIZE + 1;
        const pageDocument = {
          schemaVersion: 1,
          category,
          release,
          page,
          totalPages: releaseItems.length / PRODUCTION_EXPERIENCE_PAGE_SIZE,
          entries,
        };
        const bytes = jsonBytes(pageDocument);
        const relative = `pages/${category}-r${release}-p${String(page).padStart(2, '0')}.json`;
        writeFileSync(resolve(temporaryRoot, relative), bytes, { flag: 'wx' });
        pages.push({
          category,
          release,
          page,
          path: `/assets/production-experience/${relative}`,
          count: entries.length,
          firstId: entries[0].id,
          lastId: entries.at(-1).id,
          bytes: bytes.length,
          sha256: sha256(bytes),
        });
        releaseTotals[String(release)] += entries.length;
      }
    }
  }

  const catalogSha256 = sha256(pages.map(({ path, bytes, sha256: digest }) => `${path}:${bytes}:${digest}`).join('\n'));
  const manifest = {
    schemaVersion: 1,
    generatorVersion: 1,
    policies: {
      ledgerSourceLocked: true,
      oneEntryPerLedgerItem: true,
      lazyPaginatedLoading: true,
      pageSha256Required: true,
      boundedRuntimeOracle: true,
      reducedMotionRequired: true,
      poolResetRequired: true,
    },
    total: selected.length,
    pageSize: PRODUCTION_EXPERIENCE_PAGE_SIZE,
    categoryTotals,
    releaseTotals,
    catalogSha256,
    pages,
  };
  writeFileSync(resolve(temporaryRoot, 'manifest.json'), jsonBytes(manifest), { flag: 'wx' });
  atomicReplaceDirectory(temporaryRoot, outputRoot);
  console.log(JSON.stringify({
    generated: selected.length,
    pages: pages.length,
    categoryTotals,
    releaseTotals,
    catalogSha256,
    manifest: 'public/assets/production-experience/manifest.json',
  }, null, 2));
} catch (error) {
  rmSync(temporaryRoot, { recursive: true, force: true });
  console.error(`production-experience generation failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}

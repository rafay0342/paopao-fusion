import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import {
  PRODUCTION_EXPERIENCE_CATEGORIES,
  PRODUCTION_EXPERIENCE_PAGE_SIZE,
  createProductionExperienceEntry,
  runProductionExperienceOracle,
  validateProductionExperienceEntry,
} from '../shared/runtime/production-experience.mjs';

export const PRODUCTION_EXPERIENCE_MANIFEST = 'public/assets/production-experience/manifest.json';
export const PRODUCTION_EXPERIENCE_SHARED_TEST = 'tests/production-experience-shared-evidence.test.ts';
export const PRODUCTION_EXPERIENCE_PHASER_TEST = 'tests/production-experience-phaser-evidence.test.ts';

const PAGE_PATH = /^\/assets\/production-experience\/pages\/(ux-element|animated-element|animation)-r([1-5])-p(0[1-9]|10)\.json$/;
const SHA256 = /^[a-f0-9]{64}$/;

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

function exactKeys(value, expected, label) {
  if (!record(value)) throw new Error(`${label} must be an object`);
  if (Object.keys(value).sort().join('\0') !== [...expected].sort().join('\0')) throw new Error(`${label} has an invalid shape`);
}

function inside(parent, child) {
  const rel = relative(parent, child);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !rel.startsWith(sep));
}

function readJson(path, label) {
  try { return JSON.parse(readFileSync(path, 'utf8')); }
  catch (error) { throw new Error(`${label} is invalid JSON: ${error instanceof Error ? error.message : String(error)}`); }
}

function pageAbsolute(projectRoot, url) {
  const match = PAGE_PATH.exec(url);
  if (!match) throw new Error(`unsafe production experience page path ${String(url)}`);
  const root = resolve(projectRoot, 'public', 'assets', 'production-experience', 'pages');
  const absolute = resolve(projectRoot, 'public', url.slice(1));
  if (!existsSync(absolute) || !lstatSync(absolute).isFile() || !inside(realpathSync(root), realpathSync(absolute))) {
    throw new Error(`production experience page is missing or escaped its root: ${url}`);
  }
  return absolute;
}

export function loadProductionExperienceCatalog({ projectRoot, ledger }) {
  const manifestAbsolute = resolve(projectRoot, PRODUCTION_EXPERIENCE_MANIFEST);
  const manifest = readJson(manifestAbsolute, 'production experience manifest');
  exactKeys(manifest, [
    'schemaVersion', 'generatorVersion', 'policies', 'total', 'pageSize', 'categoryTotals',
    'releaseTotals', 'catalogSha256', 'pages',
  ], 'production experience manifest');
  if (manifest.schemaVersion !== 1 || manifest.generatorVersion !== 1 || manifest.total !== 1500
    || manifest.pageSize !== PRODUCTION_EXPERIENCE_PAGE_SIZE || !SHA256.test(manifest.catalogSha256)
    || !Array.isArray(manifest.pages) || manifest.pages.length !== 150) {
    throw new Error('production experience manifest header is invalid');
  }
  exactKeys(manifest.policies, [
    'ledgerSourceLocked', 'oneEntryPerLedgerItem', 'lazyPaginatedLoading', 'pageSha256Required',
    'boundedRuntimeOracle', 'reducedMotionRequired', 'poolResetRequired',
  ], 'production experience policies');
  if (Object.values(manifest.policies).some((enabled) => enabled !== true)) throw new Error('production experience policies must all be enabled');
  exactKeys(manifest.categoryTotals, PRODUCTION_EXPERIENCE_CATEGORIES, 'production experience category totals');
  if (PRODUCTION_EXPERIENCE_CATEGORIES.some((category) => manifest.categoryTotals[category] !== 500)) {
    throw new Error('production experience category totals must be 500 each');
  }
  exactKeys(manifest.releaseTotals, ['1', '2', '3', '4', '5'], 'production experience release totals');
  if (Object.values(manifest.releaseTotals).some((total) => total !== 300)) throw new Error('production experience releases must contain 300 items each');

  const ledgerItems = new Map(ledger.items
    .filter(({ category }) => PRODUCTION_EXPERIENCE_CATEGORIES.includes(category))
    .map((item) => [item.id, item]));
  if (ledgerItems.size !== 1500) throw new Error(`ledger contains ${ledgerItems.size}/1500 production experience items`);
  const entries = [];
  const entryById = new Map();
  const fingerprints = new Set();
  const pagePaths = new Set();
  const pageBindings = [];
  const pageCounts = new Map();

  for (const pageEntry of manifest.pages) {
    exactKeys(pageEntry, ['category', 'release', 'page', 'path', 'count', 'firstId', 'lastId', 'bytes', 'sha256'], 'production experience page binding');
    const match = typeof pageEntry.path === 'string' ? PAGE_PATH.exec(pageEntry.path) : null;
    if (!match || match[1] !== pageEntry.category || Number(match[2]) !== pageEntry.release || Number(match[3]) !== pageEntry.page
      || !PRODUCTION_EXPERIENCE_CATEGORIES.includes(pageEntry.category)
      || !Number.isInteger(pageEntry.release) || !Number.isInteger(pageEntry.page)
      || pageEntry.count !== PRODUCTION_EXPERIENCE_PAGE_SIZE || !Number.isInteger(pageEntry.bytes) || pageEntry.bytes < 100
      || typeof pageEntry.sha256 !== 'string' || !SHA256.test(pageEntry.sha256) || pagePaths.has(pageEntry.path)) {
      throw new Error(`invalid production experience page binding ${String(pageEntry.path)}`);
    }
    const key = `${pageEntry.category}:${pageEntry.release}`;
    const expectedPage = (pageCounts.get(key) ?? 0) + 1;
    if (pageEntry.page !== expectedPage) throw new Error(`${key} page order is not contiguous`);
    pageCounts.set(key, pageEntry.page);
    const absolute = pageAbsolute(projectRoot, pageEntry.path);
    const bytes = readFileSync(absolute);
    if (statSync(absolute).size !== pageEntry.bytes || sha256(bytes) !== pageEntry.sha256) {
      throw new Error(`${pageEntry.path} bytes or SHA-256 differ from manifest`);
    }
    const document = readJson(absolute, pageEntry.path);
    exactKeys(document, ['schemaVersion', 'category', 'release', 'page', 'totalPages', 'entries'], pageEntry.path);
    if (document.schemaVersion !== 1 || document.category !== pageEntry.category || document.release !== pageEntry.release
      || document.page !== pageEntry.page || document.totalPages !== 10 || !Array.isArray(document.entries)
      || document.entries.length !== PRODUCTION_EXPERIENCE_PAGE_SIZE) throw new Error(`${pageEntry.path} document header is invalid`);
    if (document.entries[0]?.id !== pageEntry.firstId || document.entries.at(-1)?.id !== pageEntry.lastId) {
      throw new Error(`${pageEntry.path} ID range differs from manifest`);
    }
    for (const raw of document.entries) {
      const entry = validateProductionExperienceEntry(raw);
      const ledgerItem = ledgerItems.get(entry.id);
      if (!ledgerItem || entryById.has(entry.id) || fingerprints.has(entry.behaviorFingerprint)) {
        throw new Error(`${entry.id} is unknown, duplicated, or behavior-inflated`);
      }
      const expected = createProductionExperienceEntry(ledgerItem);
      if (JSON.stringify(entry) !== JSON.stringify(expected)) throw new Error(`${entry.id} differs from its ledger-derived canonical specification`);
      const action = entry.specification.kind === 'ux' ? entry.specification.interaction.event : 'idle';
      const normal = runProductionExperienceOracle(entry, { timeMs: 733, action });
      const reduced = runProductionExperienceOracle(entry, { timeMs: 733, action, reducedMotion: true });
      const reset = runProductionExperienceOracle(entry, { timeMs: 733, action: 'reset' });
      if (normal.id !== entry.id || reduced.id !== entry.id || reset.id !== entry.id
        || reset.frame.x !== 0 || reset.frame.y !== 0 || reset.frame.scale !== 1 || reset.frame.rotation !== 0
        || reset.frame.alpha !== 1 || reduced.frame.x !== 0 || reduced.frame.y !== 0 || reduced.frame.rotation !== 0) {
        throw new Error(`${entry.id} behavior oracle failed normal/reduced/reset execution`);
      }
      entries.push(entry);
      entryById.set(entry.id, entry);
      fingerprints.add(entry.behaviorFingerprint);
    }
    pagePaths.add(pageEntry.path);
    pageBindings.push(pageEntry);
  }
  for (const category of PRODUCTION_EXPERIENCE_CATEGORIES) {
    for (let release = 1; release <= 5; release += 1) {
      if (pageCounts.get(`${category}:${release}`) !== 10) throw new Error(`${category}/R${release} does not contain exactly 10 pages`);
    }
  }
  if (entries.length !== 1500 || entryById.size !== 1500 || fingerprints.size !== 1500) {
    throw new Error(`production experience coverage is ${entries.length}/1500`);
  }
  const catalogSha256 = sha256(pageBindings.map(({ path, bytes, sha256: digest }) => `${path}:${bytes}:${digest}`).join('\n'));
  if (catalogSha256 !== manifest.catalogSha256) throw new Error('production experience catalog SHA-256 is stale');
  return { manifest, entries, entryById, catalogSha256, manifestPath: PRODUCTION_EXPERIENCE_MANIFEST };
}

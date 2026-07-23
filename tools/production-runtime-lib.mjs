import { createHash } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
} from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import { isSafeRelativePath, resolveEvidenceFile, sha256File } from './ledger-evidence-lib.mjs';
import {
  PRODUCTION_MASTER_MANIFEST,
  validateProductionMasterManifest,
} from './production-master-evidence-lib.mjs';

export const PRODUCTION_RUNTIME_MANIFEST = 'public/assets/production/runtime-manifest.json';
export const PRODUCTION_RUNTIME_TEST = 'tests/production-runtime-evidence.test.ts';
export const PRODUCTION_RUNTIME_GENERATOR_VERSION = 1;
export const PRODUCTION_RUNTIME_BUDGETS = Object.freeze({
  imageMaxDimension: 512,
  imageMaxBytes: 256 * 1024,
  jsonMaxBytes: 64 * 1024,
  totalRuntimeBytes: 48 * 1024 * 1024,
  loaderCacheEntries: 18,
  archivePageSize: 6,
});

const shaPattern = /^[a-f0-9]{64}$/;
const idPattern = /^PF-asset-(\d{3})$/;
const runtimePathPattern = /^\/assets\/production\/items\/(PF-asset-\d{3})\.(png|json)$/;

const canonicalize = (value) => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
};

export const canonicalJsonText = (value) => `${JSON.stringify(canonicalize(value))}\n`;
export const sha256Buffer = (value) => createHash('sha256').update(value).digest('hex');

function exactKeys(value, expected, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
  if (Object.keys(value).sort().join('\0') !== [...expected].sort().join('\0')) {
    throw new Error(`${label} has unexpected or missing fields`);
  }
}

function inside(parent, child) {
  const path = relative(parent, child);
  return path === '' || (!path.startsWith(`..${sep}`) && path !== '..' && !path.startsWith(sep));
}

function publicPathForUrl(projectRoot, runtimePath) {
  const match = runtimePathPattern.exec(runtimePath);
  if (!match) throw new Error(`unsafe production runtime URL ${String(runtimePath)}`);
  return resolve(projectRoot, 'public', ...runtimePath.slice(1).split('/'));
}

export function inspectRuntimePng(buffer, label) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (buffer.length < 33 || !buffer.subarray(0, 8).equals(signature)
    || buffer.toString('ascii', 12, 16) !== 'IHDR' || !buffer.includes(Buffer.from('IDAT'))
    || !buffer.subarray(-8, -4).equals(Buffer.from('IEND'))) {
    throw new Error(`${label} is not a complete PNG`);
  }
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  if (width < 1 || height < 1 || width > PRODUCTION_RUNTIME_BUDGETS.imageMaxDimension
    || height > PRODUCTION_RUNTIME_BUDGETS.imageMaxDimension) {
    throw new Error(`${label} exceeds the bounded runtime raster dimensions`);
  }
  return { width, height };
}

function listedRuntimeFiles(itemsRoot) {
  if (!existsSync(itemsRoot)) return [];
  return readdirSync(itemsRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => /^PF-asset-\d{3}\.(?:png|json)$/.test(name))
    .sort();
}

export function productionRuntimeTestFullName(id) {
  return `production runtime evidence [AT-${id}][phaser] delivers a bounded integrity-verified lazy runtime asset`;
}

export function validateProductionRuntime({
  ledger,
  projectRoot,
  manifestPath = PRODUCTION_RUNTIME_MANIFEST,
  requireComplete = true,
}) {
  if (!isSafeRelativePath(manifestPath)) throw new Error('production runtime manifest path is unsafe');
  const sourceAudit = validateProductionMasterManifest({
    ledger,
    projectRoot,
    manifestPath: PRODUCTION_MASTER_MANIFEST,
    requireComplete,
  });
  const absoluteManifest = resolveEvidenceFile(projectRoot, manifestPath);
  const runtimeRoot = resolve(projectRoot, 'public', 'assets', 'production');
  const itemsRoot = resolve(runtimeRoot, 'items');
  if (!inside(realpathSync(projectRoot), realpathSync(runtimeRoot))) throw new Error('production runtime root escaped the project');
  let manifest;
  try { manifest = JSON.parse(readFileSync(absoluteManifest, 'utf8')); }
  catch { throw new Error('production runtime manifest is not valid JSON'); }
  exactKeys(manifest, [
    'schemaVersion', 'generatorVersion', 'sourceManifest', 'policies', 'budgets',
    'total', 'runtimeBytes', 'entries',
  ], 'production runtime manifest');
  if (manifest.schemaVersion !== 1 || manifest.generatorVersion !== PRODUCTION_RUNTIME_GENERATOR_VERSION) {
    throw new Error('production runtime manifest version is unsupported');
  }
  exactKeys(manifest.sourceManifest, ['path', 'sha256', 'total', 'sourceBytes'], 'production runtime source manifest');
  if (manifest.sourceManifest.path !== PRODUCTION_MASTER_MANIFEST
    || manifest.sourceManifest.sha256 !== sourceAudit.manifestSha256
    || manifest.sourceManifest.total !== sourceAudit.total
    || manifest.sourceManifest.sourceBytes !== sourceAudit.manifest.entries.reduce((sum, entry) => sum + entry.bytes, 0)) {
    throw new Error('production runtime source-manifest binding is stale');
  }
  exactKeys(manifest.policies, [
    'oneRuntimeEntryPerMaster', 'derivedVariantsDoNotCountAsMasters', 'lazyOnly',
    'webCryptoSha256Required', 'failClosedOnIntegrityMismatch',
  ], 'production runtime policies');
  if (Object.values(manifest.policies).some((value) => value !== true)) throw new Error('production runtime policies must all be enabled');
  exactKeys(manifest.budgets, Object.keys(PRODUCTION_RUNTIME_BUDGETS), 'production runtime budgets');
  if (JSON.stringify(manifest.budgets) !== JSON.stringify(PRODUCTION_RUNTIME_BUDGETS)) throw new Error('production runtime budgets drifted');
  if (!Array.isArray(manifest.entries) || manifest.total !== manifest.entries.length
    || (requireComplete && manifest.total !== 500)) {
    throw new Error(`production runtime manifest has ${manifest.entries?.length ?? 0}/500 entries`);
  }

  const ledgerItems = new Map(ledger.items.filter(({ category }) => category === 'asset').map((item) => [item.id, item]));
  const ids = new Set();
  const paths = new Set();
  const entryById = new Map();
  let runtimeBytes = 0;
  for (const [index, entry] of manifest.entries.entries()) {
    const label = `production runtime entry ${index + 1}`;
    exactKeys(entry, ['id', 'title', 'allocation', 'release', 'source', 'runtime'], label);
    const sourceEntry = sourceAudit.entryById.get(entry.id);
    const ledgerItem = ledgerItems.get(entry.id);
    if (!idPattern.test(entry.id) || !sourceEntry || !ledgerItem) throw new Error(`${label} has unknown asset ID ${String(entry.id)}`);
    if (ids.has(entry.id)) throw new Error(`duplicate production runtime ID ${entry.id}`);
    if (entry.title !== ledgerItem.title || entry.allocation !== sourceEntry.allocation || entry.release !== sourceEntry.release) {
      throw new Error(`${entry.id} runtime metadata differs from its ledger/source master`);
    }
    exactKeys(entry.source, ['path', 'format', 'bytes', 'sha256'], `${entry.id} source binding`);
    for (const key of ['path', 'format', 'bytes', 'sha256']) {
      if (entry.source[key] !== sourceEntry[key]) throw new Error(`${entry.id} source ${key} binding is stale`);
    }
    const expectedKind = sourceEntry.format === 'svg' ? 'image' : 'semantic-json';
    const expectedFormat = sourceEntry.format === 'svg' ? 'png' : 'json';
    const expectedMime = sourceEntry.format === 'svg' ? 'image/png' : 'application/json';
    const runtimeKeys = expectedKind === 'image'
      ? ['path', 'format', 'kind', 'mimeType', 'bytes', 'sha256', 'byteBudget', 'width', 'height']
      : ['path', 'format', 'kind', 'mimeType', 'bytes', 'sha256', 'byteBudget'];
    exactKeys(entry.runtime, runtimeKeys, `${entry.id} runtime export`);
    const pathMatch = runtimePathPattern.exec(entry.runtime.path);
    if (!pathMatch || pathMatch[1] !== entry.id || pathMatch[2] !== expectedFormat || paths.has(entry.runtime.path)) {
      throw new Error(`${entry.id} has an invalid or duplicate loader path`);
    }
    const expectedBudget = expectedKind === 'image'
      ? PRODUCTION_RUNTIME_BUDGETS.imageMaxBytes
      : PRODUCTION_RUNTIME_BUDGETS.jsonMaxBytes;
    if (entry.runtime.kind !== expectedKind || entry.runtime.format !== expectedFormat
      || entry.runtime.mimeType !== expectedMime || entry.runtime.byteBudget !== expectedBudget
      || !Number.isInteger(entry.runtime.bytes) || entry.runtime.bytes < 2 || entry.runtime.bytes > expectedBudget
      || !shaPattern.test(entry.runtime.sha256)) {
      throw new Error(`${entry.id} runtime export contract is invalid`);
    }
    const absoluteRuntime = publicPathForUrl(projectRoot, entry.runtime.path);
    if (!existsSync(absoluteRuntime) || !lstatSync(absoluteRuntime).isFile()
      || !inside(realpathSync(itemsRoot), realpathSync(absoluteRuntime))) {
      throw new Error(`${entry.id} runtime file is missing or escaped its root`);
    }
    if (statSync(absoluteRuntime).size !== entry.runtime.bytes || sha256File(absoluteRuntime) !== entry.runtime.sha256) {
      throw new Error(`${entry.id} runtime bytes or SHA-256 differ from the manifest`);
    }
    const buffer = readFileSync(absoluteRuntime);
    if (expectedKind === 'image') {
      const dimensions = inspectRuntimePng(buffer, entry.id);
      if (dimensions.width !== entry.runtime.width || dimensions.height !== entry.runtime.height) {
        throw new Error(`${entry.id} raster dimensions differ from the manifest`);
      }
    } else {
      let value;
      try { value = JSON.parse(buffer.toString('utf8')); } catch { throw new Error(`${entry.id} semantic runtime JSON is invalid`); }
      if (!value || value.id !== entry.id || value.release !== entry.release || value.allocation !== entry.allocation
        || value.original !== true || typeof value.subject !== 'string' || typeof value.facet !== 'string'
        || typeof value.masterType !== 'string') {
        throw new Error(`${entry.id} semantic runtime JSON lost its authored identity`);
      }
    }
    runtimeBytes += entry.runtime.bytes;
    ids.add(entry.id);
    paths.add(entry.runtime.path);
    entryById.set(entry.id, entry);
  }

  if (manifest.runtimeBytes !== runtimeBytes || runtimeBytes > PRODUCTION_RUNTIME_BUDGETS.totalRuntimeBytes) {
    throw new Error('production runtime total byte budget is invalid');
  }
  if (requireComplete) {
    const sourceIds = sourceAudit.manifest.entries.map(({ id }) => id);
    if (sourceIds.some((id, index) => manifest.entries[index]?.id !== id) || ids.size !== sourceIds.length) {
      throw new Error('production runtime order/coverage differs from the 500 source masters');
    }
    const diskFiles = listedRuntimeFiles(itemsRoot);
    const expectedFiles = manifest.entries.map(({ runtime }) => runtime.path.split('/').at(-1)).sort();
    if (diskFiles.length !== expectedFiles.length || diskFiles.some((name, index) => name !== expectedFiles[index])) {
      throw new Error('production runtime tree contains an unlisted or missing asset export');
    }
  }
  return {
    total: manifest.entries.length,
    runtimeBytes,
    manifest,
    manifestSha256: sha256Buffer(readFileSync(absoluteManifest)),
    entryById,
    sourceAudit,
  };
}

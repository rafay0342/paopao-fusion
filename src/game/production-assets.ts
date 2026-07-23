export const PRODUCTION_RUNTIME_MANIFEST_URL = '/assets/production/runtime-manifest.json';
export const PRODUCTION_ARCHIVE_TOTAL = 500;
export const PRODUCTION_ARCHIVE_PAGE_SIZE = 6;
export const PRODUCTION_ASSET_CACHE_LIMIT = 18;

const ID_PATTERN = /^PF-asset-(\d{3})$/;
const SHA_PATTERN = /^[a-f0-9]{64}$/;
const RUNTIME_PATH_PATTERN = /^\/assets\/production\/items\/(PF-asset-\d{3})\.(png|json)$/;
const MAX_IMAGE_BYTES = 256 * 1024;
const MAX_JSON_BYTES = 64 * 1024;
const MAX_TOTAL_BYTES = 48 * 1024 * 1024;

export type ProductionAllocation =
  | 'characters-orbs-bosses-rigs'
  | 'environment-models-props'
  | 'material-texture-vfx-packs'
  | 'ui-icons-illustrations'
  | 'music-ambience-sfx'
  | 'cinematic-sequences'
  | 'tutorial-accessibility-promotion';

export interface ProductionRuntimeSource {
  path: string;
  format: 'svg' | 'json';
  bytes: number;
  sha256: string;
}

export interface ProductionRuntimeExport {
  path: string;
  format: 'png' | 'json';
  kind: 'image' | 'semantic-json';
  mimeType: 'image/png' | 'application/json';
  bytes: number;
  sha256: string;
  byteBudget: number;
  width?: number;
  height?: number;
}

export interface ProductionRuntimeEntry {
  id: string;
  title: string;
  allocation: ProductionAllocation;
  release: 1 | 2 | 3 | 4 | 5;
  source: ProductionRuntimeSource;
  runtime: ProductionRuntimeExport;
}

export interface ProductionRuntimeManifest {
  schemaVersion: 1;
  generatorVersion: 1;
  sourceManifest: {
    path: 'art-source/production-masters/manifest.json';
    sha256: string;
    total: 500;
    sourceBytes: number;
  };
  policies: {
    oneRuntimeEntryPerMaster: true;
    derivedVariantsDoNotCountAsMasters: true;
    lazyOnly: true;
    webCryptoSha256Required: true;
    failClosedOnIntegrityMismatch: true;
  };
  budgets: {
    imageMaxDimension: 512;
    imageMaxBytes: number;
    jsonMaxBytes: number;
    totalRuntimeBytes: number;
    loaderCacheEntries: number;
    archivePageSize: number;
  };
  total: 500;
  runtimeBytes: number;
  entries: ProductionRuntimeEntry[];
}

export interface ProductionSemanticMaster extends Record<string, unknown> {
  schemaVersion: number;
  id: string;
  release: number;
  allocation: ProductionAllocation;
  subject: string;
  facet: string;
  masterType: string;
  original: true;
}

export interface ProductionSemanticSummary {
  subject: string;
  facet: string;
  masterType: string;
  sections: string[];
  authoredValues: number;
}

export type LoadedProductionAsset =
  | {
    kind: 'image';
    entry: ProductionRuntimeEntry;
    bytes: Uint8Array;
    blob: Blob;
  }
  | {
    kind: 'semantic-json';
    entry: ProductionRuntimeEntry;
    bytes: Uint8Array;
    value: ProductionSemanticMaster;
    summary: ProductionSemanticSummary;
  };

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const allocations = new Set<ProductionAllocation>([
  'characters-orbs-bosses-rigs',
  'environment-models-props',
  'material-texture-vfx-packs',
  'ui-icons-illustrations',
  'music-ambience-sfx',
  'cinematic-sequences',
  'tutorial-accessibility-promotion',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) > 0;
}

function assertExactKeys(value: Record<string, unknown>, expected: readonly string[], label: string): void {
  const actual = Object.keys(value).sort().join('\0');
  if (actual !== [...expected].sort().join('\0')) throw new Error(`${label} has an invalid shape.`);
}

export function validateProductionRuntimeEntry(value: unknown): ProductionRuntimeEntry {
  if (!isRecord(value)) throw new Error('Production runtime entry is not an object.');
  assertExactKeys(value, ['id', 'title', 'allocation', 'release', 'source', 'runtime'], 'Production runtime entry');
  const { id, title, allocation, release, source, runtime } = value;
  if (typeof id !== 'string' || !ID_PATTERN.test(id) || typeof title !== 'string' || title.length < 1
    || typeof allocation !== 'string' || !allocations.has(allocation as ProductionAllocation)
    || !Number.isInteger(release) || Number(release) < 1 || Number(release) > 5
    || !isRecord(source) || !isRecord(runtime)) {
    throw new Error('Production runtime entry identity is invalid.');
  }
  assertExactKeys(source, ['path', 'format', 'bytes', 'sha256'], `${id} source`);
  const sourceFormat = source.format;
  if (typeof source.path !== 'string' || !source.path.startsWith('art-source/production-masters/')
    || source.path.includes('..') || (sourceFormat !== 'svg' && sourceFormat !== 'json')
    || !isPositiveInteger(source.bytes) || typeof source.sha256 !== 'string' || !SHA_PATTERN.test(source.sha256)) {
    throw new Error(`${id} source binding is invalid.`);
  }
  const image = sourceFormat === 'svg';
  const runtimeKeys = image
    ? ['path', 'format', 'kind', 'mimeType', 'bytes', 'sha256', 'byteBudget', 'width', 'height']
    : ['path', 'format', 'kind', 'mimeType', 'bytes', 'sha256', 'byteBudget'];
  assertExactKeys(runtime, runtimeKeys, `${id} runtime export`);
  const pathMatch = typeof runtime.path === 'string' ? RUNTIME_PATH_PATTERN.exec(runtime.path) : null;
  const expectedFormat = image ? 'png' : 'json';
  const expectedKind = image ? 'image' : 'semantic-json';
  const expectedMime = image ? 'image/png' : 'application/json';
  const expectedBudget = image ? MAX_IMAGE_BYTES : MAX_JSON_BYTES;
  if (!pathMatch || pathMatch[1] !== id || pathMatch[2] !== expectedFormat
    || runtime.format !== expectedFormat || runtime.kind !== expectedKind || runtime.mimeType !== expectedMime
    || runtime.byteBudget !== expectedBudget || !isPositiveInteger(runtime.bytes)
    || Number(runtime.bytes) > expectedBudget || typeof runtime.sha256 !== 'string' || !SHA_PATTERN.test(runtime.sha256)) {
    throw new Error(`${id} runtime export is invalid.`);
  }
  if (image && (!isPositiveInteger(runtime.width) || !isPositiveInteger(runtime.height)
    || Number(runtime.width) > 512 || Number(runtime.height) > 512)) {
    throw new Error(`${id} runtime image dimensions are invalid.`);
  }
  return value as unknown as ProductionRuntimeEntry;
}

export function productionRuntimeUrl(entry: ProductionRuntimeEntry): string {
  const validated = validateProductionRuntimeEntry(entry);
  return validated.runtime.path;
}

export function validateProductionRuntimeManifest(value: unknown): ProductionRuntimeManifest {
  if (!isRecord(value)) throw new Error('Production runtime manifest is not an object.');
  assertExactKeys(value, [
    'schemaVersion', 'generatorVersion', 'sourceManifest', 'policies', 'budgets',
    'total', 'runtimeBytes', 'entries',
  ], 'Production runtime manifest');
  const { sourceManifest, policies, budgets, entries } = value;
  if (value.schemaVersion !== 1 || value.generatorVersion !== 1 || value.total !== PRODUCTION_ARCHIVE_TOTAL
    || !isPositiveInteger(value.runtimeBytes) || Number(value.runtimeBytes) > MAX_TOTAL_BYTES
    || !isRecord(sourceManifest) || !isRecord(policies) || !isRecord(budgets) || !Array.isArray(entries)
    || entries.length !== PRODUCTION_ARCHIVE_TOTAL) {
    throw new Error('Production runtime manifest header is invalid.');
  }
  assertExactKeys(sourceManifest, ['path', 'sha256', 'total', 'sourceBytes'], 'Production source manifest binding');
  if (sourceManifest.path !== 'art-source/production-masters/manifest.json'
    || sourceManifest.total !== PRODUCTION_ARCHIVE_TOTAL || !isPositiveInteger(sourceManifest.sourceBytes)
    || typeof sourceManifest.sha256 !== 'string' || !SHA_PATTERN.test(sourceManifest.sha256)) {
    throw new Error('Production source manifest binding is invalid.');
  }
  assertExactKeys(policies, [
    'oneRuntimeEntryPerMaster', 'derivedVariantsDoNotCountAsMasters', 'lazyOnly',
    'webCryptoSha256Required', 'failClosedOnIntegrityMismatch',
  ], 'Production runtime policies');
  if (Object.values(policies).some((enabled) => enabled !== true)) throw new Error('Production runtime policies are disabled.');
  assertExactKeys(budgets, [
    'imageMaxDimension', 'imageMaxBytes', 'jsonMaxBytes', 'totalRuntimeBytes',
    'loaderCacheEntries', 'archivePageSize',
  ], 'Production runtime budgets');
  if (budgets.imageMaxDimension !== 512 || budgets.imageMaxBytes !== MAX_IMAGE_BYTES
    || budgets.jsonMaxBytes !== MAX_JSON_BYTES || budgets.totalRuntimeBytes !== MAX_TOTAL_BYTES
    || budgets.loaderCacheEntries !== PRODUCTION_ASSET_CACHE_LIMIT || budgets.archivePageSize !== PRODUCTION_ARCHIVE_PAGE_SIZE) {
    throw new Error('Production runtime budgets differ from the client contract.');
  }
  const validated = entries.map(validateProductionRuntimeEntry);
  const ids = new Set<string>();
  const paths = new Set<string>();
  let runtimeBytes = 0;
  for (const [index, entry] of validated.entries()) {
    const expectedId = `PF-asset-${String(index + 1).padStart(3, '0')}`;
    if (entry.id !== expectedId || ids.has(entry.id) || paths.has(entry.runtime.path)) {
      throw new Error('Production runtime coverage, order or loader paths are invalid.');
    }
    ids.add(entry.id);
    paths.add(entry.runtime.path);
    runtimeBytes += entry.runtime.bytes;
  }
  if (runtimeBytes !== value.runtimeBytes) throw new Error('Production runtime byte total is invalid.');
  return value as unknown as ProductionRuntimeManifest;
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error('Web Crypto SHA-256 is unavailable; production assets stay locked.');
  const stableBytes = new Uint8Array(bytes);
  const digest = await subtle.digest('SHA-256', stableBytes.buffer);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function countAuthoredValues(value: unknown, depth = 0): number {
  if (depth > 7) return 0;
  if (Array.isArray(value)) return value.reduce((sum, child) => sum + countAuthoredValues(child, depth + 1), 0);
  if (isRecord(value)) {
    let total = 0;
    for (const child of Object.values(value)) total += countAuthoredValues(child, depth + 1);
    return total;
  }
  return value === null ? 0 : 1;
}

export function summarizeProductionJson(value: ProductionSemanticMaster): ProductionSemanticSummary {
  const identityKeys = new Set([
    'schemaVersion', 'id', 'release', 'allocation', 'subject', 'facet', 'masterType',
    'original', 'license', 'runtimePolicy',
  ]);
  return {
    subject: value.subject,
    facet: value.facet,
    masterType: value.masterType,
    sections: Object.keys(value).filter((key) => !identityKeys.has(key)).slice(0, 4),
    authoredValues: countAuthoredValues(value),
  };
}

function validateSemanticMaster(value: unknown, entry: ProductionRuntimeEntry): ProductionSemanticMaster {
  if (!isRecord(value) || value.id !== entry.id || value.release !== entry.release
    || value.allocation !== entry.allocation || value.original !== true
    || !isPositiveInteger(value.schemaVersion) || typeof value.subject !== 'string' || !value.subject
    || typeof value.facet !== 'string' || !value.facet || typeof value.masterType !== 'string' || !value.masterType) {
    throw new Error(`${entry.id} semantic master identity is invalid.`);
  }
  return value as ProductionSemanticMaster;
}

async function readBoundedResponse(response: Response, entry: ProductionRuntimeEntry): Promise<Uint8Array> {
  if (!response.ok || response.redirected) throw new Error(`${entry.id} runtime request was rejected.`);
  const declaredLength = response.headers.get('content-length');
  if (declaredLength !== null && Number(declaredLength) !== entry.runtime.bytes) {
    throw new Error(`${entry.id} Content-Length differs from its manifest.`);
  }
  const declaredType = response.headers.get('content-type')?.split(';', 1)[0]?.trim();
  if (declaredType && declaredType !== entry.runtime.mimeType) throw new Error(`${entry.id} content type is invalid.`);
  if (!response.body) throw new Error(`${entry.id} response has no readable body.`);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      received += part.value.byteLength;
      if (received > entry.runtime.byteBudget || received > entry.runtime.bytes) {
        throw new Error(`${entry.id} exceeded its bounded runtime bytes.`);
      }
      chunks.push(part.value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  }
  if (received !== entry.runtime.bytes) throw new Error(`${entry.id} runtime length is incomplete.`);
  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  if (await sha256Hex(bytes) !== entry.runtime.sha256) throw new Error(`${entry.id} failed SHA-256 integrity verification.`);
  return bytes;
}

export class ProductionAssetLoader {
  private readonly fetcher: FetchLike;
  private readonly cacheLimit: number;
  private manifestRequest?: Promise<ProductionRuntimeManifest>;
  private readonly cache = new Map<string, LoadedProductionAsset>();
  private readonly inFlight = new Map<string, Promise<LoadedProductionAsset>>();

  constructor(fetcher: FetchLike = (...args) => fetch(...args), cacheLimit = PRODUCTION_ASSET_CACHE_LIMIT) {
    if (!Number.isInteger(cacheLimit) || cacheLimit < PRODUCTION_ARCHIVE_PAGE_SIZE || cacheLimit > PRODUCTION_ASSET_CACHE_LIMIT) {
      throw new Error('Production asset cache limit is invalid.');
    }
    this.fetcher = fetcher;
    this.cacheLimit = cacheLimit;
  }

  manifest(): Promise<ProductionRuntimeManifest> {
    if (!this.manifestRequest) {
      this.manifestRequest = this.fetcher(PRODUCTION_RUNTIME_MANIFEST_URL, {
        method: 'GET', credentials: 'same-origin', cache: 'force-cache', redirect: 'error',
        headers: { Accept: 'application/json' },
      }).then(async (response) => {
        if (!response.ok || response.redirected) throw new Error('Production runtime manifest request was rejected.');
        return validateProductionRuntimeManifest(await response.json());
      }).catch((error: unknown) => {
        this.manifestRequest = undefined;
        throw error;
      });
    }
    return this.manifestRequest;
  }

  async load(id: string, signal?: AbortSignal): Promise<LoadedProductionAsset> {
    if (!ID_PATTERN.test(id)) throw new Error('Production asset ID is invalid.');
    if (signal?.aborted) throw new DOMException('The operation was aborted.', 'AbortError');
    const cached = this.cache.get(id);
    if (cached) {
      this.cache.delete(id);
      this.cache.set(id, cached);
      return cached;
    }
    const pending = this.inFlight.get(id);
    if (pending) return pending;
    if (this.inFlight.size >= PRODUCTION_ASSET_CACHE_LIMIT) throw new Error('Production asset loader is at bounded capacity.');
    const request = this.loadFresh(id, signal).then((asset) => {
      this.cache.set(id, asset);
      while (this.cache.size > this.cacheLimit) this.cache.delete(this.cache.keys().next().value as string);
      return asset;
    }).finally(() => this.inFlight.delete(id));
    this.inFlight.set(id, request);
    return request;
  }

  clear(): void {
    this.cache.clear();
  }

  private async loadFresh(id: string, signal?: AbortSignal): Promise<LoadedProductionAsset> {
    const manifest = await this.manifest();
    const entry = manifest.entries[Number.parseInt(id.slice(-3), 10) - 1];
    if (!entry || entry.id !== id) throw new Error(`${id} is not in the production runtime manifest.`);
    const response = await this.fetcher(productionRuntimeUrl(entry), {
      method: 'GET', credentials: 'same-origin', cache: 'force-cache', redirect: 'error', signal,
      headers: { Accept: entry.runtime.mimeType },
    });
    const bytes = await readBoundedResponse(response, entry);
    if (entry.runtime.kind === 'image') {
      return { kind: 'image', entry, bytes, blob: new Blob([new Uint8Array(bytes)], { type: entry.runtime.mimeType }) };
    }
    let parsed: unknown;
    try { parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
    catch { throw new Error(`${id} semantic runtime JSON could not be decoded.`); }
    const value = validateSemanticMaster(parsed, entry);
    return { kind: 'semantic-json', entry, bytes, value, summary: summarizeProductionJson(value) };
  }
}

// Constructing the loader performs no I/O. The archive scene is the sole
// runtime entry point and asks for the manifest only after the player opens it.
export const productionAssetLoader = new ProductionAssetLoader();

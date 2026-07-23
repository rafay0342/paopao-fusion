import {
  PRODUCTION_EXPERIENCE_CATEGORIES,
  PRODUCTION_EXPERIENCE_PAGE_SIZE,
  runProductionExperienceOracle,
  validateProductionExperienceEntry,
  type ProductionExperienceCategory,
  type ProductionExperienceEntry,
  type ProductionExperienceOracleInput,
  type ProductionExperienceOracleResult,
} from '../../shared/runtime/production-experience.mjs';

export const PRODUCTION_EXPERIENCE_MANIFEST_URL = '/assets/production-experience/manifest.json';
export const PRODUCTION_EXPERIENCE_TOTAL = 1500;
export const PRODUCTION_EXPERIENCE_PAGE_CACHE_LIMIT = 2;
export const PRODUCTION_EXPERIENCE_CARD_WIDTH = 292;
export const PRODUCTION_EXPERIENCE_CARD_HEIGHT = 86;
export const PRODUCTION_EXPERIENCE_CARD_TEXT_WIDTH = 252;

export interface ProductionExperienceCardLine {
  role: 'id' | 'subject' | 'facet';
  text: string;
  y: number;
  fontSize: number;
  minScale: number;
  color: string;
  fontStyle?: 'bold';
}

/** Three independent rows keep ledger identity, subject and facet in-card. */
export function productionExperienceCardLines(
  entry: Pick<ProductionExperienceEntry, 'id' | 'subject' | 'facet'>,
): readonly ProductionExperienceCardLine[] {
  return [
    { role: 'id', text: entry.id.toUpperCase(), y: -25, fontSize: 16, minScale: 0.65, color: '#9fe8ff', fontStyle: 'bold' },
    { role: 'subject', text: entry.subject.toUpperCase(), y: 0, fontSize: 18, minScale: 0.65, color: '#f1eaff', fontStyle: 'bold' },
    { role: 'facet', text: entry.facet.toUpperCase(), y: 25, fontSize: 16, minScale: 0.6, color: '#becce0' },
  ];
}

const SHA_PATTERN = /^[a-f0-9]{64}$/;
const PAGE_PATH = /^\/assets\/production-experience\/pages\/(ux-element|animated-element|animation)-r([1-5])-p(0[1-9]|10)\.json$/;

export interface ProductionExperiencePageBinding {
  category: ProductionExperienceCategory;
  release: 1 | 2 | 3 | 4 | 5;
  page: number;
  path: string;
  count: number;
  firstId: string;
  lastId: string;
  bytes: number;
  sha256: string;
}

export interface ProductionExperienceManifest {
  schemaVersion: 1;
  generatorVersion: 1;
  policies: Record<string, true>;
  total: 1500;
  pageSize: 10;
  categoryTotals: Record<ProductionExperienceCategory, 500>;
  releaseTotals: Record<'1' | '2' | '3' | '4' | '5', 300>;
  catalogSha256: string;
  pages: ProductionExperiencePageBinding[];
}

export interface ProductionExperiencePage {
  schemaVersion: 1;
  category: ProductionExperienceCategory;
  release: 1 | 2 | 3 | 4 | 5;
  page: number;
  totalPages: 10;
  entries: ProductionExperienceEntry[];
}

export interface PhaserExperienceFrame {
  id: string;
  kind: 'ux' | 'motion' | 'clip';
  state: string;
  geometry: {
    primitive: 'panel' | 'action' | 'meter' | 'icon' | 'circle' | 'diamond' | 'hex';
    width: number;
    height: number;
    radius: number;
    color: number;
  };
  transform: {
    x: number;
    y: number;
    scale: number;
    rotation: number;
    alpha: number;
    visible: boolean;
  };
  label: string;
  description: string;
  accessibility: ProductionExperienceOracleResult['accessibility'];
  feedback: ProductionExperienceOracleResult['feedback'];
  progress: number;
}

export interface PhaserTransformTarget {
  setPosition(x: number, y: number): PhaserTransformTarget;
  setScale(scale: number): PhaserTransformTarget;
  setRotation(rotation: number): PhaserTransformTarget;
  setAlpha(alpha: number): PhaserTransformTarget;
  setVisible(visible: boolean): PhaserTransformTarget;
}

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[], label: string): void {
  if (Object.keys(value).sort().join('\0') !== [...expected].sort().join('\0')) throw new Error(`${label} has an invalid shape.`);
}

function hueToRgb(hue: number): number {
  const h = ((hue % 360) + 360) % 360;
  const x = 1 - Math.abs(((h / 60) % 2) - 1);
  const [r, g, b] = h < 60 ? [1, x, 0] : h < 120 ? [x, 1, 0] : h < 180 ? [0, 1, x]
    : h < 240 ? [0, x, 1] : h < 300 ? [x, 0, 1] : [1, 0, x];
  const channel = (value: number): number => Math.round((value * 0.56 + 0.34) * 255);
  return (channel(r) << 16) | (channel(g) << 8) | channel(b);
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error('WebCrypto is required to verify production experience pages.');
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes.slice().buffer as ArrayBuffer);
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('');
}

export function validateProductionExperienceManifest(value: unknown): ProductionExperienceManifest {
  if (!isRecord(value)) throw new Error('Production experience manifest is not an object.');
  exactKeys(value, [
    'schemaVersion', 'generatorVersion', 'policies', 'total', 'pageSize', 'categoryTotals',
    'releaseTotals', 'catalogSha256', 'pages',
  ], 'Production experience manifest');
  if (value.schemaVersion !== 1 || value.generatorVersion !== 1 || value.total !== PRODUCTION_EXPERIENCE_TOTAL
    || value.pageSize !== PRODUCTION_EXPERIENCE_PAGE_SIZE || typeof value.catalogSha256 !== 'string'
    || !SHA_PATTERN.test(value.catalogSha256) || !isRecord(value.policies) || !isRecord(value.categoryTotals)
    || !isRecord(value.releaseTotals) || !Array.isArray(value.pages) || value.pages.length !== 150) {
    throw new Error('Production experience manifest header is invalid.');
  }
  const policyKeys = [
    'ledgerSourceLocked', 'oneEntryPerLedgerItem', 'lazyPaginatedLoading', 'pageSha256Required',
    'boundedRuntimeOracle', 'reducedMotionRequired', 'poolResetRequired',
  ];
  exactKeys(value.policies, policyKeys, 'Production experience policies');
  if (Object.values(value.policies).some((enabled) => enabled !== true)) throw new Error('Production experience policies are disabled.');
  exactKeys(value.categoryTotals, PRODUCTION_EXPERIENCE_CATEGORIES, 'Production experience category totals');
  const categoryTotals = value.categoryTotals as Record<string, unknown>;
  if (PRODUCTION_EXPERIENCE_CATEGORIES.some((category) => categoryTotals[category] !== 500)) {
    throw new Error('Production experience category totals are invalid.');
  }
  exactKeys(value.releaseTotals, ['1', '2', '3', '4', '5'], 'Production experience release totals');
  if (Object.values(value.releaseTotals).some((total) => total !== 300)) throw new Error('Production experience release totals are invalid.');

  const seen = new Set<string>();
  const pages = value.pages.map((raw, index): ProductionExperiencePageBinding => {
    if (!isRecord(raw)) throw new Error(`Production experience page binding ${index + 1} is invalid.`);
    exactKeys(raw, ['category', 'release', 'page', 'path', 'count', 'firstId', 'lastId', 'bytes', 'sha256'], `Production experience page binding ${index + 1}`);
    const path = raw.path;
    const match = typeof path === 'string' ? PAGE_PATH.exec(path) : null;
    if (!match || match[1] !== raw.category || Number(match[2]) !== raw.release || Number(match[3]) !== raw.page
      || !PRODUCTION_EXPERIENCE_CATEGORIES.includes(raw.category as ProductionExperienceCategory)
      || !Number.isInteger(raw.release) || Number(raw.release) < 1 || Number(raw.release) > 5
      || !Number.isInteger(raw.page) || Number(raw.page) < 1 || Number(raw.page) > 10
      || raw.count !== 10 || !Number.isInteger(raw.bytes) || Number(raw.bytes) < 100
      || typeof raw.firstId !== 'string' || typeof raw.lastId !== 'string'
      || typeof raw.sha256 !== 'string' || !SHA_PATTERN.test(raw.sha256) || typeof path !== 'string' || seen.has(path)) {
      throw new Error(`Production experience page binding ${index + 1} is invalid.`);
    }
    seen.add(path);
    return raw as unknown as ProductionExperiencePageBinding;
  });
  return { ...value, pages } as unknown as ProductionExperienceManifest;
}

export function validateProductionExperiencePage(
  value: unknown,
  binding: ProductionExperiencePageBinding,
): ProductionExperiencePage {
  if (!isRecord(value)) throw new Error('Production experience page is not an object.');
  exactKeys(value, ['schemaVersion', 'category', 'release', 'page', 'totalPages', 'entries'], 'Production experience page');
  if (value.schemaVersion !== 1 || value.category !== binding.category || value.release !== binding.release
    || value.page !== binding.page || value.totalPages !== 10 || !Array.isArray(value.entries)
    || value.entries.length !== binding.count) throw new Error('Production experience page binding is invalid.');
  const entries = value.entries.map(validateProductionExperienceEntry);
  if (entries[0]?.id !== binding.firstId || entries[entries.length - 1]?.id !== binding.lastId
    || entries.some((entry) => entry.category !== binding.category || entry.release !== binding.release)) {
    throw new Error('Production experience page IDs differ from its manifest binding.');
  }
  return { ...value, entries } as unknown as ProductionExperiencePage;
}

export function createPhaserExperienceFrame(
  entry: ProductionExperienceEntry,
  input: ProductionExperienceOracleInput = {},
): PhaserExperienceFrame {
  const oracle = runProductionExperienceOracle(entry, input);
  const specification = entry.specification;
  const component = specification.kind === 'ux' ? specification.component : specification.actor;
  const primitive = component.primitive as PhaserExperienceFrame['geometry']['primitive'];
  const width = specification.kind === 'ux' ? Math.min(560, Math.max(180, component.minWidth)) : component.size;
  const height = specification.kind === 'ux' ? Math.max(44, component.minHeight) : component.size;
  const radius = specification.kind === 'ux' ? component.radius : Math.round(component.size / 2);
  const hue = component.accentHue as number;
  return {
    id: entry.id,
    kind: oracle.kind,
    state: oracle.state,
    geometry: { primitive, width, height, radius, color: hueToRgb(hue) },
    transform: {
      x: oracle.frame.x,
      y: oracle.frame.y,
      scale: oracle.frame.scale,
      rotation: oracle.frame.rotation,
      alpha: oracle.frame.alpha,
      visible: oracle.frame.visible,
    },
    label: component.label as string,
    description: oracle.accessibility.description,
    accessibility: oracle.accessibility,
    feedback: oracle.feedback,
    progress: oracle.frame.progress,
  };
}

export function applyPhaserExperienceTransform(
  target: PhaserTransformTarget,
  frame: PhaserExperienceFrame,
  originX = 0,
  originY = 0,
): PhaserTransformTarget {
  return target
    .setPosition(originX + frame.transform.x, originY + frame.transform.y)
    .setScale(frame.transform.scale)
    .setRotation(frame.transform.rotation)
    .setAlpha(frame.transform.alpha)
    .setVisible(frame.transform.visible);
}

export class ProductionExperienceLoader {
  private manifestPromise?: Promise<ProductionExperienceManifest>;
  private readonly cache = new Map<string, ProductionExperiencePage>();

  constructor(private readonly fetcher: FetchLike = globalThis.fetch.bind(globalThis)) {}

  manifest(): Promise<ProductionExperienceManifest> {
    if (!this.manifestPromise) {
      this.manifestPromise = this.fetcher(PRODUCTION_EXPERIENCE_MANIFEST_URL, { credentials: 'same-origin', cache: 'no-cache' })
        .then(async (response) => {
          if (!response.ok) throw new Error(`Production experience manifest returned HTTP ${response.status}.`);
          return validateProductionExperienceManifest(await response.json());
        }).catch((error: unknown) => {
          this.manifestPromise = undefined;
          throw error;
        });
    }
    return this.manifestPromise;
  }

  async page(
    category: ProductionExperienceCategory,
    release: 1 | 2 | 3 | 4 | 5,
    page: number,
    signal?: AbortSignal,
  ): Promise<ProductionExperiencePage> {
    const manifest = await this.manifest();
    const binding = manifest.pages.find((candidate) => candidate.category === category
      && candidate.release === release && candidate.page === page);
    if (!binding) throw new Error('Requested production experience page is outside the catalog.');
    const cached = this.cache.get(binding.path);
    if (cached) {
      this.cache.delete(binding.path);
      this.cache.set(binding.path, cached);
      return cached;
    }
    const response = await this.fetcher(binding.path, { credentials: 'same-origin', cache: 'force-cache', signal });
    if (!response.ok) throw new Error(`Production experience page returned HTTP ${response.status}.`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength !== binding.bytes || await sha256Hex(bytes) !== binding.sha256) {
      throw new Error('Production experience page failed SHA-256 verification.');
    }
    let value: unknown;
    try { value = JSON.parse(new TextDecoder().decode(bytes)); }
    catch { throw new Error('Production experience page is not valid JSON.'); }
    const validated = validateProductionExperiencePage(value, binding);
    this.cache.set(binding.path, validated);
    while (this.cache.size > PRODUCTION_EXPERIENCE_PAGE_CACHE_LIMIT) this.cache.delete(this.cache.keys().next().value as string);
    return validated;
  }

  cacheSize(): number {
    return this.cache.size;
  }

  clear(): void {
    this.cache.clear();
  }
}

export const productionExperienceLoader = new ProductionExperienceLoader();

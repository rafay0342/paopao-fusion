import Phaser from 'phaser';
import { hostedAssetUrl } from './hostedAsset';
import { getMeta, type RenderQuality } from './meta';

export const GAMEPLAY_ART_MANIFEST_URL = hostedAssetUrl('/assets/v14/art-manifest.json');
export const GAMEPLAY_ART_MASTER_TOTAL = 500;
export const GAMEPLAY_ART_GATE_SIZE = 100;

export type GameplayArtQuality = RenderQuality;
export type GameplayArtMediaKind =
  | 'image'
  | 'layered'
  | 'atlas'
  | 'rig'
  | 'audio'
  | 'video'
  | 'semantic';
export type GameplayArtFormat =
  | 'avif'
  | 'webp'
  | 'jpeg'
  | 'png'
  | 'svg'
  | 'json'
  | 'bin'
  | 'ogg'
  | 'mp3'
  | 'wav'
  | 'mp4'
  | 'webm';

export type GameplayArtBundle =
  | 'core'
  | 'characters'
  | 'rewards'
  | 'cinematics'
  | 'tutorials'
  | `realm-${string}`
  | `skin-${string}`;

export type PFAssetId = `PF-asset-${string}`;

export interface GameplayArtDimensions {
  width: number;
  height: number;
}

export interface GameplayArtFile {
  format: GameplayArtFormat;
  dimensions: GameplayArtDimensions | null;
  bytes: number;
  sha256: string;
  url: string;
}

export interface GameplayArtVariant extends GameplayArtFile {
  fallbacks?: readonly GameplayArtFile[];
}

/** Tier-independent coordinates normalized to the containing texture. */
export interface GameplayArtRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface GameplayArtAtlasBinding {
  frame: GameplayArtRect;
  rotated: boolean;
}

export interface GameplayArtPivot {
  x: number;
  y: number;
}

export interface GameplayArtSafeZones {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface GameplayArtProvenanceBinding {
  manifest: 'art-source/v14/manifest.json';
  recordId: PFAssetId;
  sourceSha256: string;
  approved: true;
}

export interface GameplayArtManifestEntryV1 {
  stableKey: string;
  pfId: PFAssetId;
  bundle: GameplayArtBundle;
  mediaKind: GameplayArtMediaKind;
  variants: Readonly<Record<GameplayArtQuality, GameplayArtVariant>>;
  atlas?: GameplayArtAtlasBinding;
  pivot?: GameplayArtPivot;
  trim?: GameplayArtRect;
  safeZones?: GameplayArtSafeZones;
  dependencies?: readonly string[];
  fallbackKey?: string;
  /** Optional integrity-bound still image used when a video cannot play. */
  posterKey?: string;
  provenance: GameplayArtProvenanceBinding;
}

export interface GameplayArtManifestV1 {
  schemaVersion: 1;
  releaseId: string;
  generatedAt: string;
  entries: readonly GameplayArtManifestEntryV1[];
}

export interface GameplayArtValidationOptions {
  /**
   * Production defaults to exact 001-500 coverage. Private gate previews can
   * opt out while retaining every per-entry integrity and reference check.
   */
  requireComplete?: boolean;
}

export interface ResolvedGameplayArtAsset {
  /** The unchanged Phaser texture/media identity requested by gameplay code. */
  stableKey: string;
  pfId: PFAssetId;
  bundle: GameplayArtBundle;
  mediaKind: GameplayArtMediaKind;
  quality: GameplayArtQuality;
  variant: GameplayArtVariant;
  url: string;
  candidates: readonly GameplayArtFile[];
  atlas?: GameplayArtAtlasBinding;
  pivot?: GameplayArtPivot;
  trim?: GameplayArtRect;
  safeZones?: GameplayArtSafeZones;
  dependencies: readonly string[];
  fallbackKey?: string;
  posterKey?: string;
}

export type GameplayArtManifestErrorCode =
  | 'invalid-shape'
  | 'invalid-header'
  | 'invalid-entry'
  | 'invalid-reference'
  | 'invalid-coverage';

export class GameplayArtManifestError extends Error {
  readonly code: GameplayArtManifestErrorCode;

  constructor(code: GameplayArtManifestErrorCode, message: string) {
    super(message);
    this.name = 'GameplayArtManifestError';
    this.code = code;
  }
}

const QUALITY_ORDER: readonly GameplayArtQuality[] = ['performance', 'balanced', 'ultra'];
const MEDIA_KINDS = new Set<GameplayArtMediaKind>([
  'image',
  'layered',
  'atlas',
  'rig',
  'audio',
  'video',
  'semantic',
]);
const FORMATS = new Set<GameplayArtFormat>([
  'avif',
  'webp',
  'jpeg',
  'png',
  'svg',
  'json',
  'bin',
  'ogg',
  'mp3',
  'wav',
  'mp4',
  'webm',
]);
const VISUAL_MEDIA = new Set<GameplayArtMediaKind>(['image', 'layered', 'atlas', 'video']);
const TEXTURE_MEDIA = new Set<GameplayArtMediaKind>(['image', 'layered', 'atlas']);
const MEDIA_FORMATS: Readonly<Record<GameplayArtMediaKind, ReadonlySet<GameplayArtFormat>>> = {
  image: new Set(['avif', 'webp', 'jpeg', 'png', 'svg']),
  layered: new Set(['avif', 'webp', 'jpeg', 'png', 'json']),
  atlas: new Set(['avif', 'webp', 'png']),
  rig: new Set(['json', 'bin']),
  audio: new Set(['ogg', 'mp3', 'wav']),
  video: new Set(['mp4', 'webm']),
  semantic: new Set(['json']),
};
const FORMAT_EXTENSIONS: Readonly<Record<GameplayArtFormat, readonly string[]>> = {
  avif: ['avif'],
  webp: ['webp'],
  jpeg: ['jpg', 'jpeg'],
  png: ['png'],
  svg: ['svg'],
  json: ['json'],
  bin: ['bin'],
  ogg: ['ogg'],
  mp3: ['mp3'],
  wav: ['wav'],
  mp4: ['mp4'],
  webm: ['webm'],
};
const ENTRY_KEYS = new Set([
  'stableKey',
  'pfId',
  'bundle',
  'mediaKind',
  'variants',
  'atlas',
  'pivot',
  'trim',
  'safeZones',
  'dependencies',
  'fallbackKey',
  'posterKey',
  'provenance',
]);
const FILE_KEYS = new Set(['format', 'dimensions', 'bytes', 'sha256', 'url']);
const VARIANT_KEYS = new Set([...FILE_KEYS, 'fallbacks']);
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const PF_ID_PATTERN = /^PF-asset-(\d{3})$/;
const STABLE_KEY_PATTERN = /^[a-z][a-z0-9_.-]{0,95}$/;
const BUNDLE_PATTERN = /^(?:core|characters|rewards|cinematics|tutorials|realm-[a-z0-9][a-z0-9-]{0,47}|skin-[a-z0-9][a-z0-9-]{0,47})$/;
const RELEASE_PATTERN = /^[a-z0-9][a-z0-9.-]{2,63}$/;
const MAX_RUNTIME_DIMENSION = 4096;
const MAX_VARIANT_BYTES = 256 * 1024 * 1024;
const MAX_FALLBACK_DEPTH = 8;
const MAX_RUNTIME_ENTRIES = 5000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function own(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function assertAllowedKeys(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  label: string,
): void {
  const unknownKey = Object.keys(value).find((key) => !allowed.has(key));
  if (unknownKey) {
    throw new GameplayArtManifestError('invalid-shape', `${label} contains unsupported field "${unknownKey}".`);
  }
}

function assertExactKeys(value: Record<string, unknown>, expected: readonly string[], label: string): void {
  const actual = Object.keys(value).sort().join('\0');
  if (actual !== [...expected].sort().join('\0')) {
    throw new GameplayArtManifestError('invalid-shape', `${label} has an invalid shape.`);
  }
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) > 0;
}

function isNormalizedNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

function validatePfId(value: unknown, label: string): asserts value is PFAssetId {
  const match = typeof value === 'string' ? PF_ID_PATTERN.exec(value) : null;
  const index = match ? Number(match[1]) : 0;
  if (!match || index < 1 || index > GAMEPLAY_ART_MASTER_TOTAL) {
    throw new GameplayArtManifestError('invalid-entry', `${label} must be PF-asset-001 through PF-asset-500.`);
  }
}

function validateStableKey(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !STABLE_KEY_PATTERN.test(value) || value.includes('fighting')) {
    throw new GameplayArtManifestError('invalid-entry', `${label} is not a safe stable gameplay key.`);
  }
}

function validateRect(value: unknown, label: string): asserts value is GameplayArtRect {
  if (!isRecord(value)) {
    throw new GameplayArtManifestError('invalid-entry', `${label} is not a normalized rectangle.`);
  }
  assertExactKeys(value, ['x', 'y', 'width', 'height'], label);
  const { x, y, width, height } = value;
  if (!isNormalizedNumber(x) || !isNormalizedNumber(y)
    || !isNormalizedNumber(width) || !isNormalizedNumber(height)
    || width <= 0 || height <= 0 || x + width > 1.000001 || y + height > 1.000001) {
    throw new GameplayArtManifestError('invalid-entry', `${label} is outside normalized texture bounds.`);
  }
}

function validateDimensions(value: unknown, label: string): asserts value is GameplayArtDimensions {
  if (!isRecord(value)) {
    throw new GameplayArtManifestError('invalid-entry', `${label} dimensions are missing.`);
  }
  assertExactKeys(value, ['width', 'height'], `${label} dimensions`);
  if (!isPositiveInteger(value.width) || !isPositiveInteger(value.height)
    || Number(value.width) > MAX_RUNTIME_DIMENSION || Number(value.height) > MAX_RUNTIME_DIMENSION) {
    throw new GameplayArtManifestError('invalid-entry', `${label} dimensions exceed the V14 runtime contract.`);
  }
}

function validateArtFile(
  value: unknown,
  label: string,
  mediaKind: GameplayArtMediaKind,
  allowVariantFields = false,
): asserts value is GameplayArtFile {
  if (!isRecord(value)) {
    throw new GameplayArtManifestError('invalid-entry', `${label} is not an asset file.`);
  }
  assertAllowedKeys(value, allowVariantFields ? VARIANT_KEYS : FILE_KEYS, label);
  if ([...FILE_KEYS].some((key) => !own(value, key))) {
    throw new GameplayArtManifestError('invalid-shape', `${label} is missing required file metadata.`);
  }
  if (typeof value.format !== 'string' || !FORMATS.has(value.format as GameplayArtFormat)
    || !isPositiveInteger(value.bytes) || Number(value.bytes) > MAX_VARIANT_BYTES
    || typeof value.sha256 !== 'string' || !SHA256_PATTERN.test(value.sha256)
    || typeof value.url !== 'string') {
    throw new GameplayArtManifestError('invalid-entry', `${label} integrity metadata is invalid.`);
  }
  const format = value.format as GameplayArtFormat;
  if (!MEDIA_FORMATS[mediaKind].has(format)) {
    throw new GameplayArtManifestError('invalid-entry', `${label} format does not match ${mediaKind} media.`);
  }
  const visual = VISUAL_MEDIA.has(mediaKind);
  if (visual) {
    validateDimensions(value.dimensions, label);
  } else if (value.dimensions !== null) {
    throw new GameplayArtManifestError('invalid-entry', `${label} must use null dimensions for non-visual media.`);
  }

  const url = value.url;
  const lowerUrl = url.toLowerCase();
  const extension = lowerUrl.split('.').pop();
  const hashPrefix = value.sha256.slice(0, 12);
  if (!url.startsWith('/assets/v14/')
    || url.includes('\\') || url.includes('..') || /[\u0000-\u001f?#]/.test(url)
    || lowerUrl.includes('/fighting/') || lowerUrl.includes('fighting')
    || !extension || !FORMAT_EXTENSIONS[format].includes(extension)
    || !lowerUrl.includes(hashPrefix)) {
    throw new GameplayArtManifestError(
      'invalid-entry',
      `${label} URL must be a content-addressed /assets/v14/ path matching its format and SHA-256.`,
    );
  }
}

function validateVariant(
  value: unknown,
  label: string,
  mediaKind: GameplayArtMediaKind,
): asserts value is GameplayArtVariant {
  if (!isRecord(value)) {
    throw new GameplayArtManifestError('invalid-entry', `${label} is not an asset variant.`);
  }
  assertAllowedKeys(value, VARIANT_KEYS, label);
  if ([...FILE_KEYS].some((key) => !own(value, key))) {
    throw new GameplayArtManifestError('invalid-shape', `${label} is missing its primary asset file.`);
  }
  validateArtFile(value, label, mediaKind, true);
  if (!own(value, 'fallbacks')) return;
  if (!Array.isArray(value.fallbacks) || value.fallbacks.length < 1 || value.fallbacks.length > 3) {
    throw new GameplayArtManifestError('invalid-entry', `${label} fallback files are invalid.`);
  }
  const formats = new Set<GameplayArtFormat>([value.format as GameplayArtFormat]);
  const urls = new Set<string>([value.url as string]);
  for (const [index, fallback] of value.fallbacks.entries()) {
    validateArtFile(fallback, `${label} fallback ${index + 1}`, mediaKind);
    if (formats.has(fallback.format) || urls.has(fallback.url)) {
      throw new GameplayArtManifestError(
        'invalid-entry',
        `${label} fallback formats and URLs must be unique within the quality tier.`,
      );
    }
    formats.add(fallback.format);
    urls.add(fallback.url);
  }
}

function validateProvenance(
  value: unknown,
  pfId: PFAssetId,
  label: string,
): asserts value is GameplayArtProvenanceBinding {
  if (!isRecord(value)) {
    throw new GameplayArtManifestError('invalid-entry', `${label} provenance is missing.`);
  }
  assertExactKeys(value, ['manifest', 'recordId', 'sourceSha256', 'approved'], `${label} provenance`);
  if (value.manifest !== 'art-source/v14/manifest.json' || value.recordId !== pfId
    || typeof value.sourceSha256 !== 'string' || !SHA256_PATTERN.test(value.sourceSha256)
    || value.approved !== true) {
    throw new GameplayArtManifestError('invalid-entry', `${label} provenance is not approved or correctly bound.`);
  }
}

export function validateGameplayArtEntry(value: unknown): GameplayArtManifestEntryV1 {
  if (!isRecord(value)) {
    throw new GameplayArtManifestError('invalid-entry', 'Gameplay art entry is not an object.');
  }
  assertAllowedKeys(value, ENTRY_KEYS, 'Gameplay art entry');
  const required = ['stableKey', 'pfId', 'bundle', 'mediaKind', 'variants', 'provenance'];
  if (required.some((key) => !own(value, key))) {
    throw new GameplayArtManifestError('invalid-shape', 'Gameplay art entry is missing required fields.');
  }

  validateStableKey(value.stableKey, 'Gameplay art stableKey');
  validatePfId(value.pfId, `${value.stableKey} pfId`);
  if (typeof value.bundle !== 'string' || !BUNDLE_PATTERN.test(value.bundle)
    || typeof value.mediaKind !== 'string' || !MEDIA_KINDS.has(value.mediaKind as GameplayArtMediaKind)
    || !isRecord(value.variants)) {
    throw new GameplayArtManifestError('invalid-entry', `${value.stableKey} identity or variants are invalid.`);
  }

  assertExactKeys(value.variants, QUALITY_ORDER, `${value.stableKey} variants`);
  const mediaKind = value.mediaKind as GameplayArtMediaKind;
  for (const quality of QUALITY_ORDER) {
    validateVariant(value.variants[quality], `${value.stableKey} ${quality} variant`, mediaKind);
  }

  if (own(value, 'atlas')) {
    if (!isRecord(value.atlas)) {
      throw new GameplayArtManifestError('invalid-entry', `${value.stableKey} atlas binding is invalid.`);
    }
    assertExactKeys(value.atlas, ['frame', 'rotated'], `${value.stableKey} atlas binding`);
    validateRect(value.atlas.frame, `${value.stableKey} atlas frame`);
    if (typeof value.atlas.rotated !== 'boolean') {
      throw new GameplayArtManifestError('invalid-entry', `${value.stableKey} atlas rotation is invalid.`);
    }
  }
  if (own(value, 'pivot')) {
    if (!isRecord(value.pivot)) {
      throw new GameplayArtManifestError('invalid-entry', `${value.stableKey} pivot is invalid.`);
    }
    assertExactKeys(value.pivot, ['x', 'y'], `${value.stableKey} pivot`);
    if (!isNormalizedNumber(value.pivot.x) || !isNormalizedNumber(value.pivot.y)) {
      throw new GameplayArtManifestError('invalid-entry', `${value.stableKey} pivot is outside normalized bounds.`);
    }
  }
  if (own(value, 'trim')) validateRect(value.trim, `${value.stableKey} trim`);
  if (own(value, 'safeZones')) {
    if (!isRecord(value.safeZones)) {
      throw new GameplayArtManifestError('invalid-entry', `${value.stableKey} safe zones are invalid.`);
    }
    assertExactKeys(value.safeZones, ['top', 'right', 'bottom', 'left'], `${value.stableKey} safe zones`);
    const { top, right, bottom, left } = value.safeZones;
    if (![top, right, bottom, left].every(isNormalizedNumber)
      || Number(top) + Number(bottom) >= 1 || Number(left) + Number(right) >= 1) {
      throw new GameplayArtManifestError('invalid-entry', `${value.stableKey} safe zones hide the complete frame.`);
    }
  }
  if (own(value, 'dependencies')) {
    if (!Array.isArray(value.dependencies) || value.dependencies.length > 32) {
      throw new GameplayArtManifestError('invalid-entry', `${value.stableKey} dependencies are invalid.`);
    }
    const seen = new Set<string>();
    for (const dependency of value.dependencies) {
      validateStableKey(dependency, `${value.stableKey} dependency`);
      if (dependency === value.stableKey || seen.has(dependency)) {
        throw new GameplayArtManifestError('invalid-entry', `${value.stableKey} dependencies are duplicated or recursive.`);
      }
      seen.add(dependency);
    }
  }
  if (own(value, 'fallbackKey')) {
    validateStableKey(value.fallbackKey, `${value.stableKey} fallbackKey`);
    if (value.fallbackKey === value.stableKey) {
      throw new GameplayArtManifestError('invalid-entry', `${value.stableKey} cannot fall back to itself.`);
    }
  }
  if (own(value, 'posterKey')) {
    validateStableKey(value.posterKey, `${value.stableKey} posterKey`);
    if (value.mediaKind !== 'video' || value.posterKey === value.stableKey) {
      throw new GameplayArtManifestError(
        'invalid-entry',
        `${value.stableKey} posterKey is only valid for video and cannot reference itself.`,
      );
    }
  }
  validateProvenance(value.provenance, value.pfId as PFAssetId, value.stableKey as string);
  return value as unknown as GameplayArtManifestEntryV1;
}

function assertAcyclicReferences(
  entriesByKey: ReadonlyMap<string, GameplayArtManifestEntryV1>,
  field: 'dependencies',
): void {
  const visiting = new Set<string>();
  const visited = new Set<string>();

  const visit = (key: string, depth: number): void => {
    if (visited.has(key)) return;
    if (visiting.has(key)) {
      throw new GameplayArtManifestError('invalid-reference', `Gameplay art ${field} contain a cycle at "${key}".`);
    }
    visiting.add(key);
    const entry = entriesByKey.get(key);
    const references = entry?.dependencies ?? [];
    for (const reference of references) visit(reference, depth + 1);
    visiting.delete(key);
    visited.add(key);
  };

  for (const key of entriesByKey.keys()) visit(key, 0);
}

function assertBoundedFallbacks(
  entriesByKey: ReadonlyMap<string, GameplayArtManifestEntryV1>,
): void {
  for (const origin of entriesByKey.keys()) {
    const visited = new Set<string>();
    let current: string | undefined = origin;
    let depth = 0;
    while (current) {
      if (visited.has(current)) {
        throw new GameplayArtManifestError(
          'invalid-reference',
          `Gameplay art fallbackKey contains a cycle at "${current}".`,
        );
      }
      visited.add(current);
      const next: string | undefined = entriesByKey.get(current)?.fallbackKey;
      if (!next) break;
      depth += 1;
      if (depth > MAX_FALLBACK_DEPTH) {
        throw new GameplayArtManifestError(
          'invalid-reference',
          `Gameplay art fallback chain exceeds ${MAX_FALLBACK_DEPTH} entries at "${origin}".`,
        );
      }
      current = next;
    }
  }
}

function cloneAndFreeze<T>(value: T): T {
  if (Array.isArray(value)) {
    return Object.freeze(value.map((item) => cloneAndFreeze(item))) as T;
  }
  if (isRecord(value)) {
    const copy: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) copy[key] = cloneAndFreeze(child);
    return Object.freeze(copy) as T;
  }
  return value;
}

export function validateGameplayArtManifest(
  value: unknown,
  options: GameplayArtValidationOptions = {},
): GameplayArtManifestV1 {
  if (!isRecord(value)) {
    throw new GameplayArtManifestError('invalid-shape', 'GameplayArtManifestV1 is not an object.');
  }
  assertExactKeys(value, ['schemaVersion', 'releaseId', 'generatedAt', 'entries'], 'GameplayArtManifestV1');
  if (value.schemaVersion !== 1 || typeof value.releaseId !== 'string' || !RELEASE_PATTERN.test(value.releaseId)
    || typeof value.generatedAt !== 'string' || !Number.isFinite(Date.parse(value.generatedAt))
    || !Array.isArray(value.entries) || value.entries.length < 1
    || value.entries.length > MAX_RUNTIME_ENTRIES) {
    throw new GameplayArtManifestError('invalid-header', 'GameplayArtManifestV1 header is invalid.');
  }

  const validatedEntries = value.entries.map(validateGameplayArtEntry);
  const entriesByKey = new Map<string, GameplayArtManifestEntryV1>();
  const entriesByPfId = new Map<PFAssetId, GameplayArtManifestEntryV1>();
  const pfIdByPrimaryHash = new Map<string, PFAssetId>();
  for (const entry of validatedEntries) {
    const existingForPfId = entriesByPfId.get(entry.pfId);
    const hashOwner = pfIdByPrimaryHash.get(entry.provenance.sourceSha256);
    if (entriesByKey.has(entry.stableKey)
      || (existingForPfId && existingForPfId.provenance.sourceSha256 !== entry.provenance.sourceSha256)
      || (hashOwner && hashOwner !== entry.pfId)) {
      throw new GameplayArtManifestError(
        'invalid-coverage',
        `Gameplay art key, PF binding or primary source hash conflicts at "${entry.stableKey}".`,
      );
    }
    entriesByKey.set(entry.stableKey, entry);
    if (!existingForPfId) entriesByPfId.set(entry.pfId, entry);
    if (!hashOwner) pfIdByPrimaryHash.set(entry.provenance.sourceSha256, entry.pfId);
  }

  for (const entry of validatedEntries) {
    for (const dependency of entry.dependencies ?? []) {
      if (!entriesByKey.has(dependency)) {
        throw new GameplayArtManifestError(
          'invalid-reference',
          `${entry.stableKey} depends on missing key "${dependency}".`,
        );
      }
    }
    if (entry.fallbackKey) {
      const fallback = entriesByKey.get(entry.fallbackKey);
      if (!fallback) {
        throw new GameplayArtManifestError(
          'invalid-reference',
          `${entry.stableKey} fallback "${entry.fallbackKey}" is missing.`,
        );
      }
      if (fallback.mediaKind !== entry.mediaKind) {
        throw new GameplayArtManifestError(
          'invalid-reference',
          `${entry.stableKey} fallback must preserve media kind and texture semantics.`,
        );
      }
    }
    if (entry.posterKey) {
      const poster = entriesByKey.get(entry.posterKey);
      if (!poster) {
        throw new GameplayArtManifestError(
          'invalid-reference',
          `${entry.stableKey} poster "${entry.posterKey}" is missing.`,
        );
      }
      if (poster.mediaKind !== 'image') {
        throw new GameplayArtManifestError(
          'invalid-reference',
          `${entry.stableKey} poster must reference an image entry.`,
        );
      }
    }
  }
  assertAcyclicReferences(entriesByKey, 'dependencies');
  assertBoundedFallbacks(entriesByKey);

  if (options.requireComplete !== false) {
    if (entriesByPfId.size !== GAMEPLAY_ART_MASTER_TOTAL) {
      throw new GameplayArtManifestError(
        'invalid-coverage',
        `Production GameplayArtManifestV1 requires exactly ${GAMEPLAY_ART_MASTER_TOTAL} unique PF masters.`,
      );
    }
    for (let index = 1; index <= GAMEPLAY_ART_MASTER_TOTAL; index += 1) {
      const id = `PF-asset-${String(index).padStart(3, '0')}` as PFAssetId;
      if (!entriesByPfId.has(id)) {
        throw new GameplayArtManifestError('invalid-coverage', `Production manifest is missing ${id}.`);
      }
    }
  }

  return cloneAndFreeze({
    schemaVersion: 1,
    releaseId: value.releaseId,
    generatedAt: value.generatedAt,
    entries: validatedEntries,
  } satisfies GameplayArtManifestV1);
}

export class GameplayArtRegistry {
  readonly manifest: GameplayArtManifestV1;
  private readonly entriesByKey: ReadonlyMap<string, GameplayArtManifestEntryV1>;
  private readonly keysByBundle: ReadonlyMap<GameplayArtBundle, readonly string[]>;

  constructor(value: unknown, options: GameplayArtValidationOptions = {}) {
    this.manifest = validateGameplayArtManifest(value, options);
    const entriesByKey = new Map<string, GameplayArtManifestEntryV1>();
    const keysByBundle = new Map<GameplayArtBundle, string[]>();
    for (const entry of this.manifest.entries) {
      entriesByKey.set(entry.stableKey, entry);
      const keys = keysByBundle.get(entry.bundle) ?? [];
      keys.push(entry.stableKey);
      keysByBundle.set(entry.bundle, keys);
    }
    this.entriesByKey = entriesByKey;
    this.keysByBundle = new Map(
      [...keysByBundle].map(([bundle, keys]) => [bundle, Object.freeze([...keys])] as const),
    );
  }

  entry(stableKey: string): GameplayArtManifestEntryV1 | null {
    return this.entriesByKey.get(stableKey) ?? null;
  }

  resolve(stableKey: string, quality: GameplayArtQuality): ResolvedGameplayArtAsset | null {
    if (!QUALITY_ORDER.includes(quality)) return null;
    const entry = this.entriesByKey.get(stableKey);
    if (!entry) return null;
    const variant = entry.variants[quality];
    const candidates = Object.freeze(
      [variant, ...(variant.fallbacks ?? [])].map((file) => Object.freeze({
        ...file,
        url: hostedAssetUrl(file.url),
      })),
    );
    return Object.freeze({
      stableKey: entry.stableKey,
      pfId: entry.pfId,
      bundle: entry.bundle,
      mediaKind: entry.mediaKind,
      quality,
      variant,
      url: hostedAssetUrl(variant.url),
      candidates,
      ...(entry.atlas ? { atlas: entry.atlas } : {}),
      ...(entry.pivot ? { pivot: entry.pivot } : {}),
      ...(entry.trim ? { trim: entry.trim } : {}),
      ...(entry.safeZones ? { safeZones: entry.safeZones } : {}),
      dependencies: entry.dependencies ?? Object.freeze([]),
      ...(entry.fallbackKey ? { fallbackKey: entry.fallbackKey } : {}),
      ...(entry.posterKey ? { posterKey: entry.posterKey } : {}),
    });
  }

  bundleKeys(bundle: GameplayArtBundle): readonly string[] {
    return this.keysByBundle.get(bundle) ?? Object.freeze([]);
  }

  bundleEntries(bundle: GameplayArtBundle): readonly GameplayArtManifestEntryV1[] {
    return Object.freeze(
      this.bundleKeys(bundle)
        .map((key) => this.entriesByKey.get(key))
        .filter((entry): entry is GameplayArtManifestEntryV1 => Boolean(entry)),
    );
  }

  bundles(): readonly GameplayArtBundle[] {
    return Object.freeze([...this.keysByBundle.keys()]);
  }
}

let activeRegistry: GameplayArtRegistry | null = null;

/**
 * Atomically installs a fully validated manifest. A failed validation leaves
 * the last known-good registry active; an unconfigured process resolves null.
 */
export function installGameplayArtManifest(
  value: unknown,
  options: GameplayArtValidationOptions = {},
): GameplayArtRegistry {
  const next = new GameplayArtRegistry(value, options);
  activeRegistry = next;
  return next;
}

export function clearGameplayArtManifest(): void {
  activeRegistry = null;
}

export function getGameplayArtManifest(): GameplayArtManifestV1 | null {
  return activeRegistry?.manifest ?? null;
}

export function resolveArtAsset(
  stableKey: string,
  quality: GameplayArtQuality,
): ResolvedGameplayArtAsset | null {
  return activeRegistry?.resolve(stableKey, quality) ?? null;
}

export function getArtBundleKeys(bundle: GameplayArtBundle): readonly string[] {
  return activeRegistry?.bundleKeys(bundle) ?? Object.freeze([]);
}

export function getArtBundleEntries(bundle: GameplayArtBundle): readonly GameplayArtManifestEntryV1[] {
  return activeRegistry?.bundleEntries(bundle) ?? Object.freeze([]);
}

export function getArtBundles(): readonly GameplayArtBundle[] {
  return activeRegistry?.bundles() ?? Object.freeze([]);
}

type ManifestFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export async function fetchAndInstallGameplayArtManifest(
  fetcher: ManifestFetch = globalThis.fetch.bind(globalThis),
  options: GameplayArtValidationOptions = {},
): Promise<GameplayArtRegistry> {
  const response = await fetcher(GAMEPLAY_ART_MANIFEST_URL, {
    cache: 'no-cache',
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
  });
  if (!response.ok || response.redirected) {
    throw new GameplayArtManifestError(
      'invalid-header',
      `Gameplay art manifest request failed with HTTP ${response.status}.`,
    );
  }
  const contentType = response.headers.get('content-type')?.split(';', 1)[0]?.trim();
  if (contentType && contentType !== 'application/json') {
    throw new GameplayArtManifestError('invalid-header', 'Gameplay art manifest response is not JSON.');
  }
  return installGameplayArtManifest(await response.json(), options);
}

export interface ArtBundleLoadResult {
  bundle: GameplayArtBundle;
  quality: GameplayArtQuality;
  loaded: readonly string[];
  reused: readonly string[];
  failed: readonly string[];
}

interface ManagedArtResource {
  refs: number;
  managed: boolean;
  mediaKind: GameplayArtMediaKind;
  quality: GameplayArtQuality;
  restoreKey?: string;
}

const resourcesByGame = new WeakMap<Phaser.Game, Map<string, ManagedArtResource>>();
const bundlesByScene = new WeakMap<Phaser.Scene, Map<GameplayArtBundle, readonly string[]>>();
const shutdownHookedScenes = new WeakSet<Phaser.Scene>();

export class GameplayArtIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GameplayArtIntegrityError';
  }
}

export async function verifyGameplayArtFileBytes(
  file: GameplayArtFile,
  payload: ArrayBuffer | Uint8Array,
): Promise<void> {
  const bytes = payload instanceof Uint8Array
    ? new Uint8Array(payload)
    : new Uint8Array(payload.slice(0));
  if (bytes.byteLength !== file.bytes) {
    throw new GameplayArtIntegrityError(
      `Gameplay art byte length ${bytes.byteLength} does not match ${file.bytes}.`,
    );
  }
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new GameplayArtIntegrityError('Web Crypto SHA-256 is unavailable; V14 art stays locked.');
  }
  const digest = await subtle.digest('SHA-256', bytes.buffer);
  const actual = Array.from(
    new Uint8Array(digest),
    (byte) => byte.toString(16).padStart(2, '0'),
  ).join('');
  if (actual !== file.sha256) {
    throw new GameplayArtIntegrityError('Gameplay art failed SHA-256 integrity verification.');
  }
}

class VerifiedGameplayImageFile extends Phaser.Loader.FileTypes.ImageFile {
  private readonly integrityDescriptor: GameplayArtFile;

  constructor(
    loader: Phaser.Loader.LoaderPlugin,
    stableKey: string,
    descriptor: GameplayArtFile,
  ) {
    super(loader, {
      key: stableKey,
      url: descriptor.url,
      extension: descriptor.format === 'jpeg' ? 'jpg' : descriptor.format,
    });
    this.integrityDescriptor = descriptor;
    // Phaser can be configured to bypass XHR and decode from an
    // HTMLImageElement. That mode cannot prove the downloaded bytes, so V14
    // always restores the blob/XHR path before a file is admitted to cache.
    const imageLoaderState = this as VerifiedGameplayImageFile & { useImageElementLoad?: boolean };
    if (imageLoaderState.useImageElementLoad) {
      imageLoaderState.useImageElementLoad = false;
      this.load = Phaser.Loader.File.prototype.load;
      this.onProcess = VerifiedGameplayImageFile.prototype.onProcess;
    }
  }

  override onProcess(): void {
    const response = this.xhrLoader?.response;
    if (!(response instanceof Blob)) {
      this.onProcessError();
      return;
    }
    void response.arrayBuffer()
      .then((bytes) => verifyGameplayArtFileBytes(this.integrityDescriptor, bytes))
      .then(() => super.onProcess())
      .catch(() => this.onProcessError());
  }
}

function sceneHasArtAsset(
  scene: Phaser.Scene,
  stableKey: string,
  mediaKind: GameplayArtMediaKind,
): boolean {
  if (TEXTURE_MEDIA.has(mediaKind)) return scene.textures.exists(stableKey);
  if (mediaKind === 'audio') return scene.cache.audio.exists(stableKey);
  if (mediaKind === 'video') return scene.cache.video.exists(stableKey);
  if (mediaKind === 'rig' || mediaKind === 'semantic') return scene.cache.json.exists(stableKey);
  return scene.cache.binary.exists(stableKey);
}

function queueArtFile(
  scene: Phaser.Scene,
  asset: ResolvedGameplayArtAsset,
  file: GameplayArtFile,
  loadKey = asset.stableKey,
): void {
  const { mediaKind } = asset;
  if (mediaKind === 'audio') {
    scene.load.audio(loadKey, file.url);
  } else if (mediaKind === 'video') {
    scene.load.video(loadKey, file.url, true);
  } else if (mediaKind === 'rig' || mediaKind === 'semantic') {
    scene.load.json(loadKey, file.url);
  } else if (mediaKind === 'atlas') {
    // Atlas frame metadata lives in the signed manifest. Phaser receives the
    // bounded sheet here; view adapters can address the normalized frame.
    scene.load.addFile(new VerifiedGameplayImageFile(scene.load, loadKey, file));
  } else if (mediaKind === 'image' || (mediaKind === 'layered' && file.format !== 'json')) {
    scene.load.addFile(new VerifiedGameplayImageFile(scene.load, loadKey, file));
  } else {
    scene.load.json(loadKey, file.url);
  }
}

/**
 * Queues one already-validated candidate through a byte-count and SHA-256
 * enforcing Phaser file. Used by boot/reward recovery without duplicating the
 * manifest loader's integrity rules.
 */
export function queueVerifiedArtCandidate(
  scene: Phaser.Scene,
  asset: ResolvedGameplayArtAsset,
  candidateIndex = 0,
): boolean {
  const candidate = asset.candidates[candidateIndex];
  if (!candidate) return false;
  queueArtFile(scene, asset, candidate);
  return true;
}

function recoveryCandidates(
  origin: ResolvedGameplayArtAsset,
  quality: GameplayArtQuality,
): readonly GameplayArtFile[] {
  const candidates: GameplayArtFile[] = [];
  const urls = new Set<string>();
  let current: ResolvedGameplayArtAsset | null = origin;
  const visited = new Set<string>();
  while (current && !visited.has(current.stableKey)) {
    visited.add(current.stableKey);
    for (const candidate of current.candidates) {
      if (urls.has(candidate.url)) continue;
      urls.add(candidate.url);
      candidates.push(candidate);
    }
    current = current.fallbackKey
      ? resolveArtAsset(current.fallbackKey, quality)
      : null;
  }
  return Object.freeze(candidates);
}

export function getArtBundleLoadPlan(
  bundle: GameplayArtBundle,
  quality: GameplayArtQuality,
): readonly ResolvedGameplayArtAsset[] {
  const ordered: ResolvedGameplayArtAsset[] = [];
  const visited = new Set<string>();
  const visiting = new Set<string>();

  const visit = (stableKey: string): void => {
    if (visited.has(stableKey) || visiting.has(stableKey)) return;
    const asset = resolveArtAsset(stableKey, quality);
    if (!asset) return;
    visiting.add(stableKey);
    for (const dependency of asset.dependencies) visit(dependency);
    let recovery = asset.fallbackKey
      ? resolveArtAsset(asset.fallbackKey, quality)
      : null;
    const recoveryVisited = new Set<string>();
    while (recovery && !recoveryVisited.has(recovery.stableKey)) {
      recoveryVisited.add(recovery.stableKey);
      for (const dependency of recovery.dependencies) visit(dependency);
      recovery = recovery.fallbackKey
        ? resolveArtAsset(recovery.fallbackKey, quality)
        : null;
    }
    visiting.delete(stableKey);
    visited.add(stableKey);
    ordered.push(Object.freeze({
      ...asset,
      candidates: recoveryCandidates(asset, quality),
    }));
  };

  for (const stableKey of getArtBundleKeys(bundle)) visit(stableKey);
  return Object.freeze(ordered);
}

/**
 * Queue a V14 bundle during a scene's preload phase. The manifest must already
 * be installed. Managed V14 resources are reference-counted; a colliding
 * legacy texture is replaced only after a private-key candidate verifies.
 */
export function queueArtBundle(
  scene: Phaser.Scene,
  bundle: GameplayArtBundle,
  quality: GameplayArtQuality = getMeta().quality,
): readonly ResolvedGameplayArtAsset[] {
  if (bundlesByScene.get(scene)?.has(bundle)) return Object.freeze([]);

  const resolved = getArtBundleLoadPlan(bundle, quality);
  const resources = resourcesByGame.get(scene.game);
  const existedBefore = new Set<string>();
  const queued: ResolvedGameplayArtAsset[] = [];
  const replacementKeys = new Map<string, string>();
  const restoreKeys = new Map<string, string>();
  for (const asset of resolved) {
    const { stableKey } = asset;
    if (sceneHasArtAsset(scene, stableKey, asset.mediaKind)) {
      const managed = resources?.get(stableKey);
      if (managed) {
        // A concurrent scene may still hold the previous scene-boundary
        // quality. Reuse it until its final reference is released; never
        // remove a verified texture that another live scene is rendering.
        existedBefore.add(stableKey);
        continue;
      }
      if (!TEXTURE_MEDIA.has(asset.mediaKind)) {
        // Preserve unknown non-texture cache entries. They remain unmanaged
        // and are never removed by the V14 release path.
        existedBefore.add(stableKey);
        continue;
      }
      // Boot can install a legacy recovery texture under the same stable key.
      // Load the integrity-verified V14 candidate transactionally under a
      // private key, then replace the legacy texture only after verification
      // and decode have both succeeded.
      const replacementKey = `__paopao_v14__${scene.sys.settings.key}__${bundle}__${stableKey}`;
      if (scene.textures.exists(replacementKey)) scene.textures.remove(replacementKey);
      replacementKeys.set(stableKey, replacementKey);
      queueArtFile(scene, asset, asset.candidates[0], replacementKey);
      queued.push(asset);
      continue;
    }
    queueArtFile(scene, asset, asset.candidates[0], stableKey);
    queued.push(asset);
  }
  if (queued.length > 0) {
    const retries = new Map<string, {
      asset: ResolvedGameplayArtAsset;
      nextCandidate: number;
      loadKey: string;
    }>(
      queued.map((asset) => {
        const loadKey = replacementKeys.get(asset.stableKey) ?? asset.stableKey;
        return [loadKey, { asset, nextCandidate: 1, loadKey }];
      }),
    );
    const onLoadError = (file: Phaser.Loader.File): void => {
      const retry = retries.get(String(file.key));
      if (!retry) return;
      const candidate = retry.asset.candidates[retry.nextCandidate];
      if (!candidate) {
        retries.delete(String(file.key));
        return;
      }
      retry.nextCandidate += 1;
      queueArtFile(scene, retry.asset, candidate, retry.loadKey);
    };
    const onComplete = (): void => {
      scene.load.off('loaderror', onLoadError);
      const successful: ResolvedGameplayArtAsset[] = [];
      for (const asset of resolved) {
        if (existedBefore.has(asset.stableKey)) {
          successful.push(asset);
          continue;
        }
        const replacementKey = replacementKeys.get(asset.stableKey);
        if (replacementKey) {
          if (!scene.textures.exists(replacementKey)) continue;
          const restoreKey = `__paopao_v14_restore__${asset.stableKey}`;
          if (scene.textures.exists(restoreKey)) scene.textures.remove(restoreKey);
          if (scene.textures.exists(asset.stableKey)
            && !scene.textures.renameTexture(asset.stableKey, restoreKey)) {
            scene.textures.remove(replacementKey);
            continue;
          }
          if (!scene.textures.renameTexture(replacementKey, asset.stableKey)) {
            scene.textures.remove(replacementKey);
            if (scene.textures.exists(restoreKey)) {
              scene.textures.renameTexture(restoreKey, asset.stableKey);
            }
            continue;
          }
          if (scene.textures.exists(restoreKey)) restoreKeys.set(asset.stableKey, restoreKey);
          successful.push(asset);
          continue;
        }
        if (sceneHasArtAsset(scene, asset.stableKey, asset.mediaKind)) {
          successful.push(asset);
        }
      }
      registerLoadedBundle(scene, bundle, successful, existedBefore, restoreKeys);
    };
    scene.load.on('loaderror', onLoadError);
    scene.load.once('complete', onComplete);
  } else {
    registerLoadedBundle(scene, bundle, resolved, existedBefore);
  }
  return Object.freeze(queued);
}

function removeSceneArtAsset(
  scene: Phaser.Scene,
  stableKey: string,
  mediaKind: GameplayArtMediaKind,
): void {
  if (TEXTURE_MEDIA.has(mediaKind)) {
    if (scene.textures.exists(stableKey)) scene.textures.remove(stableKey);
  } else if (mediaKind === 'audio') {
    scene.cache.audio.remove(stableKey);
  } else if (mediaKind === 'video') {
    scene.cache.video.remove(stableKey);
  } else if (mediaKind === 'rig' || mediaKind === 'semantic') {
    scene.cache.json.remove(stableKey);
  } else {
    scene.cache.binary.remove(stableKey);
  }
}

function registerLoadedBundle(
  scene: Phaser.Scene,
  bundle: GameplayArtBundle,
  successful: readonly ResolvedGameplayArtAsset[],
  existedBefore: ReadonlySet<string>,
  restoreKeys: ReadonlyMap<string, string> = new Map(),
): void {
  const sceneBundles = bundlesByScene.get(scene) ?? new Map<GameplayArtBundle, readonly string[]>();
  if (sceneBundles.has(bundle)) return;
  const gameResources = resourcesByGame.get(scene.game) ?? new Map<string, ManagedArtResource>();
  const keys = successful.map(({ stableKey }) => stableKey);
  for (const asset of successful) {
    const current = gameResources.get(asset.stableKey);
    if (current) {
      current.refs += 1;
    } else {
      gameResources.set(asset.stableKey, {
        refs: 1,
        managed: !existedBefore.has(asset.stableKey),
        mediaKind: asset.mediaKind,
        quality: asset.quality,
        ...(restoreKeys.has(asset.stableKey)
          ? { restoreKey: restoreKeys.get(asset.stableKey) }
          : {}),
      });
    }
  }
  sceneBundles.set(bundle, Object.freeze(keys));
  bundlesByScene.set(scene, sceneBundles);
  resourcesByGame.set(scene.game, gameResources);
  if (!shutdownHookedScenes.has(scene)) {
    shutdownHookedScenes.add(scene);
    scene.events.once('shutdown', () => {
      const activeBundles = [...(bundlesByScene.get(scene)?.keys() ?? [])];
      for (const activeBundle of activeBundles) releaseArtBundle(scene, activeBundle);
      shutdownHookedScenes.delete(scene);
    });
  }
}

/**
 * Load one manifest bundle with bounded format fallbacks and per-scene
 * reference counting. A failed file remains unavailable; callers can keep
 * their existing code-native or legacy recovery art.
 */
export async function loadArtBundle(
  scene: Phaser.Scene,
  bundle: GameplayArtBundle,
  quality: GameplayArtQuality = getMeta().quality,
): Promise<ArtBundleLoadResult> {
  const alreadyRegistered = bundlesByScene.get(scene)?.get(bundle);
  if (alreadyRegistered) {
    return Object.freeze({
      bundle,
      quality,
      loaded: Object.freeze([]),
      reused: Object.freeze([...alreadyRegistered]),
      failed: Object.freeze([]),
    });
  }

  const resolved = getArtBundleLoadPlan(bundle, quality);
  const queued = queueArtBundle(scene, bundle, quality);
  const queuedKeys = new Set(queued.map(({ stableKey }) => stableKey));
  if (queued.length > 0) {
    await new Promise<void>((resolve) => {
      scene.load.once('complete', () => resolve());
      if (!scene.load.isLoading()) scene.load.start();
    });
  }
  const successfulKeys = new Set(bundlesByScene.get(scene)?.get(bundle) ?? []);
  const failedKeys = new Set(
    resolved
      .map(({ stableKey }) => stableKey)
      .filter((stableKey) => !successfulKeys.has(stableKey)),
  );
  return Object.freeze({
    bundle,
    quality,
    loaded: Object.freeze(
      [...successfulKeys].filter((stableKey) => queuedKeys.has(stableKey)),
    ),
    reused: Object.freeze(
      [...successfulKeys].filter((stableKey) => !queuedKeys.has(stableKey)),
    ),
    failed: Object.freeze([...failedKeys]),
  });
}

/**
 * Release only assets this V14 loader owns and only when no scene still holds
 * a bundle reference. Pre-existing legacy textures are never removed.
 */
export function releaseArtBundle(
  scene: Phaser.Scene,
  bundle: GameplayArtBundle,
): readonly string[] {
  const sceneBundles = bundlesByScene.get(scene);
  const keys = sceneBundles?.get(bundle);
  if (!keys) return Object.freeze([]);
  sceneBundles?.delete(bundle);
  const resources = resourcesByGame.get(scene.game);
  const removed: string[] = [];
  for (const stableKey of keys) {
    const resource = resources?.get(stableKey);
    if (!resource) continue;
    resource.refs -= 1;
    if (resource.refs > 0) continue;
    resources?.delete(stableKey);
    if (resource.managed) {
      removeSceneArtAsset(scene, stableKey, resource.mediaKind);
      if (resource.restoreKey
        && TEXTURE_MEDIA.has(resource.mediaKind)
        && scene.textures.exists(resource.restoreKey)) {
        scene.textures.renameTexture(resource.restoreKey, stableKey);
      }
      removed.push(stableKey);
    }
  }
  if (sceneBundles?.size === 0) bundlesByScene.delete(scene);
  if (resources?.size === 0) resourcesByGame.delete(scene.game);
  return Object.freeze(removed);
}

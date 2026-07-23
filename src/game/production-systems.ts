import manifestJson from '../../shared/fixtures/production-systems-v1.json';
import {
  canonicalSystemInput,
  executeProductionSystem,
  validateProductionSystemsManifest,
  type ProductionSystemEntry,
  type ProductionSystemInput,
  type ProductionSystemObservation,
} from '../../shared/runtime/production-systems.mjs';

export const PRODUCTION_SYSTEM_CATEGORIES = [
  'upgrade',
  'improvement',
  'ui',
  'frontend',
  'flow',
  'rendering',
  'control',
] as const;

export type ProductionSystemCategory = typeof PRODUCTION_SYSTEM_CATEGORIES[number];

export interface ProductionSystemPresentation {
  id: string;
  title: string;
  categoryLabel: string;
  releaseLabel: string;
  statusLabel: string;
  detailLines: readonly string[];
  transitionLabels: readonly string[];
  feedbackPurpose: string;
  accentCss: string;
  accentNumber: number;
  durationMs: number;
  reducedMotion: boolean;
  accessibleRole: string;
}

type ProductionSystemManifest = {
  schemaVersion: 1;
  title: string;
  total: number;
  byCategory: Record<ProductionSystemCategory, number>;
  byRelease: Record<string, number>;
  manifestSha256: string;
  entries: ProductionSystemEntry[];
};

const manifest = manifestJson as ProductionSystemManifest;
validateProductionSystemsManifest(manifest);
const entryById = new Map(manifest.entries.map((entry) => [entry.id, Object.freeze(entry)]));

const CATEGORY_LABELS: Record<ProductionSystemCategory, string> = {
  upgrade: 'PLATFORM',
  improvement: 'VERIFIED IMPROVEMENT',
  ui: 'UI SYSTEM',
  frontend: 'FRONTEND',
  flow: 'GAME FLOW',
  rendering: 'RENDERING',
  control: 'CONTROL',
};

function hueToRgb(hue: number): number {
  const h = ((hue % 360) + 360) % 360;
  const chroma = 0.64;
  const x = chroma * (1 - Math.abs(((h / 60) % 2) - 1));
  const [r, g, b] = h < 60 ? [chroma, x, 0] : h < 120 ? [x, chroma, 0]
    : h < 180 ? [0, chroma, x] : h < 240 ? [0, x, chroma]
      : h < 300 ? [x, 0, chroma] : [chroma, 0, x];
  const lift = 0.28;
  return ((Math.round((r + lift) * 255) & 0xff) << 16)
    | ((Math.round((g + lift) * 255) & 0xff) << 8)
    | (Math.round((b + lift) * 255) & 0xff);
}

function hex(number: number): string {
  return `#${number.toString(16).padStart(6, '0')}`;
}

function displayValue(value: unknown): string {
  if (typeof value === 'boolean') return value ? 'YES' : 'NO';
  if (typeof value === 'number') return Number.isInteger(value) ? value.toLocaleString() : value.toFixed(3);
  if (value == null) return '—';
  return String(value).split('-').join(' ').toUpperCase();
}

export function productionSystemManifest(): Readonly<ProductionSystemManifest> {
  return manifest;
}

export function productionSystemEntry(id: string): ProductionSystemEntry | null {
  return entryById.get(id) ?? null;
}

export function productionSystemsFor(category?: ProductionSystemCategory, release?: number): readonly ProductionSystemEntry[] {
  return manifest.entries.filter((entry) => (category == null || entry.category === category)
    && (release == null || entry.release === release));
}

export function presentProductionSystem(
  entry: ProductionSystemEntry,
  observation: ProductionSystemObservation,
  input: ProductionSystemInput,
): Readonly<ProductionSystemPresentation> {
  const accentNumber = hueToRgb(entry.contract.accentHue);
  const detailLines = Object.entries(observation.detail).slice(0, 7).map(([key, value]) => (
    `${key.replace(/([A-Z])/g, ' $1').toUpperCase()}  ${displayValue(value)}`
  ));
  return Object.freeze({
    id: entry.id,
    title: `${entry.subject} — ${entry.facet}`,
    categoryLabel: CATEGORY_LABELS[entry.category as ProductionSystemCategory],
    releaseLabel: `RELEASE ${entry.release}`,
    statusLabel: observation.ok ? (observation.reason === 'idempotent-replay' ? 'REPLAY VERIFIED' : 'CONTRACT VERIFIED') : 'FAIL-CLOSED',
    detailLines: Object.freeze(detailLines),
    transitionLabels: Object.freeze([...observation.stateTransitions]),
    feedbackPurpose: observation.feedbackPurpose,
    accentCss: hex(accentNumber),
    accentNumber,
    durationMs: input.reducedMotion ? 0 : Math.min(420, Math.max(90, observation.timing.durationMs)),
    reducedMotion: input.reducedMotion,
    accessibleRole: entry.contract.accessibilityRole,
  });
}

export function exerciseProductionSystem(
  id: string,
  overrides: Partial<ProductionSystemInput> = {},
): Readonly<{ entry: ProductionSystemEntry; input: ProductionSystemInput; observation: ProductionSystemObservation; presentation: ProductionSystemPresentation }> {
  const entry = productionSystemEntry(id);
  if (!entry) throw new Error(`Unknown production system ${id}`);
  const input = canonicalSystemInput(entry, overrides);
  const observation = executeProductionSystem(entry, input);
  const presentation = presentProductionSystem(entry, observation, input);
  return Object.freeze({ entry, input, observation, presentation });
}

/**
 * Bounded observation cache used by the catalog scene and support tooling.
 * Replaying a system refreshes its LRU position but never grows the cache.
 */
export class ProductionSystemRuntime {
  private readonly observations = new Map<string, ReturnType<typeof exerciseProductionSystem>>();

  constructor(private readonly maximumEntries = 24) {
    if (!Number.isInteger(maximumEntries) || maximumEntries < 1 || maximumEntries > 64) throw new Error('Production system cache bound must be 1..64');
  }

  exercise(id: string, overrides: Partial<ProductionSystemInput> = {}): ReturnType<typeof exerciseProductionSystem> {
    const result = exerciseProductionSystem(id, overrides);
    this.observations.delete(id);
    this.observations.set(id, result);
    while (this.observations.size > this.maximumEntries) {
      const oldest = this.observations.keys().next().value as string | undefined;
      if (oldest == null) break;
      this.observations.delete(oldest);
    }
    return result;
  }

  size(): number {
    return this.observations.size;
  }

  has(id: string): boolean {
    return this.observations.has(id);
  }

  clear(): void {
    this.observations.clear();
  }
}

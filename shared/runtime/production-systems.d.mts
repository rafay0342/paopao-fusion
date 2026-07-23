export type ProductionSystemCategory = 'upgrade' | 'improvement' | 'ui' | 'frontend' | 'flow' | 'rendering' | 'control';
export type ProductionQuality = 'performance' | 'balanced' | 'ultra';
export type ProductionInputMode = 'mouse' | 'keyboard' | 'touch' | 'controller' | 'hand' | 'switch' | 'replay';

export interface ProductionSystemEntry {
  id: string;
  acceptanceId: string;
  category: ProductionSystemCategory;
  kind: string;
  release: number;
  ordinal: number;
  subject: string;
  facet: string;
  contract: {
    schemaVersion: 1;
    ownership: string;
    failureMode: 'fail-closed-with-recovery';
    stateBudget: number;
    frameBudgetMs: number;
    memoryBudgetKb: number;
    durationMs: number;
    accentHue: number;
    accessibilityRole: string;
    telemetryKey: string;
    reducedMotion: boolean;
    deterministicSeed: number;
  };
  contractSha256: string;
}

export interface ProductionSystemInput {
  sequence: number;
  value: number;
  available: boolean;
  interrupted: boolean;
  repeated: boolean;
  viewportWidth: number;
  viewportHeight: number;
  quality: ProductionQuality;
  inputMode: ProductionInputMode;
  reducedMotion: boolean;
}

export interface ProductionSystemObservation {
  schemaVersion: 1;
  id: string;
  acceptanceId: string;
  ok: boolean;
  reason: string;
  content: Readonly<{ subject: string; facet: string; release: number }> | null;
  rules: Readonly<Record<string, unknown>>;
  timing: Readonly<{ frameBudgetMs: number; durationMs: number }>;
  rewards: Readonly<{ grantable: false; delta: 0 }>;
  stateTransitions: readonly string[];
  feedbackPurpose: string;
  detail: Readonly<Record<string, unknown>>;
  signature: string;
}

export function stableSystemHash(value: unknown): string;
export function canonicalSystemInput(entry: ProductionSystemEntry, overrides?: Partial<ProductionSystemInput>): ProductionSystemInput;
export function executeProductionSystem(entry: ProductionSystemEntry, input: unknown): ProductionSystemObservation;
export function validateProductionSystemsManifest(manifest: unknown): Readonly<{ total: 850; byCategory: Readonly<Record<string, number>>; byRelease: Readonly<Record<string, number>> }>;

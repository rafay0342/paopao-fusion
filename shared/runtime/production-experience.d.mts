export type ProductionExperienceCategory = 'ux-element' | 'animated-element' | 'animation';

export interface ProductionExperienceLedgerItem {
  id: string;
  category: ProductionExperienceCategory;
  ordinal: number;
  release: number;
  title: string;
  acceptanceTest: { id: string };
}

export interface ProductionExperienceFrame {
  x: number;
  y: number;
  scale: number;
  rotation: number;
  alpha: number;
  progress: number;
  visible: boolean;
}

export interface ProductionExperienceEntry {
  schemaVersion: 1;
  id: string;
  acceptanceId: string;
  category: ProductionExperienceCategory;
  ordinal: number;
  release: 1 | 2 | 3 | 4 | 5;
  title: string;
  subject: string;
  facet: string;
  behaviorFingerprint: string;
  specification: Record<string, any>;
}

export interface ProductionExperienceOracleInput {
  timeMs?: number;
  action?: string;
  reducedMotion?: boolean;
  paused?: boolean;
  offscreen?: boolean;
}

export interface ProductionExperienceOracleResult {
  id: string;
  acceptanceId: string;
  kind: 'ux' | 'motion' | 'clip';
  state: string;
  frame: ProductionExperienceFrame;
  feedback: { visual: string; audio: string; announcement: string };
  reset: boolean;
  accessibility: {
    role: string;
    label: string;
    description: string;
    focusable: boolean;
    liveRegion: 'off' | 'polite' | 'assertive';
    keyboard: string[];
  };
}

export const PRODUCTION_EXPERIENCE_SCHEMA_VERSION: 1;
export const PRODUCTION_EXPERIENCE_PAGE_SIZE: 10;
export const PRODUCTION_EXPERIENCE_CATEGORIES: readonly ProductionExperienceCategory[];
export function createProductionExperienceEntry(item: ProductionExperienceLedgerItem): ProductionExperienceEntry;
export function validateProductionExperienceEntry(value: unknown): ProductionExperienceEntry;
export function runProductionExperienceOracle(entry: ProductionExperienceEntry, input?: ProductionExperienceOracleInput): ProductionExperienceOracleResult;
export function productionExperienceTestFullName(
  entryOrItem: { acceptanceId?: string; acceptanceTest?: { id: string } },
  target: 'shared' | 'phaser',
): string;

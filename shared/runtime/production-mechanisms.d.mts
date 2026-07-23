export const PRODUCTION_MECHANISM_SCHEMA_VERSION: 1;
export const PRODUCTION_MECHANISM_TOTAL: 500;
export const PRODUCTION_MECHANISM_FIXED_STEP_MS: 16;
export const PRODUCTION_MECHANISM_PREDICTION_LIMIT: 3;
export const PRODUCTION_MECHANISM_EVENT_LIMIT: 8;

export const PRODUCTION_MECHANISM_SUBJECTS: readonly ProductionMechanismSubject[];
export const PRODUCTION_MECHANISM_FACETS: readonly ProductionMechanismFacet[];

export type ProductionMechanismSubject =
  | 'hex coordinate' | 'board occupancy' | 'bubble spawn' | 'aim ray' | 'wall reflection'
  | 'shot travel' | 'cell attachment' | 'color match' | 'cluster removal' | 'floating removal'
  | 'ceiling descent' | 'loss boundary' | 'win objective' | 'move budget' | 'score multiplier'
  | 'combo chain' | 'power charge' | 'bomb power' | 'rainbow power' | 'swap queue'
  | 'level seed' | 'obstacle state' | 'boss state' | 'artifact state' | 'reward outcome';

export type ProductionMechanismFacet =
  | 'canonical representation' | 'input normalization' | 'fixed-step transition' | 'tie-break rule'
  | 'seed consumption' | 'invariant check' | 'serialization' | 'replay event'
  | 'server-client oracle' | 'property test' | 'edge-case fixture' | 'overflow guard'
  | 'rollback snapshot' | 'desync checksum' | 'authoritative validation' | 'prediction boundary'
  | 'reconciliation' | 'failure closure' | 'performance bound' | 'evidence capture';

export interface ProductionMechanismState {
  schemaVersion: 1;
  subject: ProductionMechanismSubject;
  revision: number;
  tick: number;
  seed: number;
  status: 'ready' | 'active' | 'complete' | 'failed';
  events: Array<Record<string, unknown>>;
  data: Record<string, unknown>;
}

export interface ProductionMechanismEntry {
  schemaVersion: 1;
  id: string;
  acceptanceId: string;
  category: 'mechanism';
  ordinal: number;
  release: number;
  title: string;
  subject: ProductionMechanismSubject;
  facet: ProductionMechanismFacet;
  subjectIndex: number;
  facetIndex: number;
  behaviorFingerprint: string;
  contract: {
    schemaVersion: 1;
    authority: 'shared-deterministic-oracle';
    failureMode: 'fail-closed-no-mutation';
    fixedStepMs: 16;
    predictionLimit: 3;
    eventLimit: 8;
    operationBudget: 512;
    maximumSerializedBytes: 4096;
    deterministicSeed: number;
    canonicalFields: string[];
  };
}

export interface ProductionMechanismInput {
  action: 'advance';
  authoritative: boolean;
  candidateRevision: number;
  interrupted: boolean;
  predictionSteps: number;
  repeated: boolean;
  seed: number;
  sequence: number;
  state: ProductionMechanismState;
  value: number;
}

export interface ProductionMechanismObservation {
  schemaVersion: 1;
  id: string;
  acceptanceId: string;
  subject: ProductionMechanismSubject;
  facet: ProductionMechanismFacet | 'unknown';
  ok: boolean;
  reason: string;
  state: ProductionMechanismState;
  previousState: ProductionMechanismState;
  rules: Readonly<Record<string, unknown>>;
  timing: Readonly<{ fixedStepMs: number; operations: number; operationBudget: number }>;
  rewards: Readonly<{ grantable: boolean; delta: number; authority: string }>;
  stateTransitions: readonly string[];
  feedbackPurpose: string;
  replayEvent: Readonly<Record<string, unknown>> | null;
  checksum: string;
  facetProof: Readonly<Record<string, unknown>>;
  signature: string;
}

export interface ProductionMechanismLedgerItem {
  id: string;
  category: 'mechanism';
  ordinal: number;
  release: number;
  title: string;
  clientFacing: true;
  acceptanceTest: { id: string };
}

export interface ProductionMechanismManifest {
  schemaVersion: 1;
  title: string;
  total: 500;
  policies: Record<string, true>;
  bySubject: Record<ProductionMechanismSubject, number>;
  byFacet: Record<ProductionMechanismFacet, number>;
  byRelease: Record<string, number>;
  entriesSha256: string;
  entries: ProductionMechanismEntry[];
}

export function stableMechanismHash(value: unknown): string;
export function createProductionMechanismState(subject: ProductionMechanismSubject, seed?: number): ProductionMechanismState;
export function normalizeProductionMechanismState(subject: ProductionMechanismSubject, candidate: unknown, fallbackSeed?: number): ProductionMechanismState;
export function canonicalProductionMechanismInput(entry: ProductionMechanismEntry, overrides?: Partial<ProductionMechanismInput>): ProductionMechanismInput;
export function createProductionMechanismEntry(item: ProductionMechanismLedgerItem): ProductionMechanismEntry;
export function runProductionMechanismOracle(entry: ProductionMechanismEntry, candidateInput: unknown): ProductionMechanismObservation;
export function productionMechanismTestFullName(entry: ProductionMechanismEntry, target: 'shared' | 'phaser'): string;
export function validateProductionMechanismManifest(manifest: unknown): Readonly<{ total: number; fingerprints: number }>;

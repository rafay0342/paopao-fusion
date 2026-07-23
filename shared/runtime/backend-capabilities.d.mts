export const BACKEND_CAPABILITY_SCHEMA_VERSION: 1;
export const BACKEND_CAPABILITY_FACETS: readonly string[];
export const BACKEND_CAPABILITY_SUBJECTS: readonly {
  key: string;
  title: string;
  auth: string;
  mutable: boolean;
  rateLimit: number;
}[];

export class BackendCapabilityError extends Error {
  code: string;
  statusCode: number;
  constructor(code: string, message: string, statusCode?: number);
}

export class TransientBackendRepositoryError extends Error {}

export class MemoryBackendCapabilityRepository {
  revision(subject: string): number;
  receipt(subject: string, idempotencyKey: string): { fingerprint: string; response: BackendCapabilityEnvelope } | null;
  failNextCommit(subject: string): void;
  publish(subject: string): number;
  stats(subject: string): { revision: number; receipts: number; commits: number; publications: number };
}

export type BackendCapabilityEnvelope = {
  schemaVersion: 1;
  subject: string;
  operationId: string;
  revision: number;
  attempts: number;
  recovered: boolean;
  result: Record<string, string | number | boolean>;
};

export type BackendCapabilityLedgerItem = {
  id: string;
  category: string;
  ordinal: number;
  title: string;
  acceptanceTest: { id: string };
};

export function validateBackendCapabilityEnvelope(policyKey: string, value: unknown): BackendCapabilityEnvelope;
export function createAuthorizedBackendContext(policyKey: string, overrides?: Record<string, unknown>): Record<string, unknown>;
export function createBackendCapabilityService(options?: {
  repository?: MemoryBackendCapabilityRepository;
  clock?: () => number;
}): {
  invoke(policyKey: string, input: Record<string, unknown>, context?: Record<string, unknown>): BackendCapabilityEnvelope;
  diagnostics(context?: Record<string, unknown>): {
    schemaVersion: 1;
    auditLimit: number;
    subjects: Array<{ key: string; revision: number; rateLimitPerMinute: number; metrics: Record<string, number> }>;
    audit: Array<Record<string, unknown>>;
  };
  repository: MemoryBackendCapabilityRepository;
};
export function backendCapabilityCoordinates(ordinal: number): { subject: typeof BACKEND_CAPABILITY_SUBJECTS[number]; facet: string };
export function backendCapabilityTestFullName(item: BackendCapabilityLedgerItem): string;
export function runBackendCapabilityProbe(item: BackendCapabilityLedgerItem, options?: {
  repository?: MemoryBackendCapabilityRepository;
  restartRepository?: (repository: MemoryBackendCapabilityRepository) => MemoryBackendCapabilityRepository;
}): Record<string, unknown>;
export function assertBackendCapabilityProbe(item: BackendCapabilityLedgerItem, outcome: Record<string, unknown>): true;

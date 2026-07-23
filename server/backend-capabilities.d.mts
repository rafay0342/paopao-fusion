import type {
  BackendCapabilityEnvelope,
  MemoryBackendCapabilityRepository,
} from '../shared/runtime/backend-capabilities.mjs';
import type Database from 'better-sqlite3';

export class SqliteBackendCapabilityRepository implements MemoryBackendCapabilityRepository {
  constructor(source?: string | Database.Database);
  revision(subject: string): number;
  receipt(subject: string, idempotencyKey: string): { fingerprint: string; response: BackendCapabilityEnvelope } | null;
  failNextCommit(subject: string): void;
  publish(subject: string): number;
  stats(subject: string): { revision: number; receipts: number; commits: number; publications: number };
  close(): void;
}

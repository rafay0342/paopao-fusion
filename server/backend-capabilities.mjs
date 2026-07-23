import Database from 'better-sqlite3';
import {
  BackendCapabilityError,
  TransientBackendRepositoryError,
} from '../shared/runtime/backend-capabilities.mjs';

const SUBJECT_PATTERN = /^[a-z][a-z0-9-]{2,47}$/;
const IDEMPOTENCY_PATTERN = /^[a-z0-9][a-z0-9._:-]{7,95}$/i;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

function assertSubject(subject) {
  if (typeof subject !== 'string' || !SUBJECT_PATTERN.test(subject)) {
    throw new BackendCapabilityError('invalid-subject', 'backend capability subject is invalid', 400);
  }
}

function parseReceipt(row) {
  if (!row) return null;
  let response;
  try { response = JSON.parse(row.response_json); }
  catch { throw new BackendCapabilityError('persistence-corrupt', 'backend capability receipt is corrupt', 500); }
  return { fingerprint: row.fingerprint, response };
}

export class SqliteBackendCapabilityRepository {
  #db;
  #ownsDatabase;
  #failNext = new Set();
  #ensureState;
  #readState;
  #readReceipt;
  #insertReceipt;
  #commitState;
  #publishState;
  #commitTransaction;
  #publishTransaction;

  constructor(source = ':memory:') {
    const sharedDatabase = source && typeof source === 'object'
      && typeof source.prepare === 'function' && typeof source.exec === 'function';
    this.#db = sharedDatabase ? source : new Database(source);
    this.#ownsDatabase = !sharedDatabase;
    this.#db.pragma('foreign_keys = ON');
    this.#db.pragma('busy_timeout = 5000');
    if (!sharedDatabase && source !== ':memory:') {
      this.#db.pragma('journal_mode = WAL');
      this.#db.pragma('synchronous = FULL');
    }
    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS backend_capability_state (
        subject TEXT PRIMARY KEY,
        revision INTEGER NOT NULL CHECK (revision >= 1),
        commits INTEGER NOT NULL CHECK (commits >= 0),
        publications INTEGER NOT NULL CHECK (publications >= 0)
      );
      CREATE TABLE IF NOT EXISTS backend_capability_receipts (
        subject TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        fingerprint TEXT NOT NULL CHECK (length(fingerprint) = 64),
        response_json TEXT NOT NULL,
        PRIMARY KEY (subject, idempotency_key),
        FOREIGN KEY (subject) REFERENCES backend_capability_state(subject) ON DELETE CASCADE
      );
    `);
    this.#ensureState = this.#db.prepare(`
      INSERT INTO backend_capability_state (subject, revision, commits, publications)
      VALUES (?, 1, 0, 0) ON CONFLICT(subject) DO NOTHING
    `);
    this.#readState = this.#db.prepare('SELECT revision, commits, publications FROM backend_capability_state WHERE subject = ?');
    this.#readReceipt = this.#db.prepare(`
      SELECT fingerprint, response_json FROM backend_capability_receipts
      WHERE subject = ? AND idempotency_key = ?
    `);
    this.#insertReceipt = this.#db.prepare(`
      INSERT INTO backend_capability_receipts (subject, idempotency_key, fingerprint, response_json)
      VALUES (?, ?, ?, ?)
    `);
    this.#commitState = this.#db.prepare(`
      UPDATE backend_capability_state SET revision = ?, commits = commits + 1
      WHERE subject = ? AND revision = ?
    `);
    this.#publishState = this.#db.prepare(`
      UPDATE backend_capability_state SET revision = revision + 1, publications = publications + 1
      WHERE subject = ?
    `);
    this.#commitTransaction = this.#db.transaction((input) => {
      this.#ensureState.run(input.subject);
      const existing = parseReceipt(this.#readReceipt.get(input.subject, input.idempotencyKey));
      if (existing) {
        if (existing.fingerprint !== input.fingerprint) {
          throw new BackendCapabilityError('idempotency-conflict', 'idempotency key was used with a different request', 409);
        }
        return existing.response;
      }
      const state = this.#readState.get(input.subject);
      if (state.revision !== input.expectedRevision) {
        throw new BackendCapabilityError('revision-conflict', 'expected revision is stale', 409);
      }
      const nextRevision = input.mutable ? state.revision + 1 : state.revision;
      const committed = { ...input.response, revision: nextRevision };
      const stateUpdate = this.#commitState.run(nextRevision, input.subject, state.revision);
      if (stateUpdate.changes !== 1) throw new BackendCapabilityError('revision-conflict', 'concurrent revision update lost', 409);
      this.#insertReceipt.run(input.subject, input.idempotencyKey, input.fingerprint, JSON.stringify(committed));
      return committed;
    });
    this.#publishTransaction = this.#db.transaction((subject) => {
      this.#ensureState.run(subject);
      this.#publishState.run(subject);
      return this.#readState.get(subject).revision;
    });
  }

  revision(subject) {
    assertSubject(subject);
    this.#ensureState.run(subject);
    return this.#readState.get(subject).revision;
  }

  receipt(subject, idempotencyKey) {
    assertSubject(subject);
    if (typeof idempotencyKey !== 'string' || !IDEMPOTENCY_PATTERN.test(idempotencyKey)) {
      throw new BackendCapabilityError('invalid-idempotency-key', 'backend capability idempotency key is invalid', 400);
    }
    this.#ensureState.run(subject);
    const value = parseReceipt(this.#readReceipt.get(subject, idempotencyKey));
    return value ? structuredClone(value) : null;
  }

  failNextCommit(subject) {
    assertSubject(subject);
    this.#failNext.add(subject);
  }

  publish(subject) {
    assertSubject(subject);
    return this.#publishTransaction(subject);
  }

  commit(input) {
    assertSubject(input?.subject);
    if (this.#failNext.delete(input.subject)) throw new TransientBackendRepositoryError();
    if (typeof input.idempotencyKey !== 'string' || !IDEMPOTENCY_PATTERN.test(input.idempotencyKey)
      || typeof input.fingerprint !== 'string' || !SHA256_PATTERN.test(input.fingerprint)
      || !Number.isInteger(input.expectedRevision) || input.expectedRevision < 1
      || typeof input.mutable !== 'boolean' || input.response === null || typeof input.response !== 'object') {
      throw new BackendCapabilityError('invalid-persistence-input', 'backend capability commit input is invalid', 400);
    }
    return structuredClone(this.#commitTransaction(input));
  }

  stats(subject) {
    assertSubject(subject);
    this.#ensureState.run(subject);
    const state = this.#readState.get(subject);
    const receipts = this.#db.prepare('SELECT COUNT(*) AS count FROM backend_capability_receipts WHERE subject = ?').get(subject).count;
    return { revision: state.revision, receipts, commits: state.commits, publications: state.publications };
  }

  close() {
    if (this.#ownsDatabase && this.#db.open) this.#db.close();
  }
}

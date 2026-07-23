import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import Database from 'better-sqlite3';
import {
  BACKEND_CAPABILITY_SUBJECTS,
  createAuthorizedBackendContext,
  createBackendCapabilityService,
} from '../shared/runtime/backend-capabilities.mjs';
import { SqliteBackendCapabilityRepository } from '../server/backend-capabilities.mjs';
import { installSecurityAdmin } from '../server/security-admin.mjs';
import { createSigningKeyring } from '../server/signing-keyring.mjs';

const TAILNET_HEADERS = { 'x-forwarded-for': '100.73.18.9' };

describe('installed backend capability service', () => {
  let app: ReturnType<typeof Fastify>;
  let db: Database.Database;
  let directory: string;
  let repository: SqliteBackendCapabilityRepository;

  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), 'paopao-installed-backend-capabilities-'));
    app = Fastify({ logger: false });
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    repository = new SqliteBackendCapabilityRepository(db);
    const backendCapabilities = createBackendCapabilityService({ repository });
    const signingKeyring = createSigningKeyring({
      path: join(directory, 'signing-keyring.json'),
      seedSecret: 'installed-backend-capability-signing-secret',
    });
    installSecurityAdmin({
      app,
      db,
      dataDir: directory,
      signingKeyring,
      backendCapabilities,
      origin: 'https://admin.paopao.test',
      bootstrapSecret: 'installed-backend-capability-bootstrap-secret',
    });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    repository.close();
    db.close();
    rmSync(directory, { recursive: true, force: true });
  });

  function authenticatedHeaders() {
    const createdAt = '2026-07-22T00:00:00.000Z';
    const expiresAt = '2099-07-22T00:00:00.000Z';
    const token = 'test-admin-session-token-that-is-never-returned';
    const csrfToken = 'test-admin-csrf-token';
    db.prepare('INSERT INTO admin_principals(principal_id,user_handle,display_name,created_at) VALUES(?,?,?,?)')
      .run('admin-test', 'admin-user-handle', 'Test Admin', createdAt);
    db.prepare(`INSERT INTO admin_webauthn_credentials
      (credential_id,principal_id,rp_id,name,public_key_pem,algorithm,sign_count,transports_json,created_at)
      VALUES(?,?,?,?,?,?,?,?,?)`).run(
      'credential-test', 'admin-test', 'admin.paopao.test', 'Test Passkey',
      'test-public-key-material', -7, 1, '["internal"]', createdAt,
    );
    db.prepare(`INSERT INTO admin_sessions
      (session_id,principal_id,credential_id,token_hash,csrf_token,expires_at,created_at,last_seen_at)
      VALUES(?,?,?,?,?,?,?,?)`).run(
      'session-test', 'admin-test', 'credential-test',
      createHash('sha256').update(token).digest('hex'), csrfToken, expiresAt, createdAt, createdAt,
    );
    return {
      ...TAILNET_HEADERS,
      cookie: `__Host-paopao_admin=${token}`,
      'x-csrf-token': csrfToken,
    };
  }

  it('mounts diagnostics behind both the tailnet and WebAuthn session gates', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/v3/admin/backend-capabilities' })).statusCode).toBe(403);
    expect((await app.inject({
      method: 'GET', url: '/api/v3/admin/backend-capabilities', headers: TAILNET_HEADERS,
    })).statusCode).toBe(401);

    const headers = authenticatedHeaders();
    const response = await app.inject({
      method: 'GET', url: '/api/v3/admin/backend-capabilities', headers,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ schemaVersion: 1, auditLimit: 64 });
    expect(response.json().subjects).toHaveLength(25);
    expect(response.json().subjects.map((subject: { key: string }) => subject.key))
      .toEqual(BACKEND_CAPABILITY_SUBJECTS.map((subject) => subject.key));
    expect(response.body).not.toContain('test-admin-session-token');
    expect(response.body).not.toContain('test-admin-csrf-token');
  });

  it('runs a bounded persistence probe without invoking economy adapters', async () => {
    const headers = authenticatedHeaders();
    const withoutCsrf = await app.inject({
      method: 'POST', url: '/api/v3/admin/backend-capabilities/probe',
      headers: { ...TAILNET_HEADERS, cookie: headers.cookie },
      payload: { subjects: ['health-reporting'] },
    });
    expect(withoutCsrf.statusCode).toBe(403);

    const response = await app.inject({
      method: 'POST', url: '/api/v3/admin/backend-capabilities/probe', headers,
      payload: { subjects: ['health-reporting', 'wallet'] },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      schemaVersion: 1,
      healthy: true,
      checked: 2,
      checks: [
        { key: 'health-reporting', healthy: true, revision: 1, receipts: 0, commits: 0, publications: 0 },
        { key: 'wallet', healthy: true, revision: 1, receipts: 0, commits: 0, publications: 0 },
      ],
    });
    expect(db.prepare('SELECT COUNT(*) AS count FROM backend_capability_receipts').get().count).toBe(0);

    const unknown = await app.inject({
      method: 'POST', url: '/api/v3/admin/backend-capabilities/probe', headers,
      payload: { subjects: ['not-installed'] },
    });
    expect(unknown.statusCode).toBe(400);
    expect(unknown.json()).toEqual({ error: 'backend-capability-unknown' });
  });

  it('persists idempotent receipts across service wrappers on the application database', () => {
    const firstService = createBackendCapabilityService({ repository });
    const context = createAuthorizedBackendContext('health-reporting', {
      idempotencyKey: 'health-reporting:persistence:installed',
      expectedRevision: repository.revision('health-reporting'),
    });
    const input = { component: 'database', sampleWindow: 60, verbose: true };
    const first = firstService.invoke('health-reporting', input, context);
    repository.close();
    expect(db.open).toBe(true);

    const restartedRepository = new SqliteBackendCapabilityRepository(db);
    const restartedService = createBackendCapabilityService({ repository: restartedRepository });
    const repeated = restartedService.invoke('health-reporting', input, context);
    expect(repeated).toEqual(first);
    expect(restartedRepository.stats('health-reporting')).toMatchObject({ receipts: 1, commits: 1 });
    expect(db.prepare('SELECT COUNT(*) AS count FROM backend_capability_receipts').get().count).toBe(1);
    restartedRepository.close();
    expect(db.open).toBe(true);
  });
});

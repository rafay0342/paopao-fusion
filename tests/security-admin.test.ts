import {
  createHash,
  generateKeyPairSync,
  sign,
} from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import Database from 'better-sqlite3';
import {
  installSecurityAdmin,
  isTailnetAddress,
  resolveAdminClientAddress,
} from '../server/security-admin.mjs';
import { canonicalLiveEventChallengePayload, installPlatform } from '../server/platform.mjs';
import { createSigningKeyring, verifyPublicPayload } from '../server/signing-keyring.mjs';

const ORIGIN = 'https://admin.paopao.test';
const RP_ID = 'admin.paopao.test';
const BOOTSTRAP = 'test-bootstrap-secret-with-at-least-32-bytes';
const TAILNET_HEADERS = { 'x-forwarded-for': '100.73.18.9' };

function cborHead(major: number, length: number): Buffer {
  if (length < 24) return Buffer.from([(major << 5) | length]);
  if (length <= 0xff) return Buffer.from([(major << 5) | 24, length]);
  if (length <= 0xffff) {
    const result = Buffer.alloc(3); result[0] = (major << 5) | 25; result.writeUInt16BE(length, 1); return result;
  }
  const result = Buffer.alloc(5); result[0] = (major << 5) | 26; result.writeUInt32BE(length, 1); return result;
}

function cbor(value: unknown): Buffer {
  if (typeof value === 'number' && Number.isInteger(value)) {
    return value >= 0 ? cborHead(0, value) : cborHead(1, -1 - value);
  }
  if (typeof value === 'string') {
    const bytes = Buffer.from(value); return Buffer.concat([cborHead(3, bytes.length), bytes]);
  }
  if (Buffer.isBuffer(value)) return Buffer.concat([cborHead(2, value.length), value]);
  if (value instanceof Map) {
    const entries = Array.from(value.entries());
    return Buffer.concat([cborHead(5, entries.length), ...entries.flatMap(([key, entry]) => [cbor(key), cbor(entry)])]);
  }
  throw new Error('unsupported test CBOR value');
}

function clientData(type: 'webauthn.create' | 'webauthn.get', challenge: string, origin = ORIGIN): Buffer {
  return Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false }));
}

function registrationFixture(challenge: string) {
  const keyPair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = keyPair.publicKey.export({ format: 'jwk' });
  const credentialId = createHash('sha256').update('paopao-test-admin-credential').digest().subarray(0, 24);
  const cose = new Map<unknown, unknown>([
    [1, 2], [3, -7], [-1, 1],
    [-2, Buffer.from(jwk.x!, 'base64url')], [-3, Buffer.from(jwk.y!, 'base64url')],
  ]);
  const rpHash = createHash('sha256').update(RP_ID).digest();
  const counter = Buffer.alloc(4); counter.writeUInt32BE(0);
  const credentialLength = Buffer.alloc(2); credentialLength.writeUInt16BE(credentialId.length);
  const authData = Buffer.concat([
    rpHash, Buffer.from([0x45]), counter, Buffer.alloc(16), credentialLength, credentialId, cbor(cose),
  ]);
  const attestationObject = cbor(new Map<unknown, unknown>([
    ['fmt', 'none'], ['authData', authData], ['attStmt', new Map()],
  ]));
  const data = clientData('webauthn.create', challenge);
  return {
    privateKey: keyPair.privateKey,
    credentialId: credentialId.toString('base64url'),
    credential: {
      id: credentialId.toString('base64url'),
      rawId: credentialId.toString('base64url'),
      type: 'public-key',
      response: {
        clientDataJSON: data.toString('base64url'),
        attestationObject: attestationObject.toString('base64url'),
        transports: ['internal'],
      },
    },
  };
}

function authenticationCredential(
  credentialId: string,
  privateKey: ReturnType<typeof generateKeyPairSync>['privateKey'],
  challenge: string,
  signCount: number,
  origin = ORIGIN,
) {
  const authenticatorData = Buffer.alloc(37);
  createHash('sha256').update(RP_ID).digest().copy(authenticatorData, 0);
  authenticatorData[32] = 0x05;
  authenticatorData.writeUInt32BE(signCount, 33);
  const data = clientData('webauthn.get', challenge, origin);
  const signed = Buffer.concat([authenticatorData, createHash('sha256').update(data).digest()]);
  return {
    id: credentialId,
    rawId: credentialId,
    type: 'public-key',
    response: {
      clientDataJSON: data.toString('base64url'),
      authenticatorData: authenticatorData.toString('base64url'),
      signature: sign('sha256', signed, privateKey).toString('base64url'),
    },
  };
}

describe('tailnet-only WebAuthn admin security', () => {
  let app: ReturnType<typeof Fastify>;
  let db: Database.Database;
  let directory: string;
  let keyring: ReturnType<typeof createSigningKeyring>;

  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), 'paopao-security-admin-'));
    app = Fastify({ logger: false });
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    keyring = createSigningKeyring({ path: join(directory, 'signing-keyring.json'), seedSecret: 'content-signing-secret-for-focused-tests' });
    const platform = installPlatform({ app, db, signingKeyring: keyring, signingSecret: 'content-signing-secret-for-focused-tests' });
    installSecurityAdmin({
      app, db, dataDir: directory, signingKeyring: keyring, liveConfigAdmin: platform.liveConfigAdmin,
      origin: ORIGIN, bootstrapSecret: BOOTSTRAP,
    });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    db.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it('recognizes only CGNAT and Tailscale ULA addresses and ignores forwarded data from untrusted peers', () => {
    expect(isTailnetAddress('100.64.0.1')).toBe(true);
    expect(isTailnetAddress('100.127.255.254')).toBe(true);
    expect(isTailnetAddress('100.128.0.1')).toBe(false);
    expect(isTailnetAddress('fd7a:115c:a1e0::1234')).toBe(true);
    expect(isTailnetAddress('fd7a:115c:a1e1::1')).toBe(false);
    expect(resolveAdminClientAddress({
      raw: { socket: { remoteAddress: '203.0.113.10' } },
      headers: { 'x-forwarded-for': '100.73.18.9' },
    } as never)).toBe('203.0.113.10');
    expect(resolveAdminClientAddress({
      raw: { socket: { remoteAddress: '127.0.0.1' } },
      headers: { 'x-forwarded-for': '198.51.100.4, 100.73.18.9' },
    } as never)).toBe('100.73.18.9');
  });

  it('blocks the console and ceremonies outside the tailnet', async () => {
    const local = await app.inject({ method: 'GET', url: '/admin/' });
    expect(local.statusCode).toBe(403);
    expect(local.json()).toEqual({ error: 'tailnet-required' });

    const publicProxy = await app.inject({ method: 'GET', url: '/api/v3/admin/status', headers: { 'x-forwarded-for': '203.0.113.7' } });
    expect(publicProxy.statusCode).toBe(403);
    const publicLiveConfig = await app.inject({ method: 'GET', url: '/api/v3/admin/live/config', headers: { 'x-forwarded-for': '203.0.113.7' } });
    expect(publicLiveConfig.statusCode).toBe(403);

    const tailnet = await app.inject({ method: 'GET', url: '/admin/', headers: TAILNET_HEADERS });
    expect(tailnet.statusCode).toBe(200);
    expect(tailnet.body).toContain('PaoPao Secure Admin');
  });

  it('derives a secure RP origin from the trusted local Tailscale proxy when no origin environment is configured', async () => {
    const dynamicDirectory = mkdtempSync(join(tmpdir(), 'paopao-dynamic-admin-origin-'));
    const dynamicApp = Fastify({ logger: false });
    const dynamicDb = new Database(':memory:');
    try {
      const dynamicKeyring = createSigningKeyring({ path: join(dynamicDirectory, 'keys.json'), seedSecret: 'dynamic-origin-signing-secret-for-tests' });
      installSecurityAdmin({
        app: dynamicApp, db: dynamicDb, dataDir: dynamicDirectory, signingKeyring: dynamicKeyring,
        origin: '', rpId: '', bootstrapSecret: BOOTSTRAP,
      });
      await dynamicApp.ready();
      const headers = {
        ...TAILNET_HEADERS,
        'x-forwarded-proto': 'https',
        'x-forwarded-host': 'rafayamir-1.tail372a9e.ts.net',
        authorization: `Bearer ${BOOTSTRAP}`,
      };
      const status = await dynamicApp.inject({ method: 'GET', url: '/api/v3/admin/status', headers });
      expect(status.json()).toMatchObject({ configured: true, enrollment: 'bootstrap-required' });
      const options = await dynamicApp.inject({
        method: 'POST', url: '/api/v3/admin/webauthn/registration/options', headers, payload: {},
      });
      expect(options.statusCode).toBe(200);
      expect(options.json().publicKey.rp.id).toBe('rafayamir-1.tail372a9e.ts.net');

      const insecureProxy = await dynamicApp.inject({
        method: 'POST', url: '/api/v3/admin/webauthn/registration/options',
        headers: { ...headers, 'x-forwarded-proto': 'http' }, payload: {},
      });
      expect(insecureProxy.statusCode).toBe(503);
      expect(insecureProxy.json()).toEqual({ error: 'admin-origin-unconfigured' });
    } finally {
      await dynamicApp.close(); dynamicDb.close(); rmSync(dynamicDirectory, { recursive: true, force: true });
    }
  });

  it('[AT-PF-security-009][shared] performs tailnet-only P-256 WebAuthn and rejects replay', async () => {
    const unauthorized = await app.inject({
      method: 'POST', url: '/api/v3/admin/webauthn/registration/options', headers: TAILNET_HEADERS, payload: {},
    });
    expect(unauthorized.statusCode).toBe(401);
    expect(unauthorized.json()).toEqual({ error: 'admin-bootstrap-required' });

    const registrationOptions = await app.inject({
      method: 'POST', url: '/api/v3/admin/webauthn/registration/options',
      headers: { ...TAILNET_HEADERS, authorization: `Bearer ${BOOTSTRAP}` }, payload: { name: 'Primary test key' },
    });
    expect(registrationOptions.statusCode).toBe(200);
    const createOptions = registrationOptions.json();
    expect(createOptions.publicKey).toMatchObject({
      rp: { id: RP_ID }, attestation: 'none',
      authenticatorSelection: { userVerification: 'required' },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
    });
    const fixture = registrationFixture(createOptions.publicKey.challenge);
    const registration = await app.inject({
      method: 'POST', url: '/api/v3/admin/webauthn/registration/verify',
      headers: { ...TAILNET_HEADERS, authorization: `Bearer ${BOOTSTRAP}` },
      payload: { challengeId: createOptions.challengeId, name: 'Primary test key', credential: fixture.credential },
    });
    expect(registration.statusCode).toBe(200);
    expect(registration.json()).toMatchObject({ registered: true, credentialId: fixture.credentialId, bootstrapConsumed: true });

    const replayedRegistration = await app.inject({
      method: 'POST', url: '/api/v3/admin/webauthn/registration/verify',
      headers: { ...TAILNET_HEADERS, authorization: `Bearer ${BOOTSTRAP}` },
      payload: { challengeId: createOptions.challengeId, credential: fixture.credential },
    });
    expect(replayedRegistration.statusCode).toBe(401); // bootstrap closes immediately after first enrollment
    expect(replayedRegistration.json()).toEqual({ error: 'admin-authentication-required' });

    const authenticationOptions = await app.inject({
      method: 'POST', url: '/api/v3/admin/webauthn/authentication/options', headers: TAILNET_HEADERS, payload: {},
    });
    const getOptions = authenticationOptions.json();
    const assertion = authenticationCredential(fixture.credentialId, fixture.privateKey, getOptions.publicKey.challenge, 1);
    const authenticated = await app.inject({
      method: 'POST', url: '/api/v3/admin/webauthn/authentication/verify', headers: TAILNET_HEADERS,
      payload: { challengeId: getOptions.challengeId, credential: assertion },
    });
    expect(authenticated.statusCode).toBe(200);
    expect(authenticated.json()).toMatchObject({ authenticated: true });
    const cookie = String(authenticated.headers['set-cookie']).split(';')[0];
    const csrfToken = authenticated.json().csrfToken as string;
    expect(String(authenticated.headers['set-cookie'])).toContain('HttpOnly; Secure; SameSite=Strict');

    const challengeReplay = await app.inject({
      method: 'POST', url: '/api/v3/admin/webauthn/authentication/verify', headers: TAILNET_HEADERS,
      payload: { challengeId: getOptions.challengeId, credential: assertion },
    });
    expect(challengeReplay.statusCode).toBe(410);
    expect(challengeReplay.json()).toEqual({ error: 'webauthn-challenge-expired' });

    const noCsrf = await app.inject({
      method: 'POST', url: '/api/v3/admin/signing/rotate', headers: { ...TAILNET_HEADERS, cookie }, payload: { confirmation: 'ROTATE' },
    });
    expect(noCsrf.statusCode).toBe(403);
    expect(noCsrf.json()).toEqual({ error: 'csrf-invalid' });

    const oldToken = keyring.signMessage('event-fixture', 'live-event');
    const oldKeyId = keyring.metadata().activeKeyId;
    const rotated = await app.inject({
      method: 'POST', url: '/api/v3/admin/signing/rotate',
      headers: { ...TAILNET_HEADERS, cookie, 'x-csrf-token': csrfToken }, payload: { confirmation: 'ROTATE' },
    });
    expect(rotated.statusCode).toBe(200);
    expect(rotated.json().activeKeyId).not.toBe(oldKeyId);
    expect(keyring.verifyMessage(oldToken, 'event-fixture', 'live-event')).toBe(true);

    const scheduled = (await app.inject({ method: 'GET', url: '/api/v3/live/config' })).json();
    const draft = {
      ...scheduled,
      season: 'remote-admin-a',
      endless: {
        ...scheduled.endless, seasonId: 'remote-admin-a', seed: 987654,
        startsAt: '2026-08-01T00:00:00.000Z', endsAt: '2026-08-29T00:00:00.000Z',
      },
      events: [{
        id: 'remote-boss-a', kind: 'event-boss', boss: 'prism-warden', level: 4, seed: 123456,
        modifier: 'precision-plus', reward: { currency: 'coins', amount: 900 },
        startsAt: '2026-08-03T00:00:00.000Z', endsAt: '2026-08-10T00:00:00.000Z',
      }],
    };
    const noLiveCsrf = await app.inject({
      method: 'POST', url: '/api/v3/admin/live/config/publish', headers: { ...TAILNET_HEADERS, cookie },
      payload: { idempotencyKey: 'live-publish-no-csrf', config: draft },
    });
    expect(noLiveCsrf.statusCode).toBe(403);
    const firstPublish = await app.inject({
      method: 'POST', url: '/api/v3/admin/live/config/publish',
      headers: { ...TAILNET_HEADERS, cookie, 'x-csrf-token': csrfToken },
      payload: { idempotencyKey: 'live-publish-0001', config: draft },
    });
    expect(firstPublish.statusCode).toBe(200);
    expect(firstPublish.json()).toMatchObject({ duplicate: false, revision: 1, activeRevision: 1, source: 'remote' });
    const published = (await app.inject({ method: 'GET', url: '/api/v3/live/config' })).json();
    expect(published).toMatchObject({
      season: 'remote-admin-a', endless: { seasonId: 'remote-admin-a', seed: 987654 },
      events: [{ id: 'remote-boss-a', reward: { amount: 900 } }], integrity: { algorithm: expect.any(String) },
    });
    expect(typeof published.events[0].submissionToken).toBe('string');
    const { integrity: publishedIntegrity, ...unsignedPublished } = published;
    expect(verifyPublicPayload(unsignedPublished, publishedIntegrity)).toBe(true);
    const duplicatePublish = await app.inject({
      method: 'POST', url: '/api/v3/admin/live/config/publish',
      headers: { ...TAILNET_HEADERS, cookie, 'x-csrf-token': csrfToken },
      payload: { idempotencyKey: 'live-publish-0001', config: draft },
    });
    expect(duplicatePublish.json()).toMatchObject({ duplicate: true, revision: 1, activeRevision: 1 });
    const conflictPublish = await app.inject({
      method: 'POST', url: '/api/v3/admin/live/config/publish',
      headers: { ...TAILNET_HEADERS, cookie, 'x-csrf-token': csrfToken },
      payload: { idempotencyKey: 'live-publish-0001', config: { ...draft, endless: { ...draft.endless, seed: 987600 } } },
    });
    expect(conflictPublish.statusCode).toBe(409);
    expect(conflictPublish.json()).toEqual({ error: 'live-config-idempotency-conflict' });
    const secondDraft = {
      ...draft, season: 'remote-admin-b',
      endless: { ...draft.endless, seasonId: 'remote-admin-b', seed: 987655 },
    };
    const secondPublish = await app.inject({
      method: 'POST', url: '/api/v3/admin/live/config/publish',
      headers: { ...TAILNET_HEADERS, cookie, 'x-csrf-token': csrfToken },
      payload: { idempotencyKey: 'live-publish-0002', config: secondDraft },
    });
    expect(secondPublish.json()).toMatchObject({ revision: 2, activeRevision: 2 });
    const rollback = await app.inject({
      method: 'POST', url: '/api/v3/admin/live/config/rollback',
      headers: { ...TAILNET_HEADERS, cookie, 'x-csrf-token': csrfToken },
      payload: { idempotencyKey: 'live-rollback-0001', targetRevision: 1 },
    });
    expect(rollback.json()).toMatchObject({ duplicate: false, revision: 3, activeRevision: 3 });
    expect((await app.inject({ method: 'GET', url: '/api/v3/live/config' })).json().season).toBe('remote-admin-a');

    const audit = await app.inject({ method: 'GET', url: '/api/v3/admin/audit?limit=100', headers: { ...TAILNET_HEADERS, cookie } });
    expect(audit.statusCode).toBe(200);
    expect(audit.json()).toMatchObject({ chainValid: true, retainedSignaturesValid: true });
    expect(audit.json().events.some((entry: { eventType: string }) => entry.eventType === 'content-signing-key-rotated')).toBe(true);
    expect(audit.json().events.some((entry: { eventType: string }) => entry.eventType === 'live-config-published')).toBe(true);
    expect(audit.json().events.some((entry: { eventType: string }) => entry.eventType === 'live-config-rolled-back')).toBe(true);

    const counterOptions = (await app.inject({
      method: 'POST', url: '/api/v3/admin/webauthn/authentication/options', headers: TAILNET_HEADERS, payload: {},
    })).json();
    const repeatedCounter = authenticationCredential(fixture.credentialId, fixture.privateKey, counterOptions.publicKey.challenge, 1);
    const counterReplay = await app.inject({
      method: 'POST', url: '/api/v3/admin/webauthn/authentication/verify', headers: TAILNET_HEADERS,
      payload: { challengeId: counterOptions.challengeId, credential: repeatedCounter },
    });
    expect(counterReplay.statusCode).toBe(409);
    expect(counterReplay.json()).toEqual({ error: 'webauthn-counter-replay' });
  });

  it('consumes an authentication challenge when the browser origin is wrong', async () => {
    const options = (await app.inject({
      method: 'POST', url: '/api/v3/admin/webauthn/registration/options',
      headers: { ...TAILNET_HEADERS, authorization: `Bearer ${BOOTSTRAP}` }, payload: {},
    })).json();
    const fixture = registrationFixture(options.publicKey.challenge);
    fixture.credential.response.clientDataJSON = clientData('webauthn.create', options.publicKey.challenge, 'https://evil.example').toString('base64url');
    const wrongOrigin = await app.inject({
      method: 'POST', url: '/api/v3/admin/webauthn/registration/verify',
      headers: { ...TAILNET_HEADERS, authorization: `Bearer ${BOOTSTRAP}` },
      payload: { challengeId: options.challengeId, credential: fixture.credential },
    });
    expect(wrongOrigin.statusCode).toBe(400);
    expect(wrongOrigin.json()).toEqual({ error: 'webauthn-client-data-invalid' });

    const retry = await app.inject({
      method: 'POST', url: '/api/v3/admin/webauthn/registration/verify',
      headers: { ...TAILNET_HEADERS, authorization: `Bearer ${BOOTSTRAP}` },
      payload: { challengeId: options.challengeId, credential: fixture.credential },
    });
    expect(retry.statusCode).toBe(410);
  });
});

describe('persistent content signing keyring', () => {
  it('persists rotations without leaking secrets through metadata and retains overlap verification', () => {
    const directory = mkdtempSync(join(tmpdir(), 'paopao-keyring-'));
    try {
      const path = join(directory, 'keys.json');
      const first = createSigningKeyring({ path, seedSecret: 'stable-content-signing-secret-for-tests', maxRetiredKeys: 2 });
      const token = first.signMessage('signed-live-event', 'live-event');
      const original = first.metadata().activeKeyId;
      const rotated = first.rotate();
      expect(rotated.previousKeyId).toBe(original);
      expect(rotated.activeKeyId).not.toBe(original);
      expect(first.verifyMessage(token, 'signed-live-event', 'live-event')).toBe(true);
      expect(first.verifyMessage(token, 'tampered-live-event', 'live-event')).toBe(false);
      expect(JSON.stringify(first.metadata())).not.toContain('stable-content-signing-secret');

      const reloaded = createSigningKeyring({ path, seedSecret: 'ignored-because-file-exists-with-32-bytes' });
      expect(reloaded.metadata().activeKeyId).toBe(rotated.activeKeyId);
      expect(reloaded.verifyMessage(token, 'signed-live-event', 'live-event')).toBe(true);
      expect(JSON.parse(readFileSync(path, 'utf8')).keys).toHaveLength(2);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  it('[AT-PF-security-005][shared] rotates signed content manifests while retaining bounded verification overlap', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'paopao-platform-keyring-'));
    const app = Fastify({ logger: false });
    const db = new Database(':memory:');
    try {
      const keyring = createSigningKeyring({ path: join(directory, 'keys.json'), seedSecret: 'platform-signing-secret-for-rotation-tests' });
      installPlatform({ app, db, signingSecret: 'platform-signing-secret-for-rotation-tests', signingKeyring: keyring });
      await app.ready();
      const firstManifest = (await app.inject({ method: 'GET', url: '/api/v3/content/manifest' })).json();
      const firstLive = (await app.inject({ method: 'GET', url: '/api/v3/live/config' })).json();
      const event = firstLive.events[0];
      const eventPayload = canonicalLiveEventChallengePayload(event, firstLive.endless);
      expect(firstManifest.integrity.keyId).toBe(keyring.metadata().activeKeyId);
      expect(keyring.verifyMessage(event.submissionToken, eventPayload, 'live-event')).toBe(true);

      keyring.rotate();
      const secondManifest = (await app.inject({ method: 'GET', url: '/api/v3/content/manifest' })).json();
      expect(secondManifest.integrity.keyId).toBe(keyring.metadata().activeKeyId);
      expect(secondManifest.integrity.keyId).not.toBe(firstManifest.integrity.keyId);
      expect(secondManifest.integrity.contentHash).toBe(firstManifest.integrity.contentHash);
      expect(keyring.verifyMessage(event.submissionToken, eventPayload, 'live-event')).toBe(true);
    } finally {
      await app.close(); db.close(); rmSync(directory, { recursive: true, force: true });
    }
  });
});

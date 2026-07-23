import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import Database from 'better-sqlite3';
import { installPlatform } from '../server/platform.mjs';

const serverSource = () => readFileSync(fileURLToPath(new URL('../server/index.mjs', import.meta.url)), 'utf8');
const trackingSource = () => readFileSync(fileURLToPath(new URL('../src/game/handtracking.ts', import.meta.url)), 'utf8');

describe('classic-client V3 contract', () => {
  it('publishes one versioned content and live configuration for the classic client', async () => {
    const app = Fastify({ logger: false }); const db = new Database(':memory:');
    installPlatform({ app, db }); await app.ready();
    try {
      const bootstrap = await app.inject({ method: 'GET', url: '/api/v3/bootstrap' });
      expect(bootstrap.statusCode).toBe(200);
      expect(bootstrap.json()).toMatchObject({
        apiVersion: 3,
        content: {
          saveVersion: 4, worlds: 6, levels: 30,
          clients: { classic: { status: 'production', engine: 'phaser-3.90.0' } },
        },
        live: { minimumFps: 30, preferredFps: 60 },
        account: { authenticated: false },
      });
    } finally { await app.close(); db.close(); }
  });

  it('requires authentication for durable V3 progress and run submission', async () => {
    const app = Fastify({ logger: false }); const db = new Database(':memory:');
    installPlatform({ app, db }); await app.ready();
    try {
      expect((await app.inject({ method: 'GET', url: '/api/v3/progress' })).statusCode).toBe(401);
      expect((await app.inject({ method: 'POST', url: '/api/v3/runs', payload: {
        runId: 'run-unauthenticated', client: 'classic', level: 0, mode: 'classic', score: 0,
        durationMs: 500, won: false, createdAt: '2026-07-22T00:00:00.000Z',
      } })).statusCode).toBe(401);
    } finally { await app.close(); db.close(); }
  });

  it('[AT-PF-security-006][shared] keeps camera frames private and enforces CSP plus strict API input validation', async () => {
    const app = Fastify({ logger: false }); const db = new Database(':memory:');
    installPlatform({ app, db }); await app.ready();
    try {
      const accepted = await app.inject({ method: 'POST', url: '/api/v3/telemetry/batch', payload: { events: [{ type: 'frame-health', averageFps: 60 }] } });
      const rejected = await app.inject({ method: 'POST', url: '/api/v3/telemetry/batch', payload: { events: [{ type: 'frame-health', secret: 'not-allowed' }] } });
      expect(accepted.statusCode).toBe(200); expect(accepted.json()).toEqual({ accepted: 1 });
      expect(rejected.statusCode).toBe(400);
      const server = serverSource();
      expect(server).toContain("Content-Security-Policy");
      expect(server).toContain("Permissions-Policy', 'camera=(self), microphone=(), geolocation=()'");
      expect(server).toContain("Cross-Origin-Resource-Policy', 'same-origin'");
      const tracking = trackingSource();
      expect(tracking).toContain("worker.postMessage({ type: 'FRAME'");
      expect(tracking).not.toMatch(/fetch\([^)]*(?:bitmap|video|camera|landmark)/i);
    } finally { await app.close(); db.close(); }
  });

  it('uses revisions for progress and idempotency for classic runs', async () => {
    const prior = process.env.PAOPAO_ALLOW_DEV_OTP; process.env.PAOPAO_ALLOW_DEV_OTP = '1';
    const app = Fastify({ logger: false }); const db = new Database(':memory:');
    installPlatform({ app, db }); await app.ready();
    try {
      const requested = await app.inject({ method: 'POST', url: '/api/auth/otp/request', payload: { email: 'v3@example.com' } });
      const challenge = requested.json();
      const verified = await app.inject({ method: 'POST', url: '/api/auth/otp/verify', payload: { challengeId: challenge.challengeId, code: challenge.developmentCode } });
      const cookie = String(verified.headers['set-cookie']).split(';')[0]; const csrf = verified.json().csrfToken;
      const read = await app.inject({ method: 'GET', url: '/api/v3/progress', headers: { cookie } });
      expect(read.json()).toMatchObject({ saveVersion: 4, revision: 0 });
      const headers = { cookie, 'x-csrf-token': csrf };
      const update = await app.inject({ method: 'PUT', url: '/api/v3/progress', headers, payload: { revision: 0, progress: { unlocked: 2, stars: [3], cleared: [0] } } });
      expect(update.json()).toMatchObject({ saveVersion: 4, revision: 1, progress: { cleared: [0] } });
      expect(update.json().progress.stars).toHaveLength(30); expect(update.json().progress.stars[0]).toBe(3);
      const conflict = await app.inject({ method: 'PUT', url: '/api/v3/progress', headers, payload: { revision: 0, progress: { unlocked: 1 } } });
      expect(conflict.statusCode).toBe(409); expect(conflict.json()).toMatchObject({ error: 'revision-conflict', revision: 1 });
      const payload = { runId: 'classic-run-0001', client: 'classic', level: 0, mode: 'classic', score: 1200, durationMs: 2500, won: true, shots: 4, hits: 3, createdAt: '2026-07-22T00:00:00.000Z' };
      const first = await app.inject({ method: 'POST', url: '/api/v3/runs', headers, payload });
      const duplicate = await app.inject({ method: 'POST', url: '/api/v3/runs', headers, payload });
      expect(first.json()).toMatchObject({ accepted: true, duplicate: false });
      expect(duplicate.json()).toMatchObject({ accepted: false, duplicate: true });
    } finally {
      await app.close(); db.close();
      if (prior === undefined) delete process.env.PAOPAO_ALLOW_DEV_OTP; else process.env.PAOPAO_ALLOW_DEV_OTP = prior;
    }
  });
});

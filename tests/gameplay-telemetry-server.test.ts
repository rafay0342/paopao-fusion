import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import Database from 'better-sqlite3';
import { installPlatform } from '../server/platform.mjs';

const productBatch = {
  client: 'classic',
  anonymous: true,
  consentVersion: 'product-telemetry-v1',
  batchId: 'bat_product_test_0001',
  events: [{
    type: 'level-end',
    eventId: 'evt_product_test_0001',
    sessionId: 'ses_product_test_0001',
    occurredAtMs: 1_800_000_000_000,
    level: 3,
    mode: 'classic',
    inputMode: 'hand',
    outcome: 'won',
    shots: 12,
    hits: 9,
    won: true,
  }],
};

describe('gameplay telemetry server boundary', () => {
  it('requires explicit anonymous product consent and stores an idempotent bounded batch', async () => {
    const app = Fastify({ logger: false });
    const db = new Database(':memory:');
    installPlatform({ app, db });
    await app.ready();
    try {
      const missingConsent = await app.inject({
        method: 'POST',
        url: '/api/v3/telemetry/batch',
        payload: { events: productBatch.events },
      });
      expect(missingConsent.statusCode).toBe(400);
      expect(missingConsent.json()).toEqual({ error: 'product-telemetry-consent-required' });

      db.prepare('INSERT INTO telemetry_batches(batch_id,user_id,events_json,created_at) VALUES(?,?,?,?)')
        .run('old_batch', null, '[]', '2020-01-01T00:00:00.000Z');
      const accepted = await app.inject({
        method: 'POST',
        url: '/api/v3/telemetry/batch',
        payload: productBatch,
      });
      expect(accepted.statusCode).toBe(200);
      expect(accepted.json()).toEqual({
        accepted: 1,
        duplicate: false,
        batchId: productBatch.batchId,
      });
      const stored = db.prepare('SELECT user_id AS userId,events_json AS eventsJson FROM telemetry_batches WHERE batch_id=?')
        .get(productBatch.batchId) as { userId: string | null; eventsJson: string };
      expect(stored.userId).toBeNull();
      expect(JSON.parse(stored.eventsJson)).toMatchObject([{
        type: 'level-end',
        eventId: 'evt_product_test_0001',
        sessionId: 'ses_product_test_0001',
        level: 3,
        inputMode: 'hand',
        outcome: 'won',
      }]);
      expect(db.prepare('SELECT COUNT(*) AS count FROM telemetry_batches WHERE batch_id=?').get('old_batch'))
        .toEqual({ count: 0 });

      const duplicate = await app.inject({
        method: 'POST',
        url: '/api/v3/telemetry/batch',
        payload: productBatch,
      });
      expect(duplicate.json()).toEqual({
        accepted: 0,
        duplicate: true,
        batchId: productBatch.batchId,
      });
    } finally {
      await app.close();
      db.close();
    }
  });

  it('rejects free-form fields, PII, camera data and unknown event values', async () => {
    const app = Fastify({ logger: false });
    const db = new Database(':memory:');
    installPlatform({ app, db });
    await app.ready();
    try {
      const unsafeEvents = [
        { ...productBatch.events[0], email: 'player@example.com' },
        { ...productBatch.events[0], landmarks: [{ x: 0.5, y: 0.5 }] },
        { ...productBatch.events[0], cameraFrame: 'base64-data' },
        { ...productBatch.events[0], outcome: 'free-form-player-message' },
      ];
      for (const [index, unsafe] of unsafeEvents.entries()) {
        const response = await app.inject({
          method: 'POST',
          url: '/api/v3/telemetry/batch',
          payload: {
            client: 'classic',
            anonymous: true,
            consentVersion: 'product-telemetry-v1',
            batchId: `bat_reject_test_${index}`,
            events: [unsafe],
          },
        });
        expect(response.statusCode).toBe(400);
      }
    } finally {
      await app.close();
      db.close();
    }
  });
});

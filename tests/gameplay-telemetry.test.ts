import { describe, expect, it } from 'vitest';
import {
  GAMEPLAY_TELEMETRY_MAX_EVENTS,
  GAMEPLAY_TELEMETRY_STORAGE_KEY,
  GameplayTelemetryQueue,
  normalizeGameplayTelemetryInput,
  type GameplayTelemetryBatch,
  type TelemetryStorage,
} from '../src/game/gameplay-telemetry';

class MemoryStorage implements TelemetryStorage {
  readonly values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
  removeItem(key: string): void { this.values.delete(key); }
}

const idFactory = () => {
  let sequence = 0;
  return (prefix: 'evt' | 'ses' | 'bat'): string => `${prefix}_test_${++sequence}`;
};

describe('privacy-safe gameplay telemetry', () => {
  it('accepts only bounded product fields and rejects PII, landmarks and aim coordinates', () => {
    expect(normalizeGameplayTelemetryInput({
      type: 'level-end',
      level: 4,
      mode: 'classic',
      inputMode: 'hand',
      outcome: 'won',
      shots: 12,
      hits: 9,
      won: true,
    })).toEqual({
      type: 'level-end',
      level: 4,
      mode: 'classic',
      inputMode: 'hand',
      outcome: 'won',
      shots: 12,
      hits: 9,
      won: true,
    });
    expect(normalizeGameplayTelemetryInput({ type: 'level-end', email: 'player@example.com' })).toBeNull();
    expect(normalizeGameplayTelemetryInput({ type: 'hand-state', landmarks: [{ x: 0.5, y: 0.5 }] })).toBeNull();
    expect(normalizeGameplayTelemetryInput({ type: 'shot-result', aimX: 0.5, aimY: 0.5 })).toBeNull();
    expect(normalizeGameplayTelemetryInput({ type: 'made-up-event' })).toBeNull();
  });

  it('is opt-in, bounded and clears pending data when consent is withdrawn', () => {
    const storage = new MemoryStorage();
    const queue = new GameplayTelemetryQueue({
      storage,
      createId: idFactory(),
      now: () => 1_800_000_000_000,
    });
    expect(queue.track({ type: 'level-start', level: 0 })).toBe(false);
    queue.setConsent(true);
    for (let index = 0; index < GAMEPLAY_TELEMETRY_MAX_EVENTS; index++) {
      expect(queue.track({ type: 'shot-result', level: 0, outcome: 'hit', shots: index })).toBe(true);
    }
    expect(queue.pendingCount()).toBe(GAMEPLAY_TELEMETRY_MAX_EVENTS);
    expect(queue.track({ type: 'shot-result', level: 0, outcome: 'miss' })).toBe(false);
    expect(storage.getItem(GAMEPLAY_TELEMETRY_STORAGE_KEY)).not.toBeNull();
    queue.setConsent(false);
    expect(queue.pendingCount()).toBe(0);
    expect(storage.getItem(GAMEPLAY_TELEMETRY_STORAGE_KEY)).toBeNull();
  });

  it('retries the identical batch id and removes it only after acceptance', async () => {
    const attempts: GameplayTelemetryBatch[] = [];
    const queue = new GameplayTelemetryQueue({
      storage: new MemoryStorage(),
      createId: idFactory(),
      now: () => 1_800_000_000_000,
      sender: async (batch) => {
        attempts.push(batch);
        return attempts.length > 1;
      },
    });
    queue.setConsent(true);
    queue.track({ type: 'tutorial-step', step: 'aim', outcome: 'completed' });
    await queue.flush();
    expect(queue.pendingCount()).toBe(1);
    await queue.flush();
    expect(queue.pendingCount()).toBe(0);
    expect(attempts).toHaveLength(2);
    expect(attempts[1].batchId).toBe(attempts[0].batchId);
    expect(attempts[1].events[0].eventId).toBe(attempts[0].events[0].eventId);
  });

  it('seals an in-flight batch so a new event cannot be lost after acknowledgement', async () => {
    let releaseFirst: ((accepted: boolean) => void) | undefined;
    const sent: GameplayTelemetryBatch[] = [];
    const queue = new GameplayTelemetryQueue({
      storage: new MemoryStorage(),
      createId: idFactory(),
      sender: async (batch) => {
        sent.push(batch);
        if (sent.length === 1) return new Promise<boolean>((resolve) => { releaseFirst = resolve; });
        return true;
      },
    });
    queue.setConsent(true);
    queue.track({ type: 'level-start', level: 1, outcome: 'started' });
    const flushing = queue.flush();
    await Promise.resolve();
    queue.track({ type: 'next-action', level: 1, outcome: 'selected' });
    releaseFirst?.(true);
    await flushing;
    expect(sent).toHaveLength(2);
    expect(sent[0].batchId).not.toBe(sent[1].batchId);
    expect(queue.pendingCount()).toBe(0);
  });
});

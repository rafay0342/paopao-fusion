import { beforeEach, describe, expect, it } from 'vitest';
import {
  PLAYER_SAVE_V4_STORAGE_KEY,
  buildClassicProgressUpdateV3,
  parsePlayerSaveV4,
  parseProgressEnvelopeV3,
} from '../src/game/contracts';
import {
  HAND_CALIBRATION_PROFILE_REVISION_FLOOR,
  updateHandSettings,
} from '../src/game/handsettings';
import { setQuality } from '../src/game/meta';
import {
  CLASSIC_CLIENT_BUILD,
  initializeClassicPlayerSaveV4,
} from '../src/game/save-v4';

class MemoryStorage {
  private readonly values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
  removeItem(key: string): void { this.values.delete(key); }
  clear(): void { this.values.clear(); }
}

beforeEach(() => {
  Object.defineProperty(globalThis, 'localStorage', { value: new MemoryStorage(), configurable: true });
  Object.defineProperty(globalThis, 'window', {
    value: { dispatchEvent: () => true }, configurable: true,
  });
});

describe('Classic PlayerSaveV4 migration and mirror', () => {
  it('strictly normalizes the four legacy stores and persists a durable V4 envelope', () => {
    localStorage.setItem('paopao-fusion-player-v3', JSON.stringify({
      version: 3, playerId: 'classic-player', displayName: '  rafay  ',
      totals: { score: Number.POSITIVE_INFINITY }, badges: [null, 'KEEPER', 'KEEPER'],
    }));
    localStorage.setItem('paopao-fusion-progress-v2', JSON.stringify({
      unlocked: 999, bestScores: { length: 1_000_000_000 }, stars: ['bad', 9, -2],
      cleared: [0, 0, 999],
    }));
    localStorage.setItem('paopao-fusion-meta-v1', JSON.stringify({
      coins: 9_999_999, quality: 'invalid', ownedArtifacts: { length: 99 },
    }));
    localStorage.setItem('paopao-fusion-inventory-v1', JSON.stringify({
      version: 99, transactions: [null, { id: '', item: 'bomb', delta: 999 }],
    }));

    const save = initializeClassicPlayerSaveV4(new Date('2026-07-22T10:00:00.000Z'));
    const persisted = parsePlayerSaveV4(JSON.parse(localStorage.getItem(PLAYER_SAVE_V4_STORAGE_KEY) ?? '{}'));

    expect(persisted).toEqual(save);
    expect(save).toMatchObject({
      version: 4, revision: 0, client: 'classic',
      clientIdentity: { id: 'classic', platform: 'web', build: CLASSIC_CLIENT_BUILD },
      player: { playerId: 'classic-player', displayName: 'RAFAY', badges: ['KEEPER'] },
      meta: { coins: 9_999_999, quality: 'ultra', ownedArtifacts: ['chrono'] },
      inventory: { version: 1 },
    });
    expect(save.progress.bestScores).toHaveLength(30);
    expect(save.progress.stars.slice(0, 3)).toEqual([0, 3, 0]);
    expect(save.progress.cleared).toEqual([0, 1]);
    expect(save.inventory.transactions.map(({ id }) => id)).toEqual(['starter-bombs-v1', 'starter-rainbows-v1']);
    expect(save.clientIdentity.installId).toMatch(/^classic-/);
  });

  it('coalesces later quality and hand-setting mutations into the V4 mirror', async () => {
    initializeClassicPlayerSaveV4(new Date('2026-07-22T10:00:00.000Z'));
    setQuality('performance');
    updateHandSettings({
      dominantHand: 'left', sensitivity: 1.35, pinchOn: 0.4, pinchOff: 0.47, calibrated: true,
    });
    await Promise.resolve();
    await Promise.resolve();

    const mirrored = parsePlayerSaveV4(JSON.parse(localStorage.getItem(PLAYER_SAVE_V4_STORAGE_KEY) ?? '{}'));
    expect(mirrored?.deviceSettings.quality).toBe('performance');
    expect(mirrored?.handProfile).toMatchObject({
      handedness: 'left', aimSensitivity: 1.35,
      pinchContactRatio: 0.4, pinchReleaseRatio: 0.47,
    });
    expect(mirrored?.handProfile.calibrationRevision)
      .toBeGreaterThanOrEqual(HAND_CALIBRATION_PROFILE_REVISION_FLOOR);
  });

  it('builds an exact non-authoritative Classic PUT DTO and rejects malformed envelopes', () => {
    localStorage.setItem('paopao-fusion-meta-v1', JSON.stringify({ coins: 7_654_321, quality: 'balanced' }));
    const save = initializeClassicPlayerSaveV4(new Date('2026-07-22T10:00:00.000Z'));
    const update = buildClassicProgressUpdateV3(save);
    expect(update).not.toBeNull();
    expect(Object.keys(update ?? {}).sort()).toEqual([
      'campaign', 'clientIdentity', 'deviceSettings', 'handProfile', 'progress', 'revision',
    ]);
    expect(update).not.toHaveProperty('meta');
    expect(update).not.toHaveProperty('inventory');
    expect(update).not.toHaveProperty('entitlements');
    expect(update).not.toHaveProperty('endless');
    expect(JSON.stringify(update)).not.toContain('7654321');

    expect(parseProgressEnvelopeV3({ saveVersion: 4, revision: 0 })).toBeNull();
    expect(parseProgressEnvelopeV3({
      saveVersion: 4, revision: 0, updatedAt: 'invalid', client: 'classic',
      progress: {}, clientIdentity: {}, campaign: {}, endless: {}, liveEvent: {},
      entitlements: {}, deviceSettings: {}, handProfile: {},
    })).toBeNull();
  });
});

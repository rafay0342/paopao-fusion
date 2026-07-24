import {
  PLAYER_SAVE_V4_STORAGE_KEY,
  assemblePlayerSaveV4,
  normalizeDeviceSettingsV4,
  normalizeHandProfileV4,
  parsePlayerSaveV4,
  type HandProfileV4,
  type PlayerSaveV4,
  type ProgressEnvelopeV3,
} from './contracts';
import {
  HAND_CALIBRATION_ALGORITHM_REVISION,
  HAND_CALIBRATION_PROFILE_REVISION_FLOOR,
  getHandSettings,
  updateHandSettings,
} from './handsettings';
import { getInventoryState } from './inventory';
import { getMeta } from './meta';
import { getProgress, mergeGameProgress, persistGameProgress } from './progression';
import { getPlayerSave } from './retention';
import { subscribeLocalSaveChanges } from './save-events';

export const PLAYER_SAVE_V4_CORRUPT_STORAGE_KEY = `${PLAYER_SAVE_V4_STORAGE_KEY}.corrupt`;
export const CLASSIC_CLIENT_BUILD = 'classic-web-2026.07.24-r2';
export { HAND_CALIBRATION_ALGORITHM_REVISION };

let volatileSave: PlayerSaveV4 | null = null;
let observedStorage: Storage | null = null;
let mirroring = false;
let mirrorScheduled = false;
let mirrorInstalled = false;

function availableStorage(): Storage | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage; }
  catch { return null; }
}

function resetVolatileForStorage(storage: Storage | null): void {
  if (storage && observedStorage && storage !== observedStorage) volatileSave = null;
  if (storage) observedStorage = storage;
}

function installId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return `classic-${crypto.randomUUID()}`;
    }
  } catch {
    // A bounded local identifier is sufficient; it is not an authentication token.
  }
  return `classic-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
}

function readStoredSave(now = new Date()): PlayerSaveV4 | null {
  const storage = availableStorage();
  resetVolatileForStorage(storage);
  if (!storage) return volatileSave;
  let rawText: string | null = null;
  try { rawText = storage.getItem(PLAYER_SAVE_V4_STORAGE_KEY); }
  catch { return volatileSave; }
  if (rawText === null) return volatileSave;
  try {
    const parsed = parsePlayerSaveV4(JSON.parse(rawText));
    if (parsed) {
      volatileSave = parsed;
      return parsed;
    }
  } catch {
    // Quarantine below preserves bounded evidence for a recoverable local reset.
  }
  try {
    storage.setItem(PLAYER_SAVE_V4_CORRUPT_STORAGE_KEY, JSON.stringify({
      capturedAt: now.toISOString(), raw: rawText.slice(0, 100_000),
    }));
    storage.removeItem(PLAYER_SAVE_V4_STORAGE_KEY);
  } catch {
    // The normalized V3 stores can still reconstruct the V4 mirror in memory.
  }
  volatileSave = null;
  return null;
}

function persistSave(save: PlayerSaveV4): PlayerSaveV4 {
  const normalized = parsePlayerSaveV4(save);
  if (!normalized) throw new Error('invalid-player-save-v4');
  volatileSave = normalized;
  const storage = availableStorage();
  resetVolatileForStorage(storage);
  if (storage) {
    try { storage.setItem(PLAYER_SAVE_V4_STORAGE_KEY, JSON.stringify(normalized)); }
    catch { /* the in-memory mirror keeps the active session coherent */ }
  }
  return normalized;
}

function localHandProfile(previous?: HandProfileV4): HandProfileV4 {
  const hand = getHandSettings();
  return normalizeHandProfileV4({
    ...previous,
    enabled: previous?.enabled ?? true,
    handedness: hand.dominantHand === 'either' ? 'auto' : hand.dominantHand,
    aimSensitivity: hand.sensitivity,
    pinchContactRatio: hand.pinchOn,
    pinchReleaseRatio: hand.pinchOff,
    calibrationRevision: hand.calibrated ? hand.calibrationRevision : 0,
  });
}

function prefersReducedMotion(): boolean {
  try { return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches; }
  catch { return false; }
}

/** Rebuild the V4 mirror exclusively from normalized live Classic stores. */
export function mirrorClassicPlayerSaveV4(now = new Date()): PlayerSaveV4 {
  if (mirroring && volatileSave) return volatileSave;
  mirroring = true;
  try {
    const previous = readStoredSave(now);
    const player = getPlayerSave(now);
    const progress = getProgress();
    const meta = getMeta();
    const inventory = getInventoryState();
    return persistSave(assemblePlayerSaveV4(
      player,
      progress,
      meta,
      inventory,
      'classic',
      previous?.revision ?? 0,
      now,
      {
        clientIdentity: {
          id: 'classic', platform: 'web', build: CLASSIC_CLIENT_BUILD,
          installId: previous?.clientIdentity.installId || installId(), lastSeenAt: now.toISOString(),
        },
        campaign: previous ? {
          activeWorld: previous.campaign.activeWorld,
          activeLevel: previous.campaign.activeLevel,
          storyFlags: previous.campaign.storyFlags,
        } : undefined,
        endless: previous?.endless,
        liveEvent: previous?.liveEvent,
        entitlements: previous?.entitlements,
        deviceSettings: normalizeDeviceSettingsV4({
          ...(previous?.deviceSettings ?? {}),
          quality: meta.quality,
          reducedMotion: previous?.deviceSettings.reducedMotion ?? prefersReducedMotion(),
        }, meta),
        handProfile: localHandProfile(previous?.handProfile),
      },
    ));
  } finally {
    mirroring = false;
  }
}

function scheduleMirror(): void {
  if (mirroring || mirrorScheduled) return;
  mirrorScheduled = true;
  queueMicrotask(() => {
    mirrorScheduled = false;
    if (!mirroring) mirrorClassicPlayerSaveV4();
  });
}

/** Install one coalesced V3-to-V4 mirror and perform the startup migration. */
export function initializeClassicPlayerSaveV4(now = new Date()): PlayerSaveV4 {
  const save = mirrorClassicPlayerSaveV4(now);
  if (!mirrorInstalled) {
    subscribeLocalSaveChanges(scheduleMirror);
    mirrorInstalled = true;
  }
  return save;
}

/**
 * Merge a server progress envelope into the local V4 view. Campaign progress
 * is monotonic; endless/live-event state and entitlements are copied only from
 * the authoritative response. Local meta coins and inventory never enter the
 * server-owned fields.
 */
export function mergeProgressEnvelopeIntoClassicSaveV4(
  envelope: ProgressEnvelopeV3,
  now = new Date(),
): PlayerSaveV4 {
  const local = mirrorClassicPlayerSaveV4(now);
  const progress = persistGameProgress(mergeGameProgress(local.progress, envelope.progress));
  const useRemoteCalibration = envelope.handProfile.calibrationRevision >= HAND_CALIBRATION_PROFILE_REVISION_FLOOR
    && envelope.handProfile.calibrationRevision > local.handProfile.calibrationRevision;
  if (useRemoteCalibration) {
    updateHandSettings({
      dominantHand: envelope.handProfile.handedness === 'auto' ? 'either' : envelope.handProfile.handedness,
      sensitivity: envelope.handProfile.aimSensitivity,
      pinchOn: envelope.handProfile.pinchContactRatio,
      pinchOff: envelope.handProfile.pinchReleaseRatio,
      calibrated: true,
      calibrationRevision: envelope.handProfile.calibrationRevision,
    });
  }
  const appliedHand = useRemoteCalibration
    ? localHandProfile(envelope.handProfile)
    : localHandProfile(local.handProfile);
  const player = getPlayerSave(now);
  const meta = getMeta();
  const inventory = getInventoryState();
  const merged = assemblePlayerSaveV4(
    player,
    progress,
    meta,
    inventory,
    'classic',
    envelope.revision,
    now,
    {
      clientIdentity: {
        id: 'classic', platform: 'web', build: CLASSIC_CLIENT_BUILD,
        installId: local.clientIdentity.installId || installId(), lastSeenAt: now.toISOString(),
      },
      campaign: {
        activeWorld: Math.max(local.campaign.activeWorld, envelope.campaign.activeWorld),
        activeLevel: Math.max(local.campaign.activeLevel, envelope.campaign.activeLevel),
        storyFlags: Array.from(new Set([...envelope.campaign.storyFlags, ...local.campaign.storyFlags])),
      },
      endless: envelope.endless,
      liveEvent: envelope.liveEvent,
      entitlements: envelope.entitlements,
      deviceSettings: normalizeDeviceSettingsV4({
        ...envelope.deviceSettings,
        // Quality and reduced-motion are device capabilities/preferences; the
        // current Classic device keeps its local choices.
        quality: meta.quality,
        reducedMotion: local.deviceSettings.reducedMotion,
      }, meta),
      handProfile: normalizeHandProfileV4({
        ...appliedHand,
        enabled: envelope.handProfile.enabled,
        smoothing: envelope.handProfile.smoothing,
        calibrationRevision: appliedHand.calibrationRevision,
      }),
    },
  );
  return persistSave(merged);
}

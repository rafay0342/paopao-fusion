import { normalizeGameProgress, type GameProgress } from './progression';
import { normalizeInventory, type InventoryStateV1 } from './inventory';
import { normalizeMetaState, type MetaState, type RenderQuality } from './meta';
import { normalizePlayerSaveV3, type PlayerSaveV3 } from './retention';

export const PLAYER_SAVE_V4_STORAGE_KEY = 'paopao-fusion-save-v4';

/** Canonical identity for the permanently supported Phaser game client. */
export type PaopaoClientId = 'classic';
export type PaopaoPlatform = 'web' | 'windows' | 'android';

export interface ClientIdentityV4 {
  id: PaopaoClientId;
  platform: PaopaoPlatform;
  build: string;
  installId: string;
  lastSeenAt: string;
}

export interface CampaignStateV4 {
  progress: GameProgress;
  activeWorld: number;
  activeLevel: number;
  storyFlags: string[];
}

export interface EndlessStateV4 {
  seasonId: string;
  bestWave: number;
  bestScore: number;
  seasonPoints: number;
  completedRunIds: string[];
}

export interface LiveEventStateV4 {
  seasonId: string;
  rewardTrackTier: number;
  claimedRewardIds: string[];
  completedChallengeIds: string[];
}

export interface EntitlementStateV4 {
  revision: number;
  ids: string[];
}

export interface DeviceSettingsV4 {
  quality: RenderQuality;
  targetFps: 30 | 60;
  reducedMotion: boolean;
  highContrast: boolean;
  subtitles: boolean;
  musicVolume: number;
  effectsVolume: number;
}

export interface HandProfileV4 {
  enabled: boolean;
  handedness: 'auto' | 'left' | 'right';
  aimSensitivity: number;
  smoothing: number;
  pinchContactRatio: number;
  pinchReleaseRatio: number;
  calibrationRevision: number;
}

export interface PlayerSaveV4 {
  version: 4;
  revision: number;
  updatedAt: string;
  /** Kept as a scalar so existing V4 readers remain compatible. */
  client: PaopaoClientId;
  clientIdentity: ClientIdentityV4;
  player: PlayerSaveV3;
  progress: GameProgress;
  campaign: CampaignStateV4;
  endless: EndlessStateV4;
  liveEvent: LiveEventStateV4;
  entitlements: EntitlementStateV4;
  deviceSettings: DeviceSettingsV4;
  handProfile: HandProfileV4;
  meta: MetaState;
  inventory: InventoryStateV1;
}

export interface ManifestIntegrityV3 {
  algorithm: 'Ed25519';
  keyId: string;
  /** Base64url DER SubjectPublicKeyInfo; contains no private material. */
  publicKey: string;
  contentHash: string;
  signature: string;
}

export interface NativeCredentialsV3 {
  authentication: 'native';
  tokenType: 'Bearer';
  client: Extract<PaopaoPlatform, 'windows' | 'android'>;
  accessToken: string;
  accessExpiresAt: string;
  refreshToken: string;
  refreshExpiresAt: string;
}

export interface LiveEventConfigV3 {
  id: string;
  kind: 'event-boss';
  boss: string;
  level: number;
  seed: number;
  modifier: string;
  reward: { currency: 'coins'; amount: number };
  startsAt: string;
  endsAt: string;
  submissionToken: string;
}

export interface RunSubmissionV3 {
  runId: string;
  client: PaopaoClientId;
  level: number;
  mode: 'classic' | 'rush' | 'precision' | 'endless';
  score: number;
  durationMs: number;
  won: boolean;
  shots?: number;
  hits?: number;
  contentVersion?: string;
  seasonId?: string;
  seed?: number;
  wave?: number;
  replayHash?: string;
  replayVersion?: 1;
  shotTrace?: Array<{
    sequence: number;
    atMs: number;
    angleMilliDegrees: number;
  }>;
  eventId?: string;
  challengeToken?: string;
  classicTicketId?: string;
  classicTicketToken?: string;
  classicTerminalChallenge?: string;
  createdAt: string;
}

export interface RunValidationV3 extends ManifestIntegrityV3 {
  payload: {
    runId: string;
    userId: string;
    client: PaopaoClientId;
    contentVersion: string;
    createdAt: string;
    scoreClaim: number;
    wonClaim: boolean;
    replayHash?: string;
  };
}

export interface RunReceiptV3 {
  accepted: boolean;
  duplicate: boolean;
  replayed?: boolean;
  runId: string;
  serverAcceptedAt?: string;
  validation: RunValidationV3;
  replayVerification?: {
    status: 'not-required' | 'unverified' | 'integrity-only' | 'authoritative';
    authoritative: boolean;
    rewardEligible: boolean;
    reason: string;
    canonicalHash?: string;
    replayVersion?: 1;
    shotCount?: number;
    result?: {
      score: number;
      hits: number;
      shots: number;
      wave: number;
      won: boolean;
      maxCombo: number;
      seasonPoints: number;
      boss: { maxHp: number; hp: number } | null;
      stateChecksum: string;
    };
    scope?: 'server-observed-input-proof';
    proof?: {
      rulesVersion: number;
      proofHits: number;
      requiredProofHits: number;
      requiredShots: number;
    };
  };
  progression?: {
    applied: false;
    reason: string;
  } | {
    applied: true;
    seasonId: string;
    runPoints: number;
    bestWave: number;
    bestScore: number;
    seasonPoints: number;
    rewardTrackTier: number;
  };
  reward?: {
    granted: boolean;
    alreadyClaimed: boolean;
    currency: 'coins';
    amount: number;
    balance: number;
    source: 'classic-first-clear' | 'live-event';
    eventId?: string;
    level?: number;
    reason?: string;
  };
  rewardProof?: ManifestIntegrityV3 & { payload: Record<string, unknown> };
}

export interface ContentManifestV3 {
  schemaVersion: 3;
  contentVersion: string;
  saveVersion: 4;
  clients: Record<PaopaoClientId, {
    route: string;
    engine: string;
    status: 'production' | 'building';
    platforms: readonly PaopaoPlatform[];
  }>;
  worlds: number;
  levels: number;
  modes: readonly string[];
  artifacts: readonly string[];
  compatibility: { minimumApiVersion: number; legacyAdaptersThroughRelease: number };
  integrity: ManifestIntegrityV3;
}

export interface BootstrapV3 {
  apiVersion: 3;
  serverTime: string;
  content: ContentManifestV3;
  live: {
    schemaVersion: 3;
    season: string;
    minimumFps: number;
    preferredFps: number;
    handTracking: { targetFps: number; adaptive: boolean; workerInference: boolean; framesUploaded: false };
    features: Record<string, boolean>;
    endless: {
      seasonId: string;
      seed: number;
      rulesVersion: number;
      replayVersion: number;
      maximumShots: number;
      aimMilliDegrees: { minimum: number; maximum: number };
      pointsPerRewardTier: number;
      startsAt: string;
      endsAt: string;
      modifiers: readonly string[];
    };
    events: readonly LiveEventConfigV3[];
    integrity: ManifestIntegrityV3;
  };
  account: { authenticated: boolean } & Record<string, unknown>;
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function finite(value: unknown, minimum: number, maximum: number, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
}

function integer(value: unknown, minimum: number, maximum: number, fallback: number): number {
  return Math.trunc(finite(value, minimum, maximum, fallback));
}

function cleanStrings(value: unknown, maximum: number): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.slice(0, maximum)
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim().slice(0, 96))
    .filter(Boolean)));
}

function validDate(value: unknown, fallback: string): string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? value : fallback;
}

export function defaultDeviceSettingsV4(meta: MetaState): DeviceSettingsV4 {
  return {
    quality: ['ultra', 'balanced', 'performance'].includes(meta.quality) ? meta.quality : 'balanced',
    targetFps: 60,
    reducedMotion: false,
    highContrast: false,
    subtitles: true,
    musicVolume: 0.8,
    effectsVolume: 0.9,
  };
}

export function normalizeDeviceSettingsV4(value: unknown, meta: MetaState): DeviceSettingsV4 {
  const raw = record(value);
  const defaults = defaultDeviceSettingsV4(meta);
  return {
    quality: ['ultra', 'balanced', 'performance'].includes(String(raw.quality))
      ? raw.quality as RenderQuality
      : defaults.quality,
    targetFps: raw.targetFps === 30 ? 30 : 60,
    reducedMotion: raw.reducedMotion === true,
    highContrast: raw.highContrast === true,
    subtitles: raw.subtitles !== false,
    musicVolume: finite(raw.musicVolume, 0, 1, defaults.musicVolume),
    effectsVolume: finite(raw.effectsVolume, 0, 1, defaults.effectsVolume),
  };
}

export function normalizeHandProfileV4(value: unknown): HandProfileV4 {
  const raw = record(value);
  const pinchContactRatio = finite(raw.pinchContactRatio, 0.08, 0.8, 0.28);
  return {
    enabled: raw.enabled !== false,
    handedness: ['left', 'right'].includes(String(raw.handedness))
      ? raw.handedness as 'left' | 'right'
      : 'auto',
    aimSensitivity: finite(raw.aimSensitivity, 0.25, 3, 1),
    smoothing: finite(raw.smoothing, 0, 1, 0.58),
    pinchContactRatio,
    pinchReleaseRatio: Math.max(pinchContactRatio + 0.03, finite(raw.pinchReleaseRatio, 0.1, 1.2, 0.38)),
    calibrationRevision: integer(raw.calibrationRevision, 0, Number.MAX_SAFE_INTEGER, 0),
  };
}

/**
 * Parse both the original compact V4 envelope and the expanded Phaser V4
 * envelope. Missing expansion fields are deterministically migrated in-memory;
 * malformed core V4 data still fails closed.
 */
export function parsePlayerSaveV4(value: unknown): PlayerSaveV4 | null {
  const raw = record(value);
  if (raw.version !== 4 || !Number.isInteger(raw.revision) || Number(raw.revision) < 0) return null;
  if (!raw.updatedAt || Number.isNaN(Date.parse(String(raw.updatedAt)))) return null;
  if (raw.client !== 'classic') return null;
  for (const key of ['player', 'progress', 'meta', 'inventory']) {
    if (Object.keys(record(raw[key])).length === 0) return null;
  }

  const client = raw.client as PaopaoClientId;
  const updatedAt = String(raw.updatedAt);
  const player = normalizePlayerSaveV3(raw.player, new Date(updatedAt));
  const progress = normalizeGameProgress(raw.progress);
  const meta = normalizeMetaState(raw.meta);
  const inventory = normalizeInventory(raw.inventory);
  const identity = record(raw.clientIdentity);
  const campaign = record(raw.campaign);
  const endless = record(raw.endless);
  const liveEvent = record(raw.liveEvent);
  const entitlements = record(raw.entitlements);
  return {
    version: 4,
    revision: Number(raw.revision),
    updatedAt,
    client,
    clientIdentity: {
      id: client,
      platform: ['windows', 'android'].includes(String(identity.platform)) ? identity.platform as PaopaoPlatform : 'web',
      build: typeof identity.build === 'string' && identity.build.trim()
        ? identity.build.trim().slice(0, 64)
        : 'legacy-v4',
      installId: typeof identity.installId === 'string' ? identity.installId.trim().slice(0, 96) : '',
      lastSeenAt: validDate(identity.lastSeenAt, updatedAt),
    },
    player,
    progress,
    campaign: {
      progress,
      activeWorld: integer(campaign.activeWorld, 0, 5, 0),
      activeLevel: integer(campaign.activeLevel, 0, 41, Math.max(0, progress.unlocked - 1)),
      storyFlags: cleanStrings(campaign.storyFlags, 256),
    },
    endless: {
      seasonId: typeof endless.seasonId === 'string' ? endless.seasonId.slice(0, 64) : '',
      bestWave: integer(endless.bestWave, 0, 100_000, 0),
      bestScore: integer(endless.bestScore, 0, 1_000_000_000, 0),
      seasonPoints: integer(endless.seasonPoints, 0, 1_000_000_000, 0),
      completedRunIds: cleanStrings(endless.completedRunIds, 200),
    },
    liveEvent: {
      seasonId: typeof liveEvent.seasonId === 'string' ? liveEvent.seasonId.slice(0, 64) : '',
      rewardTrackTier: integer(liveEvent.rewardTrackTier, 0, 10_000, 0),
      claimedRewardIds: cleanStrings(liveEvent.claimedRewardIds, 200),
      completedChallengeIds: cleanStrings(liveEvent.completedChallengeIds, 200),
    },
    entitlements: {
      revision: integer(entitlements.revision, 0, Number.MAX_SAFE_INTEGER, 0),
      ids: cleanStrings(entitlements.ids, 500),
    },
    deviceSettings: normalizeDeviceSettingsV4(raw.deviceSettings, meta),
    handProfile: normalizeHandProfileV4(raw.handProfile),
    meta,
    inventory,
  };
}

export interface AssemblePlayerSaveV4Options {
  clientIdentity?: Partial<ClientIdentityV4>;
  campaign?: Partial<Omit<CampaignStateV4, 'progress'>>;
  endless?: Partial<EndlessStateV4>;
  liveEvent?: Partial<LiveEventStateV4>;
  entitlements?: Partial<EntitlementStateV4>;
  deviceSettings?: Partial<DeviceSettingsV4>;
  handProfile?: Partial<HandProfileV4>;
}

export function assemblePlayerSaveV4(
  player: PlayerSaveV3,
  progress: GameProgress,
  meta: MetaState,
  inventory: InventoryStateV1,
  client: PaopaoClientId = 'classic',
  revision = 0,
  now = new Date(),
  options: AssemblePlayerSaveV4Options = {},
): PlayerSaveV4 {
  const updatedAt = now.toISOString();
  const candidate = {
    version: 4,
    revision: Math.max(0, Math.trunc(revision)),
    updatedAt,
    client,
    clientIdentity: {
      id: client,
      platform: 'web',
      build: 'local',
      installId: '',
      lastSeenAt: updatedAt,
      ...options.clientIdentity,
    },
    player,
    progress,
    campaign: { progress, activeWorld: 0, activeLevel: Math.max(0, progress.unlocked - 1), storyFlags: [], ...options.campaign },
    endless: { seasonId: '', bestWave: 0, bestScore: 0, seasonPoints: 0, completedRunIds: [], ...options.endless },
    liveEvent: { seasonId: '', rewardTrackTier: 0, claimedRewardIds: [], completedChallengeIds: [], ...options.liveEvent },
    entitlements: { revision: 0, ids: [], ...options.entitlements },
    deviceSettings: { ...defaultDeviceSettingsV4(meta), ...options.deviceSettings },
    handProfile: { ...normalizeHandProfileV4({}), ...options.handProfile },
    meta,
    inventory,
  } satisfies PlayerSaveV4;
  const parsed = parsePlayerSaveV4(candidate);
  if (!parsed) throw new Error('player-save-v4-assembly-invalid');
  return parsed;
}

export interface ProgressEnvelopeV3 {
  saveVersion: 4;
  revision: number;
  updatedAt: string;
  client: PaopaoClientId;
  progress: GameProgress;
  clientIdentity: ClientIdentityV4;
  campaign: CampaignStateV4;
  endless: EndlessStateV4;
  liveEvent: LiveEventStateV4;
  entitlements: EntitlementStateV4;
  deviceSettings: DeviceSettingsV4;
  handProfile: HandProfileV4;
}

export interface ClassicProgressUpdateV3 {
  revision: number;
  progress: GameProgress;
  clientIdentity: Pick<ClientIdentityV4, 'id' | 'platform' | 'build' | 'installId'>;
  campaign: Omit<CampaignStateV4, 'progress'>;
  deviceSettings: DeviceSettingsV4;
  handProfile: HandProfileV4;
}

function nonEmptyRecord(value: unknown): Record<string, unknown> | null {
  const parsed = record(value);
  return Object.keys(parsed).length > 0 ? parsed : null;
}

/** Parse the exact GET/PUT /api/v3/progress response without shallow casts. */
export function parseProgressEnvelopeV3(value: unknown): ProgressEnvelopeV3 | null {
  const raw = record(value);
  if (raw.saveVersion !== 4 || !Number.isInteger(raw.revision) || Number(raw.revision) < 0) return null;
  if (raw.client !== 'classic') return null;
  const updatedAt = validDate(raw.updatedAt, '');
  if (!updatedAt) return null;
  const progressRaw = nonEmptyRecord(raw.progress);
  const identity = nonEmptyRecord(raw.clientIdentity);
  const campaign = nonEmptyRecord(raw.campaign);
  const endless = nonEmptyRecord(raw.endless);
  const liveEvent = nonEmptyRecord(raw.liveEvent);
  const entitlements = nonEmptyRecord(raw.entitlements);
  const deviceSettings = nonEmptyRecord(raw.deviceSettings);
  const handProfile = nonEmptyRecord(raw.handProfile);
  if (!progressRaw || !identity || !campaign || !endless || !liveEvent || !entitlements || !deviceSettings || !handProfile) return null;
  if (identity.id !== 'classic'
    || !['web', 'windows', 'android'].includes(String(identity.platform))
    || typeof identity.build !== 'string' || identity.build.length < 1 || identity.build.length > 64
    || typeof identity.installId !== 'string' || identity.installId.length > 96) return null;

  const client = raw.client as PaopaoClientId;
  const progress = normalizeGameProgress(progressRaw);
  const identityLastSeenAt = validDate(identity.lastSeenAt, updatedAt);
  const normalizedDeviceSettings = normalizeDeviceSettingsV4(
    deviceSettings,
    normalizeMetaState({ quality: deviceSettings.quality }),
  );
  return {
    saveVersion: 4,
    revision: Number(raw.revision),
    updatedAt,
    client,
    progress,
    clientIdentity: {
      id: identity.id as PaopaoClientId,
      platform: identity.platform as PaopaoPlatform,
      build: identity.build,
      installId: identity.installId,
      lastSeenAt: identityLastSeenAt,
    },
    campaign: {
      progress,
      activeWorld: integer(campaign.activeWorld, 0, 5, 0),
      activeLevel: integer(campaign.activeLevel, 0, 41, Math.max(0, progress.unlocked - 1)),
      storyFlags: cleanStrings(campaign.storyFlags, 256),
    },
    endless: {
      seasonId: typeof endless.seasonId === 'string' ? endless.seasonId.slice(0, 64) : '',
      bestWave: integer(endless.bestWave, 0, 100_000, 0),
      bestScore: integer(endless.bestScore, 0, 1_000_000_000, 0),
      seasonPoints: integer(endless.seasonPoints, 0, 1_000_000_000, 0),
      completedRunIds: cleanStrings(endless.completedRunIds, 200),
    },
    liveEvent: {
      seasonId: typeof liveEvent.seasonId === 'string' ? liveEvent.seasonId.slice(0, 64) : '',
      rewardTrackTier: integer(liveEvent.rewardTrackTier, 0, 10_000, 0),
      claimedRewardIds: cleanStrings(liveEvent.claimedRewardIds, 200),
      completedChallengeIds: cleanStrings(liveEvent.completedChallengeIds, 200),
    },
    entitlements: {
      revision: integer(entitlements.revision, 0, Number.MAX_SAFE_INTEGER, 0),
      ids: cleanStrings(entitlements.ids, 500),
    },
    deviceSettings: normalizedDeviceSettings,
    handProfile: normalizeHandProfileV4(handProfile),
  };
}

/**
 * Construct the complete Classic write DTO. Server-owned endless state,
 * entitlements, inventory, meta and every client coin field are intentionally
 * absent and therefore cannot be promoted by a save upload.
 */
export function buildClassicProgressUpdateV3(value: unknown): ClassicProgressUpdateV3 | null {
  const save = parsePlayerSaveV4(value);
  if (!save || save.client !== 'classic') return null;
  return {
    revision: save.revision,
    progress: normalizeGameProgress(save.progress),
    clientIdentity: {
      id: 'classic',
      platform: 'web',
      build: save.clientIdentity.build,
      installId: save.clientIdentity.installId,
    },
    campaign: {
      activeWorld: save.campaign.activeWorld,
      activeLevel: save.campaign.activeLevel,
      storyFlags: [...save.campaign.storyFlags],
    },
    deviceSettings: normalizeDeviceSettingsV4(save.deviceSettings, save.meta),
    handProfile: normalizeHandProfileV4(save.handProfile),
  };
}

export function classicProgressUpdateMatchesEnvelopeV3(
  update: ClassicProgressUpdateV3,
  envelope: ProgressEnvelopeV3,
): boolean {
  const comparableEnvelope = {
    progress: envelope.progress,
    clientIdentity: {
      id: envelope.clientIdentity.id,
      platform: envelope.clientIdentity.platform,
      build: envelope.clientIdentity.build,
      installId: envelope.clientIdentity.installId,
    },
    campaign: {
      activeWorld: envelope.campaign.activeWorld,
      activeLevel: envelope.campaign.activeLevel,
      storyFlags: envelope.campaign.storyFlags,
    },
    deviceSettings: envelope.deviceSettings,
    handProfile: envelope.handProfile,
  };
  const comparableUpdate = {
    progress: update.progress,
    clientIdentity: update.clientIdentity,
    campaign: update.campaign,
    deviceSettings: update.deviceSettings,
    handProfile: update.handProfile,
  };
  return JSON.stringify(comparableUpdate) === JSON.stringify(comparableEnvelope);
}

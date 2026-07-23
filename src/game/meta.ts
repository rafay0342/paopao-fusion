import { ORB_SKINS, type OrbSkinId } from '../config';
import { notifyLocalSaveChanged } from './save-events';

export type GameMode = 'classic' | 'rush' | 'precision';
export type RenderQuality = 'ultra' | 'balanced' | 'performance';
export type ArtifactId = 'chrono' | 'phoenix' | 'void' | 'fortune';
export type TierId = 'bronze' | 'silver' | 'gold' | 'prismatic';

export interface ArtifactDef {
  id: ArtifactId;
  name: string;
  subtitle: string;
  description: string;
  superName: string;
  superDescription: string;
  texture: string;
  price: number;
  accent: number;
  accentCss: string;
}

export interface ModeDef {
  id: GameMode;
  name: string;
  tagline: string;
  description: string;
  timerSeconds: number | null;
  coinMultiplier: number;
  accent: number;
  accentCss: string;
}

export interface MetaState {
  coins: number;
  lifetimeCoins: number;
  totalHits: number;
  completedRuns: number;
  ownedArtifacts: ArtifactId[];
  equippedArtifact: ArtifactId;
  mode: GameMode;
  quality: RenderQuality;
  mysteryKeys: number;
  openedMysteryBoxes: number;
  ownedSkins: OrbSkinId[];
  equippedSkin: OrbSkinId;
  lastDailyKey: string;
}

export interface TierDef {
  id: TierId;
  name: string;
  subtitle: string;
  threshold: number;
  texture: string;
  accent: number;
  accentCss: string;
}

export interface TierProgress {
  tier: TierDef;
  next?: TierDef;
  renown: number;
  progress: number;
}

export interface MysteryReward {
  kind: 'coins' | 'skin' | 'keys';
  title: string;
  detail: string;
  amount: number;
  skinId?: OrbSkinId;
  accent: number;
  accentCss: string;
}

export interface QualityProfile {
  motes: number;
  particles: number;
  parallax: boolean;
  glints: boolean;
  bloom: boolean;
  dprCap: number;
  handFps: 15 | 20 | 30;
}

export const ARTIFACTS: readonly ArtifactDef[] = [
  {
    id: 'chrono',
    name: 'CHRONO PRISM',
    subtitle: 'KEEPER OF SECONDS',
    description: '+5 seconds in every timed mode.',
    superName: 'TIME WARP',
    superDescription: 'Freeze danger and add 15 seconds.',
    texture: 'artifact_chrono',
    price: 0,
    accent: 0x58e8ff,
    accentCss: '#58e8ff',
  },
  {
    id: 'phoenix',
    name: 'PHOENIX CROWN',
    subtitle: 'ROYAL FLAME',
    description: '+10% score from every successful hit.',
    superName: 'PHOENIX SWEEP',
    superDescription: 'Burn away the two lowest grid rows.',
    texture: 'artifact_phoenix',
    price: 450,
    accent: 0xff7355,
    accentCss: '#ff7355',
  },
  {
    id: 'void',
    name: 'VOID COMPASS',
    subtitle: 'SEEKER OF COLOUR',
    description: 'Super energy charges 25% faster.',
    superName: 'PRISM SEEK',
    superDescription: 'Erase every orb matching the loaded colour.',
    texture: 'artifact_void',
    price: 650,
    accent: 0xb277ff,
    accentCss: '#b277ff',
  },
  {
    id: 'fortune',
    name: 'FORTUNE IDOL',
    subtitle: 'GILDED HARVEST',
    description: 'Double all coins earned during a run.',
    superName: 'GOLDEN RAIN',
    superDescription: 'Shatter six orbs and summon bonus coins.',
    texture: 'artifact_fortune',
    price: 500,
    accent: 0xffd34e,
    accentCss: '#ffd34e',
  },
] as const;

export const MODE_DEFS: Record<GameMode, ModeDef> = {
  classic: {
    id: 'classic',
    name: 'CLASSIC SAGA',
    tagline: 'MASTER THE GRID',
    description: 'No countdown. Clear every orb and build huge combos.',
    timerSeconds: null,
    coinMultiplier: 1,
    accent: 0x62f3ef,
    accentCss: '#62f3ef',
  },
  rush: {
    id: 'rush',
    name: 'TIME RUSH',
    tagline: 'BEAT THE CLOCK',
    description: 'Start with 75 seconds. Every hit restores precious time.',
    timerSeconds: 75,
    coinMultiplier: 1.5,
    accent: 0xffb84d,
    accentCss: '#ffb84d',
  },
  precision: {
    id: 'precision',
    name: 'PRECISION TRIAL',
    tagline: 'FIVE MISSES MAX',
    description: 'Complete the level objective before time expires, with no more than five misses.',
    timerSeconds: 105,
    coinMultiplier: 1.75,
    accent: 0xc78cff,
    accentCss: '#c78cff',
  },
};

export const QUALITY_PROFILES: Record<RenderQuality, QualityProfile> = {
  ultra: { motes: 1, particles: 1, parallax: true, glints: false, bloom: true, dprCap: 2, handFps: 30 },
  balanced: { motes: 0.56, particles: 0.64, parallax: true, glints: false, bloom: false, dprCap: 1.5, handFps: 20 },
  performance: { motes: 0.22, particles: 0.3, parallax: false, glints: false, bloom: false, dprCap: 1, handFps: 15 },
};

export const TIER_DEFS: readonly TierDef[] = [
  {
    id: 'bronze', name: 'BRONZE GUARDIAN', subtitle: 'AWAKENED', threshold: 0,
    texture: 'tier_bronze', accent: 0xd28b52, accentCss: '#e1a06b',
  },
  {
    id: 'silver', name: 'SILVER KNIGHT', subtitle: 'ASCENDANT', threshold: 1000,
    texture: 'tier_silver', accent: 0xbdd8ee, accentCss: '#d6edff',
  },
  {
    id: 'gold', name: 'GOLD SOVEREIGN', subtitle: 'ROYAL', threshold: 3200,
    texture: 'tier_gold', accent: 0xffd05f, accentCss: '#ffe08a',
  },
  {
    id: 'prismatic', name: 'PRISMATIC LEGEND', subtitle: 'ETERNAL', threshold: 8000,
    texture: 'tier_prismatic', accent: 0xc59cff, accentCss: '#d9b9ff',
  },
] as const;

const KEY = 'paopao-fusion-meta-v1';
const ARTIFACT_IDS = new Set<ArtifactId>(ARTIFACTS.map((artifact) => artifact.id));
const MODE_IDS = new Set<GameMode>(Object.keys(MODE_DEFS) as GameMode[]);
const QUALITY_IDS = new Set<RenderQuality>(Object.keys(QUALITY_PROFILES) as RenderQuality[]);
const SKIN_IDS = new Set<OrbSkinId>(ORB_SKINS.map((skin) => skin.id));
const MAX_META_COUNT = 1_000_000_000;

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function safeCount(value: unknown, fallback: number, maximum = MAX_META_COUNT): number {
  const numeric = Number(value);
  return Number.isFinite(numeric)
    ? Math.min(maximum, Math.max(0, Math.trunc(numeric)))
    : fallback;
}

function initialMeta(): MetaState {
  return {
    coins: 600,
    lifetimeCoins: 600,
    totalHits: 0,
    completedRuns: 0,
    ownedArtifacts: ['chrono'],
    equippedArtifact: 'chrono',
    mode: 'classic',
    quality: 'ultra',
    mysteryKeys: 1,
    openedMysteryBoxes: 0,
    ownedSkins: ['nova', 'nova_optical'],
    equippedSkin: 'nova',
    lastDailyKey: '',
  };
}

export function normalizeMetaState(value: unknown): MetaState {
  const saved = record(value);
  const fallback = initialMeta();
  const owned = Array.isArray(saved.ownedArtifacts)
    ? saved.ownedArtifacts.slice(0, ARTIFACTS.length).filter((id): id is ArtifactId => ARTIFACT_IDS.has(id as ArtifactId))
    : [...fallback.ownedArtifacts];
  if (!owned.includes('chrono')) owned.unshift('chrono');
  const equipped = ARTIFACT_IDS.has(saved.equippedArtifact as ArtifactId) && owned.includes(saved.equippedArtifact as ArtifactId)
    ? saved.equippedArtifact as ArtifactId
    : 'chrono';
  const ownedSkins = Array.isArray(saved.ownedSkins)
    ? saved.ownedSkins.slice(0, ORB_SKINS.length).filter((id): id is OrbSkinId => SKIN_IDS.has(id as OrbSkinId))
    : [...fallback.ownedSkins];
  if (!ownedSkins.includes('nova')) ownedSkins.unshift('nova');
  // Nova Optical is an additive launch gift. Existing profiles receive it
  // without changing their equipped V6 skin or any prior collection state.
  if (!ownedSkins.includes('nova_optical')) ownedSkins.push('nova_optical');
  const equippedSkin = SKIN_IDS.has(saved.equippedSkin as OrbSkinId) && ownedSkins.includes(saved.equippedSkin as OrbSkinId)
    ? saved.equippedSkin as OrbSkinId
    : 'nova';
  return {
    coins: safeCount(saved.coins, fallback.coins),
    lifetimeCoins: safeCount(saved.lifetimeCoins, fallback.lifetimeCoins),
    totalHits: safeCount(saved.totalHits, fallback.totalHits),
    completedRuns: safeCount(saved.completedRuns, fallback.completedRuns),
    ownedArtifacts: Array.from(new Set(owned)),
    equippedArtifact: equipped,
    mode: MODE_IDS.has(saved.mode as GameMode) ? saved.mode as GameMode : fallback.mode,
    quality: QUALITY_IDS.has(saved.quality as RenderQuality) ? saved.quality as RenderQuality : fallback.quality,
    mysteryKeys: safeCount(saved.mysteryKeys, fallback.mysteryKeys, 1_000_000),
    openedMysteryBoxes: safeCount(saved.openedMysteryBoxes, fallback.openedMysteryBoxes, 1_000_000),
    ownedSkins: Array.from(new Set(ownedSkins)),
    equippedSkin,
    lastDailyKey: typeof saved.lastDailyKey === 'string' ? saved.lastDailyKey.slice(0, 32) : fallback.lastDailyKey,
  };
}

function save(meta: MetaState): MetaState {
  const normalized = normalizeMetaState(meta);
  try {
    localStorage.setItem(KEY, JSON.stringify(normalized));
  } catch {
    // The current scene keeps working even when storage is unavailable.
  }
  notifyLocalSaveChanged();
  return normalized;
}

export function getMeta(): MetaState {
  try {
    return normalizeMetaState(JSON.parse(localStorage.getItem(KEY) ?? '{}'));
  } catch {
    return initialMeta();
  }
}

export function mergeMetaState(localInput: Partial<MetaState>, cloudInput: Partial<MetaState>): MetaState {
  const local = normalizeMetaState(localInput);
  const cloud = normalizeMetaState({ ...local, ...record(cloudInput) });
  const ownedArtifacts = Array.from(new Set([...local.ownedArtifacts, ...cloud.ownedArtifacts]));
  const ownedSkins = Array.from(new Set([...local.ownedSkins, ...cloud.ownedSkins]));
  const openedMysteryBoxes = Math.max(local.openedMysteryBoxes, cloud.openedMysteryBoxes);
  const earnedMysteryKeys = Math.max(
    local.mysteryKeys + local.openedMysteryBoxes,
    cloud.mysteryKeys + cloud.openedMysteryBoxes,
  );
  return normalizeMetaState({
    ...local,
    ...cloud,
    coins: Math.max(local.coins, cloud.coins),
    lifetimeCoins: Math.max(local.lifetimeCoins, cloud.lifetimeCoins),
    totalHits: Math.max(local.totalHits, cloud.totalHits),
    completedRuns: Math.max(local.completedRuns, cloud.completedRuns),
    mysteryKeys: Math.max(0, earnedMysteryKeys - openedMysteryBoxes),
    openedMysteryBoxes,
    ownedArtifacts,
    equippedArtifact: ownedArtifacts.includes(cloud.equippedArtifact) ? cloud.equippedArtifact : local.equippedArtifact,
    ownedSkins,
    equippedSkin: ownedSkins.includes(cloud.equippedSkin) ? cloud.equippedSkin : local.equippedSkin,
    lastDailyKey: local.lastDailyKey > cloud.lastDailyKey ? local.lastDailyKey : cloud.lastDailyKey,
  });
}

export function getArtifact(id: ArtifactId): ArtifactDef {
  return ARTIFACTS.find((artifact) => artifact.id === id) ?? ARTIFACTS[0];
}

export function setMode(mode: GameMode): MetaState {
  const meta = getMeta();
  meta.mode = mode;
  return save(meta);
}

export function setQuality(quality: RenderQuality): MetaState {
  const meta = getMeta();
  meta.quality = quality;
  return save(meta);
}

export function cycleQuality(): MetaState {
  const order: RenderQuality[] = ['ultra', 'balanced', 'performance'];
  const meta = getMeta();
  meta.quality = order[(order.indexOf(meta.quality) + 1) % order.length];
  return save(meta);
}

export function getQualityProfile(): QualityProfile {
  return QUALITY_PROFILES[getMeta().quality];
}

export function addCoins(amount: number, hits = 0, completedRun = false): MetaState {
  const meta = getMeta();
  const awarded = safeCount(amount, 0);
  meta.coins = safeCount(meta.coins + awarded, meta.coins);
  meta.lifetimeCoins = safeCount(meta.lifetimeCoins + awarded, meta.lifetimeCoins);
  meta.totalHits = safeCount(meta.totalHits + safeCount(hits, 0), meta.totalHits);
  if (completedRun) meta.completedRuns = safeCount(meta.completedRuns + 1, meta.completedRuns);
  return save(meta);
}

/** Record local progression statistics without minting spendable currency. */
export function recordRunStats(hits = 0, completedRun = false): MetaState {
  const meta = getMeta();
  meta.totalHits = safeCount(meta.totalHits + safeCount(hits, 0), meta.totalHits);
  if (completedRun) meta.completedRuns = safeCount(meta.completedRuns + 1, meta.completedRuns);
  return save(meta);
}

export function purchaseArtifact(id: ArtifactId): { ok: boolean; reason?: 'owned' | 'insufficient'; meta: MetaState } {
  const artifact = getArtifact(id);
  const meta = getMeta();
  if (meta.ownedArtifacts.includes(id)) return { ok: false, reason: 'owned', meta };
  if (meta.coins < artifact.price) return { ok: false, reason: 'insufficient', meta };
  meta.coins -= artifact.price;
  meta.ownedArtifacts.push(id);
  return { ok: true, meta: save(meta) };
}

export function applyServerWallet(coins: number): MetaState {
  const meta = getMeta();
  meta.coins = safeCount(coins, meta.coins);
  meta.lifetimeCoins = Math.max(meta.lifetimeCoins, meta.coins);
  return save(meta);
}

/**
 * Replace durable ownership with the authenticated server snapshot.
 *
 * This must not union with the current browser profile: a second account using
 * the same device must never inherit the first account's purchased artifact or
 * skin. Launch gifts remain available to every profile.
 */
export function applyServerEntitlements(ids: readonly string[]): MetaState {
  const meta = getMeta();
  const ownedArtifacts = new Set<ArtifactId>(['chrono']);
  const ownedSkins = new Set<OrbSkinId>(['nova', 'nova_optical']);
  for (const entitlement of ids) {
    if (entitlement.startsWith('artifact:')) {
      const id = entitlement.slice('artifact:'.length) as ArtifactId;
      if (ARTIFACT_IDS.has(id)) ownedArtifacts.add(id);
    } else if (entitlement.startsWith('skin:')) {
      const id = entitlement.slice('skin:'.length) as OrbSkinId;
      if (SKIN_IDS.has(id)) ownedSkins.add(id);
    }
  }
  meta.ownedArtifacts = Array.from(ownedArtifacts);
  meta.ownedSkins = Array.from(ownedSkins);
  if (!ownedArtifacts.has(meta.equippedArtifact)) meta.equippedArtifact = 'chrono';
  if (!ownedSkins.has(meta.equippedSkin)) meta.equippedSkin = 'nova';
  return save(meta);
}

export function grantArtifactOwnership(id: ArtifactId): MetaState {
  const meta = getMeta();
  if (!meta.ownedArtifacts.includes(id)) meta.ownedArtifacts.push(id);
  return save(meta);
}

export function grantSkinOwnership(id: OrbSkinId): MetaState {
  const meta = getMeta();
  if (!meta.ownedSkins.includes(id)) meta.ownedSkins.push(id);
  return save(meta);
}

export function equipArtifact(id: ArtifactId): { ok: boolean; meta: MetaState } {
  const meta = getMeta();
  if (!meta.ownedArtifacts.includes(id)) return { ok: false, meta };
  meta.equippedArtifact = id;
  return { ok: true, meta: save(meta) };
}

export function addMysteryKeys(amount: number): MetaState {
  const meta = getMeta();
  meta.mysteryKeys = safeCount(meta.mysteryKeys + safeCount(amount, 0, 1_000_000), meta.mysteryKeys, 1_000_000);
  return save(meta);
}

export function claimDailyKey(): { claimed: boolean; meta: MetaState } {
  const meta = getMeta();
  const today = new Date().toISOString().slice(0, 10);
  if (meta.lastDailyKey === today) return { claimed: false, meta };
  meta.lastDailyKey = today;
  meta.mysteryKeys += 1;
  return { claimed: true, meta: save(meta) };
}

export function purchaseSkin(id: OrbSkinId): { ok: boolean; reason?: 'owned' | 'insufficient'; meta: MetaState } {
  const skin = ORB_SKINS.find((entry) => entry.id === id) ?? ORB_SKINS[0];
  const meta = getMeta();
  if (meta.ownedSkins.includes(id)) return { ok: false, reason: 'owned', meta };
  if (meta.coins < skin.price) return { ok: false, reason: 'insufficient', meta };
  meta.coins -= skin.price;
  meta.ownedSkins.push(id);
  return { ok: true, meta: save(meta) };
}

export function equipSkin(id: OrbSkinId): { ok: boolean; meta: MetaState } {
  const meta = getMeta();
  if (!meta.ownedSkins.includes(id)) return { ok: false, meta };
  meta.equippedSkin = id;
  return { ok: true, meta: save(meta) };
}

export function getRenown(meta = getMeta()): number {
  return Math.floor(meta.lifetimeCoins + meta.totalHits * 12 + meta.completedRuns * 250 + meta.openedMysteryBoxes * 90);
}

export function getTierProgress(meta = getMeta()): TierProgress {
  const renown = getRenown(meta);
  let index = 0;
  for (let i = 0; i < TIER_DEFS.length; i++) {
    if (renown >= TIER_DEFS[i].threshold) index = i;
  }
  const tier = TIER_DEFS[index];
  const next = TIER_DEFS[index + 1];
  const progress = next
    ? Math.min(1, Math.max(0, (renown - tier.threshold) / (next.threshold - tier.threshold)))
    : 1;
  return { tier, next, renown, progress };
}

export function openMysteryBox(): { ok: boolean; reward?: MysteryReward; meta: MetaState } {
  const meta = getMeta();
  if (meta.mysteryKeys < 1) return { ok: false, meta };
  meta.mysteryKeys -= 1;
  const lockedSkins = ORB_SKINS.filter((skin) => !meta.ownedSkins.includes(skin.id));
  const roll = Math.random();
  let reward: MysteryReward;

  // The first vault opening always demonstrates the collectible-skin system.
  if (meta.openedMysteryBoxes === 0 && lockedSkins.length) {
    const skin = lockedSkins[0];
    meta.ownedSkins.push(skin.id);
    reward = {
      kind: 'skin', title: `${skin.name} UNLOCKED`, detail: `${skin.rarity} ORB SKIN`, amount: 1,
      skinId: skin.id, accent: skin.accent, accentCss: skin.accentCss,
    };
  } else if (lockedSkins.length && roll < 0.18) {
    const skin = lockedSkins[Math.floor(Math.random() * lockedSkins.length)];
    meta.ownedSkins.push(skin.id);
    reward = {
      kind: 'skin', title: `${skin.name} UNLOCKED`, detail: `${skin.rarity} ORB SKIN`, amount: 1,
      skinId: skin.id, accent: skin.accent, accentCss: skin.accentCss,
    };
  } else if (roll < 0.25) {
    meta.mysteryKeys += 2;
    reward = {
      kind: 'keys', title: 'GIFT HAMPER', detail: '+2 MYSTERY KEYS', amount: 2,
      accent: 0x65efff, accentCss: '#65efff',
    };
  } else {
    const amount = roll > 0.94 ? 1500 : roll > 0.72 ? 600 : roll > 0.42 ? 300 : 140;
    meta.coins += amount;
    meta.lifetimeCoins += amount;
    reward = {
      kind: 'coins', title: amount >= 1500 ? 'ROYAL JACKPOT' : 'TREASURE COINS',
      detail: `+${amount.toLocaleString()} COINS`, amount,
      accent: amount >= 1500 ? 0xffef8a : 0xffd05f, accentCss: amount >= 1500 ? '#ffef8a' : '#ffd05f',
    };
  }

  meta.openedMysteryBoxes += 1;
  return { ok: true, reward, meta: save(meta) };
}

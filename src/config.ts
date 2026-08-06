/**
 * Central config. The original V6 Royal families and the additional V7
 * Optical families use distinct texture keys, so new art never replaces an
 * existing collectible. Procedural orbs remain only as a resilient fallback
 * if a deployed image cannot be loaded.
 */
import campaignFixture from '../shared/fixtures/campaign-v1.json';
import {
  CLASSIC_FIRST_CLEAR_REWARD_CURRENCY,
  CLASSIC_FIRST_CLEAR_REWARD_SOURCE,
  classicFirstClearReward,
} from '../shared/runtime/classic-economy.mjs';

export const COLORS = {
  red:    { hex: 0xff5a6e, name: 'Red' },
  blue:   { hex: 0x4fb0ff, name: 'Blue' },
  green:  { hex: 0x4be08a, name: 'Green' },
  yellow: { hex: 0xffd24b, name: 'Yellow' },
  purple: { hex: 0xb46bff, name: 'Purple' },
  orange: { hex: 0xff9f45, name: 'Orange' },
} as const;

export type ColorKey = keyof typeof COLORS;
export const COLOR_KEYS = Object.keys(COLORS) as ColorKey[];

export type OrbSkinId =
  | 'nova'
  | 'aurora'
  | 'voidforge'
  | 'nova_optical'
  | 'aurora_optical'
  | 'voidforge_optical'
  | 'phoenix'
  | 'frostglass'
  | 'nexus_crown'
  | 'phoenix_optical'
  | 'frostglass_optical'
  | 'nexus_crown_optical';

export type OrbSkinEdition = 'royal' | 'optical';
export type OrbAssetFolder = 'v6' | 'v7' | 'v11';
export type OrbAssetSlug =
  | 'nova'
  | 'aurora'
  | 'voidforge'
  | 'phoenix'
  | 'frostglass'
  | 'nexus-crown'
  | 'phoenix-optical'
  | 'frostglass-optical'
  | 'nexus-crown-optical';

export interface OrbSkinDef {
  id: OrbSkinId;
  name: string;
  rarity: string;
  description: string;
  price: number;
  accent: number;
  accentCss: string;
  visualFill: number;
  edition: OrbSkinEdition;
  assetFolder: OrbAssetFolder;
  assetSlug: OrbAssetSlug;
}

export const ORB_SKINS: readonly OrbSkinDef[] = [
  {
    id: 'nova',
    name: 'NOVA GLASS',
    rarity: 'EPIC',
    description: 'Living plasma sealed inside flawless royal glass.',
    price: 0,
    accent: 0x59ecff,
    accentCss: '#59ecff',
    visualFill: 0.84,
    edition: 'royal',
    assetFolder: 'v6',
    assetSlug: 'nova',
  },
  {
    id: 'aurora',
    name: 'ROYAL AURORA',
    rarity: 'MYTHIC',
    description: 'Pearlescent starlight wrapped in gilded filigree.',
    price: 900,
    accent: 0xffd77a,
    accentCss: '#ffd77a',
    visualFill: 0.76,
    edition: 'royal',
    assetFolder: 'v6',
    assetSlug: 'aurora',
  },
  {
    id: 'voidforge',
    name: 'VOIDFORGE',
    rarity: 'LEGENDARY',
    description: 'Dark-silver raid orbs forged around a cosmic core.',
    price: 1800,
    accent: 0xb58cff,
    accentCss: '#b58cff',
    visualFill: 0.78,
    edition: 'royal',
    assetFolder: 'v6',
    assetSlug: 'voidforge',
  },
  {
    id: 'nova_optical',
    name: 'NOVA OPTICAL',
    rarity: 'ASCENDED',
    description: 'Deep liquid crystal with layered refractive nova currents.',
    price: 0,
    accent: 0x59ecff,
    accentCss: '#59ecff',
    visualFill: 0.92,
    edition: 'optical',
    assetFolder: 'v7',
    assetSlug: 'nova',
  },
  {
    id: 'aurora_optical',
    name: 'AURORA OPTICAL',
    rarity: 'CELESTIAL',
    description: 'Volumetric aurora light inside a seamless circular lens.',
    price: 1400,
    accent: 0xffd77a,
    accentCss: '#ffd77a',
    visualFill: 0.92,
    edition: 'optical',
    assetFolder: 'v7',
    assetSlug: 'aurora',
  },
  {
    id: 'voidforge_optical',
    name: 'VOID OPTICAL',
    rarity: 'ETERNAL',
    description: 'Smoked celestial glass around a controlled plasma core.',
    price: 2600,
    accent: 0xb58cff,
    accentCss: '#b58cff',
    visualFill: 0.92,
    edition: 'optical',
    assetFolder: 'v7',
    assetSlug: 'voidforge',
  },
  {
    id: 'phoenix',
    name: 'PHOENIX EMBER',
    rarity: 'MYTHIC',
    description: 'A reborn flame protected by royal crown filigree.',
    price: 2100,
    accent: 0xff7b42,
    accentCss: '#ff9a62',
    visualFill: 0.8,
    edition: 'royal',
    assetFolder: 'v11',
    assetSlug: 'phoenix',
  },
  {
    id: 'frostglass',
    name: 'FROSTGLASS',
    rarity: 'CELESTIAL',
    description: 'Ancient glacial crystal bound in a silver regent frame.',
    price: 2400,
    accent: 0x7edcff,
    accentCss: '#8be0ff',
    visualFill: 0.8,
    edition: 'royal',
    assetFolder: 'v11',
    assetSlug: 'frostglass',
  },
  {
    id: 'nexus_crown',
    name: 'NEXUS CROWN',
    rarity: 'ETERNAL',
    description: 'The kingdom lattice focused through an amethyst core.',
    price: 2900,
    accent: 0xbc83ff,
    accentCss: '#c99dff',
    visualFill: 0.8,
    edition: 'royal',
    assetFolder: 'v11',
    assetSlug: 'nexus-crown',
  },
  {
    id: 'phoenix_optical',
    name: 'PHOENIX OPTICAL',
    rarity: 'ASCENDED',
    description: 'Seamless optical glass around a living phoenix current.',
    price: 3200,
    accent: 0xff7043,
    accentCss: '#ff8a65',
    visualFill: 0.92,
    edition: 'optical',
    assetFolder: 'v11',
    assetSlug: 'phoenix-optical',
  },
  {
    id: 'frostglass_optical',
    name: 'FROST OPTICAL',
    rarity: 'ASCENDED',
    description: 'A sixfold ice geometry suspended in dimensional glass.',
    price: 3500,
    accent: 0x69d4ff,
    accentCss: '#7cddff',
    visualFill: 0.92,
    edition: 'optical',
    assetFolder: 'v11',
    assetSlug: 'frostglass-optical',
  },
  {
    id: 'nexus_crown_optical',
    name: 'NEXUS OPTICAL',
    rarity: 'SOVEREIGN',
    description: 'Dimensional nexus rings aligned on the Crown singularity.',
    price: 4200,
    accent: 0xa96cff,
    accentCss: '#bd8cff',
    visualFill: 0.92,
    edition: 'optical',
    assetFolder: 'v11',
    assetSlug: 'nexus-crown-optical',
  },
] as const;

export function getOrbSkin(id: OrbSkinId): OrbSkinDef {
  return ORB_SKINS.find((skin) => skin.id === id) ?? ORB_SKINS[0];
}

export function orbTexture(skin: OrbSkinId, color: ColorKey): string {
  return `bubble_${skin}_${color}`;
}

/** Colour -> default original V6 Nova Glass texture key. */
export const SKIN: Record<ColorKey, string> = {
  red: 'bubble_nova_red',
  blue: 'bubble_nova_blue',
  green: 'bubble_nova_green',
  yellow: 'bubble_nova_yellow',
  purple: 'bubble_nova_purple',
  orange: 'bubble_nova_orange',
};

/**
 * If your real art lives in a texture atlas (candy.png + candy.json), set this
 * to the atlas key and make SKIN values the frame names inside it. makeSprite()
 * will then create sprites from that atlas automatically.
 */
export const ATLAS_KEY: string | null = null; // e.g. 'candy'

export const GRID = {
  cols: 11,
  baseRows: 5,
  gap: 2,
};

/** Level progression: each adds rows and colours. `colors` = how many of the
 *  6 colour keys are in play (a smaller palette is easier). */
export type LevelGoal = 'clear' | 'seals' | 'vines' | 'portal_cores' | 'embers' | 'ice_cores' | 'polarity_nodes' | 'boss';
export type WorldMechanic = 'none' | 'crystal' | 'vine' | 'portal' | 'ember' | 'ice' | 'polarity';

export interface BossConfig {
  name: string;
  hp: number;
  actionEvery: number;
}

export interface LevelDef {
  rows: number;
  colors: number;
  world: number;
  title: string;
  objective: string;
  targetScore: number;
  goal: LevelGoal;
  mechanic: WorldMechanic;
  mechanicCount: number;
  shotLimit?: number;
  boss?: BossConfig;
  act: 'crown' | 'echoes';
  masteryTier?: 1 | 2;
}

const LEVEL_GOALS: readonly LevelGoal[] = ['clear', 'seals', 'vines', 'portal_cores', 'embers', 'ice_cores', 'polarity_nodes', 'boss'];
const WORLD_MECHANICS: readonly WorldMechanic[] = ['none', 'crystal', 'vine', 'portal', 'ember', 'ice', 'polarity'];

export const LEVELS: LevelDef[] = campaignFixture.levels.map((entry, expectedIndex) => {
  if (entry.index !== expectedIndex || !LEVEL_GOALS.includes(entry.goal as LevelGoal) || !WORLD_MECHANICS.includes(entry.mechanic as WorldMechanic)) {
    throw new Error(`Invalid shared campaign level at index ${expectedIndex}`);
  }
  const boss = 'boss' in entry && entry.boss
    ? { name: entry.boss.name, hp: entry.boss.hp, actionEvery: entry.boss.actionEvery }
    : undefined;
  return {
    rows: entry.rows,
    colors: entry.colors,
    world: entry.world,
    title: entry.title,
    objective: entry.objective,
    targetScore: entry.targetScore,
    goal: entry.goal as LevelGoal,
    mechanic: entry.mechanic as WorldMechanic,
    mechanicCount: entry.mechanicCount,
    ...(entry.shotLimit > 0 ? { shotLimit: entry.shotLimit } : {}),
    ...(boss ? { boss } : {}),
    act: 'act' in entry && entry.act === 'echoes' ? 'echoes' : 'crown',
    ...('masteryTier' in entry && (entry.masteryTier === 1 || entry.masteryTier === 2)
      ? { masteryTier: entry.masteryTier }
      : {}),
  };
});

export type MapNodeKind = 'standard' | 'challenge' | 'elite' | 'mystery' | 'boss';
export interface MapNodeDef {
  level: number;
  kind: MapNodeKind;
  requires: readonly number[];
  reward: {
    source: typeof CLASSIC_FIRST_CLEAR_REWARD_SOURCE;
    currency: typeof CLASSIC_FIRST_CLEAR_REWARD_CURRENCY;
    amount: number;
    firstClearOnly: true;
    accountRequired: true;
  };
}

export type MapRewardAvailability = 'claimed' | 'locked' | 'account-required' | 'verification-pending' | 'available';

export interface WorldTheme {
  id: string;
  name: string;
  subtitle: string;
  background: string;
  accent: number;
  accentCss: string;
  shadow: number;
  levels: readonly number[];
  echoLevels: readonly number[];
}

const WORLD_PRESENTATION = [
  { background: 'world_crystal', shadow: 0x30205e },
  { background: 'world_emerald', shadow: 0x123f32 },
  { background: 'world_celestial', shadow: 0x263d79 },
  { background: 'world_ember', shadow: 0x611d2c },
  { background: 'world_frostbound', shadow: 0x102d59 },
  { background: 'world_nexus', shadow: 0x241448 },
] as const;

export const WORLD_THEMES: readonly WorldTheme[] = campaignFixture.worlds.map((world, expectedIndex) => {
  const presentation = WORLD_PRESENTATION[expectedIndex];
  if (!presentation || world.index !== expectedIndex || !/^#[0-9a-f]{6}$/i.test(world.accent) || world.levels.length !== 5 || world.echoLevels.length !== 2) {
    throw new Error(`Invalid shared campaign world at index ${expectedIndex}`);
  }
  return {
    id: world.id,
    name: world.name,
    subtitle: world.subtitle,
    background: presentation.background,
    accent: Number.parseInt(world.accent.slice(1), 16),
    accentCss: world.accent,
    shadow: presentation.shadow,
    levels: world.levels,
    echoLevels: world.echoLevels,
  };
});

const CROWN_MAP_NODES: readonly MapNodeDef[] = WORLD_THEMES.flatMap((world) => world.levels.map((level, index) => ({
  level,
  kind: (index === 4 ? 'boss' : index === 3 ? 'elite' : index === 1 ? 'mystery' : index === 2 ? 'challenge' : 'standard') as MapNodeKind,
  requires: index === 0
    ? (world.levels[0] === 0 ? [] : [WORLD_THEMES[LEVELS[level].world - 1].levels[4]])
    : [world.levels[index - 1]],
  reward: {
    source: CLASSIC_FIRST_CLEAR_REWARD_SOURCE,
    currency: CLASSIC_FIRST_CLEAR_REWARD_CURRENCY,
    amount: classicFirstClearReward(level),
    firstClearOnly: true,
    accountRequired: true,
  },
}))) as readonly MapNodeDef[];

const ECHO_MAP_NODES: readonly MapNodeDef[] = WORLD_THEMES.flatMap((world) => world.echoLevels.map((level, index) => ({
  level,
  kind: (index === 1 ? 'boss' : 'elite') as MapNodeKind,
  requires: index === 0 ? [17] : [world.echoLevels[index - 1]],
  reward: {
    source: CLASSIC_FIRST_CLEAR_REWARD_SOURCE,
    currency: CLASSIC_FIRST_CLEAR_REWARD_CURRENCY,
    amount: classicFirstClearReward(level),
    firstClearOnly: true,
    accountRequired: true,
  },
}))) as readonly MapNodeDef[];

export const MAP_NODES: readonly MapNodeDef[] = [...CROWN_MAP_NODES, ...ECHO_MAP_NODES];

export function mapNodeForLevel(level: number): MapNodeDef {
  return MAP_NODES.find((node) => node.level === level) ?? MAP_NODES[0];
}

/**
 * Player-facing campaign stage number in authored route order.
 *
 * Canonical level indices remain stable for saves, replays, rewards and API
 * payloads. The route interleaves legacy and expanded levels, so exposing the
 * raw index would make a realm appear to jump backwards and forwards.
 */
export function campaignStageNumber(level: number): number {
  const routeIndex = MAP_NODES.findIndex((node) => node.level === level);
  return routeIndex >= 0 ? routeIndex + 1 : Math.max(1, level + 1);
}

export function mapRewardLabel(reward: MapNodeDef['reward'], availability: MapRewardAvailability): string {
  if (availability === 'claimed') return 'CLAIMED';
  const amount = `◆ ${reward.amount}`;
  if (availability === 'account-required') return `SIGN IN ${amount}`;
  if (availability === 'verification-pending') return `VERIFY ${amount}`;
  if (availability === 'available') return `1ST CLEAR ${amount}`;
  return `LOCKED ${amount}`;
}

export function nextStoryLevel(level: number): number | null {
  const world = WORLD_THEMES[LEVELS[level]?.world ?? 0];
  if (LEVELS[level]?.act === 'echoes') {
    const echoIndex = world.echoLevels.indexOf(level);
    if (echoIndex >= 0 && echoIndex < world.echoLevels.length - 1) return world.echoLevels[echoIndex + 1];
    const nextEchoWorld = WORLD_THEMES[(LEVELS[level]?.world ?? 0) + 1];
    return nextEchoWorld?.echoLevels[0] ?? null;
  }
  const index = world.levels.indexOf(level);
  if (index >= 0 && index < world.levels.length - 1) return world.levels[index + 1];
  const nextWorld = WORLD_THEMES[(LEVELS[level]?.world ?? 0) + 1];
  return nextWorld?.levels[0] ?? null;
}

export function worldForLevel(level: number): WorldTheme {
  return WORLD_THEMES[LEVELS[Math.min(Math.max(0, level), LEVELS.length - 1)].world] ?? WORLD_THEMES[0];
}

/** Fixed design resolution (portrait). Phaser FIT-scales this to any screen. */
export const VIEW = { width: 720, height: 1280 };

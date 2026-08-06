import Phaser from 'phaser';
import { hostedAssetUrl } from '../game/hostedAsset';

export const UI_V16 = {
  panelWide: 'ui_v16_panel_wide',
  panelCompact: 'ui_v16_panel_compact',
  buttonPrimary: 'ui_v16_button_primary',
  buttonSecondary: 'ui_v16_button_secondary',
  medallion: 'ui_v16_medallion',
  crownBadge: 'ui_v16_crown_badge',
  counterCoins: 'ui_v16_counter_coins',
  counterHearts: 'ui_v16_counter_hearts',
  pause: 'ui_v16_pause',
  sound: 'ui_v16_sound',
  map: 'ui_v16_map',
  rewardChest: 'ui_v16_reward_chest',
  hud: 'ui_v16_hud',
  mapModes: 'ui_v16_map_modes',
  inventoryRewards: 'ui_v16_inventory_rewards',
  socialSystem: 'ui_v16_social_system',
  overlaysProgress: 'ui_v16_overlays_progress',
  controlsPrimitives: 'ui_v16_controls_primitives',
} as const;

export const UI_V16_FRAME = {
  hud: {
    score: 0, stage: 1, timer: 2, moves: 3,
    objective: 4, nextOrb: 5, combo: 6, danger: 7,
    pause: 8, sound: 9, hand: 10, touchAim: 11,
  },
  map: {
    standard: 0, mystery: 1, challenge: 2, elite: 3,
    boss: 4, locked: 5, current: 6, completed: 7,
    world: 8, junction: 9, classic: 10, rush: 11,
  },
  inventory: {
    coins: 0, crystal: 1, heart: 2, key: 3,
    wildcard: 4, aim: 5, bomb: 6, shield: 7,
    chestClosed: 8, chestOpen: 9, gift: 10, launcherSkin: 11,
  },
  social: {
    profile: 0, friends: 1, multiplayer: 2, invite: 3,
    chat: 4, leaderboard: 5, cloudSave: 6, online: 7,
    offline: 8, settings: 9, cameraHand: 10, quality: 11,
  },
  overlays: {
    chronicle: 0, tooltip: 1, toast: 2, tabSelected: 3,
    tabIdle: 4, progressTrack: 5, progressFill: 6, spinner: 7,
    objective: 8, victory: 9, defeat: 10, achievementClaim: 11,
  },
  controls: {
    back: 0, home: 1, close: 2, information: 3,
    help: 4, checked: 5, toggle: 6, slider: 7,
    scrollbar: 8, divider: 9, corners: 10, cursor: 11,
  },
} as const;

const CORE_IMAGES: ReadonlyArray<readonly [string, string]> = [
  [UI_V16.panelWide, 'assets/ui/v16/core/panel-wide.png'],
  [UI_V16.panelCompact, 'assets/ui/v16/core/panel-compact.png'],
  [UI_V16.buttonPrimary, 'assets/ui/v16/core/button-primary.png'],
  [UI_V16.buttonSecondary, 'assets/ui/v16/core/button-secondary.png'],
  [UI_V16.medallion, 'assets/ui/v16/core/medallion.png'],
  [UI_V16.crownBadge, 'assets/ui/v16/core/crown-badge.png'],
  [UI_V16.counterCoins, 'assets/ui/v16/core/counter-coins.png'],
  [UI_V16.counterHearts, 'assets/ui/v16/core/counter-hearts.png'],
  [UI_V16.pause, 'assets/ui/v16/core/button-pause.png'],
  [UI_V16.sound, 'assets/ui/v16/core/button-sound.png'],
  [UI_V16.map, 'assets/ui/v16/core/button-map.png'],
  [UI_V16.rewardChest, 'assets/ui/v16/core/reward-chest.png'],
];

const GRID_SHEETS: ReadonlyArray<readonly [string, string]> = [
  [UI_V16.hud, 'assets/ui/v16/paopao-hud-controls-transparent.webp'],
  [UI_V16.mapModes, 'assets/ui/v16/paopao-map-modes-transparent.webp'],
  [UI_V16.inventoryRewards, 'assets/ui/v16/paopao-inventory-rewards-transparent.webp'],
  [UI_V16.socialSystem, 'assets/ui/v16/paopao-social-system-transparent.webp'],
  [UI_V16.overlaysProgress, 'assets/ui/v16/paopao-overlays-progress-transparent.webp'],
  [UI_V16.controlsPrimitives, 'assets/ui/v16/paopao-controls-primitives-transparent.webp'],
];

export function queueV16UiArt(scene: Phaser.Scene): void {
  for (const [key, url] of CORE_IMAGES) {
    if (!scene.textures.exists(key)) scene.load.image(key, hostedAssetUrl(url));
  }
  for (const [key, url] of GRID_SHEETS) {
    if (!scene.textures.exists(key)) {
      scene.load.spritesheet(key, hostedAssetUrl(url), { frameWidth: 362, frameHeight: 362 });
    }
  }
}

export function hasV16UiArt(scene: Phaser.Scene, key: string): boolean {
  return scene.textures.exists(key);
}

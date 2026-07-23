import Phaser from 'phaser';
import { COLORS, COLOR_KEYS, getOrbSkin, orbTexture, VIEW, WORLD_THEMES } from '../config';
import { getMeta } from '../game/meta';
import { scheduleOnlineSync } from '../game/online';
import { makeOrbCanvas, makeSparkCanvas, makeBgCanvas } from '../gfx/textures';
import { DISPLAY_FONT, TYPE, UI_FONT } from '../gfx/ui';
import { PHASER_RELEASE_FEATURES } from '../game/release-profile';

const LOAD_STAGES = [
  { until: 0.08, label: 'RESTORING PLAYER PROFILE' },
  { until: 0.28, label: 'OPENING THE REALM ATLAS' },
  { until: 0.48, label: 'CHARGING THE ORB MATRIX' },
  { until: 0.66, label: 'PREPARING CROWN RELICS' },
  { until: 0.84, label: 'AWAKENING REALM GUARDIANS' },
  { until: 0.995, label: 'STOCKING THE REWARD VAULT' },
  { until: 1, label: 'THE KINGDOM IS READY' },
] as const;

const REALM_SHORT_NAMES = ['CRYSTAL', 'EMERALD', 'CELESTIAL', 'EMBER', 'FROST', 'NEXUS'] as const;

function loadStageFor(progress: number): string {
  return LOAD_STAGES.find((stage) => progress <= stage.until)?.label ?? LOAD_STAGES[LOAD_STAGES.length - 1].label;
}

function fileProgressLabel(key: string): string {
  if (key === 'intro_poster') return 'Framing the opening chapter';
  if (key.startsWith('world_')) {
    const worldName = key.replace('world_', '').replace('frostbound', 'frost').toUpperCase();
    return `Mapping ${worldName} realm`;
  }
  if (key.startsWith('bubble_')) return 'Tuning the equipped orb family';
  if (key.startsWith('ui_') || key === 'level_medallion') return 'Forging the royal interface';
  if (key.startsWith('power_') || key.startsWith('artifact_')) return 'Preparing crown relics';
  if (key.startsWith('mechanic_')) return 'Binding world mechanisms';
  if (key.startsWith('boss_')) return 'Awakening realm guardians';
  if (key.startsWith('mystery_') || key.startsWith('tier_') || key === 'coin_stack') return 'Stocking the reward vault';
  return 'Preparing the next chapter';
}

export class BootScene extends Phaser.Scene {
  private readonly failedAssetKeys = new Set<string>();

  constructor() {
    super('Boot');
  }

  preload(): void {
    this.failedAssetKeys.clear();

    const textResolution = Math.min(2, window.devicePixelRatio || 1);
    const loaderUi = this.add.container(0, 0);

    const loadingBg = this.add.graphics();
    loadingBg.fillGradientStyle(0x060716, 0x060716, 0x160d2a, 0x160d2a, 1);
    loadingBg.fillRect(0, 0, VIEW.width, VIEW.height);

    // Restrained architectural lines give the loader depth without sweep or shimmer effects.
    const architecture = this.add.graphics();
    architecture.lineStyle(1, 0xc59a50, 0.1);
    architecture.strokeCircle(VIEW.width / 2, 350, 176);
    architecture.strokeCircle(VIEW.width / 2, 350, 150);
    architecture.beginPath();
    architecture.moveTo(86, 90);
    architecture.lineTo(VIEW.width / 2, 246);
    architecture.lineTo(VIEW.width - 86, 90);
    architecture.strokePath();
    architecture.beginPath();
    architecture.moveTo(86, VIEW.height - 86);
    architecture.lineTo(VIEW.width / 2, VIEW.height - 206);
    architecture.lineTo(VIEW.width - 86, VIEW.height - 86);
    architecture.strokePath();

    const crest = this.add.graphics();
    crest.fillStyle(0x21143a, 0.95);
    crest.fillCircle(VIEW.width / 2, 350, 128);
    crest.lineStyle(2, 0xd2aa5e, 0.76);
    crest.strokeCircle(VIEW.width / 2, 350, 128);
    crest.lineStyle(1, 0x735798, 0.7);
    crest.strokeCircle(VIEW.width / 2, 350, 113);
    crest.fillStyle(0xd2aa5e, 0.96);
    crest.fillTriangle(326, 305, 339, 276, 351, 305);
    crest.fillTriangle(345, 305, 360, 267, 375, 305);
    crest.fillTriangle(369, 305, 382, 276, 394, 305);
    crest.fillRoundedRect(326, 302, 68, 11, 4);

    const title = this.add.text(VIEW.width / 2, 347, 'PAOPAO', {
      fontFamily: DISPLAY_FONT,
      fontSize: TYPE.hero,
      color: '#f0ddb3',
      fontStyle: 'bold',
      stroke: '#26143f',
      strokeThickness: 5,
      resolution: textResolution,
    }).setOrigin(0.5);
    const subtitle = this.add.text(VIEW.width / 2, 403, 'F U S I O N', {
      fontFamily: UI_FONT,
      fontSize: TYPE.body,
      color: '#d2aa5e',
      fontStyle: 'bold',
      letterSpacing: 5,
      resolution: textResolution,
    }).setOrigin(0.5);
    const chapter = this.add.text(VIEW.width / 2, 470, 'THE SHATTERED CROWN', {
      fontFamily: DISPLAY_FONT,
      fontSize: TYPE.caption,
      color: '#9f91b8',
      fontStyle: 'bold',
      letterSpacing: 3,
      resolution: textResolution,
    }).setOrigin(0.5);

    const realmHeading = this.add.text(VIEW.width / 2, 576, 'RESTORING THE SIX REALMS', {
      fontFamily: UI_FONT,
      fontSize: TYPE.label,
      color: '#b99a63',
      fontStyle: 'bold',
      letterSpacing: 2,
      resolution: textResolution,
    }).setOrigin(0.5);

    const realmRail = this.add.graphics();
    realmRail.lineStyle(1, 0x6d5635, 0.65);
    realmRail.beginPath();
    realmRail.moveTo(103, 640);
    realmRail.lineTo(VIEW.width - 103, 640);
    realmRail.strokePath();

    const realmSeals = WORLD_THEMES.map((world, index) => {
      const x = 102 + index * 103.2;
      const outer = this.add.circle(x, 640, 22, 0x0d1023, 1)
        .setStrokeStyle(2, 0x6d5635, 0.75);
      const core = this.add.circle(x, 640, 12, 0x211b30, 1)
        .setStrokeStyle(1, world.accent, 0.22);
      const label = this.add.text(x, 680, REALM_SHORT_NAMES[index], {
        fontFamily: UI_FONT,
        fontSize: TYPE.caption,
        color: '#665d75',
        fontStyle: 'bold',
        letterSpacing: 0.4,
        resolution: textResolution,
      }).setOrigin(0.5);
      return { outer, core, label, accent: world.accent, active: false };
    });

    const trackShadow = this.add.rectangle(VIEW.width / 2, 753, 454, 28, 0x03040c, 0.55);
    const track = this.add.rectangle(VIEW.width / 2, 751, 432, 16, 0x0e1123, 1)
      .setStrokeStyle(1, 0x8c6d3d, 0.9);
    const bar = this.add.graphics();
    const percent = this.add.text(VIEW.width / 2, 751, '0%', {
      fontFamily: UI_FONT,
      fontSize: TYPE.caption,
      color: '#ead5aa',
      fontStyle: 'bold',
      resolution: textResolution,
    }).setOrigin(0.5);
    const status = this.add.text(VIEW.width / 2, 797, LOAD_STAGES[0].label, {
      fontFamily: UI_FONT,
      fontSize: TYPE.label,
      color: '#e2c98f',
      fontStyle: 'bold',
      letterSpacing: 1.2,
      resolution: textResolution,
    }).setOrigin(0.5);
    const detail = this.add.text(VIEW.width / 2, 833, 'Reading local save and display settings', {
      fontFamily: UI_FONT,
      fontSize: TYPE.caption,
      color: '#827792',
      letterSpacing: 0.4,
      resolution: textResolution,
    }).setOrigin(0.5);
    const recovery = this.add.text(VIEW.width / 2, 870, '', {
      fontFamily: UI_FONT,
      fontSize: TYPE.caption,
      color: '#c59a50',
      fontStyle: 'bold',
      align: 'center',
      wordWrap: { width: VIEW.width - 72, useAdvancedWrap: true },
      resolution: textResolution,
    }).setOrigin(0.5);
    const attribution = this.add.text(VIEW.width / 2, VIEW.height - 76, 'POWERED BY RAFAYGEN AI', {
      fontFamily: UI_FONT,
      fontSize: TYPE.caption,
      color: '#766886',
      fontStyle: 'bold',
      letterSpacing: 2,
      resolution: textResolution,
    }).setOrigin(0.5);

    loaderUi.add([
      loadingBg,
      architecture,
      crest,
      title,
      subtitle,
      chapter,
      realmHeading,
      realmRail,
      ...realmSeals.flatMap((seal) => [seal.outer, seal.core, seal.label]),
      trackShadow,
      track,
      bar,
      percent,
      status,
      detail,
      recovery,
      attribution,
    ]);

    const renderProgress = (rawProgress: number): void => {
      const progress = Phaser.Math.Clamp(rawProgress, 0, 1);
      const fillWidth = 428 * progress;
      bar.clear();
      if (fillWidth > 0) {
        bar.fillGradientStyle(0x9b7137, 0xd8b662, 0x80562c, 0xb38a46, 1);
        bar.fillRoundedRect(VIEW.width / 2 - 214, 746, fillWidth, 10, Math.min(5, fillWidth / 2));
      }
      percent.setText(`${Math.round(progress * 100)}%`);
      status.setText(loadStageFor(progress));

      realmSeals.forEach((seal, index) => {
        const isActive = progress >= (index + 1) / realmSeals.length;
        if (isActive === seal.active) return;
        seal.active = isActive;
        seal.outer.setStrokeStyle(2, isActive ? 0xd2aa5e : 0x6d5635, isActive ? 1 : 0.75);
        seal.core.setFillStyle(isActive ? seal.accent : 0x211b30, isActive ? 0.78 : 1);
        seal.core.setStrokeStyle(1, isActive ? 0xe0bd72 : seal.accent, isActive ? 0.95 : 0.22);
        seal.label.setColor(isActive ? '#d8bd83' : '#665d75');
      });
    };

    const onProgress = (value: number): void => renderProgress(value);
    const onFileProgress = (file: Phaser.Loader.File, value: number): void => {
      detail.setText(`${fileProgressLabel(String(file.key))}  ·  ${Math.round(Phaser.Math.Clamp(value, 0, 1) * 100)}%`);
    };
    const onLoadError = (file: Phaser.Loader.File): void => {
      this.failedAssetKeys.add(String(file.key));
      recovery.setText(`RECOVERY MODE  ·  ${this.failedAssetKeys.size} ART ASSET${this.failedAssetKeys.size === 1 ? '' : 'S'} WILL USE FALLBACKS`);
    };
    const onComplete = (): void => {
      renderProgress(1);
      this.load.off('progress', onProgress);
      this.load.off('fileprogress', onFileProgress);
      this.load.off('loaderror', onLoadError);
      loaderUi.destroy(true);
    };

    this.load.on('progress', onProgress);
    this.load.on('fileprogress', onFileProgress);
    this.load.on('loaderror', onLoadError);
    this.load.once('complete', onComplete);
    renderProgress(0);

    // The DOM splash listens for this exact point so it only fades once Phaser
    // has a fully drawn boot surface underneath it.
    window.dispatchEvent(new window.CustomEvent('paopao:boot-visible'));

    // A portrait frame from the shipped cinematic keeps the poster-to-video
    // handoff compositionally exact and avoids decoding the larger key art.
    if (PHASER_RELEASE_FEATURES.cinematicPresentation) {
      this.load.image('intro_poster', 'assets/cinematics/previews-v2/frame-00750ms.jpg');
    }
    this.load.image('world_crystal', 'assets/worlds/v3/world-crystal-hd.jpg');
    this.load.image('world_emerald', 'assets/worlds/v3/world-emerald-hd.jpg');
    this.load.image('world_celestial', 'assets/worlds/v3/world-celestial-hd.jpg');
    this.load.image('world_ember', 'assets/worlds/v3/world-ember-hd.jpg');
    this.load.image('world_frostbound', 'assets/worlds/v9/world-frostbound-hd.jpg');
    this.load.image('world_nexus', 'assets/worlds/v9/world-nexus-hd.jpg');
    this.load.image('level_medallion', 'assets/ui/v3/level-medallion-hd.png');
    // Boot only the equipped family. The Prize Vault streams the other skin
    // collections on demand so the first playable screen arrives quickly.
    const activeSkin = getMeta().equippedSkin;
    const activeSkinDef = getOrbSkin(activeSkin);
    for (const color of COLOR_KEYS) {
      this.load.image(
        orbTexture(activeSkin, color),
        `assets/sprites/${activeSkinDef.assetFolder}/${activeSkinDef.assetSlug}-${color}.png`,
      );
    }
    this.load.image('power_bomb', 'assets/sprites/v3/power-bomb-hd.png');
    this.load.image('power_rainbow', 'assets/sprites/v3/power-rainbow-hd.png');
    this.load.image('crystal_launcher', 'assets/sprites/v3/crystal-launcher-hd.png');
    this.load.image('artifact_chrono', 'assets/sprites/v4/artifact-chrono-prism.png');
    this.load.image('artifact_phoenix', 'assets/sprites/v4/artifact-phoenix-crown.png');
    this.load.image('artifact_void', 'assets/sprites/v4/artifact-void-compass.png');
    this.load.image('artifact_fortune', 'assets/sprites/v4/artifact-fortune-idol.png');
    this.load.image('mechanic_crystal_seal', 'assets/sprites/v8/mechanic-crystal-seal.png');
    this.load.image('mechanic_vine_bind', 'assets/sprites/v8/mechanic-vine-bind.png');
    this.load.image('mechanic_celestial_portal', 'assets/sprites/v8/mechanic-celestial-portal.png');
    this.load.image('mechanic_ember_core', 'assets/sprites/v8/mechanic-ember-core.png');
    this.load.image('boss_prism', 'assets/sprites/v8/boss-prism-warden.png');
    this.load.image('boss_heartwood', 'assets/sprites/v8/boss-heartwood-guardian.png');
    this.load.image('boss_astral', 'assets/sprites/v8/boss-astral-sentinel.png');
    this.load.image('boss_inferno', 'assets/sprites/v8/boss-inferno-sovereign.png');
    this.load.image('mechanic_ice_armor', 'assets/sprites/v9/mechanic-ice-armor.png');
    this.load.image('mechanic_polarity_ring', 'assets/sprites/v9/mechanic-polarity-ring.png');
    this.load.image('boss_frost', 'assets/sprites/v9/boss-frost-regent.png');
    this.load.image('boss_nexus', 'assets/sprites/v9/boss-nexus-architect.png');
    this.load.image('mystery_chest_closed', 'assets/ui/v6/mystery-chest-closed.png');
    this.load.image('coin_stack', 'assets/ui/v6/coin-stack.png');
    this.load.image('tier_bronze', 'assets/ui/v6/tier-bronze.png');
    this.load.image('tier_silver', 'assets/ui/v6/tier-silver.png');
    this.load.image('tier_gold', 'assets/ui/v6/tier-gold.png');
    this.load.image('tier_prismatic', 'assets/ui/v6/tier-prismatic.png');
  }

  create(): void {
    // Background fallback keeps the first playable screen resilient when a
    // network cache is incomplete. Other worlds retain Phaser's missing-asset
    // reporting so an incomplete production deployment remains detectable.
    if (!this.textures.exists('world_crystal')) {
      this.textures.addCanvas('world_crystal', makeBgCanvas(VIEW.width, VIEW.height));
    }
    // particle
    if (!this.textures.exists('spark')) {
      this.textures.addCanvas('spark', makeSparkCanvas(32));
    }
    // Bounded recovery orbs are created only when a production sprite failed.
    const activeSkin = getMeta().equippedSkin;
    for (const color of COLOR_KEYS) {
      const key = orbTexture(activeSkin, color);
      if (!this.textures.exists(key)) {
        this.textures.addCanvas(key, makeOrbCanvas(COLORS[color].hex, 256));
      }
      this.textures.get(key).setFilter(Phaser.Textures.FilterMode.LINEAR);
    }
    if (this.failedAssetKeys.size > 0) {
      console.warn(`[PaoPao] Boot continued with ${this.failedAssetKeys.size} unavailable art asset(s).`, [...this.failedAssetKeys]);
    }
    scheduleOnlineSync(0);
    this.scene.start(PHASER_RELEASE_FEATURES.cinematicPresentation ? 'Intro' : 'Menu');
  }
}

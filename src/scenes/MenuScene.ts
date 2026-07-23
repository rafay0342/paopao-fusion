import Phaser from 'phaser';
import { COLOR_KEYS, LEVELS, ORB_SKINS, orbTexture, VIEW } from '../config';
import { getProgress, totalStars } from '../game/progression';
import { getArtifact, getMeta, getTierProgress } from '../game/meta';
import { SFX } from '../game/sfx';
import { getAccountSnapshot } from '../game/online';
import { getMusicState, startMusic, toggleMusic } from '../game/music';
import { PHASER_RELEASE_FEATURES } from '../game/release-profile';
import {
  addAmbientMotes,
  addArtButton,
  addArtPanel,
  addIconFrame,
  addWorldBackground,
  DISPLAY_FONT,
  fitText,
  sharpenSceneText,
  TYPE,
  UI_COLORS,
  UI_FONT,
} from '../gfx/ui';

export class MenuScene extends Phaser.Scene {
  constructor() {
    super('Menu');
  }

  create(): void {
    const { width, height } = VIEW;
    const progress = getProgress();
    const meta = getMeta();
    const account = getAccountSnapshot();
    const artifact = getArtifact(meta.equippedArtifact);
    const skin = ORB_SKINS.find(({ id }) => id === meta.equippedSkin) ?? ORB_SKINS[0];
    const tierProgress = getTierProgress(meta);
    const reducedMotion = typeof window !== 'undefined'
      && typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const addFacetRail = (
      x: number,
      y: number,
      railWidth: number,
      railHeight: number,
      accent: number,
      depth = 7,
    ): Phaser.GameObjects.Container => {
      const rail = this.add.container(x, y).setDepth(depth);
      const art = this.add.graphics();
      const points = [
        { x: -railWidth / 2 + 24, y: -railHeight / 2 },
        { x: railWidth / 2 - 34, y: -railHeight / 2 },
        { x: railWidth / 2, y: -railHeight / 2 + 22 },
        { x: railWidth / 2, y: railHeight / 2 - 14 },
        { x: railWidth / 2 - 16, y: railHeight / 2 },
        { x: -railWidth / 2 + 30, y: railHeight / 2 },
        { x: -railWidth / 2, y: railHeight / 2 - 20 },
        { x: -railWidth / 2, y: -railHeight / 2 + 14 },
      ];
      art.fillStyle(0x01030a, 0.5);
      art.fillPoints(points.map((point) => ({ x: point.x + 3, y: point.y + 7 })), true);
      art.fillStyle(UI_COLORS.surface, 0.94);
      art.fillPoints(points, true);
      art.lineStyle(1, UI_COLORS.quietBorder, 0.92);
      art.strokePoints(points, true);
      art.fillStyle(accent, 0.12);
      art.fillTriangle(-railWidth / 2, -railHeight / 2 + 14, -railWidth / 2 + 56, -railHeight / 2, -railWidth / 2, railHeight / 2 - 20);
      art.fillStyle(UI_COLORS.gold, 0.1);
      art.fillTriangle(railWidth / 2 - 34, -railHeight / 2, railWidth / 2, -railHeight / 2 + 22, railWidth / 2, railHeight / 2 - 14);
      art.lineStyle(2, accent, 0.7);
      art.lineBetween(-railWidth / 2 + 26, -railHeight / 2 + 1, -railWidth / 2 + Math.min(138, railWidth * 0.28), -railHeight / 2 + 1);
      art.lineStyle(2, UI_COLORS.gold, 0.62);
      art.lineBetween(railWidth / 2 - Math.min(112, railWidth * 0.2), railHeight / 2 - 1, railWidth / 2 - 18, railHeight / 2 - 1);
      rail.add(art);
      return rail;
    };

    startMusic('menu');
    SFX.setMuted(getMusicState().muted);

    const revealText = (text: Phaser.GameObjects.Text, delay: number, rise = 12): Phaser.GameObjects.Text => {
      if (reducedMotion) return text;
      const targetY = text.y;
      text.setY(targetY + rise).setAlpha(0);
      this.tweens.add({ targets: text, y: targetY, alpha: 1, delay, duration: 390, ease: 'Cubic.easeOut' });
      return text;
    };

    const addActionButton = (
      parent: Phaser.GameObjects.Container | null,
      x: number,
      y: number,
      buttonWidth: number,
      label: string,
      accent: number,
      action: () => void,
      buttonHeight = 64,
    ): Phaser.GameObjects.Container => {
      const button = this.add.container(x, y);
      const surface = this.add.graphics();
      const drawSurface = (hovered = false): void => {
        surface.clear();
        const notch = Math.min(13, buttonHeight * 0.2);
        const points = [
          { x: -buttonWidth / 2 + notch, y: -buttonHeight / 2 },
          { x: buttonWidth / 2 - notch * 1.8, y: -buttonHeight / 2 },
          { x: buttonWidth / 2, y: -buttonHeight / 2 + notch },
          { x: buttonWidth / 2 - notch * 0.45, y: buttonHeight / 2 },
          { x: -buttonWidth / 2 + notch * 1.5, y: buttonHeight / 2 },
          { x: -buttonWidth / 2, y: buttonHeight / 2 - notch },
        ];
        surface.fillStyle(hovered ? 0x102b3d : UI_COLORS.surface, 0.98);
        surface.fillPoints(points, true);
        surface.lineStyle(hovered ? 2 : 1, hovered ? accent : UI_COLORS.quietBorder, hovered ? 0.88 : 0.92);
        surface.strokePoints(points, true);
        surface.fillStyle(accent, hovered ? 0.16 : 0.08);
        surface.fillTriangle(-buttonWidth / 2, buttonHeight / 2 - notch, -buttonWidth / 2 + notch, -buttonHeight / 2, -buttonWidth / 2 + 44, buttonHeight / 2);
        surface.lineStyle(2, accent, hovered ? 0.74 : 0.42);
        surface.lineBetween(-buttonWidth / 2 + 16, -buttonHeight / 2 + 1, -buttonWidth / 2 + 58, -buttonHeight / 2 + 1);
        surface.lineStyle(2, UI_COLORS.gold, hovered ? 0.72 : 0.42);
        surface.lineBetween(buttonWidth / 2 - 48, buttonHeight / 2 - 1, buttonWidth / 2 - 12, buttonHeight / 2 - 1);
      };
      drawSurface();
      const buttonText = this.add.text(0, 0, label, {
        fontFamily: UI_FONT,
        fontSize: TYPE.label,
        color: Phaser.Display.Color.IntegerToColor(accent).rgba,
        fontStyle: 'bold',
        letterSpacing: 0.55,
        align: 'center',
      }).setOrigin(0.5).setShadow(0, 2, '#02040c', 4);
      fitText(buttonText, buttonWidth - 18, 0.88);
      button.add([surface, buttonText]);
      button.setSize(buttonWidth, Math.max(64, buttonHeight)).setInteractive({ useHandCursor: true });
      button.on('pointerover', () => drawSurface(true));
      button.on('pointerout', () => {
        drawSurface();
        button.setScale(1);
      });
      button.on('pointerdown', () => button.setScale(0.975));
      button.on('pointerup', () => {
        button.setScale(1);
        SFX.click();
        action();
      });
      if (parent) parent.add(button);
      else button.setDepth(12);
      return button;
    };

    this.cameras.main.fadeIn(reducedMotion ? 0 : 220, 3, 5, 19);
    addWorldBackground(this, 'world_crystal', 0.2);
    addAmbientMotes(this, 0x62f3ef, 5, 2);

    // Cropped edge bubbles bring the collection identity into the composition
    // without another animated layer.
    const edgeOrbs = [
      { x: 18, y: 327, size: 68, color: 0 },
      { x: width - 16, y: 507, size: 76, color: 2 },
      { x: 20, y: 835, size: 60, color: 4 },
    ];
    edgeOrbs.forEach((entry) => {
      const texture = orbTexture(meta.equippedSkin, COLOR_KEYS[entry.color % COLOR_KEYS.length]);
      this.add.image(entry.x, entry.y, texture)
        .setDisplaySize(entry.size, entry.size)
        .setAlpha(0.28)
        .setDepth(3);
    });

    // Compact status bar: all durable account information lives in one zone.
    addFacetRail(width / 2, 51, width - 24, 78, tierProgress.tier.accent, 7);
    this.add.image(48, 51, tierProgress.tier.texture).setDisplaySize(60, 60).setDepth(9);
    this.add.text(84, 27, tierProgress.tier.id.toUpperCase(), {
      fontFamily: UI_FONT,
      fontSize: TYPE.caption,
      color: tierProgress.tier.accentCss,
      fontStyle: 'bold',
      letterSpacing: 1,
    }).setOrigin(0, 0).setDepth(9).setShadow(0, 2, '#000000', 4);
    const accountText = this.add.text(
      84,
      51,
      `${account.displayName}  •  ${account.connection === 'online' ? 'CLOUD' : account.connection === 'guest' ? 'GUEST' : 'OFFLINE SAFE'}`,
      {
        fontFamily: UI_FONT,
        fontSize: TYPE.caption,
        color: account.connection === 'online' ? '#8fffd0' : '#ffc879',
        fontStyle: 'bold',
      },
    ).setOrigin(0, 0).setDepth(9).setShadow(0, 2, '#000000', 4);
    fitText(accountText, 360, 0.78);

    this.add.text(width - 28, 25, `◆  ${meta.coins.toLocaleString()}`, {
      fontFamily: UI_FONT,
      fontSize: TYPE.body,
      color: '#ffdc64',
      fontStyle: 'bold',
      stroke: '#151224',
      strokeThickness: 3,
    }).setOrigin(1, 0).setDepth(9);
    const soundText = this.add.text(width - 28, 53, getMusicState().muted ? '♪  SOUND OFF' : '♪  SOUND ON', {
      fontFamily: UI_FONT,
      fontSize: TYPE.caption,
      color: '#9deff1',
      fontStyle: 'bold',
      padding: { x: 6, y: 6 },
    }).setOrigin(1, 0).setDepth(9).setInteractive({ useHandCursor: true });
    soundText.on('pointerup', () => {
      const music = toggleMusic();
      SFX.setMuted(music.muted);
      soundText.setText(music.muted ? '♪  SOUND OFF' : '♪  SOUND ON');
      if (!music.muted) SFX.click();
    });

    // One title and one primary action define the first reading order.
    revealText(this.add.text(width / 2, 117, 'THE SHATTERED CROWN', {
      fontFamily: UI_FONT,
      fontSize: TYPE.label,
      color: '#e6c982',
      fontStyle: 'bold',
      letterSpacing: 2.2,
    }).setOrigin(0.5).setDepth(10).setShadow(0, 2, '#000000', 5), 40, 8);
    revealText(this.add.text(width / 2, 174, 'PAOPAO', {
      fontFamily: DISPLAY_FONT,
      fontSize: TYPE.hero,
      color: '#f5e4bb',
      fontStyle: 'bold',
      stroke: '#2d174c',
      strokeThickness: 7,
    }).setOrigin(0.5).setDepth(10).setShadow(0, 6, '#08030f', 12), 80, 16);
    revealText(this.add.text(width / 2, 241, 'F U S I O N', {
      fontFamily: UI_FONT,
      fontSize: TYPE.section,
      color: '#62f3ef',
      fontStyle: 'bold',
      stroke: '#073f50',
      strokeThickness: 4,
      letterSpacing: 5,
    }).setOrigin(0.5).setDepth(10).setShadow(0, 3, '#000000', 6), 120, 10);

    addArtButton(this, width / 2, 322, progress.unlocked > 1 ? 'CONTINUE ADVENTURE' : 'BEGIN ADVENTURE', () => {
      SFX.click();
      this.cameras.main.fadeOut(reducedMotion ? 0 : 200, 3, 5, 19);
      this.time.delayedCall(reducedMotion ? 0 : 210, () => this.scene.start('ModeSelect'));
    }, 380, 84, 12);
    const progressText = revealText(this.add.text(
      width / 2,
      385,
      `${progress.unlocked} / ${LEVELS.length} LEVELS OPEN   •   ${totalStars(progress)} / ${LEVELS.length * 3} STARS`,
      {
        fontFamily: UI_FONT,
        fontSize: TYPE.label,
        color: '#ffe7a6',
        fontStyle: 'bold',
        letterSpacing: 0.8,
      },
    ).setOrigin(0.5).setDepth(12), 180, 8);
    fitText(progressText, 600);

    // The launcher is the only large illustration and sits in an open visual
    // field. Its motion is a restrained idle breath, with no glint overlay.
    const hero = this.add.container(width / 2, 618).setDepth(6);
    const heroSigil = this.add.graphics();
    const sigilPoints = [
      { x: 0, y: -158 }, { x: 122, y: -86 }, { x: 130, y: 68 },
      { x: 0, y: 148 }, { x: -130, y: 68 }, { x: -122, y: -86 },
    ];
    heroSigil.lineStyle(2, artifact.accent, 0.3);
    heroSigil.strokePoints(sigilPoints, true);
    heroSigil.lineStyle(1, UI_COLORS.gold, 0.22);
    heroSigil.strokeCircle(0, -8, 116);
    heroSigil.fillStyle(artifact.accent, 0.07);
    heroSigil.fillTriangle(0, -158, 48, -130, -48, -130);
    heroSigil.fillStyle(UI_COLORS.gold, 0.08);
    heroSigil.fillTriangle(-130, 68, -92, 112, -68, 42);
    const heroHalo = this.add.circle(0, -54, 112, 0x2cced8, 0.07)
      .setStrokeStyle(1, 0xd9ad55, 0.2);
    const heroGround = this.add.ellipse(0, 112, 250, 54, 0x02040c, 0.48);
    const launcher = this.add.image(0, 0, 'crystal_launcher').setDisplaySize(300, 300);
    const heroBubble = this.add.image(0, -80, orbTexture(meta.equippedSkin, 'blue')).setDisplaySize(94, 94);
    const heroBubbleLeft = this.add.image(-96, -28, orbTexture(meta.equippedSkin, 'purple')).setDisplaySize(42, 42).setAlpha(0.7);
    const heroBubbleRight = this.add.image(101, -2, orbTexture(meta.equippedSkin, 'green')).setDisplaySize(34, 34).setAlpha(0.58);
    hero.add([heroSigil, heroHalo, heroGround, launcher, heroBubble, heroBubbleLeft, heroBubbleRight]);
    if (!reducedMotion) {
      hero.setY(hero.y + 18).setAlpha(0).setScale(0.94);
      this.tweens.add({
        targets: hero,
        y: 608,
        alpha: 1,
        scale: 1,
        delay: 110,
        duration: 520,
        ease: 'Cubic.easeOut',
        onComplete: () => this.tweens.add({
          targets: hero,
          y: 602,
          duration: 2200,
          yoyo: true,
          repeat: -1,
          ease: 'Sine.easeInOut',
        }),
      });
    }

    // Equipment context is preserved as one quiet information strip instead
    // of a second promotional card.
    addFacetRail(width / 2, 811, 590, 76, artifact.accent, 7);
    addIconFrame(this, 101, 811, 48, skin.accent, 8, true);
    this.add.image(101, 811, orbTexture(meta.equippedSkin, 'blue')).setDisplaySize(38, 38).setDepth(9);
    addIconFrame(this, width - 101, 811, 48, artifact.accent, 8, true);
    this.add.image(width - 101, 811, artifact.texture).setDisplaySize(40, 40).setDepth(9);
    const equipmentLine = this.add.text(width / 2, 796, `${skin.name}   •   ${artifact.name}`, {
      fontFamily: UI_FONT,
      fontSize: TYPE.label,
      color: '#dce8f5',
      fontStyle: 'bold',
      letterSpacing: 0.65,
    }).setOrigin(0.5).setDepth(9);
    fitText(equipmentLine, 424, 0.88);
    const artifactLine = this.add.text(width / 2, 823, artifact.superName, {
      fontFamily: UI_FONT,
      fontSize: TYPE.caption,
      color: '#b8a6e6',
      fontStyle: 'bold',
      letterSpacing: 0.7,
    }).setOrigin(0.5).setDepth(9);
    fitText(artifactLine, 424, 0.88);

    // Secondary destinations are built once, then hidden behind MORE. The
    // full-screen input shield prevents clicks leaking into the menu beneath.
    const moreLayer = this.add.container(0, 0).setDepth(40).setVisible(false);
    let moreOpen = false;
    const closeMore = (): void => {
      if (!moreOpen) return;
      moreOpen = false;
      this.tweens.killTweensOf(moreLayer);
      if (reducedMotion) {
        moreLayer.setVisible(false);
        return;
      }
      this.tweens.add({
        targets: moreLayer,
        alpha: 0,
        y: 16,
        duration: 150,
        ease: 'Quad.easeIn',
        onComplete: () => moreLayer.setVisible(false),
      });
    };
    const openMore = (): void => {
      if (moreOpen) return;
      moreOpen = true;
      this.tweens.killTweensOf(moreLayer);
      moreLayer.setVisible(true);
      if (reducedMotion) {
        moreLayer.setAlpha(1).setY(0);
        return;
      }
      moreLayer.setAlpha(0).setY(20);
      this.tweens.add({ targets: moreLayer, alpha: 1, y: 0, duration: 190, ease: 'Cubic.easeOut' });
    };

    const modalShield = this.add.rectangle(width / 2, height / 2, width, height, 0x02040c, 0.78)
      .setInteractive({ useHandCursor: true });
    modalShield.on('pointerup', () => {
      SFX.click();
      closeMore();
    });
    const modalPanel = addArtPanel(this, width / 2, 700, 646, 620, 0, 0.99)
      .setSize(646, 620)
      .setInteractive();
    const modalTitle = this.add.text(width / 2, 444, 'KEEPER SERVICES', {
      fontFamily: DISPLAY_FONT,
      fontSize: TYPE.title,
      color: '#f1dcaa',
      fontStyle: 'bold',
      letterSpacing: 1.5,
    }).setOrigin(0.5);
    const modalRule = this.add.rectangle(width / 2, 480, 170, 2, 0xd9ad55, 0.72);
    moreLayer.add([modalShield, modalPanel, modalTitle, modalRule]);
    addActionButton(moreLayer, 205, 570, 276, 'ACCOUNT', 0xd2c1ff, () => this.scene.start('Account'), 72);
    if (PHASER_RELEASE_FEATURES.completeGameplay) {
      addActionButton(moreLayer, 515, 570, 276, 'STORE', 0xffe7a6, () => this.scene.start('Store'), 72);
      addActionButton(moreLayer, 205, 676, 276, 'CHALLENGES', 0x8fffd0, () => this.scene.start('Challenges'), 72);
      addActionButton(moreLayer, width / 2, 782, 586, 'RANKINGS', 0xffc879, () => this.scene.start('Competitive'), 72);
    }
    if (PHASER_RELEASE_FEATURES.cinematicPresentation) {
      addActionButton(moreLayer, 515, 676, 276, 'GALLERY', 0x79e9ff, () => this.scene.start('Gallery'), 72);
    }
    addActionButton(moreLayer, width / 2, 906, 220, 'CLOSE', 0xaab8cf, closeMore, 62);

    // One compact row is the complete always-visible navigation surface.
    addFacetRail(width / 2, 988, 664, 144, UI_COLORS.cyan, 7);
    this.add.text(width / 2, 944, 'KEEPER HUB', {
      fontFamily: UI_FONT,
      fontSize: TYPE.caption,
      color: '#e6c982',
      fontStyle: 'bold',
      letterSpacing: 2.5,
    }).setOrigin(0.5).setDepth(9);
    if (PHASER_RELEASE_FEATURES.completeGameplay) {
      addActionButton(null, 120, 1009, 148, 'CHRONICLE', 0x79e9ff, () => this.scene.start('Chronicle', { returnScene: 'Menu' }), 72);
      addActionButton(null, 280, 1009, 148, 'INVENTORY', 0x8fffd0, () => this.scene.start('Inventory'), 72);
      addActionButton(null, 440, 1009, 148, 'PRIZE VAULT', 0xffe7a6, () => this.scene.start('Rewards'), 72);
      addActionButton(null, 600, 1009, 148, 'MORE', 0xd2c1ff, openMore, 72);
    } else {
      addActionButton(null, width / 2, 1009, 300, 'ACCOUNT & SETTINGS', 0xd2c1ff, openMore, 72);
    }

    const handleEscape = (): void => {
      if (moreOpen) {
        SFX.click();
        closeMore();
      }
    };
    this.input.keyboard?.on('keydown-ESC', handleEscape);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.input.keyboard?.off('keydown-ESC', handleEscape);
    });

    sharpenSceneText(this);
  }
}

import Phaser from 'phaser';
import { COLORS, COLOR_KEYS, getOrbSkin, orbTexture, VIEW, WORLD_THEMES } from '../config';
import { ARTIFACTS, equipArtifact, getMeta } from '../game/meta';
import { getProgress, totalStars } from '../game/progression';
import { SFX } from '../game/sfx';
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

function addWorldCrystalIdentity(
  scene: Phaser.Scene,
  x: number,
  y: number,
  accent: number,
  index: number,
  unlocked: boolean,
): void {
  const art = scene.add.graphics().setDepth(9);
  const alpha = unlocked ? 0.13 : 0.035;
  const leftShard = index % 2 === 0
    ? [{ x: x - 96, y: y - 72 }, { x: x - 72, y: y - 84 }, { x: x - 68, y: y + 68 }, { x: x - 96, y: y + 82 }]
    : [{ x: x - 96, y: y - 82 }, { x: x - 70, y: y - 66 }, { x: x - 76, y: y + 80 }, { x: x - 96, y: y + 62 }];
  art.fillStyle(accent, alpha);
  art.fillPoints(leftShard, true);
  art.lineStyle(1, accent, unlocked ? 0.38 : 0.12);
  art.strokePoints(leftShard, true);

  const runeX = x + 90;
  const runeY = y - 70;
  const runeSize = 5 + index % 3;
  art.fillStyle(unlocked ? accent : UI_COLORS.quietBorder, unlocked ? 0.58 : 0.22);
  art.fillPoints([
    { x: runeX, y: runeY - runeSize }, { x: runeX + runeSize, y: runeY },
    { x: runeX, y: runeY + runeSize }, { x: runeX - runeSize, y: runeY },
  ], true);
  art.lineStyle(1, unlocked ? UI_COLORS.gold : UI_COLORS.quietBorder, unlocked ? 0.34 : 0.12);
  art.lineBetween(x + 70, y + 80, x + 96, y + 60);
}

function addWorldPictureFrame(
  scene: Phaser.Scene,
  x: number,
  y: number,
  accent: number,
  unlocked: boolean,
): void {
  const art = scene.add.graphics().setPosition(x, y).setDepth(11);
  const halfWidth = 87;
  const halfHeight = 50;
  const cut = 12;
  const frame = [
    { x: -halfWidth + cut, y: -halfHeight }, { x: halfWidth - cut, y: -halfHeight },
    { x: halfWidth, y: -halfHeight + cut }, { x: halfWidth, y: halfHeight - cut },
    { x: halfWidth - cut, y: halfHeight }, { x: -halfWidth + cut, y: halfHeight },
    { x: -halfWidth, y: halfHeight - cut }, { x: -halfWidth, y: -halfHeight + cut },
  ];
  art.fillStyle(0x050814, unlocked ? 0.06 : 0.38);
  art.fillPoints(frame, true);

  // Opaque corner facets visually clip the rectangular source image into the
  // same cut-crystal language as the surrounding card.
  art.fillStyle(0x050814, unlocked ? 0.88 : 0.96);
  art.fillPoints([{ x: -halfWidth, y: -halfHeight }, { x: -halfWidth + cut, y: -halfHeight }, { x: -halfWidth, y: -halfHeight + cut }], true);
  art.fillPoints([{ x: halfWidth, y: -halfHeight }, { x: halfWidth - cut, y: -halfHeight }, { x: halfWidth, y: -halfHeight + cut }], true);
  art.fillPoints([{ x: halfWidth, y: halfHeight }, { x: halfWidth - cut, y: halfHeight }, { x: halfWidth, y: halfHeight - cut }], true);
  art.fillPoints([{ x: -halfWidth, y: halfHeight }, { x: -halfWidth + cut, y: halfHeight }, { x: -halfWidth, y: halfHeight - cut }], true);
  art.lineStyle(2, accent, unlocked ? 0.52 : 0.14);
  art.strokePoints(frame, true);
  art.lineStyle(1, UI_COLORS.gold, unlocked ? 0.26 : 0.08);
  art.lineBetween(-22, -halfHeight, 18, -halfHeight);
}

function addArtifactPedestal(
  scene: Phaser.Scene,
  x: number,
  y: number,
  accent: number,
  owned: boolean,
  equipped: boolean,
): void {
  const art = scene.add.graphics().setDepth(9);
  art.lineStyle(equipped ? 2 : 1, equipped ? UI_COLORS.gold : accent, equipped ? 0.74 : owned ? 0.34 : 0.14);
  art.lineBetween(x, y + 54, x, y + 65);
  art.fillStyle(equipped ? UI_COLORS.gold : accent, equipped ? 0.72 : owned ? 0.42 : 0.18);
  art.fillPoints([
    { x, y: y + 60 }, { x: x + 7, y: y + 67 },
    { x, y: y + 74 }, { x: x - 7, y: y + 67 },
  ], true);
}

export class GalleryScene extends Phaser.Scene {
  constructor() {
    super('Gallery');
  }

  create(): void {
    const { width } = VIEW;
    const meta = getMeta();
    const progress = getProgress();
    this.cameras.main.fadeIn(180, 0, 0, 0);
    addWorldBackground(this, 'world_celestial', 0.31);
    addAmbientMotes(this, 0x9bdfff, 24, 2);

    addArtPanel(this, width / 2, 118, 620, 220, 8, 0.97);
    this.add.text(width / 2, 49, '✦  THE ROYAL COLLECTION  ✦', {
      fontFamily: UI_FONT, fontSize: TYPE.label, color: '#ffe4a0', fontStyle: 'bold', letterSpacing: 2,
    }).setOrigin(0.5).setDepth(12);
    this.add.text(width / 2, 95, 'CRYSTAL GALLERY', {
      fontFamily: DISPLAY_FONT, fontSize: TYPE.screen, color: '#8ce5ff', fontStyle: 'bold', stroke: '#202b62', strokeThickness: 6,
    }).setOrigin(0.5).setDepth(12).setShadow(0, 5, '#000000', 10);
    this.add.text(width / 2, 140, `${totalStars(progress)} STARS   •   ${meta.totalHits} HITS   •   ${meta.ownedArtifacts.length} RELICS`, {
      fontFamily: UI_FONT, fontSize: TYPE.label, color: '#d7e2f2', fontStyle: 'bold', letterSpacing: 1,
    }).setOrigin(0.5).setDepth(12);
    this.add.text(width / 2, 169, `◆ ${meta.coins.toLocaleString()} WALLET   •   ◆ ${meta.lifetimeCoins.toLocaleString()} LIFETIME EARNED`, {
      fontFamily: UI_FONT, fontSize: TYPE.label, color: '#ffe29a', fontStyle: 'bold', letterSpacing: 1,
    }).setOrigin(0.5).setDepth(12);
    addArtButton(this, 86, 45, '‹  MENU', () => {
      SFX.click();
      this.scene.start('Menu');
    }, 140, 48, 18);
    addArtButton(this, width - 86, 45, 'OPENING', () => {
      SFX.click();
      this.scene.start('Intro');
    }, 140, 48, 18);

    this.add.text(width / 2, 236, 'DISCOVERED WORLDS', {
      fontFamily: UI_FONT, fontSize: TYPE.section, color: '#ffe4a0', fontStyle: 'bold', letterSpacing: 2,
    }).setOrigin(0.5).setDepth(12);
    const worldColumns = [126, 360, 594];
    const worldRows = [350, 548];
    WORLD_THEMES.forEach((world, index) => {
      const unlocked = progress.unlocked >= index * 3 + 1;
      const x = worldColumns[index % worldColumns.length];
      const y = worldRows[Math.floor(index / worldColumns.length)];
      addArtPanel(this, x, y, 210, 178, 8, unlocked ? 0.97 : 0.82);
      addWorldCrystalIdentity(this, x, y, world.accent, index, unlocked);
      const picture = this.add.image(x, y - 24, world.background)
        .setCrop(0, 210, 720, 720)
        .setDisplaySize(174, 100)
        .setDepth(10);
      if (!unlocked) picture.setTint(0x404655).setAlpha(0.55);
      addWorldPictureFrame(this, x, y - 24, world.accent, unlocked);
      fitText(this.add.text(x, y + 41, unlocked ? world.name : 'SEALED WORLD', {
        fontFamily: UI_FONT, fontSize: TYPE.caption, color: unlocked ? world.accentCss : '#8b93a3', fontStyle: 'bold',
        stroke: '#101225', strokeThickness: 4,
      }).setOrigin(0.5).setDepth(12), 178);
      fitText(this.add.text(x, y + 67, unlocked ? world.subtitle : `CLEAR WORLD ${index}`, {
        fontFamily: UI_FONT, fontSize: TYPE.caption, color: unlocked ? '#d4deec' : '#727988', fontStyle: 'bold', letterSpacing: 1,
      }).setOrigin(0.5).setDepth(12), 178, 0.76);
    });

    this.add.text(width / 2, 690, 'ARTIFACT INVENTORY', {
      fontFamily: UI_FONT, fontSize: TYPE.section, color: '#ffe4a0', fontStyle: 'bold', letterSpacing: 2,
    }).setOrigin(0.5).setDepth(12);
    ARTIFACTS.forEach((artifact, index) => {
      const x = 92 + index * 178;
      const owned = meta.ownedArtifacts.includes(artifact.id);
      const equipped = meta.equippedArtifact === artifact.id;
      addArtifactPedestal(this, x, 762, artifact.accent, owned, equipped);
      addIconFrame(this, x, 762, 120, artifact.accent, 9, equipped);
      const icon = this.add.image(x, 762, artifact.texture).setDisplaySize(94, 94).setDepth(10);
      if (!owned) icon.setTint(0xa2a8b3).setAlpha(0.68);
      icon.setInteractive({ useHandCursor: true }).on('pointerup', () => {
        SFX.click();
        if (!owned) {
          this.scene.start('Store');
          return;
        }
        equipArtifact(artifact.id);
        this.scene.restart();
      });
      this.add.text(x, 838, owned ? artifact.name.split(' ')[0] : 'LOCKED', {
        fontFamily: UI_FONT, fontSize: TYPE.caption, color: owned ? artifact.accentCss : '#777f8e', fontStyle: 'bold',
      }).setOrigin(0.5).setDepth(12);
      fitText(this.add.text(x, 866, equipped ? 'EQUIPPED' : owned ? 'TAP TO EQUIP' : 'OPEN STORE', {
        fontFamily: UI_FONT, fontSize: TYPE.caption, color: equipped ? '#ffe5a0' : '#a9b4c5', fontStyle: 'bold', letterSpacing: 1,
      }).setOrigin(0.5).setDepth(12), 152, 0.8);
    });

    this.add.text(width / 2, 934, 'PRISM ORB COLLECTION', {
      fontFamily: UI_FONT, fontSize: TYPE.section, color: '#ffe4a0', fontStyle: 'bold', letterSpacing: 2,
    }).setOrigin(0.5).setDepth(12);
    COLOR_KEYS.forEach((color, index) => {
      addIconFrame(this, 80 + index * 112, 1014, 92, COLORS[color].hex, 9);
      this.add.image(80 + index * 112, 1014, orbTexture(meta.equippedSkin, color))
        .setDisplaySize(80, 80).setDepth(10).setInteractive({ useHandCursor: true })
        .on('pointerup', () => this.scene.start('Rewards'));
    });
    this.add.text(width / 2, 1078, `EQUIPPED ORB SKIN  •  ${getOrbSkin(meta.equippedSkin).name}`, {
      fontFamily: UI_FONT, fontSize: TYPE.label, color: '#d3ddeb', fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(12);
    fitText(this.add.text(width / 2, 1114, `${meta.completedRuns} LEVELS CLEARED   •   ${meta.totalHits.toLocaleString()} LIFETIME HITS   •   TAP A RELIC TO EQUIP`, {
      fontFamily: UI_FONT, fontSize: TYPE.caption, color: '#9fb5d0', fontStyle: 'bold', letterSpacing: 1,
    }).setOrigin(0.5).setDepth(12), 610);
    if (PHASER_RELEASE_FEATURES.productionHardening) {
      addArtButton(this, 116, 1190, 'ARCHIVE\n500 MASTERS', () => {
        SFX.click();
        this.scene.start('ProductionArchive');
      }, 204, 64, 15);
      addArtButton(this, 360, 1190, 'EXPERIENCE\n1,500 SYSTEMS', () => {
        SFX.click();
        this.scene.start('ProductionExperience');
      }, 204, 64, 15);
      addArtButton(this, 604, 1190, 'SYSTEMS LAB\n850 CONTRACTS', () => {
        SFX.click();
        this.scene.start('ProductionSystems');
      }, 204, 64, 15);
    } else {
      this.add.text(width / 2, 1190, 'CINEMATIC PRESENTATION GATE ACTIVE', {
        fontFamily: UI_FONT, fontSize: TYPE.label, color: '#9fb5d0', fontStyle: 'bold', letterSpacing: 1,
      }).setOrigin(0.5).setDepth(12);
    }
    sharpenSceneText(this);
  }
}

import Phaser from 'phaser';
import { LEVELS, mapNodeForLevel, mapRewardLabel, VIEW, WORLD_THEMES } from '../config';
import { getProgress, isLevelCleared, isLevelUnlocked, totalStars } from '../game/progression';
import { hasPlatformAccountBinding } from '../game/platform';
import { startMusic } from '../game/music';
import { SFX } from '../game/sfx';
import { getArtifact, getMeta, MODE_DEFS } from '../game/meta';
import { PHASER_RELEASE_FEATURES } from '../game/release-profile';
import { accessibilityRuntimeForCanvas } from '../gfx/accessibility';
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
  UI_FONT,
} from '../gfx/ui';

export class WorldMapScene extends Phaser.Scene {
  private world = 0;

  constructor() {
    super('WorldMap');
  }

  init(data: { world?: number }): void {
    this.world = PHASER_RELEASE_FEATURES.completeGameplay
      ? Phaser.Math.Clamp(data.world ?? this.world, 0, WORLD_THEMES.length - 1)
      : 0;
  }

  create(): void {
    const { width, height } = VIEW;
    startMusic('story');
    const theme = WORLD_THEMES[this.world];
    const progress = getProgress();
    const accountBound = hasPlatformAccountBinding();
    const meta = getMeta();
    const mode = MODE_DEFS[meta.mode];
    const artifact = getArtifact(meta.equippedArtifact);
    const a11y = accessibilityRuntimeForCanvas(this.game.canvas).mountScene({
      id: `world-map-${this.world + 1}`,
      heading: `${theme.name} adventure map`,
      description: `${theme.subtitle}. Choose an unlocked level, switch realm, open the Chronicle, or return to the menu.`,
      status: `${progress.unlocked} of ${LEVELS.length} levels unlocked. ${totalStars(progress)} stars earned.`,
      lifecycle: this.events,
    });
    this.cameras.main.fadeIn(180, 0, 0, 0);
    addWorldBackground(this, theme.background, 0.23);
    addAmbientMotes(this, theme.accent, theme.id === 'ember' ? 24 : 18, 2);

    addArtPanel(this, width / 2, 146, 620, 300, 8, 0.96);
    this.add.text(width / 2, 64, '✦  ADVENTURE MAP  ✦', {
      fontFamily: UI_FONT, fontSize: TYPE.label, color: '#ffe6a6', fontStyle: 'bold', letterSpacing: 2,
    }).setOrigin(0.5).setDepth(12).setShadow(0, 2, '#000000', 6);
    this.add.text(width / 2, 113, theme.name, {
      fontFamily: DISPLAY_FONT, fontSize: TYPE.screen, color: theme.accentCss, fontStyle: 'bold',
      stroke: '#101225', strokeThickness: 5,
    }).setOrigin(0.5).setDepth(12).setShadow(0, 5, '#000000', 10);
    this.add.text(width / 2, 151, theme.subtitle, {
      fontFamily: UI_FONT, fontSize: TYPE.label, color: '#e2e8f5', fontStyle: 'bold', letterSpacing: 2,
    }).setOrigin(0.5).setDepth(12);
    this.add.text(width / 2, 188, `${mode.name}  ×${mode.coinMultiplier} COINS   •   ${totalStars(progress)} / ${LEVELS.length * 3} STARS`, {
      fontFamily: UI_FONT, fontSize: TYPE.label, color: '#cbd6e7', fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(12);
    addIconFrame(this, 82, 211, 44, artifact.accent, 11, true);
    this.add.image(82, 211, artifact.texture).setDisplaySize(34, 34).setDepth(12);
    fitText(this.add.text(380, 211, `${artifact.name}   •   ◆ ${meta.coins.toLocaleString()}   •   KEYS ${meta.mysteryKeys}   •   ${progress.unlocked} / ${LEVELS.length} OPEN`, {
      fontFamily: UI_FONT, fontSize: TYPE.label, color: artifact.accentCss, fontStyle: 'bold', letterSpacing: 1,
      stroke: '#050814', strokeThickness: 3,
    }).setOrigin(0.5).setDepth(12), 500);

    addArtButton(this, 92, 54, '‹  MENU', () => {
      SFX.click();
      this.cameras.main.fadeOut(160, 0, 0, 0);
      this.time.delayedCall(170, () => this.scene.start('Menu'));
    }, 150, 52, 16);
    if (PHASER_RELEASE_FEATURES.completeGameplay) {
      addArtButton(this, width - 92, 54, 'CHRONICLE', () => {
        SFX.click();
        this.scene.start('Chronicle', { returnScene: 'WorldMap', world: this.world, page: 0 });
      }, 156, 52, 16);
    }

    const previous = (this.world + WORLD_THEMES.length - 1) % WORLD_THEMES.length;
    const next = (this.world + 1) % WORLD_THEMES.length;
    if (PHASER_RELEASE_FEATURES.completeGameplay) {
      addArtButton(this, 82, 310, '‹', () => this.switchWorld(previous), 86, 58, 16);
      addArtButton(this, width - 82, 310, '›', () => this.switchWorld(next), 86, 58, 16);
    }
    this.add.text(width / 2, 310, `WORLD ${this.world + 1}  /  ${WORLD_THEMES.length}`, {
      fontFamily: UI_FONT, fontSize: TYPE.body, color: '#e6edf9', fontStyle: 'bold', letterSpacing: 2,
    }).setOrigin(0.5).setDepth(12);

    const positions = [
      { x: 236, y: 420, side: 1 },
      { x: 484, y: 570, side: -1 },
      { x: 250, y: 720, side: 1 },
      { x: 470, y: 870, side: -1 },
      { x: 275, y: 1020, side: 1 },
    ];
    // A crooked rune rail makes the route feel like a fracture through the
    // Shattered Crown instead of a generic progress connector.
    const path = this.add.graphics().setDepth(7);
    const route = [...positions.map(({ x, y }) => ({ x, y }))];
    const drawRoute = (lineWidth: number, color: number, alpha: number): void => {
      path.lineStyle(lineWidth, color, alpha);
      path.beginPath();
      path.moveTo(route[0].x, route[0].y);
      route.slice(1).forEach((point) => path.lineTo(point.x, point.y));
      path.strokePath();
    };
    drawRoute(15, 0x020611, 0.64);
    drawRoute(4, theme.accent, 0.74);
    route.slice(1, -1).forEach((point, index) => {
      const radius = index % 3 === 2 ? 7 : 4;
      path.fillStyle(index % 3 === 2 ? 0xd4a94f : theme.accent, index % 3 === 2 ? 0.72 : 0.5);
      path.fillPoints([
        { x: point.x, y: point.y - radius },
        { x: point.x + radius, y: point.y },
        { x: point.x, y: point.y + radius },
        { x: point.x - radius, y: point.y },
      ], true);
    });

    theme.levels.forEach((level, index) => {
      const pos = positions[index];
      const releaseAvailable = PHASER_RELEASE_FEATURES.completeGameplay || level === 0;
      const unlocked = releaseAvailable && isLevelUnlocked(level, progress);
      const cleared = isLevelCleared(level, progress);
      const def = LEVELS[level];
      const mapNode = mapNodeForLevel(level);
      const node = this.add.container(pos.x, pos.y + 26).setDepth(13).setAlpha(0).setScale(0.74);
      const aura = this.add.circle(0, 0, 62, theme.accent, unlocked ? 0.13 : 0.04)
        .setStrokeStyle(2, theme.accent, unlocked ? 0.42 : 0.12);
      const medallion = this.add.image(0, 0, 'level_medallion').setDisplaySize(132, 132);
      if (!unlocked) medallion.setTint(0x5b6070).setAlpha(0.72);
      const number = this.add.text(0, -3, unlocked ? String(level + 1) : '🔒', {
        fontFamily: UI_FONT, fontSize: unlocked ? TYPE.title : TYPE.section, color: unlocked ? '#ffffff' : '#bbc1ce',
        fontStyle: 'bold', stroke: '#15142c', strokeThickness: 6,
      }).setOrigin(0.5).setShadow(0, 4, '#000000', 8);
      const stars = progress.stars[level] ?? 0;
      const starText = this.add.text(0, 45, `${'★'.repeat(stars)}${'☆'.repeat(3 - stars)}`, {
        fontFamily: UI_FONT, fontSize: TYPE.caption, color: unlocked ? '#ffe277' : '#747a89', fontStyle: 'bold',
      }).setOrigin(0.5);
      const rewardChest = this.add.image(51, -48, 'mystery_chest_closed').setDisplaySize(44, 44);
      if (!unlocked) rewardChest.setTint(0x59606d).setAlpha(0.5);
      const rewardAvailability = progress.claimedFirstClears.includes(level)
        ? 'claimed'
        : !unlocked
          ? 'locked'
          : !accountBound
            ? 'account-required'
            : cleared
              ? 'verification-pending'
              : 'available';
      const rewardText = mapRewardLabel(mapNode.reward, rewardAvailability);
      const rewardLabel = this.add.text(51, -28, rewardText, {
        fontFamily: UI_FONT, fontSize: TYPE.caption, color: unlocked ? '#ffe29a' : '#858d9b', fontStyle: 'bold',
        stroke: '#0a0d18', strokeThickness: 3,
      }).setOrigin(0.5);
      node.add([aura, medallion, number, starText, rewardChest, rewardLabel]);
      node.setSize(144, 144).setInteractive({ useHandCursor: true });
      this.tweens.add({
        targets: node,
        y: pos.y,
        alpha: 1,
        scale: 1,
        delay: 120 + index * 150,
        duration: 470,
        ease: 'Cubic.easeOut',
      });
      node.on('pointerover', () => unlocked && this.tweens.add({ targets: node, scale: 1.06, duration: 100 }));
      node.on('pointerout', () => this.tweens.add({ targets: node, scale: 1, duration: 120 }));
      const activateLevel = (): void => {
        if (!releaseAvailable) {
          this.showLockedMessage(level, 'AVAILABLE IN RELEASE 2');
          a11y.announce(`Level ${level + 1} is not available in this release.`);
          return;
        }
        if (!unlocked) {
          this.showLockedMessage(level);
          a11y.announce(`Level ${level + 1} is locked. Complete the previous path.`);
          return;
        }
        SFX.click();
        this.cameras.main.fadeOut(180, 0, 0, 0);
        this.time.delayedCall(190, () => this.scene.start('Story', { level, score: 0, mode: meta.mode }));
      };
      node.on('pointerup', activateLevel);
      a11y.registerButton({
        id: `world-${this.world + 1}-level-${level + 1}`,
        label: unlocked
          ? `Play level ${level + 1}: ${def.title}. ${def.objective}`
          : `Level ${level + 1}: ${def.title}. Locked`,
        description: unlocked ? `${stars} of 3 stars earned.` : 'Complete the previous path to unlock.',
        onActivate: activateLevel,
        onFocusChange: (focused) => {
          if (!unlocked) return;
          this.tweens.add({ targets: node, scale: focused ? 1.06 : 1, duration: 100 });
        },
      });

      const labelX = pos.x + pos.side * 104;
      const originX = pos.side > 0 ? 0 : 1;
      const labelRail = this.add.graphics().setDepth(12);
      const railStart = pos.x + pos.side * 68;
      const railEnd = labelX - pos.side * 8;
      labelRail.lineStyle(2, 0x020611, 0.72);
      labelRail.lineBetween(railStart, pos.y - 7, railEnd, pos.y - 7);
      labelRail.lineStyle(1, theme.accent, unlocked ? 0.66 : 0.24);
      labelRail.lineBetween(railStart, pos.y - 9, railEnd, pos.y - 9);
      labelRail.fillStyle(unlocked ? theme.accent : 0x515b68, unlocked ? 0.78 : 0.54);
      labelRail.fillPoints([
        { x: railEnd, y: pos.y - 14 },
        { x: railEnd + pos.side * 5, y: pos.y - 9 },
        { x: railEnd, y: pos.y - 4 },
        { x: railEnd - pos.side * 5, y: pos.y - 9 },
      ], true);
      this.add.text(labelX, pos.y - 34, `${mapNode.kind.toUpperCase()}  •  LEVEL ${level + 1}`, {
        fontFamily: UI_FONT, fontSize: TYPE.caption, color: theme.accentCss, fontStyle: 'bold', letterSpacing: 1,
      }).setOrigin(originX, 0.5).setDepth(13);
      fitText(this.add.text(labelX, pos.y - 5, def.title, {
        fontFamily: UI_FONT, fontSize: TYPE.control, color: unlocked ? '#ffffff' : '#8991a0', fontStyle: 'bold',
        stroke: '#060914', strokeThickness: 4,
      }).setOrigin(originX, 0.5).setDepth(13), 205, 0.82);
      this.add.text(labelX, pos.y + 23, unlocked ? def.objective : 'Complete required path', {
        fontFamily: UI_FONT, fontSize: TYPE.caption, color: unlocked ? '#d2dcea' : '#8992a2',
        wordWrap: { width: 200 }, align: pos.side > 0 ? 'left' : 'right',
      }).setOrigin(originX, 0.5).setDepth(13);
      if (progress.bestScores[level]) {
        this.add.text(labelX, pos.y + 49, `BEST  ${progress.bestScores[level].toLocaleString()}`, {
          fontFamily: UI_FONT, fontSize: TYPE.caption, color: '#ffe7a6', fontStyle: 'bold',
        }).setOrigin(originX, 0.5).setDepth(13);
      }
    });

    fitText(this.add.text(width / 2, height - 54, accountBound
      ? 'VERIFIED FIRST-CLEAR COINS  •  ONE ACCOUNT CLAIM PER LEVEL'
      : 'SIGN IN FOR VERIFIED FIRST-CLEAR COINS  •  LOCAL PLAY REMAINS AVAILABLE', {
      fontFamily: UI_FONT, fontSize: TYPE.label, color: '#d6deec', fontStyle: 'bold', letterSpacing: 1,
    }).setOrigin(0.5).setDepth(14).setShadow(0, 2, '#000000', 5), 610);
    sharpenSceneText(this);
  }

  private switchWorld(world: number): void {
    SFX.click();
    this.cameras.main.fadeOut(120, 0, 0, 0);
    this.time.delayedCall(130, () => this.scene.restart({ world }));
  }

  private showLockedMessage(level: number, reason = 'COMPLETE THE PREVIOUS PATH'): void {
    const message = this.add.text(VIEW.width / 2, VIEW.height - 116, `LEVEL ${level + 1} IS LOCKED  •  ${reason}`, {
      fontFamily: UI_FONT, fontSize: TYPE.body, color: '#fff2d2', backgroundColor: 'rgba(8,10,22,0.92)',
      padding: { x: 20, y: 12 }, fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(30);
    message.setResolution(Phaser.Math.Clamp(window.devicePixelRatio || 1, 1, 2));
    this.tweens.add({ targets: message, alpha: 0, delay: 1800, duration: 450, onComplete: () => message.destroy() });
  }
}

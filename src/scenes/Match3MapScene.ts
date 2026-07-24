import Phaser from 'phaser';
import { VIEW, WORLD_THEMES } from '../config';
import {
  getMatch3Progress,
  isMatch3LevelUnlocked,
  totalMatch3Stars,
  type Match3CampaignProgress,
} from '../game/match3-progress';
import {
  MATCH3_LEVEL_COUNT,
  getMatch3LevelDefinition,
  type Match3LevelDefinition,
} from '../game/match3';
import { startMusic } from '../game/music';
import { SFX } from '../game/sfx';
import {
  addAmbientMotes,
  addArtButton,
  addArtPanel,
  addWorldBackground,
  DISPLAY_FONT,
  fitText,
  prefersReducedMotion,
  sharpenSceneText,
  TYPE,
  UI_FONT,
} from '../gfx/ui';

interface Match3MapSceneData {
  world?: number;
}

interface NodePosition {
  x: number;
  y: number;
  side: -1 | 1;
}

const LEVELS_PER_WORLD = 5;
const WORLD_COUNT = Math.ceil(MATCH3_LEVEL_COUNT / LEVELS_PER_WORLD);
const NODE_POSITIONS: readonly NodePosition[] = [
  { x: 218, y: 432, side: 1 },
  { x: 500, y: 583, side: -1 },
  { x: 236, y: 734, side: 1 },
  { x: 484, y: 885, side: -1 },
  { x: 252, y: 1_036, side: 1 },
];
const NODE_KINDS = ['PRISM PATH', 'COLOR RELAY', 'CASCADE TEST', 'CROWN GATE', 'REALM TRIAL'] as const;

export class Match3MapScene extends Phaser.Scene {
  private world = 0;
  private transitioning = false;

  constructor() {
    super('Match3Map');
  }

  init(data: Match3MapSceneData = {}): void {
    const progress = getMatch3Progress();
    const newestAccessibleWorld = this.highestAccessibleWorld(progress);
    const requested = data.world ?? newestAccessibleWorld;
    this.world = Phaser.Math.Clamp(Math.trunc(requested), 0, newestAccessibleWorld);
    this.transitioning = false;
  }

  create(): void {
    const progress = getMatch3Progress();
    const theme = WORLD_THEMES[this.world] ?? WORLD_THEMES[0];
    const worldStart = this.world * LEVELS_PER_WORLD;
    const worldLevels = Array.from(
      { length: LEVELS_PER_WORLD },
      (_, index) => worldStart + index,
    ).filter((level) => level < MATCH3_LEVEL_COUNT);
    const worldClears = worldLevels.filter((level) => progress.cleared.includes(level)).length;
    const worldStars = worldLevels.reduce((sum, level) => sum + (progress.stars[level] ?? 0), 0);

    startMusic('story');
    this.cameras.main.fadeIn(180, 0, 0, 0);
    addWorldBackground(this, theme.background, 0.25);
    addAmbientMotes(this, theme.accent, theme.id === 'ember' ? 24 : 18, 2);

    this.composeHeader(progress, worldClears, worldStars);
    this.composeWorldNavigation(progress);
    addArtPanel(this, VIEW.width / 2, 776, 660, 814, 5, 0.9);
    this.composeRoute(progress, worldLevels);

    fitText(this.add.text(
      VIEW.width / 2,
      VIEW.height - 42,
      'SWAP ADJACENT PRISMS  •  BUILD SPECIALS  •  MASTER EVERY REALM',
      {
        fontFamily: UI_FONT,
        fontSize: TYPE.label,
        color: '#e5edf8',
        fontStyle: 'bold',
        letterSpacing: 1,
        stroke: '#030712',
        strokeThickness: 4,
      },
    ).setOrigin(0.5).setDepth(16).setShadow(0, 2, '#000000', 5), 632, 0.8);

    sharpenSceneText(this);
  }

  private composeHeader(
    progress: Match3CampaignProgress,
    worldClears: number,
    worldStars: number,
  ): void {
    const theme = WORLD_THEMES[this.world] ?? WORLD_THEMES[0];
    addArtPanel(this, VIEW.width / 2, 138, 632, 250, 8, 0.97);

    addArtButton(this, 88, 47, '‹  MODES', () => {
      if (this.transitioning) return;
      this.transitioning = true;
      SFX.click();
      this.cameras.main.fadeOut(150, 0, 0, 0);
      this.time.delayedCall(160, () => this.scene.start('ModeSelect'));
    }, 148, 50, 18);

    this.add.text(VIEW.width / 2, 54, '✦  PRISM CASCADE  ✦', {
      fontFamily: UI_FONT,
      fontSize: TYPE.label,
      color: '#ffe6a6',
      fontStyle: 'bold',
      letterSpacing: 2,
    }).setOrigin(0.5).setDepth(12).setShadow(0, 2, '#000000', 6);

    this.add.text(VIEW.width - 76, 54, `${totalMatch3Stars(progress)} / ${MATCH3_LEVEL_COUNT * 3} ★`, {
      fontFamily: UI_FONT,
      fontSize: TYPE.caption,
      color: '#ffe27a',
      fontStyle: 'bold',
      stroke: '#050815',
      strokeThickness: 4,
    }).setOrigin(0.5).setDepth(12);

    fitText(this.add.text(VIEW.width / 2, 111, theme.name, {
      fontFamily: DISPLAY_FONT,
      fontSize: TYPE.screen,
      color: theme.accentCss,
      fontStyle: 'bold',
      stroke: '#101225',
      strokeThickness: 5,
    }).setOrigin(0.5).setDepth(12).setShadow(0, 5, '#000000', 10), 500);

    fitText(this.add.text(VIEW.width / 2, 155, theme.subtitle, {
      fontFamily: UI_FONT,
      fontSize: TYPE.label,
      color: '#e2e8f5',
      fontStyle: 'bold',
      letterSpacing: 1.5,
    }).setOrigin(0.5).setDepth(12), 530);

    this.add.text(
      VIEW.width / 2,
      204,
      `${worldClears} / ${LEVELS_PER_WORLD} CLEARED   •   ${worldStars} / ${LEVELS_PER_WORLD * 3} STARS   •   ${progress.cleared.length} / ${MATCH3_LEVEL_COUNT} TOTAL`,
      {
        fontFamily: UI_FONT,
        fontSize: TYPE.caption,
        color: '#cbd6e7',
        fontStyle: 'bold',
        letterSpacing: 0.5,
      },
    ).setOrigin(0.5).setDepth(12);
  }

  private composeWorldNavigation(progress: Match3CampaignProgress): void {
    const highestWorld = this.highestAccessibleWorld(progress);

    addArtPanel(this, VIEW.width / 2, 299, 440, 74, 8, 0.95);
    if (this.world > 0) {
      addArtButton(this, 74, 299, '‹', () => this.switchWorld(this.world - 1), 82, 54, 16);
    }
    if (this.world < highestWorld) {
      addArtButton(this, VIEW.width - 74, 299, '›', () => this.switchWorld(this.world + 1), 82, 54, 16);
    }

    this.add.text(VIEW.width / 2, 285, `REALM ${this.world + 1}  /  ${WORLD_COUNT}`, {
      fontFamily: UI_FONT,
      fontSize: TYPE.body,
      color: '#f2f6ff',
      fontStyle: 'bold',
      letterSpacing: 2,
    }).setOrigin(0.5).setDepth(12);

    const railWidth = 198;
    const railStart = VIEW.width / 2 - railWidth / 2;
    const rail = this.add.graphics().setDepth(12);
    rail.lineStyle(2, 0x6d7e96, 0.36);
    rail.lineBetween(railStart, 319, railStart + railWidth, 319);

    for (let world = 0; world < WORLD_COUNT; world += 1) {
      const accessible = world <= highestWorld;
      const active = world === this.world;
      const x = railStart + (railWidth / (WORLD_COUNT - 1)) * world;
      const accent = WORLD_THEMES[world]?.accent ?? 0x65dbe8;
      const marker = this.add.container(x, 319).setDepth(13);
      const halo = this.add.circle(0, 0, active ? 13 : 9, accent, active ? 0.26 : 0.08)
        .setStrokeStyle(active ? 2 : 1, accent, accessible ? 0.86 : 0.2);
      const core = this.add.circle(0, 0, active ? 5 : 4, accessible ? accent : 0x566173, accessible ? 1 : 0.65);
      marker.add([halo, core]);
      marker.setSize(38, 38).setInteractive({ useHandCursor: accessible });
      marker.on('pointerup', () => {
        if (accessible) this.switchWorld(world);
      });
    }
  }

  private composeRoute(progress: Match3CampaignProgress, worldLevels: readonly number[]): void {
    const theme = WORLD_THEMES[this.world] ?? WORLD_THEMES[0];
    const route = NODE_POSITIONS.slice(0, worldLevels.length);
    const path = this.add.graphics().setDepth(7);

    route.slice(0, -1).forEach((point, index) => {
      const next = route[index + 1];
      const nextLevel = worldLevels[index + 1];
      const active = isMatch3LevelUnlocked(nextLevel, progress);
      path.lineStyle(16, 0x01040c, 0.68);
      path.lineBetween(point.x, point.y, next.x, next.y);
      path.lineStyle(4, active ? theme.accent : 0x465265, active ? 0.76 : 0.28);
      path.lineBetween(point.x, point.y, next.x, next.y);

      const midpointX = (point.x + next.x) / 2;
      const midpointY = (point.y + next.y) / 2;
      path.fillStyle(active ? 0xffdf82 : 0x647083, active ? 0.78 : 0.34);
      path.fillPoints([
        { x: midpointX, y: midpointY - 7 },
        { x: midpointX + 7, y: midpointY },
        { x: midpointX, y: midpointY + 7 },
        { x: midpointX - 7, y: midpointY },
      ], true);
    });

    worldLevels.forEach((level, index) => {
      const position = route[index];
      this.composeLevelNode(level, index, position, progress);
    });
  }

  private composeLevelNode(
    level: number,
    index: number,
    position: NodePosition,
    progress: Match3CampaignProgress,
  ): void {
    const theme = WORLD_THEMES[this.world] ?? WORLD_THEMES[0];
    const definition = getMatch3LevelDefinition(level);
    const unlocked = isMatch3LevelUnlocked(level, progress);
    const cleared = progress.cleared.includes(level);
    const stars = progress.stars[level] ?? 0;
    const node = this.add.container(position.x, position.y + 22)
      .setDepth(13)
      .setAlpha(prefersReducedMotion() ? 1 : 0)
      .setScale(prefersReducedMotion() ? 1 : 0.78);

    const aura = this.add.circle(0, 0, index === LEVELS_PER_WORLD - 1 ? 68 : 60, theme.accent, unlocked ? 0.13 : 0.035)
      .setStrokeStyle(index === LEVELS_PER_WORLD - 1 ? 3 : 2, unlocked ? theme.accent : 0x5a6475, unlocked ? 0.5 : 0.18);
    const medallion = this.add.image(0, 0, 'level_medallion')
      .setDisplaySize(index === LEVELS_PER_WORLD - 1 ? 138 : 126, index === LEVELS_PER_WORLD - 1 ? 138 : 126);
    if (!unlocked) medallion.setTint(0x586172).setAlpha(0.7);

    const number = this.add.text(0, -7, unlocked ? String(level + 1) : '🔒', {
      fontFamily: UI_FONT,
      fontSize: unlocked ? TYPE.title : TYPE.section,
      color: unlocked ? '#ffffff' : '#b7c0cf',
      fontStyle: 'bold',
      stroke: '#111428',
      strokeThickness: 6,
    }).setOrigin(0.5).setShadow(0, 4, '#000000', 8);
    const starText = this.add.text(0, 38, `${'★'.repeat(stars)}${'☆'.repeat(3 - stars)}`, {
      fontFamily: UI_FONT,
      fontSize: TYPE.caption,
      color: unlocked ? '#ffe277' : '#6f7888',
      fontStyle: 'bold',
      stroke: '#111428',
      strokeThickness: 3,
    }).setOrigin(0.5);
    const stateGem = this.add.circle(46, -45, 12, cleared ? 0xffd76f : unlocked ? theme.accent : 0x596474, 0.95)
      .setStrokeStyle(2, 0xffffff, cleared ? 0.74 : 0.26);
    const stateMark = this.add.text(46, -46, cleared ? '✓' : index === LEVELS_PER_WORLD - 1 ? '✦' : '•', {
      fontFamily: UI_FONT,
      fontSize: '16px',
      color: '#07101e',
      fontStyle: 'bold',
    }).setOrigin(0.5);

    node.add([aura, medallion, number, starText, stateGem, stateMark]);
    node.setSize(146, 146).setInteractive({ useHandCursor: true });
    node.on('pointerover', () => {
      if (unlocked) this.tweens.add({ targets: node, scale: 1.06, duration: 100 });
    });
    node.on('pointerout', () => this.tweens.add({ targets: node, scale: 1, duration: 120 }));
    node.on('pointerup', () => {
      if (!unlocked) {
        this.showLockedMessage(level);
        return;
      }
      this.openLevel(level);
    });

    if (!prefersReducedMotion()) {
      this.tweens.add({
        targets: node,
        y: position.y,
        alpha: 1,
        scale: 1,
        delay: 90 + index * 120,
        duration: 430,
        ease: 'Cubic.easeOut',
      });
    }

    const labelX = position.x + position.side * 104;
    const originX = position.side > 0 ? 0 : 1;
    const railEnd = labelX - position.side * 10;
    const labelRail = this.add.graphics().setDepth(12);
    labelRail.lineStyle(2, 0x01040c, 0.82);
    labelRail.lineBetween(position.x + position.side * 67, position.y - 11, railEnd, position.y - 11);
    labelRail.lineStyle(1, unlocked ? theme.accent : 0x5d6878, unlocked ? 0.65 : 0.24);
    labelRail.lineBetween(position.x + position.side * 67, position.y - 13, railEnd, position.y - 13);

    this.add.text(labelX, position.y - 42, NODE_KINDS[index], {
      fontFamily: UI_FONT,
      fontSize: TYPE.caption,
      color: unlocked ? theme.accentCss : '#798494',
      fontStyle: 'bold',
      letterSpacing: 1,
    }).setOrigin(originX, 0.5).setDepth(13);

    fitText(this.add.text(labelX, position.y - 12, definition.name, {
      fontFamily: UI_FONT,
      fontSize: TYPE.control,
      color: unlocked ? '#ffffff' : '#8993a2',
      fontStyle: 'bold',
      stroke: '#050914',
      strokeThickness: 4,
    }).setOrigin(originX, 0.5).setDepth(13), 205, 0.78);

    fitText(this.add.text(labelX, position.y + 18, unlocked ? this.objectiveLabel(definition) : this.lockReason(level), {
      fontFamily: UI_FONT,
      fontSize: TYPE.caption,
      color: unlocked ? '#d1dbea' : '#7f8998',
      fontStyle: unlocked ? 'normal' : 'bold',
    }).setOrigin(originX, 0.5).setDepth(13), 210, 0.76);

    const best = progress.bestScores[level] ?? 0;
    this.add.text(labelX, position.y + 46, best > 0 ? `BEST  ${best.toLocaleString()}` : `${definition.moves} MOVES`, {
      fontFamily: UI_FONT,
      fontSize: TYPE.caption,
      color: best > 0 ? '#ffe4a0' : unlocked ? '#a9b7ca' : '#667181',
      fontStyle: 'bold',
    }).setOrigin(originX, 0.5).setDepth(13);
  }

  private objectiveLabel(definition: Match3LevelDefinition): string {
    const pieces: string[] = [`SCORE ${definition.goals.targetScore.toLocaleString()}`];
    const collections = Object.entries(definition.goals.collect)
      .filter(([, amount]) => Number(amount) > 0)
      .slice(0, 2)
      .map(([color, amount]) => `${amount} ${color.toUpperCase()}`);
    pieces.push(...collections);
    if (definition.goals.shells > 0) pieces.push(`${definition.goals.shells} SHELL`);
    if (definition.goals.vines > 0) pieces.push(`${definition.goals.vines} VINE`);
    return pieces.slice(0, 3).join('  •  ');
  }

  private lockReason(level: number): string {
    return level > 0 ? `CLEAR LEVEL ${level} TO UNLOCK` : 'LOCKED';
  }

  private openLevel(level: number): void {
    if (this.transitioning) return;
    this.transitioning = true;
    SFX.click();
    this.cameras.main.fadeOut(170, 0, 0, 0);
    this.time.delayedCall(180, () => this.scene.start('Match3', { level }));
  }

  private switchWorld(world: number): void {
    if (this.transitioning || world === this.world) return;
    const progress = getMatch3Progress();
    const destination = Phaser.Math.Clamp(Math.trunc(world), 0, this.highestAccessibleWorld(progress));
    if (destination === this.world) return;
    this.transitioning = true;
    SFX.click();
    this.cameras.main.fadeOut(120, 0, 0, 0);
    this.time.delayedCall(130, () => this.scene.restart({ world: destination }));
  }

  private highestAccessibleWorld(progress: Match3CampaignProgress): number {
    const latestLevel = Math.max(0, Math.min(MATCH3_LEVEL_COUNT - 1, progress.unlocked - 1));
    return Math.min(WORLD_COUNT - 1, Math.floor(latestLevel / LEVELS_PER_WORLD));
  }

  private showLockedMessage(level: number): void {
    SFX.click();
    const message = fitText(this.add.text(
      VIEW.width / 2,
      VIEW.height - 104,
      `LEVEL ${level + 1} IS LOCKED  •  ${this.lockReason(level)}`,
      {
        fontFamily: UI_FONT,
        fontSize: TYPE.body,
        color: '#fff2d2',
        backgroundColor: 'rgba(8,10,22,0.94)',
        padding: { x: 20, y: 12 },
        fontStyle: 'bold',
        stroke: '#050711',
        strokeThickness: 3,
      },
    ).setOrigin(0.5).setDepth(30), 620, 0.75);
    this.tweens.add({
      targets: message,
      alpha: 0,
      delay: 1_600,
      duration: 380,
      onComplete: () => message.destroy(),
    });
  }
}

import Phaser from 'phaser';
import { COLOR_KEYS, LEVELS, VIEW, orbTexture, worldForLevel } from '../config';
import { storyBeatForLevel, storyChapterForLevel } from '../game/story';
import { getMeta, type GameMode } from '../game/meta';
import { startMusic } from '../game/music';
import { SFX } from '../game/sfx';
import { addAmbientMotes, addArtButton, addWorldBackground, DISPLAY_FONT, fitText, sharpenSceneText, TYPE, UI_FONT } from '../gfx/ui';

export interface StoryLaunchData {
  level?: number;
  score?: number;
  mode?: GameMode;
}

export class StoryScene extends Phaser.Scene {
  private level = 0;
  private score = 0;
  private mode?: GameMode;
  private leaving = false;

  constructor() {
    super('Story');
  }

  init(data: StoryLaunchData): void {
    this.level = Phaser.Math.Clamp(data.level ?? 0, 0, LEVELS.length - 1);
    this.score = Math.max(0, data.score ?? 0);
    this.mode = data.mode;
    this.leaving = false;
  }

  create(): void {
    const { width, height } = VIEW;
    startMusic('story');
    const theme = worldForLevel(this.level);
    const beat = storyBeatForLevel(this.level);
    const chapter = storyChapterForLevel(this.level);
    const meta = getMeta();
    const spiritColor = COLOR_KEYS[this.level % COLOR_KEYS.length];

    this.cameras.main.fadeIn(260, 0, 0, 0);
    addWorldBackground(this, theme.background, 0.34);
    addAmbientMotes(this, theme.accent, 15, 2);

    const veil = this.add.graphics().setDepth(3);
    veil.fillGradientStyle(0x030712, 0x030712, 0x02040a, 0x02040a, 0.18, 0.18, 0.78, 0.78);
    veil.fillRect(0, 0, width, height);

    this.add.text(width / 2, 58, `CHAPTER ${chapter.number}  •  ${chapter.title}`, {
      fontFamily: UI_FONT, fontSize: TYPE.label, color: theme.accentCss, fontStyle: 'bold', letterSpacing: 2,
    }).setOrigin(0.5).setDepth(8).setShadow(0, 3, '#000000', 8);
    this.add.text(width / 2, 94, `LEVEL ${String(this.level + 1).padStart(2, '0')}  /  ${LEVELS.length}`, {
      fontFamily: UI_FONT, fontSize: TYPE.caption, color: '#cad5e7', fontStyle: 'bold', letterSpacing: 2,
    }).setOrigin(0.5).setDepth(8);

    const line = this.add.rectangle(width / 2, 128, 350, 2, theme.accent, 0.48).setDepth(8).setScale(0, 1);
    this.tweens.add({ targets: line, scaleX: 1, duration: 650, ease: 'Cubic.easeOut' });

    const halo = this.add.circle(width / 2, 272, 116, theme.accent, 0.08)
      .setStrokeStyle(2, theme.accent, 0.28).setBlendMode(Phaser.BlendModes.ADD).setDepth(5);
    const ring = this.add.circle(width / 2, 272, 84, 0x000000, 0)
      .setStrokeStyle(2, 0xffdda0, 0.34).setDepth(6);
    const spirit = this.add.image(width / 2, 272, orbTexture(meta.equippedSkin, spiritColor))
      .setDisplaySize(132, 132).setDepth(7).setAlpha(0).setScale(0.55);
    this.tweens.add({ targets: spirit, alpha: 1, scale: 1, angle: { from: -8, to: 0 }, duration: 620, ease: 'Back.easeOut' });
    this.tweens.add({ targets: halo, scale: 1.13, alpha: 0.2, duration: 1500, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    this.tweens.add({ targets: ring, angle: 360, duration: 15000, repeat: -1, ease: 'Linear' });
    this.tweens.add({ targets: spirit, y: 263, duration: 1700, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });

    const kicker = this.add.text(width / 2, 411, beat.kicker, {
      fontFamily: UI_FONT, fontSize: TYPE.label, color: '#ffe19a', fontStyle: 'bold', letterSpacing: 3,
    }).setOrigin(0.5).setDepth(8).setAlpha(0);
    const title = fitText(this.add.text(width / 2, 461, beat.title, {
      fontFamily: DISPLAY_FONT, fontSize: TYPE.screen, color: '#ffffff', fontStyle: 'bold',
      stroke: '#101326', strokeThickness: 6,
    }).setOrigin(0.5).setDepth(8).setShadow(0, 5, '#000000', 10).setAlpha(0), 620);
    const speaker = this.add.text(width / 2, 525, beat.speaker, {
      fontFamily: UI_FONT, fontSize: TYPE.caption, color: theme.accentCss, fontStyle: 'bold', letterSpacing: 2,
    }).setOrigin(0.5).setDepth(8).setAlpha(0);
    const body = this.add.text(width / 2, 590, beat.body, {
      fontFamily: UI_FONT, fontSize: TYPE.body, color: '#e7edf8', align: 'center',
      wordWrap: { width: 578, useAdvancedWrap: true }, lineSpacing: 8,
    }).setOrigin(0.5, 0).setDepth(8).setAlpha(0);

    const objectiveY = Math.max(810, body.y + body.height + 62);
    const objectiveLine = this.add.rectangle(width / 2, objectiveY - 31, 270, 1, 0xffdda0, 0.32).setDepth(8);
    const objectiveLabel = this.add.text(width / 2, objectiveY, 'KEEPER PURPOSE', {
      fontFamily: UI_FONT, fontSize: TYPE.caption, color: '#ffe19a', fontStyle: 'bold', letterSpacing: 2,
    }).setOrigin(0.5).setDepth(8).setAlpha(0);
    const objective = this.add.text(width / 2, objectiveY + 35, beat.purpose, {
      fontFamily: UI_FONT, fontSize: TYPE.body, color: '#d4dfed', align: 'center', fontStyle: 'bold',
      wordWrap: { width: 560, useAdvancedWrap: true }, lineSpacing: 5,
    }).setOrigin(0.5, 0).setDepth(8).setAlpha(0);

    [kicker, title, speaker, body, objectiveLabel, objective].forEach((item, index) => {
      const y = item.y;
      item.setY(y + 13);
      this.tweens.add({ targets: item, y, alpha: 1, delay: 130 + index * 75, duration: 440, ease: 'Cubic.easeOut' });
    });

    const beginY = Math.min(height - 132, Math.max(1040, objective.y + objective.height + 78));
    addArtButton(this, width / 2, beginY, `BEGIN  •  ${LEVELS[this.level].title}`, () => this.beginLevel(), 470, 76, 10);
    this.add.text(width / 2, beginY + 68, 'SPACE / ENTER TO CONTINUE', {
      fontFamily: UI_FONT, fontSize: TYPE.caption, color: '#aebacd', fontStyle: 'bold', letterSpacing: 1,
    }).setOrigin(0.5).setDepth(10);

    this.add.text(38, height - 36, '‹  ADVENTURE MAP', {
      fontFamily: UI_FONT, fontSize: TYPE.label, color: '#cbd5e5', fontStyle: 'bold', letterSpacing: 1,
    }).setOrigin(0, 0.5).setDepth(10).setInteractive({ useHandCursor: true }).on('pointerup', () => {
      if (this.leaving) return;
      SFX.click();
      this.scene.start('WorldMap', { world: theme.levels.includes(this.level) ? LEVELS[this.level].world : 0 });
    });
    this.add.text(width - 38, height - 36, 'CHRONICLE  ›', {
      fontFamily: UI_FONT, fontSize: TYPE.label, color: '#ffe19a', fontStyle: 'bold', letterSpacing: 1,
    }).setOrigin(1, 0.5).setDepth(10).setInteractive({ useHandCursor: true }).on('pointerup', () => {
      if (this.leaving) return;
      SFX.click();
      this.scene.start('Chronicle', { returnScene: 'Story', level: this.level, score: this.score, mode: this.mode });
    });

    this.input.keyboard?.on('keydown-SPACE', () => this.beginLevel());
    this.input.keyboard?.on('keydown-ENTER', () => this.beginLevel());
    sharpenSceneText(this);
  }

  private beginLevel(): void {
    if (this.leaving) return;
    this.leaving = true;
    SFX.click();
    this.cameras.main.fadeOut(180, 0, 0, 0);
    this.time.delayedCall(190, () => this.scene.start('Game', {
      level: this.level,
      score: this.score,
      mode: this.mode,
    }));
  }
}

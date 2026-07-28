import Phaser from 'phaser';
import { VIEW, WORLD_THEMES } from '../config';
import { ENDING_PASSAGES, STORY_TAGLINE } from '../game/story';
import { queueArtBundle } from '../game/art-v14';
import type { GameMode } from '../game/meta';
import { startMusic } from '../game/music';
import { SFX } from '../game/sfx';
import { addAmbientMotes, addArtButton, addWorldBackground, DISPLAY_FONT, sharpenSceneText, TYPE, UI_FONT } from '../gfx/ui';

interface EndingLaunchData {
  score?: number;
  mode?: GameMode;
  replay?: boolean;
}

const SHARD_COLORS = [0x62f3ef, 0x70ef98, 0x79d9ff, 0xff715a, 0x78dcff, 0xb8a3ff] as const;

export class EndingScene extends Phaser.Scene {
  private score = 0;
  private mode?: GameMode;
  private replay = true;
  private passageText?: Phaser.GameObjects.Text;
  private passageIndex = 0;
  private choicesShown = false;
  private shards: Phaser.GameObjects.Triangle[] = [];
  private crown?: Phaser.GameObjects.Text;
  private crownHalo?: Phaser.GameObjects.Arc;
  private skipText?: Phaser.GameObjects.Text;

  constructor() {
    super('Ending');
  }

  init(data: EndingLaunchData): void {
    this.score = Math.max(0, data.score ?? 0);
    this.mode = data.mode;
    this.replay = data.replay ?? true;
    this.passageIndex = 0;
    this.choicesShown = false;
    this.shards = [];
  }

  preload(): void {
    queueArtBundle(this, 'realm-nexus');
  }

  create(): void {
    const { width, height } = VIEW;
    startMusic('ending');
    this.cameras.main.fadeIn(800, 0, 0, 0);
    addWorldBackground(this, 'world_nexus', 0.34);
    addAmbientMotes(this, 0xffe3a0, 24, 2);

    const night = this.add.graphics().setDepth(3);
    night.fillGradientStyle(0x02040b, 0x02040b, 0x081127, 0x081127, 0.74, 0.74, 0.36, 0.36);
    night.fillRect(0, 0, width, height);

    const crownX = width / 2;
    const crownY = 350;
    this.crownHalo = this.add.circle(crownX, crownY, 145, 0xffdb79, 0.025)
      .setStrokeStyle(3, 0xffdf8d, 0.16).setBlendMode(Phaser.BlendModes.ADD).setDepth(5).setScale(0.4).setAlpha(0);
    const innerRing = this.add.circle(crownX, crownY, 103, 0x000000, 0)
      .setStrokeStyle(2, 0xffffff, 0.12).setBlendMode(Phaser.BlendModes.ADD).setDepth(5);
    this.tweens.add({ targets: innerRing, angle: 360, duration: 22000, repeat: -1, ease: 'Linear' });

    const starts = [
      { x: 70, y: 176 }, { x: 650, y: 220 }, { x: 70, y: 526 },
      { x: 650, y: 530 }, { x: 185, y: 720 }, { x: 535, y: 720 },
    ];
    const targets = [
      { x: crownX - 69, y: crownY + 7, angle: -42 },
      { x: crownX - 42, y: crownY - 48, angle: -24 },
      { x: crownX, y: crownY - 73, angle: 0 },
      { x: crownX + 42, y: crownY - 48, angle: 24 },
      { x: crownX + 69, y: crownY + 7, angle: 42 },
      { x: crownX, y: crownY + 48, angle: 180 },
    ];
    SHARD_COLORS.forEach((color, index) => {
      const shard = this.add.triangle(starts[index].x, starts[index].y, 0, 30, 20, -30, -20, -30, color, 0.92)
        .setStrokeStyle(2, 0xffffff, 0.38).setDepth(7).setAngle(index * 60).setScale(0.7).setAlpha(0);
      this.shards.push(shard);
      if (this.replay) {
        this.tweens.add({
          targets: shard,
          x: targets[index].x,
          y: targets[index].y,
          angle: targets[index].angle,
          scale: 1,
          alpha: 1,
          delay: 480 + index * 260,
          duration: 1900,
          ease: 'Cubic.easeInOut',
        });
      } else {
        shard.setPosition(targets[index].x, targets[index].y).setAngle(targets[index].angle).setScale(1).setAlpha(1);
      }
    });

    this.crown = this.add.text(crownX, crownY + 4, '♛', {
      fontFamily: UI_FONT, fontSize: '112px', color: '#fff1b7', fontStyle: 'bold',
      stroke: '#754b16', strokeThickness: 6,
    }).setOrigin(0.5).setDepth(8).setAlpha(0).setScale(0.45).setShadow(0, 0, '#ffe188', 18);

    this.add.text(width / 2, 66, 'THE FINAL CHRONICLE', {
      fontFamily: UI_FONT, fontSize: TYPE.label, color: '#ffe3a0', fontStyle: 'bold', letterSpacing: 3,
    }).setOrigin(0.5).setDepth(9);
    this.add.text(width / 2, 108, 'THE CROWN REBORN', {
      fontFamily: DISPLAY_FONT, fontSize: TYPE.screen, color: '#ffffff', fontStyle: 'bold',
      stroke: '#1e2145', strokeThickness: 6,
    }).setOrigin(0.5).setDepth(9).setShadow(0, 5, '#000000', 10);

    this.passageText = this.add.text(width / 2, 610, ENDING_PASSAGES[0], {
      fontFamily: UI_FONT, fontSize: TYPE.title, color: '#edf3fb', fontStyle: 'bold', align: 'center',
      wordWrap: { width: 575, useAdvancedWrap: true }, lineSpacing: 8,
    }).setOrigin(0.5, 0).setDepth(9).setAlpha(this.replay ? 0 : 1);

    this.skipText = this.add.text(width - 34, height - 34, 'SKIP TO EPILOGUE  ›', {
      fontFamily: UI_FONT, fontSize: TYPE.caption, color: '#b9c6d8', fontStyle: 'bold', letterSpacing: 1,
    }).setOrigin(1, 0.5).setDepth(15).setInteractive({ useHandCursor: true }).on('pointerup', () => this.finishSequence());

    if (this.replay) {
      this.time.delayedCall(620, () => this.revealPassage(0));
      this.time.delayedCall(2320, () => this.formCrown());
      for (let index = 1; index < ENDING_PASSAGES.length; index += 1) {
        this.time.delayedCall(2800 + index * 2400, () => this.revealPassage(index));
      }
      this.time.delayedCall(2800 + ENDING_PASSAGES.length * 2400, () => this.revealChoices());
    } else {
      this.formCrown(true);
      this.passageText.setText(ENDING_PASSAGES[ENDING_PASSAGES.length - 1]);
      this.revealChoices(true);
    }

    this.input.keyboard?.on('keydown-SPACE', () => this.finishSequence());
    this.input.keyboard?.on('keydown-ENTER', () => this.finishSequence());
    sharpenSceneText(this);
  }

  private revealPassage(index: number): void {
    if (this.choicesShown || !this.passageText) return;
    this.passageIndex = index;
    this.tweens.killTweensOf(this.passageText);
    this.tweens.add({
      targets: this.passageText,
      alpha: 0,
      y: 626,
      duration: index === 0 ? 0 : 260,
      onComplete: () => {
        if (!this.passageText) return;
        this.passageText.setText(ENDING_PASSAGES[index]).setY(594);
        this.tweens.add({ targets: this.passageText, y: 610, alpha: 1, duration: 540, ease: 'Cubic.easeOut' });
      },
    });
  }

  private formCrown(immediate = false): void {
    if (!this.crown || !this.crownHalo) return;
    const duration = immediate ? 0 : 850;
    this.tweens.add({ targets: this.crown, alpha: 1, scale: 1, duration, ease: 'Back.easeOut' });
    this.tweens.add({ targets: this.crownHalo, alpha: 0.33, scale: 1, duration, ease: 'Cubic.easeOut' });
    this.tweens.add({ targets: this.crownHalo, alpha: 0.17, scale: 1.16, delay: duration, duration: 1500, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
  }

  private finishSequence(): void {
    if (this.choicesShown) return;
    this.time.removeAllEvents();
    const crownX = VIEW.width / 2;
    const crownY = 350;
    const targets = [
      { x: crownX - 69, y: crownY + 7, angle: -42 }, { x: crownX - 42, y: crownY - 48, angle: -24 },
      { x: crownX, y: crownY - 73, angle: 0 }, { x: crownX + 42, y: crownY - 48, angle: 24 },
      { x: crownX + 69, y: crownY + 7, angle: 42 }, { x: crownX, y: crownY + 48, angle: 180 },
    ];
    this.shards.forEach((shard, index) => {
      this.tweens.killTweensOf(shard);
      shard.setPosition(targets[index].x, targets[index].y).setAngle(targets[index].angle).setScale(1).setAlpha(1);
    });
    this.formCrown(true);
    this.passageText?.setText(ENDING_PASSAGES[ENDING_PASSAGES.length - 1]).setY(610).setAlpha(1);
    this.revealChoices(true);
  }

  private revealChoices(immediate = false): void {
    if (this.choicesShown) return;
    this.choicesShown = true;
    this.skipText?.setVisible(false);
    const { width, height } = VIEW;
    const layer = this.add.container(0, immediate ? 0 : 22).setDepth(12).setAlpha(immediate ? 1 : 0);
    const epilogue = this.add.text(width / 2, 785, 'THE RIFT IS CLOSED', {
      fontFamily: UI_FONT, fontSize: TYPE.section, color: '#ffe3a0', fontStyle: 'bold', letterSpacing: 3,
    }).setOrigin(0.5);
    const tagline = this.add.text(width / 2, 828, STORY_TAGLINE.toUpperCase(), {
      fontFamily: UI_FONT, fontSize: TYPE.label, color: '#cbd8e8', fontStyle: 'bold', letterSpacing: 1,
    }).setOrigin(0.5);
    const score = this.add.text(width / 2, 866, `FINAL RUN SCORE  •  ${this.score.toLocaleString()}`, {
      fontFamily: UI_FONT, fontSize: TYPE.label, color: '#91e6ff', fontStyle: 'bold', letterSpacing: 1,
    }).setOrigin(0.5);
    const newGame = addArtButton(this, width / 2, 950, 'NEW GAME+', () => {
      SFX.click();
      this.scene.start('Story', { level: 0, score: 0, mode: this.mode });
    }, 360, 74, 14);
    const retained = this.add.text(width / 2, 1000, 'ALL RELICS, STARS AND SHARDS RETAINED', {
      fontFamily: UI_FONT, fontSize: TYPE.caption, color: '#aebdd0', fontStyle: 'bold', letterSpacing: 1,
    }).setOrigin(0.5);
    const chronicle = addArtButton(this, width / 2, 1064, 'OPEN CHRONICLE', () => {
      SFX.click();
      this.scene.start('Chronicle', { returnScene: 'Ending', score: this.score, mode: this.mode, page: 4 });
    }, 330, 66, 14);
    const menu = this.add.text(width / 2, height - 82, 'MAIN MENU', {
      fontFamily: UI_FONT, fontSize: TYPE.body, color: '#d3ddeb', fontStyle: 'bold', letterSpacing: 2,
    }).setOrigin(0.5).setInteractive({ useHandCursor: true }).on('pointerup', () => {
      SFX.click();
      this.scene.start('Menu');
    });
    layer.add([epilogue, tagline, score, newGame, retained, chronicle, menu]);
    if (!immediate) this.tweens.add({ targets: layer, y: 0, alpha: 1, duration: 650, ease: 'Cubic.easeOut' });
    sharpenSceneText(this);
  }
}

import Phaser from 'phaser';
import { LEVELS, VIEW, WORLD_THEMES } from '../config';
import {
  CHARACTERS,
  CHRONICLE_LORE,
  PREMISE,
  STORY_CHAPTERS,
  STORY_TAGLINE,
  STORY_TITLE,
  storyProgressFromStars,
} from '../game/story';
import { getProgress, totalStars } from '../game/progression';
import { getArtBundleKeys, queueArtBundle } from '../game/art-v14';
import { hostedAssetUrl } from '../game/hostedAsset';
import { startMusic } from '../game/music';
import { SFX } from '../game/sfx';
import type { GameMode } from '../game/meta';
import { addAmbientMotes, addArtButton, addArtPanel, addWorldBackground, DISPLAY_FONT, fitText, sharpenSceneText, TYPE, UI_FONT } from '../gfx/ui';

type ChronicleReturnScene = 'Menu' | 'WorldMap' | 'Story' | 'Ending';

interface ChronicleLaunchData {
  returnScene?: ChronicleReturnScene;
  world?: number;
  level?: number;
  score?: number;
  mode?: GameMode;
  page?: number;
}

const PAGE_NAMES = ['ORIGIN', 'CHARACTERS', 'SIX REALMS', 'LIVING LORE', 'YOUR JOURNEY'] as const;
const ORIGIN_CARDS = [
  {
    title: 'THE CROWN',
    body: 'The Aurora Crown kept colour, memory, flame, frost, nature and motion in harmony.',
  },
  {
    title: 'THE SHATTERING',
    body: 'The Nexus Architect broke the Crown into six shards and opened the Rift.',
  },
  {
    title: 'THE LAST KEEPER',
    body: 'You are the final Prism Keeper, carrying the launcher and the gift of Fusion.',
  },
  {
    title: 'THE PAO SPIRITS',
    body: 'Pao spirits guide you to corrupted guardians. Heal each one—never destroy them.',
  },
  {
    title: 'THE OATH',
    body: 'Restore the guardians, recover every shard, close the Rift and reunite the Crown.',
  },
] as const;

export class ChronicleScene extends Phaser.Scene {
  private page = 0;
  private returnScene: ChronicleReturnScene = 'Menu';
  private world = 0;
  private level = 0;
  private score = 0;
  private mode?: GameMode;
  private pageLayer?: Phaser.GameObjects.Container;
  private pageNumberText?: Phaser.GameObjects.Text;
  private leftButton?: Phaser.GameObjects.Container;
  private rightButton?: Phaser.GameObjects.Container;

  constructor() {
    super('Chronicle');
  }

  init(data: ChronicleLaunchData): void {
    this.returnScene = data.returnScene ?? 'Menu';
    this.world = Phaser.Math.Clamp(data.world ?? 0, 0, WORLD_THEMES.length - 1);
    this.level = Phaser.Math.Clamp(data.level ?? 0, 0, LEVELS.length - 1);
    this.score = Math.max(0, data.score ?? 0);
    this.mode = data.mode;
    this.page = Phaser.Math.Clamp(data.page ?? 0, 0, PAGE_NAMES.length - 1);
  }

  preload(): void {
    const v14CharacterKeys = new Set(getArtBundleKeys('characters'));
    queueArtBundle(this, 'characters');
    if (!this.textures.exists('prism_keeper_hero') && !v14CharacterKeys.has('prism_keeper_hero')) {
      this.load.image('prism_keeper_hero', hostedAssetUrl('assets/characters/v13/prism-keeper-hero.webp'));
    }
    if (!this.textures.exists('lumi_guide') && !v14CharacterKeys.has('lumi_guide')) {
      this.load.image('lumi_guide', hostedAssetUrl('assets/characters/v13/lumi-guide.webp'));
    }
  }

  create(): void {
    const { width, height } = VIEW;
    startMusic('story');
    this.cameras.main.fadeIn(180, 0, 0, 0);
    addWorldBackground(this, 'world_celestial', 0.4);
    addAmbientMotes(this, 0x88dcff, 13, 2);
    this.add.rectangle(0, 0, width, height, 0x02050d, 0.36).setOrigin(0).setDepth(3);

    addArtPanel(this, width / 2, 88, 620, 150, 7, 0.97);
    fitText(this.add.text(width / 2, 88, 'THE AURORA CHRONICLE', {
      fontFamily: DISPLAY_FONT, fontSize: TYPE.screen, color: '#91e4ff', fontStyle: 'bold',
      stroke: '#192653', strokeThickness: 5,
    }).setOrigin(0.5).setDepth(10).setShadow(0, 4, '#000000', 9), 500);
    this.add.text(width / 2, 134, STORY_TAGLINE.toUpperCase(), {
      fontFamily: UI_FONT, fontSize: TYPE.caption, color: '#d8e1ef', fontStyle: 'bold', letterSpacing: 1,
    }).setOrigin(0.5).setDepth(10);

    addArtButton(this, 79, 54, '‹  BACK', () => this.goBack(), 128, 48, 14);
    addArtPanel(this, width / 2, 650, 630, 960, 6, 0.98);

    this.pageNumberText = this.add.text(width / 2, height - 120, '', {
      fontFamily: UI_FONT, fontSize: TYPE.caption, color: '#aebdd2', fontStyle: 'bold', letterSpacing: 2,
    }).setOrigin(0.5).setDepth(14);
    this.leftButton = addArtButton(this, 105, height - 67, '‹', () => this.changePage(-1), 96, 58, 14);
    this.rightButton = addArtButton(this, width - 105, height - 67, '›', () => this.changePage(1), 96, 58, 14);
    addArtButton(this, width / 2, height - 67, 'RETURN', () => this.goBack(), 250, 58, 14);

    this.renderPage();
    this.input.keyboard?.on('keydown-LEFT', () => this.changePage(-1));
    this.input.keyboard?.on('keydown-RIGHT', () => this.changePage(1));
    this.input.keyboard?.on('keydown-ESC', () => this.goBack());
    sharpenSceneText(this);
  }

  private renderPage(): void {
    this.pageLayer?.destroy(true);
    this.pageLayer = this.add.container(0, 0).setDepth(11).setAlpha(0);
    this.pageNumberText?.setText(`${String(this.page + 1).padStart(2, '0')}  /  ${String(PAGE_NAMES.length).padStart(2, '0')}`);
    this.leftButton?.setAlpha(this.page === 0 ? 0.38 : 1);
    this.rightButton?.setAlpha(this.page === PAGE_NAMES.length - 1 ? 0.38 : 1);

    const heading = this.add.text(VIEW.width / 2, 210, PAGE_NAMES[this.page], {
      fontFamily: UI_FONT, fontSize: TYPE.title, color: '#ffe3a0', fontStyle: 'bold', letterSpacing: 3,
    }).setOrigin(0.5);
    const rule = this.add.rectangle(VIEW.width / 2, 248, 300, 2, 0x82dcff, 0.42);
    this.pageLayer.add([heading, rule]);

    if (this.page === 0) this.renderOrigin();
    else if (this.page === 1) this.renderCharacters();
    else if (this.page === 2) this.renderRealms();
    else if (this.page === 3) this.renderLore();
    else this.renderProgress();

    this.tweens.add({ targets: this.pageLayer, alpha: 1, duration: 260, ease: 'Cubic.easeOut' });
    sharpenSceneText(this);
  }

  private renderOrigin(): void {
    const title = fitText(this.add.text(VIEW.width / 2, 315, STORY_TITLE, {
      fontFamily: UI_FONT, fontSize: TYPE.title, color: '#ffffff', fontStyle: 'bold',
      stroke: '#151a35', strokeThickness: 4,
    }).setOrigin(0.5), 560);
    this.pageLayer?.add(title);

    ORIGIN_CARDS.forEach((card, index) => {
      const y = 400 + index * 136;
      const accent = index === ORIGIN_CARDS.length - 1 ? 0xffdf8a : index % 2 ? 0xb49aff : 0x83e6ff;
      const cardArt = this.add.graphics();
      cardArt.fillStyle(0x050817, 0.9);
      cardArt.fillRoundedRect(67, y - 64, 586, 128, 16);
      cardArt.lineStyle(2, accent, 0.48);
      cardArt.strokeRoundedRect(67, y - 64, 586, 128, 16);
      cardArt.fillStyle(accent, 0.88);
      cardArt.fillRoundedRect(67, y - 64, 7, 128, 4);
      const number = this.add.text(96, y + 4, String(index + 1).padStart(2, '0'), {
        fontFamily: DISPLAY_FONT, fontSize: TYPE.section, color: index === ORIGIN_CARDS.length - 1 ? '#ffe6a2' : '#bfefff',
        fontStyle: 'bold',
      }).setOrigin(0.5);
      const cardTitle = this.add.text(127, y - 34, card.title, {
        fontFamily: UI_FONT, fontSize: TYPE.caption, color: index === ORIGIN_CARDS.length - 1 ? '#ffe6a2' : '#9cecff',
        fontStyle: 'bold', letterSpacing: 2,
      }).setOrigin(0, 0);
      const body = this.add.text(127, y - 5, card.body, {
        fontFamily: UI_FONT, fontSize: TYPE.caption, color: '#e2eaf5',
        wordWrap: { width: 486, useAdvancedWrap: true }, lineSpacing: 3,
      }).setOrigin(0, 0);
      this.pageLayer?.add([cardArt, number, cardTitle, body]);
    });

    // Keep the canonical long-form premise in the source-of-truth story file;
    // this screen deliberately presents it as five mobile-readable beats.
    void PREMISE;
  }

  private renderCharacters(): void {
    CHARACTERS.forEach((character, index) => {
      const y = 288 + index * 197;
      let identityArt: Phaser.GameObjects.GameObject[];
      if (index === 0) {
        const frame = this.add.ellipse(90, y + 32, 76, 112, 0x62e9f2, 0.09)
          .setStrokeStyle(2, 0xffdfa0, 0.42);
        const portrait = this.add.image(90, y + 36, 'prism_keeper_hero')
          .setDisplaySize(72, 108);
        identityArt = [frame, portrait];
      } else if (index === 1) {
        const frame = this.add.circle(90, y + 30, 43, 0x62e9f2, 0.09)
          .setStrokeStyle(2, 0xffdfa0, 0.42);
        const portrait = this.add.image(90, y + 30, 'lumi_guide')
          .setDisplaySize(86, 86);
        identityArt = [frame, portrait];
      } else {
        const marker = this.add.circle(90, y + 30, 26, index === 3 ? 0xa88cff : 0x62e9f2, 0.12)
          .setStrokeStyle(2, index === 3 ? 0xa88cff : 0xffdfa0, 0.42);
        const number = this.add.text(90, y + 30, String(index + 1).padStart(2, '0'), {
          fontFamily: UI_FONT, fontSize: TYPE.caption, color: '#ffffff', fontStyle: 'bold',
        }).setOrigin(0.5);
        identityArt = [marker, number];
      }
      const name = fitText(this.add.text(132, y, character.name, {
        fontFamily: UI_FONT, fontSize: TYPE.section, color: index === 3 ? '#c8b5ff' : '#8ce8ff', fontStyle: 'bold',
      }).setOrigin(0, 0), 480);
      const role = this.add.text(132, y + 31, character.role, {
        fontFamily: UI_FONT, fontSize: TYPE.caption, color: '#ffe2a2', fontStyle: 'bold', letterSpacing: 1,
      }).setOrigin(0, 0);
      const description = this.add.text(132, y + 65, character.description, {
        fontFamily: UI_FONT, fontSize: TYPE.label, color: '#d5dfec',
        wordWrap: { width: 470, useAdvancedWrap: true }, lineSpacing: 5,
      }).setOrigin(0, 0);
      this.pageLayer?.add([...identityArt, name, role, description]);
    });
  }

  private renderRealms(): void {
    STORY_CHAPTERS.forEach((chapter, index) => {
      const y = 278 + index * 137;
      const world = WORLD_THEMES[index];
      const chapterNo = this.add.text(74, y, chapter.number, {
        fontFamily: UI_FONT, fontSize: TYPE.title, color: world.accentCss, fontStyle: 'bold',
      }).setOrigin(0.5, 0);
      const name = this.add.text(112, y, chapter.title, {
        fontFamily: UI_FONT, fontSize: TYPE.body, color: '#ffffff', fontStyle: 'bold',
      }).setOrigin(0, 0);
      const relic = fitText(this.add.text(112, y + 30, `${chapter.guardian}  •  ${chapter.shard}`, {
        fontFamily: UI_FONT, fontSize: TYPE.caption, color: world.accentCss, fontStyle: 'bold', letterSpacing: 1,
      }).setOrigin(0, 0), 500);
      const summary = this.add.text(112, y + 59, chapter.summary, {
        fontFamily: UI_FONT, fontSize: TYPE.caption, color: '#cbd7e7',
        wordWrap: { width: 490, useAdvancedWrap: true }, lineSpacing: 4,
      }).setOrigin(0, 0);
      this.pageLayer?.add([chapterNo, name, relic, summary]);
    });
  }

  private renderLore(): void {
    CHRONICLE_LORE.forEach((entry, index) => {
      const y = 290 + index * 205;
      const glyph = this.add.text(84, y, ['✦', '♜', '◈', '♛'][index], {
        fontFamily: UI_FONT, fontSize: TYPE.title, color: index % 2 ? '#ffe19a' : '#86e6ff', fontStyle: 'bold',
      }).setOrigin(0.5, 0);
      const title = this.add.text(124, y, entry.title, {
        fontFamily: UI_FONT, fontSize: TYPE.section, color: '#ffffff', fontStyle: 'bold',
      }).setOrigin(0, 0);
      const body = this.add.text(124, y + 45, entry.body, {
        fontFamily: UI_FONT, fontSize: TYPE.label, color: '#d3deed',
        wordWrap: { width: 480, useAdvancedWrap: true }, lineSpacing: 6,
      }).setOrigin(0, 0);
      this.pageLayer?.add([glyph, title, body]);
    });
  }

  private renderProgress(): void {
    const progress = getProgress();
    const story = storyProgressFromStars(progress.stars);
    const total = totalStars(progress);
    const crownColor = story.crownRestored ? '#ffe08a' : '#a4b2c6';
    const crown = this.add.text(VIEW.width / 2, 300, story.crownRestored ? '♛' : '♙', {
      fontFamily: UI_FONT, fontSize: '72px', color: crownColor, fontStyle: 'bold',
      stroke: '#14172c', strokeThickness: 5,
    }).setOrigin(0.5);
    const status = this.add.text(VIEW.width / 2, 395,
      story.crownRestored ? 'AURORA CROWN RESTORED' : `${story.shardsRecovered} / 6 CROWN SHARDS RECOVERED`, {
        fontFamily: UI_FONT, fontSize: TYPE.title, color: crownColor, fontStyle: 'bold',
      }).setOrigin(0.5);
    const totals = this.add.text(VIEW.width / 2, 447,
      `${story.levelsCleared} / ${LEVELS.length} LEVELS CLEARED   •   ${total} / ${LEVELS.length * 3} STARS`, {
        fontFamily: UI_FONT, fontSize: TYPE.label, color: '#d5e0ef', fontStyle: 'bold', letterSpacing: 1,
      }).setOrigin(0.5);
    this.pageLayer?.add([crown, status, totals]);

    STORY_CHAPTERS.forEach((chapter, index) => {
      const cleared = (progress.stars[chapter.levelRange[1]] ?? 0) > 0;
      const visited = progress.unlocked > chapter.levelRange[0];
      const y = 545 + index * 84;
      const marker = this.add.text(82, y, cleared ? '◆' : visited ? '◇' : '·', {
        fontFamily: UI_FONT, fontSize: TYPE.section, color: cleared ? '#ffe08a' : visited ? WORLD_THEMES[index].accentCss : '#596579',
        fontStyle: 'bold',
      }).setOrigin(0.5);
      const label = this.add.text(116, y - 12, `${chapter.number}  ${chapter.title}`, {
        fontFamily: UI_FONT, fontSize: TYPE.body, color: visited ? '#f0f4fb' : '#788497', fontStyle: 'bold',
      }).setOrigin(0, 0);
      const detail = this.add.text(116, y + 18, cleared ? `${chapter.shard}  •  GUARDIAN RESTORED` : visited ? 'JOURNEY IN PROGRESS' : 'CHAPTER SEALED', {
        fontFamily: UI_FONT, fontSize: TYPE.caption, color: cleared ? WORLD_THEMES[index].accentCss : '#8997aa', fontStyle: 'bold', letterSpacing: 1,
      }).setOrigin(0, 0);
      this.pageLayer?.add([marker, label, detail]);
    });
  }

  private changePage(direction: number): void {
    const next = Phaser.Math.Clamp(this.page + direction, 0, PAGE_NAMES.length - 1);
    if (next === this.page) return;
    SFX.click();
    this.page = next;
    this.renderPage();
  }

  private goBack(): void {
    SFX.click();
    if (this.returnScene === 'WorldMap') {
      this.scene.start('WorldMap', { world: this.world });
      return;
    }
    if (this.returnScene === 'Story') {
      this.scene.start('Story', { level: this.level, score: this.score, mode: this.mode });
      return;
    }
    if (this.returnScene === 'Ending') {
      this.scene.start('Ending', { score: this.score, mode: this.mode, replay: false });
      return;
    }
    this.scene.start('Menu');
  }
}

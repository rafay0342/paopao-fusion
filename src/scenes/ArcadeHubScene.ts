import Phaser from 'phaser';
import { VIEW } from '../config';
import { ARCADE_GAME_CATALOG, type ArcadeGameDefinition } from '../game/arcade';
import { arcadeWorldTextureKey } from '../game/arcade-art';
import { getArcadeProgress } from '../game/arcade-progress';
import { getMeta } from '../game/meta';
import { SFX } from '../game/sfx';
import {
  accessibilityRuntimeForCanvas,
  type AccessibilityButtonRegistration,
  type AccessibilitySceneSession,
} from '../gfx/accessibility';
import {
  addAmbientMotes,
  addArtButton,
  addArtPanel,
  addIconFrame,
  addWorldBackground,
  DISPLAY_FONT,
  fitText,
  prefersReducedMotion,
  setArtButtonHitArea,
  sharpenSceneText,
  UI_COLORS,
  UI_FONT,
  updateArtButtonAccessibility,
} from '../gfx/ui';

const PAGE_SIZE = 2;
const CARD_WIDTH = 620;
const CARD_HEIGHT = 292;
const CARD_CENTERS = [390, 715] as const;

function pageCount(): number {
  return Math.max(1, Math.ceil(ARCADE_GAME_CATALOG.length / PAGE_SIZE));
}

export class ArcadeHubScene extends Phaser.Scene {
  private page = 0;
  private pageLayer?: Phaser.GameObjects.Container;
  private pageText?: Phaser.GameObjects.Text;
  private a11y?: AccessibilitySceneSession;
  private cardRegistrations: AccessibilityButtonRegistration[] = [];

  constructor() {
    super('ArcadeHub');
  }

  init(data: { page?: number } = {}): void {
    const requested = Number.isInteger(data.page) ? Number(data.page) : 0;
    this.page = Phaser.Math.Clamp(requested, 0, pageCount() - 1);
    this.pageLayer = undefined;
    this.pageText = undefined;
    this.a11y = undefined;
    this.cardRegistrations = [];
  }

  create(): void {
    const meta = getMeta();
    this.a11y = accessibilityRuntimeForCanvas(this.game.canvas).mountScene({
      id: 'arcade-hub',
      heading: 'PaoPao Arcade',
      description: 'Choose a deterministic PaoPao game. Arcade records are local only and never mint wallet rewards.',
      status: `Page ${this.page + 1} of ${pageCount()}.`,
      lifecycle: this.events,
    });
    addWorldBackground(this, arcadeWorldTextureKey('rainway', meta.quality), 0.1);
    addAmbientMotes(this, 0x74eaff, 22, 2);
    this.cameras.main.fadeIn(prefersReducedMotion() ? 0 : 170, 0, 0, 0);

    addArtPanel(this, VIEW.width / 2, 112, 630, 194, 8, 0.97);
    this.add.text(VIEW.width / 2, 60, 'PAOPAO ARCADE', {
      fontFamily: DISPLAY_FONT,
      fontSize: '48px',
      color: '#ffffff',
      fontStyle: 'bold',
      stroke: '#251752',
      strokeThickness: 7,
      letterSpacing: 1.2,
    }).setOrigin(0.5).setDepth(12);
    this.add.text(VIEW.width / 2, 116, 'THREE NEW DETERMINISTIC CHALLENGES', {
      fontFamily: UI_FONT,
      fontSize: '30px',
      color: '#ffe5a0',
      fontStyle: 'bold',
      letterSpacing: 1.1,
    }).setOrigin(0.5).setDepth(12);
    fitText(this.add.text(
      VIEW.width / 2,
      163,
      'TOUCH  •  KEYS  •  HAND  •  EYES',
      {
        fontFamily: UI_FONT,
        fontSize: '30px',
        color: '#dbe8f8',
        fontStyle: 'bold',
      },
    ).setOrigin(0.5).setDepth(12), 570, 0.9);

    const previous = setArtButtonHitArea(addArtButton(this, 116, 968, '‹', () => {
      this.changePage(-1);
    }, 112, 112, 20), 112, 112);
    const next = setArtButtonHitArea(addArtButton(this, 604, 968, '›', () => {
      this.changePage(1);
    }, 112, 112, 20), 112, 112);
    previous.setName('arcade-page-previous');
    next.setName('arcade-page-next');
    updateArtButtonAccessibility(previous, { label: 'Previous arcade page' });
    updateArtButtonAccessibility(next, { label: 'Next arcade page' });
    this.pageText = this.add.text(VIEW.width / 2, 968, '', {
      fontFamily: UI_FONT,
      fontSize: '32px',
      color: '#f8e1a3',
      fontStyle: 'bold',
      letterSpacing: 1.2,
    }).setOrigin(0.5).setDepth(22);

    addArtPanel(this, VIEW.width / 2, 1_082, 620, 92, 8, 0.95);
    this.add.text(VIEW.width / 2, 1_058, 'LOCAL PRACTICE  •  NO WALLET REWARDS', {
      fontFamily: UI_FONT,
      fontSize: '26px',
      color: '#aef5df',
      fontStyle: 'bold',
      letterSpacing: 0.7,
    }).setOrigin(0.5).setDepth(12);
    this.add.text(VIEW.width / 2, 1_102, 'FAIR DAILY SEEDS  •  REPRODUCIBLE RECORDS', {
      fontFamily: UI_FONT,
      fontSize: '28px',
      color: '#d8e3f2',
      fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(12);

    addArtButton(this, VIEW.width / 2, 1_210, '‹  CHALLENGES', () => {
      SFX.click();
      this.scene.start('ModeSelect');
    }, 360, 78, 20);

    const keyboard = this.input.keyboard;
    const previousPage = (): void => this.changePage(-1);
    const nextPage = (): void => this.changePage(1);
    keyboard?.on('keydown-LEFT', previousPage);
    keyboard?.on('keydown-PAGEUP', previousPage);
    keyboard?.on('keydown-RIGHT', nextPage);
    keyboard?.on('keydown-PAGEDOWN', nextPage);
    const handleBack = (): void => {
      this.scene.start('ModeSelect');
    };
    this.events.on('paopao:back-request', handleBack);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      keyboard?.off('keydown-LEFT', previousPage);
      keyboard?.off('keydown-PAGEUP', previousPage);
      keyboard?.off('keydown-RIGHT', nextPage);
      keyboard?.off('keydown-PAGEDOWN', nextPage);
      this.events.off('paopao:back-request', handleBack);
      this.clearCards();
    });

    this.renderPage();
    sharpenSceneText(this);
  }

  private changePage(direction: number): void {
    const pages = pageCount();
    const next = Phaser.Math.Wrap(this.page + direction, 0, pages);
    if (next === this.page) return;
    SFX.click();
    this.page = next;
    this.renderPage();
  }

  private clearCards(): void {
    this.cardRegistrations.forEach((registration) => registration.unregister());
    this.cardRegistrations = [];
    this.pageLayer?.destroy(true);
    this.pageLayer = undefined;
  }

  private renderPage(): void {
    this.clearCards();
    this.pageLayer = this.add.container(0, 0).setDepth(8);
    const start = this.page * PAGE_SIZE;
    const games = ARCADE_GAME_CATALOG.slice(start, start + PAGE_SIZE);
    games.forEach((game, index) => this.addGameCard(
      game,
      games.length === 1 ? 540 : CARD_CENTERS[index],
    ));
    this.pageText?.setText(`PAGE ${this.page + 1} / ${pageCount()}`);
    const names = games.map((game) => game.title).join(' and ');
    this.a11y?.setStatus(`Page ${this.page + 1} of ${pageCount()}. ${names}.`);
    this.a11y?.announce(`Arcade page ${this.page + 1} of ${pageCount()}. ${names}.`);
    sharpenSceneText(this);
  }

  private addGameCard(game: ArcadeGameDefinition, y: number): void {
    const layer = this.pageLayer!;
    const progress = getArcadeProgress().games[game.id];
    const panel = addArtPanel(this, VIEW.width / 2, y, CARD_WIDTH, CARD_HEIGHT, 9, 0.98);
    const frame = addIconFrame(this, 126, y, 128, game.accent, 11, false);
    const identity = this.add.graphics().setDepth(12);
    this.drawGameIdentity(identity, game, 126, y);
    const title = this.add.text(214, y - 104, game.title.toUpperCase(), {
      fontFamily: DISPLAY_FONT,
      fontSize: '40px',
      color: '#ffffff',
      fontStyle: 'bold',
      stroke: '#1b1038',
      strokeThickness: 5,
    }).setDepth(13);
    fitText(title, 390, 0.78);
    const tagline = this.add.text(214, y - 52, game.tagline.toUpperCase(), {
      fontFamily: UI_FONT,
      fontSize: '28px',
      color: Phaser.Display.Color.IntegerToColor(game.accent).rgba,
      fontStyle: 'bold',
      letterSpacing: 0.4,
    }).setDepth(13);
    fitText(tagline, 390, 0.8);
    const description = this.add.text(214, y - 3, game.description, {
      fontFamily: UI_FONT,
      fontSize: '26px',
      color: '#e2ebf8',
      fontStyle: 'bold',
      lineSpacing: 2,
      wordWrap: { width: 390 },
    }).setDepth(13);
    fitText(description, 390, 0.88);
    const best = this.add.text(
      214,
      y + 126,
      progress.plays > 0
        ? `PLAY  •  BEST ${progress.bestScore.toLocaleString()}  •  RUNS ${progress.plays}`
        : 'PLAY  •  NEW CHALLENGE',
      {
        fontFamily: UI_FONT,
        fontSize: '26px',
        color: '#ffe6a0',
        fontStyle: 'bold',
        letterSpacing: 0.5,
      },
    ).setOrigin(0, 1).setDepth(13);
    fitText(best, 390, 0.88);

    const highlight = this.add.graphics().setDepth(14);
    const drawHighlight = (focused: boolean): void => {
      highlight.clear();
      highlight.lineStyle(focused ? 5 : 2, focused ? UI_COLORS.gold : game.accent, focused ? 0.96 : 0.42);
      highlight.strokeRoundedRect(
        VIEW.width / 2 - CARD_WIDTH / 2 + 5,
        y - CARD_HEIGHT / 2 + 5,
        CARD_WIDTH - 10,
        CARD_HEIGHT - 10,
        18,
      );
    };
    drawHighlight(false);
    const zone = this.add.zone(VIEW.width / 2, y, CARD_WIDTH, CARD_HEIGHT)
      .setDepth(15)
      .setInteractive({ useHandCursor: true });
    const activate = (): void => {
      SFX.click();
      this.scene.start(game.route, game.sceneData ? { ...game.sceneData } : undefined);
    };
    zone.on('pointerover', () => drawHighlight(true));
    zone.on('pointerout', () => drawHighlight(false));
    zone.on('pointerup', activate);
    const registration = this.a11y!.registerButton({
      id: `arcade-${game.id}`,
      label: `Play ${game.title}`,
      description: `${game.tagline} ${game.description}`,
      onActivate: activate,
      onFocusChange: drawHighlight,
    });
    this.cardRegistrations.push(registration);
    layer.add([panel, frame, identity, title, tagline, description, best, highlight, zone]);
  }

  private drawGameIdentity(
    graphics: Phaser.GameObjects.Graphics,
    game: ArcadeGameDefinition,
    x: number,
    y: number,
  ): void {
    graphics.lineStyle(4, game.accent, 0.9);
    if (game.id === 'prism-sprint') {
      const orbs = [
        { x: x - 28, y: y + 22, color: 0x7de2b8, radius: 23 },
        { x: x + 28, y: y + 22, color: 0xb993ff, radius: 23 },
        { x, y: y - 25, color: 0x73eaff, radius: 30 },
      ];
      orbs.forEach((orb) => {
        graphics.fillStyle(orb.color, 0.95);
        graphics.fillCircle(orb.x, orb.y, orb.radius);
        graphics.lineStyle(3, 0xffffff, 0.72);
        graphics.strokeCircle(orb.x, orb.y, orb.radius);
        graphics.fillStyle(0xffffff, 0.72);
        graphics.fillCircle(orb.x - orb.radius * 0.28, orb.y - orb.radius * 0.28, orb.radius * 0.18);
      });
      return;
    }
    if (game.id === 'nexus-aim') {
      graphics.strokeCircle(x, y, 45);
      graphics.strokeCircle(x, y, 24);
      graphics.lineBetween(x - 52, y, x + 52, y);
      graphics.lineBetween(x, y - 52, x, y + 52);
      graphics.fillStyle(UI_COLORS.gold, 0.94);
      graphics.fillPoints([
        { x, y: y - 13 },
        { x: x + 13, y },
        { x, y: y + 13 },
        { x: x - 13, y },
      ], true);
      return;
    }
    for (let row = 0; row < 2; row += 1) {
      for (let col = 0; col < 2; col += 1) {
        const cardX = x - 33 + col * 44;
        const cardY = y - 33 + row * 44;
        graphics.fillStyle((row + col) % 2 ? 0xffd56f : 0xb993ff, 0.82);
        graphics.fillRoundedRect(cardX, cardY, 34, 34, 7);
        graphics.lineStyle(2, 0xffffff, 0.68);
        graphics.strokeRoundedRect(cardX, cardY, 34, 34, 7);
      }
    }
  }
}

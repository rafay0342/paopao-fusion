import Phaser from 'phaser';
import { COLORS, orbTexture, VIEW, WORLD_THEMES } from '../config';
import {
  HandAimPredictor,
  HandDragSwapController,
  HandGestureContinuityGate,
  PinchDoubleTapControl,
  type HandGridCell,
  type HandGridDragFrame,
} from '../game/handcontrol';
import { getHandSettings } from '../game/handsettings';
import { getHandTracker, type HandSample, type HandTrackingFailure } from '../game/handtracking';
import {
  MATCH3_COLUMNS,
  MATCH3_LEVEL_COUNT,
  MATCH3_ROWS,
  areMatch3Neighbors,
  createMatch3State,
  getMatch3LevelDefinition,
  match3Hint,
  tryMatch3Swap,
  useMatch3Booster,
  type Match3ActionResult,
  type Match3Board,
  type Match3Booster,
  type Match3Color,
  type Match3Coordinate,
  type Match3ResolutionStep,
  type Match3Special,
  type Match3State,
} from '../game/match3';
import {
  getMatch3Progress,
  isMatch3LevelUnlocked,
  match3StarsForScore,
  recordMatch3Clear,
} from '../game/match3-progress';
import { getMeta, getQualityProfile, type QualityProfile } from '../game/meta';
import { startMusic } from '../game/music';
import { SFX } from '../game/sfx';
import {
  addAmbientMotes,
  addArtButton,
  addArtPanel,
  addWorldBackground,
  applyLiveSceneQuality,
  DISPLAY_FONT,
  fitText,
  prefersReducedMotion,
  sharpenSceneText,
  TYPE,
  UI_COLORS,
  UI_FONT,
} from '../gfx/ui';

interface Match3SceneData {
  level?: number;
}

const BOARD_X = 72;
const BOARD_Y = 286;
const CELL_SIZE = 72;
const BOARD_WIDTH = CELL_SIZE * MATCH3_COLUMNS;
const BOARD_HEIGHT = CELL_SIZE * MATCH3_ROWS;
const BOARD_BOTTOM = BOARD_Y + BOARD_HEIGHT;
const HAND_LOSS_HIDE_MS = 450;
const HAND_LOSS_RESET_MS = 1_200;

const coordinateKey = ({ row, col }: Match3Coordinate): string => `${row}:${col}`;

function cellCenter(coordinate: Match3Coordinate): { x: number; y: number } {
  return {
    x: BOARD_X + coordinate.col * CELL_SIZE + CELL_SIZE / 2,
    y: BOARD_Y + coordinate.row * CELL_SIZE + CELL_SIZE / 2,
  };
}

function handFailureMessage(failure: HandTrackingFailure): string {
  if (failure === 'permission-denied') return 'CAMERA BLOCKED — ALLOW CAMERA, THEN RETRY';
  if (failure === 'no-camera') return 'NO CAMERA FOUND';
  if (failure === 'camera-busy') return 'CAMERA IS BUSY IN ANOTHER APP';
  if (failure === 'insecure-context') return 'HAND MODE REQUIRES HTTPS';
  if (failure === 'unsupported') return 'HAND MODE IS NOT SUPPORTED HERE';
  if (failure === 'model-load-failed') return 'HAND MODEL FAILED — RELOAD AND RETRY';
  return 'HAND CAMERA COULD NOT START';
}

export class Match3Scene extends Phaser.Scene {
  private level = 0;
  private state!: Match3State;
  private quality!: QualityProfile;
  private readonly reducedMotion = prefersReducedMotion();
  private pieceLayer?: Phaser.GameObjects.Container;
  private effectLayer?: Phaser.GameObjects.Container;
  private selectionGraphics?: Phaser.GameObjects.Graphics;
  private tileViews = new Map<number, Phaser.GameObjects.Container>();
  private selected: Match3Coordinate | null = null;
  private candidate: Match3Coordinate | null = null;
  private pointerDown: Match3Coordinate | null = null;
  private keyboardCell: Match3Coordinate = { row: 3, col: 3 };
  private inputLocked = false;
  private activeBooster: Match3Booster | null = null;
  private terminalShown = false;
  private pauseShown = false;

  private scoreText?: Phaser.GameObjects.Text;
  private movesText?: Phaser.GameObjects.Text;
  private chainText?: Phaser.GameObjects.Text;
  private objectivesText?: Phaser.GameObjects.Text;
  private boosterButtons: Partial<Record<Match3Booster, Phaser.GameObjects.Container>> = {};
  private statusText?: Phaser.GameObjects.Text;

  private handOn = false;
  private handStarting = false;
  private handHasSeen = false;
  private handActivationGeneration = 0;
  private handReleaseThreshold = 0.5;
  private handLastSeenAt = 0;
  private handCursor?: Phaser.GameObjects.Arc;
  private handButton?: Phaser.GameObjects.Container;
  private handButtonText?: Phaser.GameObjects.Text;
  private handBoosterTarget: Match3Coordinate | null = null;
  private pinchControl = new PinchDoubleTapControl(undefined, undefined, { fireOnFirstRelease: true });
  private readonly handAimPredictor = new HandAimPredictor(32, 0.04, 180);
  private readonly handContinuity = new HandGestureContinuityGate();
  private readonly handDrag = new HandDragSwapController();

  private readonly handleQualityChange = (): void => {
    if (!this.scene.isActive()) return;
    this.quality = getQualityProfile();
    applyLiveSceneQuality(this, this.quality);
  };

  private readonly handleRenderContextBoundary = (): void => {
    if (!this.scene.isActive()) return;
    this.pinchControl.resetForContinuity();
    this.handAimPredictor.reset();
    this.handContinuity.reset();
    this.handDrag.cancel();
    this.handBoosterTarget = null;
    this.handHasSeen = false;
    this.handLastSeenAt = 0;
    this.handCursor?.setVisible(false);
    this.clearSelection();
    this.setStatus('HAND STABILIZING', '#ffe083');
  };

  constructor() {
    super('Match3');
  }

  init(data: Match3SceneData = {}): void {
    const requested = Number.isInteger(data.level) ? Number(data.level) : 0;
    const progress = getMatch3Progress();
    const highestOpen = Math.max(0, progress.unlocked - 1);
    this.level = Phaser.Math.Clamp(requested, 0, Math.min(MATCH3_LEVEL_COUNT - 1, highestOpen));
    this.state = createMatch3State(this.level);
    this.quality = getQualityProfile();
    this.selected = null;
    this.candidate = null;
    this.pointerDown = null;
    this.keyboardCell = { row: 3, col: 3 };
    this.inputLocked = false;
    this.activeBooster = null;
    this.terminalShown = false;
    this.pauseShown = false;
    this.handOn = false;
    this.handStarting = false;
    this.handHasSeen = false;
    this.handLastSeenAt = 0;
    this.handBoosterTarget = null;
    this.tileViews.clear();
    this.handAimPredictor.reset();
    this.handContinuity.reset();
    this.handDrag.cancel();
    const settings = getHandSettings();
    this.handReleaseThreshold = settings.pinchOff;
    this.pinchControl = new PinchDoubleTapControl(
      settings.pinchOn,
      settings.pinchOff,
      { fireOnFirstRelease: true },
    );
  }

  create(): void {
    const definition = getMatch3LevelDefinition(this.level);
    const world = WORLD_THEMES[definition.world];
    startMusic(definition.act === 4 ? 'boss' : 'game');
    addWorldBackground(this, world.background, 0.23);
    addAmbientMotes(this, world.accent, 18, 2);
    this.cameras.main.fadeIn(160, 0, 0, 0);

    this.add.text(VIEW.width / 2, 48, 'PRISM CASCADE', {
      fontFamily: DISPLAY_FONT,
      fontSize: TYPE.screen,
      color: '#ffffff',
      fontStyle: 'bold',
      stroke: '#23143e',
      strokeThickness: 7,
      letterSpacing: 1.2,
    }).setOrigin(0.5).setDepth(12).setShadow(0, 5, '#000000', 10);
    fitText(this.add.text(VIEW.width / 2, 94, `${world.name.toUpperCase()}  •  ${definition.name.toUpperCase()}`, {
      fontFamily: UI_FONT,
      fontSize: TYPE.label,
      color: world.accentCss,
      fontStyle: 'bold',
      letterSpacing: 1.1,
    }).setOrigin(0.5).setDepth(12), 500);
    addArtButton(this, 82, 48, '‹ MAP', () => this.showPause(), 132, 50, 16);

    addArtPanel(this, VIEW.width / 2, 170, 640, 112, 8, 0.97);
    this.movesText = this.add.text(112, 154, '', {
      fontFamily: UI_FONT, fontSize: TYPE.metric, color: '#ffe7a6', fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(12);
    this.scoreText = this.add.text(VIEW.width / 2, 154, '', {
      fontFamily: UI_FONT, fontSize: TYPE.metric, color: '#ffffff', fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(12);
    this.chainText = this.add.text(608, 154, '', {
      fontFamily: UI_FONT, fontSize: TYPE.control, color: '#8fffd0', fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(12);
    this.add.text(VIEW.width / 2, 202, 'SWAP ADJACENT ORBS  •  CASCADES BUILD SCORE', {
      fontFamily: UI_FONT, fontSize: TYPE.caption, color: '#b8c9dc', fontStyle: 'bold', letterSpacing: 0.5,
    }).setOrigin(0.5).setDepth(12);

    addArtPanel(this, VIEW.width / 2, BOARD_Y + BOARD_HEIGHT / 2, 628, 604, 5, 0.97);
    this.drawBoardGrid(world.accent);
    this.pieceLayer = this.add.container(0, 0).setDepth(10);
    this.effectLayer = this.add.container(0, 0).setDepth(22);
    this.selectionGraphics = this.add.graphics().setDepth(21);
    this.renderBoard(this.state.board, true);

    addArtPanel(this, VIEW.width / 2, 932, 640, 108, 7, 0.97);
    this.add.text(52, 895, 'OBJECTIVES', {
      fontFamily: UI_FONT, fontSize: TYPE.caption, color: '#e6c982', fontStyle: 'bold', letterSpacing: 1.7,
    }).setDepth(12);
    this.objectivesText = this.add.text(52, 928, '', {
      fontFamily: UI_FONT,
      fontSize: TYPE.control,
      color: '#e6edf8',
      fontStyle: 'bold',
      wordWrap: { width: 616 },
      lineSpacing: 5,
    }).setOrigin(0, 0.5).setDepth(12);

    this.boosterButtons.hammer = addArtButton(this, 128, 1_030, 'HAMMER ×1', () => {
      this.selectBooster('hammer');
    }, 196, 58, 16);
    this.boosterButtons.shuffle = addArtButton(this, 360, 1_030, 'RESHUFFLE ×1', () => {
      void this.activateShuffle();
    }, 224, 58, 16);
    this.boosterButtons.spectrum = addArtButton(this, 592, 1_030, 'PRISM ×1', () => {
      this.selectBooster('spectrum');
    }, 196, 58, 16);

    addArtButton(this, 112, 1_112, 'HINT', () => this.showHint(), 168, 58, 16);
    this.handButton = addArtButton(this, 360, 1_112, 'HAND  •  OFF', () => {
      void this.toggleHand();
    }, 286, 58, 16);
    this.handButtonText = this.handButton.list.find(
      (child): child is Phaser.GameObjects.Text => child instanceof Phaser.GameObjects.Text,
    );
    addArtButton(this, 608, 1_112, 'RESTART', () => this.restartLevel(), 168, 58, 16);

    this.statusText = this.add.text(VIEW.width / 2, 1_176, 'DRAG, TAP-TAP, ARROWS + SPACE, OR PINCH + PALM SWIPE', {
      fontFamily: UI_FONT,
      fontSize: TYPE.caption,
      color: '#aebdd1',
      fontStyle: 'bold',
      align: 'center',
    }).setOrigin(0.5).setDepth(12);
    fitText(this.statusText, 650);
    this.handCursor = this.add.circle(0, 0, 19, 0x5ef2e3, 0.14)
      .setStrokeStyle(4, 0xe7fff9, 0.94)
      .setDepth(30)
      .setVisible(false);

    this.bindInput();
    this.updateHud();
    this.drawSelection();
    this.cameras.main.setRoundPixels(false);
    window.addEventListener('paopao:quality-adapted', this.handleQualityChange);
    window.addEventListener('paopao:render-context-boundary', this.handleRenderContextBoundary);
    this.events.on('paopao:back-request', this.showPause, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      window.removeEventListener('paopao:quality-adapted', this.handleQualityChange);
      window.removeEventListener('paopao:render-context-boundary', this.handleRenderContextBoundary);
      this.events.off('paopao:back-request', this.showPause, this);
      this.unbindInput();
      this.pinchControl.reset();
      this.handAimPredictor.reset();
      this.handContinuity.reset();
      this.handDrag.cancel();
      this.handActivationGeneration += 1;
      this.handStarting = false;
      this.handOn = false;
      getHandTracker().suspend();
    });
    const tracker = getHandTracker();
    if (tracker.isWanted()) void this.startHandTracking();
    else void tracker.prepare().catch(() => undefined);
    sharpenSceneText(this);
  }

  update(): void {
    if (!this.handOn || this.inputLocked || this.pauseShown || this.terminalShown) return;
    this.pollHand();
    this.advanceHandCursor();
  }

  private drawBoardGrid(accent: number): void {
    const grid = this.add.graphics().setDepth(8);
    grid.fillStyle(0x020611, 0.58);
    grid.fillRoundedRect(BOARD_X - 8, BOARD_Y - 8, BOARD_WIDTH + 16, BOARD_HEIGHT + 16, 22);
    grid.lineStyle(2, accent, 0.34);
    grid.strokeRoundedRect(BOARD_X - 8, BOARD_Y - 8, BOARD_WIDTH + 16, BOARD_HEIGHT + 16, 22);
    for (let row = 0; row < MATCH3_ROWS; row += 1) {
      for (let col = 0; col < MATCH3_COLUMNS; col += 1) {
        const x = BOARD_X + col * CELL_SIZE + 4;
        const y = BOARD_Y + row * CELL_SIZE + 4;
        grid.fillStyle((row + col) % 2 === 0 ? 0x0d2034 : 0x09182a, 0.72);
        grid.fillRoundedRect(x, y, CELL_SIZE - 8, CELL_SIZE - 8, 14);
        grid.lineStyle(1, accent, 0.12);
        grid.strokeRoundedRect(x, y, CELL_SIZE - 8, CELL_SIZE - 8, 14);
      }
    }
  }

  private renderBoard(board: Match3Board, animate = false): void {
    if (!this.pieceLayer) return;
    this.pieceLayer.removeAll(true);
    this.tileViews.clear();
    const skin = getMeta().equippedSkin;
    for (let row = 0; row < MATCH3_ROWS; row += 1) {
      for (let col = 0; col < MATCH3_COLUMNS; col += 1) {
        const coordinate = { row, col };
        const cell = board[row][col];
        const center = cellCenter(coordinate);
        const view = this.add.container(center.x, center.y);
        if (cell.tile) {
          const texture = cell.tile.special === 'spectrum'
            ? 'power_rainbow'
            : orbTexture(skin, cell.tile.color as Match3Color);
          const orb = this.add.image(0, 0, texture).setDisplaySize(60, 60);
          orb.setData('paopaoMatch3TileId', cell.tile.id);
          view.add(orb);
          this.addSpecialIdentity(view, cell.tile.special, cell.tile.color);
          this.tileViews.set(cell.tile.id, view);
        }
        if (cell.shell > 0) {
          const shell = this.add.image(0, 0, 'mechanic_crystal_seal')
            .setDisplaySize(66, 66)
            .setAlpha(0.82);
          view.add(shell);
          if (cell.shell > 1) {
            view.add(this.add.text(22, 20, String(cell.shell), {
              fontFamily: UI_FONT, fontSize: '18px', color: '#ffffff', fontStyle: 'bold',
              stroke: '#18214d', strokeThickness: 3,
            }).setOrigin(0.5));
          }
        }
        if (cell.vine) {
          view.add(this.add.image(0, 0, 'mechanic_vine_bind').setDisplaySize(65, 65).setAlpha(0.86));
        }
        this.pieceLayer.add(view);
        if (animate && !this.reducedMotion) {
          view.setScale(0.72).setAlpha(0);
          this.tweens.add({
            targets: view,
            scale: 1,
            alpha: 1,
            delay: (row * MATCH3_COLUMNS + col) * 4,
            duration: 180,
            ease: 'Back.easeOut',
          });
        }
      }
    }
  }

  private addSpecialIdentity(
    view: Phaser.GameObjects.Container,
    special: Match3Special | null,
    color: Match3Color | null,
  ): void {
    if (!special || special === 'spectrum') return;
    const accent = color ? COLORS[color].hex : 0xffffff;
    const graphic = this.add.graphics();
    if (special === 'row') {
      graphic.fillStyle(0xffffff, 0.74);
      graphic.fillRoundedRect(-29, -5, 58, 10, 5);
      graphic.lineStyle(2, accent, 1);
      graphic.lineBetween(-26, 0, 26, 0);
    } else if (special === 'column') {
      graphic.fillStyle(0xffffff, 0.74);
      graphic.fillRoundedRect(-5, -29, 10, 58, 5);
      graphic.lineStyle(2, accent, 1);
      graphic.lineBetween(0, -26, 0, 26);
    } else {
      graphic.fillStyle(0xffffff, 0.62);
      graphic.fillPoints([
        { x: 0, y: -27 }, { x: 8, y: -9 }, { x: 27, y: 0 }, { x: 8, y: 9 },
        { x: 0, y: 27 }, { x: -8, y: 9 }, { x: -27, y: 0 }, { x: -8, y: -9 },
      ], true);
      graphic.lineStyle(2, accent, 0.94);
      graphic.strokeCircle(0, 0, 17);
    }
    view.add(graphic);
  }

  private bindInput(): void {
    this.input.on('pointerdown', this.handlePointerDown, this);
    this.input.on('pointermove', this.handlePointerMove, this);
    this.input.on('pointerup', this.handlePointerUp, this);
    this.input.keyboard?.on('keydown', this.handleKeyboard, this);
  }

  private unbindInput(): void {
    this.input.off('pointerdown', this.handlePointerDown, this);
    this.input.off('pointermove', this.handlePointerMove, this);
    this.input.off('pointerup', this.handlePointerUp, this);
    this.input.keyboard?.off('keydown', this.handleKeyboard, this);
  }

  private cellAtPoint(x: number, y: number): Match3Coordinate | null {
    if (x < BOARD_X || x >= BOARD_X + BOARD_WIDTH || y < BOARD_Y || y >= BOARD_BOTTOM) return null;
    return {
      row: Math.floor((y - BOARD_Y) / CELL_SIZE),
      col: Math.floor((x - BOARD_X) / CELL_SIZE),
    };
  }

  private handlePointerDown(pointer: Phaser.Input.Pointer): void {
    if (this.inputLocked || this.pauseShown || this.terminalShown) return;
    const cell = this.cellAtPoint(pointer.x, pointer.y);
    if (!cell) return;
    if (this.activeBooster) {
      this.pointerDown = cell;
      return;
    }
    this.pointerDown = cell;
    this.candidate = null;
    this.keyboardCell = { ...cell };
    if (!this.selected || !areMatch3Neighbors(this.selected, cell)) this.selected = { ...cell };
    this.drawSelection();
  }

  private handlePointerMove(pointer: Phaser.Input.Pointer): void {
    if (!pointer.isDown || !this.pointerDown || this.inputLocked || this.activeBooster) return;
    const cell = this.cellAtPoint(pointer.x, pointer.y);
    this.candidate = cell && areMatch3Neighbors(this.pointerDown, cell) ? { ...cell } : null;
    this.drawSelection(this.pointerDown, this.candidate);
  }

  private handlePointerUp(pointer: Phaser.Input.Pointer): void {
    if (!this.pointerDown || this.inputLocked || this.pauseShown || this.terminalShown) return;
    const down = this.pointerDown;
    this.pointerDown = null;
    const released = this.cellAtPoint(pointer.x, pointer.y) ?? down;
    if (this.activeBooster) {
      const booster = this.activeBooster;
      this.activeBooster = null;
      void this.applyBooster(booster, released);
      return;
    }
    if (areMatch3Neighbors(down, released)) {
      void this.attemptSwap(down, released);
      return;
    }
    if (this.selected && !this.sameCell(this.selected, released) && areMatch3Neighbors(this.selected, released)) {
      void this.attemptSwap(this.selected, released);
      return;
    }
    this.selected = { ...released };
    this.candidate = null;
    this.drawSelection();
  }

  private handleKeyboard(event: KeyboardEvent): void {
    if (this.inputLocked || this.pauseShown || this.terminalShown || event.repeat) return;
    let moved = false;
    if (event.key === 'ArrowLeft' || event.key.toLowerCase() === 'a') {
      this.keyboardCell.col = Math.max(0, this.keyboardCell.col - 1);
      moved = true;
    } else if (event.key === 'ArrowRight' || event.key.toLowerCase() === 'd') {
      this.keyboardCell.col = Math.min(MATCH3_COLUMNS - 1, this.keyboardCell.col + 1);
      moved = true;
    } else if (event.key === 'ArrowUp' || event.key.toLowerCase() === 'w') {
      this.keyboardCell.row = Math.max(0, this.keyboardCell.row - 1);
      moved = true;
    } else if (event.key === 'ArrowDown' || event.key.toLowerCase() === 's') {
      this.keyboardCell.row = Math.min(MATCH3_ROWS - 1, this.keyboardCell.row + 1);
      moved = true;
    } else if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault();
      if (this.activeBooster) {
        const booster = this.activeBooster;
        this.activeBooster = null;
        void this.applyBooster(booster, this.keyboardCell);
      } else if (this.selected && areMatch3Neighbors(this.selected, this.keyboardCell)) {
        void this.attemptSwap(this.selected, this.keyboardCell);
      } else {
        this.selected = { ...this.keyboardCell };
        this.drawSelection();
      }
      return;
    }
    if (moved) {
      event.preventDefault();
      this.candidate = this.selected && areMatch3Neighbors(this.selected, this.keyboardCell)
        ? { ...this.keyboardCell }
        : null;
      this.drawSelection(this.selected ?? this.keyboardCell, this.candidate);
    }
  }

  private sameCell(first: Match3Coordinate | null, second: Match3Coordinate | null): boolean {
    return Boolean(first && second && first.row === second.row && first.col === second.col);
  }

  private drawSelection(
    selected: Match3Coordinate | null = this.selected,
    candidate: Match3Coordinate | null = this.candidate,
  ): void {
    const graphics = this.selectionGraphics;
    if (!graphics) return;
    graphics.clear();
    const drawCell = (coordinate: Match3Coordinate, color: number, width: number, alpha: number): void => {
      const center = cellCenter(coordinate);
      graphics.lineStyle(width, color, alpha);
      graphics.strokeRoundedRect(
        center.x - CELL_SIZE / 2 + 5,
        center.y - CELL_SIZE / 2 + 5,
        CELL_SIZE - 10,
        CELL_SIZE - 10,
        14,
      );
    };
    if (selected) drawCell(selected, 0xffdf82, 4, 0.96);
    if (candidate) {
      drawCell(candidate, 0x64f3e5, 4, 0.96);
      const first = cellCenter(selected ?? candidate);
      const second = cellCenter(candidate);
      graphics.lineStyle(3, 0xffffff, 0.72);
      graphics.lineBetween(first.x, first.y, second.x, second.y);
    }
    if (!selected) drawCell(this.keyboardCell, 0xa9b9d2, 2, 0.42);
  }

  private clearSelection(): void {
    this.selected = null;
    this.candidate = null;
    this.pointerDown = null;
    this.selectionGraphics?.clear();
  }

  private async attemptSwap(from: Match3Coordinate, to: Match3Coordinate): Promise<void> {
    if (this.inputLocked || this.state.status !== 'active') return;
    const result = tryMatch3Swap(this.state, from, to);
    if (!result.accepted) {
      SFX.click();
      this.setStatus('THAT SWAP MAKES NO MATCH', '#ffb27d');
      await this.animateRejectedSwap(from, to);
      this.selected = { ...from };
      this.candidate = null;
      this.drawSelection();
      return;
    }
    this.inputLocked = true;
    this.clearSelection();
    await this.animateAcceptedSwap(from, to);
    await this.playResolution(result);
  }

  private async animateAcceptedSwap(from: Match3Coordinate, to: Match3Coordinate): Promise<void> {
    if (this.reducedMotion) return;
    const firstTile = this.state.board[from.row][from.col].tile;
    const secondTile = this.state.board[to.row][to.col].tile;
    const firstView = firstTile ? this.tileViews.get(firstTile.id) : null;
    const secondView = secondTile ? this.tileViews.get(secondTile.id) : null;
    const fromCenter = cellCenter(from);
    const toCenter = cellCenter(to);
    const tweens: Promise<void>[] = [];
    if (firstView) tweens.push(this.tweenTo(firstView, { x: toCenter.x, y: toCenter.y }, 120, 'Sine.easeInOut'));
    if (secondView) tweens.push(this.tweenTo(secondView, { x: fromCenter.x, y: fromCenter.y }, 120, 'Sine.easeInOut'));
    await Promise.all(tweens);
  }

  private async animateRejectedSwap(from: Match3Coordinate, to: Match3Coordinate): Promise<void> {
    if (this.reducedMotion) return;
    const firstTile = this.state.board[from.row][from.col].tile;
    const secondTile = this.state.board[to.row][to.col].tile;
    const firstView = firstTile ? this.tileViews.get(firstTile.id) : null;
    const secondView = secondTile ? this.tileViews.get(secondTile.id) : null;
    const fromCenter = cellCenter(from);
    const toCenter = cellCenter(to);
    await Promise.all([
      firstView ? this.tweenTo(firstView, { x: toCenter.x, y: toCenter.y }, 85, 'Quad.easeOut') : Promise.resolve(),
      secondView ? this.tweenTo(secondView, { x: fromCenter.x, y: fromCenter.y }, 85, 'Quad.easeOut') : Promise.resolve(),
    ]);
    await Promise.all([
      firstView ? this.tweenTo(firstView, fromCenter, 100, 'Back.easeOut') : Promise.resolve(),
      secondView ? this.tweenTo(secondView, toCenter, 100, 'Back.easeOut') : Promise.resolve(),
    ]);
  }

  private async playResolution(result: Match3ActionResult): Promise<void> {
    let displayScore = this.state.score;
    for (const step of result.steps) {
      if (!this.sys.isActive()) return;
      if (step.kind === 'clear') {
        this.setStatus(
          step.cascade > 1 ? `CASCADE ×${step.cascade}` : step.activated.length ? 'SPECIAL FUSION' : 'PRISM MATCH',
          step.cascade > 1 ? '#ffe083' : '#76f0c7',
        );
        SFX.pop(Math.max(0, step.cascade - 1));
        await this.animateClearStep(step);
        displayScore += step.scoreDelta;
        this.renderBoard(step.board, true);
        this.scoreText?.setText(`SCORE\n${displayScore.toLocaleString()}`);
        if (!this.reducedMotion) await this.delay(120);
      } else {
        SFX.drop();
        this.setStatus(step.kind === 'shuffle' ? 'NO DEAD BOARD — AUTO RESHUFFLED' : 'PRISM CORE FORGED', '#a9e8ff');
        await this.animateBoardTransition(step.board);
      }
    }
    this.state = result.state;
    this.renderBoard(this.state.board);
    this.updateHud();
    this.inputLocked = false;
    if (this.state.status === 'won') this.showTerminal(true);
    else if (this.state.status === 'lost') this.showTerminal(false);
    else this.setStatus('READY — BUILD THE NEXT CASCADE', '#aebdd1');
  }

  private async animateClearStep(step: Match3ResolutionStep): Promise<void> {
    this.effectLayer?.removeAll(true);
    const tweens: Promise<void>[] = [];
    for (const cleared of step.cleared) {
      const view = this.tileViews.get(cleared.tile.id);
      if (view && !this.reducedMotion) {
        tweens.push(this.tweenTo(view, { alpha: 0, scaleX: 1.42, scaleY: 1.42, angle: 18 }, 170, 'Quad.easeOut'));
      }
      const center = cellCenter(cleared.at);
      const tint = cleared.tile.color ? COLORS[cleared.tile.color].hex : 0xffffff;
      const ring = this.add.circle(center.x, center.y, 13, tint, 0.24)
        .setStrokeStyle(3, 0xffffff, 0.78);
      this.effectLayer?.add(ring);
      if (!this.reducedMotion) {
        tweens.push(this.tweenTo(ring, { radius: 38, alpha: 0 }, 230, 'Cubic.easeOut'));
      }
    }
    if (step.activated.length > 0 && !this.reducedMotion) {
      this.cameras.main.shake(90, Math.min(0.006, 0.002 + step.activated.length * 0.0007));
    }
    if (tweens.length) await Promise.all(tweens);
    else if (!this.reducedMotion) await this.delay(80);
    this.effectLayer?.removeAll(true);
  }

  private async animateBoardTransition(board: Match3Board): Promise<void> {
    if (!this.pieceLayer || this.reducedMotion) {
      this.renderBoard(board);
      return;
    }
    await this.tweenTo(this.pieceLayer, { alpha: 0, scaleX: 0.94, scaleY: 0.94 }, 130, 'Quad.easeIn');
    this.renderBoard(board);
    this.pieceLayer.setAlpha(0).setScale(1.06);
    await this.tweenTo(this.pieceLayer, { alpha: 1, scaleX: 1, scaleY: 1 }, 190, 'Back.easeOut');
  }

  private tweenTo(
    target: Phaser.GameObjects.GameObject,
    values: Record<string, number>,
    duration: number,
    ease: string,
  ): Promise<void> {
    if (!this.sys.isActive()) return Promise.resolve();
    return new Promise((resolve) => {
      this.tweens.add({
        targets: target,
        ...values,
        duration,
        ease,
        onComplete: () => resolve(),
      });
    });
  }

  private delay(milliseconds: number): Promise<void> {
    if (!this.sys.isActive() || milliseconds <= 0) return Promise.resolve();
    return new Promise((resolve) => {
      this.time.delayedCall(milliseconds, resolve);
    });
  }

  private selectBooster(booster: Match3Booster): void {
    if (this.inputLocked || this.state.status !== 'active') return;
    if (this.state.boosters[booster] <= 0) {
      this.setStatus('THAT BOOSTER IS EMPTY FOR THIS RUN', '#ffb27d');
      return;
    }
    this.activeBooster = this.activeBooster === booster ? null : booster;
    this.clearSelection();
    this.setStatus(
      this.activeBooster
        ? `${booster === 'hammer' ? 'HAMMER' : 'PRISM CORE'} ARMED — CHOOSE ONE ORB`
        : 'BOOSTER CANCELLED',
      this.activeBooster ? '#ffe083' : '#aebdd1',
    );
  }

  private async activateShuffle(): Promise<void> {
    if (this.inputLocked || this.state.status !== 'active') return;
    const result = useMatch3Booster(this.state, 'shuffle');
    if (!result.accepted) {
      this.setStatus('RESHUFFLE IS EMPTY', '#ffb27d');
      return;
    }
    this.inputLocked = true;
    this.activeBooster = null;
    this.clearSelection();
    await this.playResolution(result);
  }

  private async applyBooster(booster: Match3Booster, coordinate: Match3Coordinate): Promise<void> {
    if (this.inputLocked || this.state.status !== 'active') return;
    const result = useMatch3Booster(this.state, booster, coordinate);
    if (!result.accepted) {
      this.setStatus('CHOOSE A LIVE ORB', '#ffb27d');
      return;
    }
    this.inputLocked = true;
    this.clearSelection();
    SFX.shoot();
    await this.playResolution(result);
  }

  private showHint(): void {
    if (this.inputLocked || this.state.status !== 'active') return;
    const hint = match3Hint(this.state);
    if (!hint) {
      this.setStatus('RESHUFFLING FOR A FRESH PATH…', '#ffe083');
      return;
    }
    this.selected = { ...hint.from };
    this.candidate = { ...hint.to };
    this.drawSelection();
    this.setStatus('HINT — SWAP THE TWO GLOWING ORBS', '#a9e8ff');
    this.time.delayedCall(1_800, () => {
      if (!this.sys.isActive() || this.inputLocked) return;
      this.candidate = null;
      this.drawSelection();
    });
  }

  private updateHud(): void {
    const definition = getMatch3LevelDefinition(this.level);
    this.movesText?.setText(`MOVES\n${this.state.movesRemaining}`);
    this.scoreText?.setText(`SCORE\n${this.state.score.toLocaleString()}`);
    this.chainText?.setText(`BEST\n×${Math.max(1, this.state.comboPeak)}`);
    const objectiveParts: string[] = [
      `SCORE ${Math.min(this.state.score, this.state.goals.targetScore).toLocaleString()} / ${this.state.goals.targetScore.toLocaleString()}`,
    ];
    for (const [color, target] of Object.entries(this.state.goals.collect)) {
      const typedColor = color as Match3Color;
      objectiveParts.push(
        `${COLORS[typedColor].name.toUpperCase()} ${Math.min(this.state.progress.collected[typedColor], target ?? 0)} / ${target}`,
      );
    }
    if (this.state.goals.shells > 0) {
      objectiveParts.push(`SHELLS ${Math.min(this.state.progress.shellsCleared, this.state.goals.shells)} / ${this.state.goals.shells}`);
    }
    if (this.state.goals.vines > 0) {
      objectiveParts.push(`VINES ${Math.min(this.state.progress.vinesCleared, this.state.goals.vines)} / ${this.state.goals.vines}`);
    }
    this.objectivesText?.setText(objectiveParts.join('   •   '));
    fitText(this.objectivesText!, 616, 0.78);
    for (const booster of ['hammer', 'shuffle', 'spectrum'] as const) {
      const text = this.boosterButtons[booster]?.list.find(
        (child): child is Phaser.GameObjects.Text => child instanceof Phaser.GameObjects.Text,
      );
      const label = booster === 'hammer' ? 'HAMMER' : booster === 'shuffle' ? 'RESHUFFLE' : 'PRISM';
      text?.setText(`${label} ×${this.state.boosters[booster]}`);
    }
    if (definition.goals.shells === 0 && definition.goals.vines === 0) {
      this.objectivesText?.setColor('#dfefff');
    }
  }

  private setStatus(message: string, color: string): void {
    if (!this.statusText) return;
    this.statusText.setText(message).setColor(color);
    fitText(this.statusText, 650, 0.76);
  }

  private restartLevel(): void {
    if (this.inputLocked) return;
    SFX.click();
    this.scene.restart({ level: this.level });
  }

  private showTerminal(won: boolean): void {
    if (this.terminalShown || !this.sys.isActive()) return;
    this.terminalShown = true;
    this.inputLocked = true;
    this.clearSelection();
    this.handCursor?.setVisible(false);
    this.suspendHandTracking();
    if (won) {
      recordMatch3Clear(this.level, this.state.score);
      SFX.win();
    } else {
      SFX.lose();
    }
    const shield = this.add.rectangle(VIEW.width / 2, VIEW.height / 2, VIEW.width, VIEW.height, 0x02040c, 0.82)
      .setDepth(60)
      .setInteractive();
    addArtPanel(this, VIEW.width / 2, 640, 628, 520, 62, 1);
    this.add.text(VIEW.width / 2, 474, won ? 'REALM RESTORED' : 'OUT OF MOVES', {
      fontFamily: DISPLAY_FONT,
      fontSize: TYPE.screen,
      color: won ? '#fff0a8' : '#ff9a99',
      fontStyle: 'bold',
      stroke: '#21123f',
      strokeThickness: 7,
    }).setOrigin(0.5).setDepth(66);
    const stars = won ? match3StarsForScore(this.level, this.state.score) : 0;
    this.add.text(VIEW.width / 2, 550, won ? `${'★'.repeat(stars)}${'☆'.repeat(3 - stars)}` : '◇  ◇  ◇', {
      fontFamily: UI_FONT, fontSize: '54px', color: '#ffe083', fontStyle: 'bold', letterSpacing: 8,
    }).setOrigin(0.5).setDepth(66);
    this.add.text(VIEW.width / 2, 625, `SCORE  ${this.state.score.toLocaleString()}   •   CASCADE  ×${Math.max(1, this.state.comboPeak)}`, {
      fontFamily: UI_FONT, fontSize: TYPE.control, color: '#e5edf8', fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(66);
    if (won && this.level + 1 < MATCH3_LEVEL_COUNT) {
      addArtButton(this, VIEW.width / 2, 720, 'NEXT LEVEL', () => {
        SFX.click();
        this.scene.restart({ level: this.level + 1 });
      }, 330, 66, 70);
    } else {
      addArtButton(this, VIEW.width / 2, 720, 'TRY AGAIN', () => this.scene.restart({ level: this.level }), 330, 66, 70);
    }
    addArtButton(this, VIEW.width / 2, 808, won ? 'LEVEL MAP' : 'RETRY LEVEL', () => {
      SFX.click();
      if (won) this.scene.start('Match3Map', { world: Math.floor(this.level / 5) });
      else this.scene.restart({ level: this.level });
    }, 330, 62, 70);
    shield.on('pointerup', () => undefined);
  }

  private showPause(): void {
    if (this.pauseShown || this.terminalShown || this.inputLocked) return;
    this.pauseShown = true;
    this.inputLocked = true;
    this.handCursor?.setVisible(false);
    this.suspendHandTracking();
    const overlay: Phaser.GameObjects.GameObject[] = [];
    const shield = this.add.rectangle(VIEW.width / 2, VIEW.height / 2, VIEW.width, VIEW.height, 0x02040c, 0.78)
      .setDepth(60)
      .setInteractive();
    const panel = addArtPanel(this, VIEW.width / 2, 640, 610, 410, 62, 1);
    const title = this.add.text(VIEW.width / 2, 520, 'CASCADE PAUSED', {
      fontFamily: DISPLAY_FONT, fontSize: TYPE.screen, color: '#ffffff', fontStyle: 'bold',
      stroke: '#23143e', strokeThickness: 6,
    }).setOrigin(0.5).setDepth(66);
    const resume = addArtButton(this, VIEW.width / 2, 640, 'RESUME', () => {
      SFX.click();
      overlay.forEach((object) => object.destroy());
      this.pauseShown = false;
      this.inputLocked = false;
      this.setStatus('READY — CONTINUE THE CASCADE', '#aebdd1');
      if (getHandTracker().isWanted()) void this.startHandTracking();
    }, 330, 66, 70);
    const leave = addArtButton(this, VIEW.width / 2, 730, 'RETURN TO MAP', () => {
      SFX.click();
      this.scene.start('Match3Map', { world: Math.floor(this.level / 5) });
    }, 330, 62, 70);
    overlay.push(shield, panel, title, resume, leave);
  }

  private async toggleHand(): Promise<void> {
    if (this.handStarting) return;
    const tracker = getHandTracker();
    if (this.handOn) {
      this.handActivationGeneration += 1;
      tracker.disable();
      this.handOn = false;
      this.pinchControl.reset();
      this.handAimPredictor.reset();
      this.handContinuity.reset();
      this.handDrag.cancel();
      this.handCursor?.setVisible(false);
      this.setHandButton('HAND  •  OFF', '#f2e8d4');
      this.setStatus('POINTER, TOUCH AND KEYBOARD READY', '#aebdd1');
      return;
    }
    await this.startHandTracking();
  }

  private async startHandTracking(): Promise<void> {
    if (this.handStarting || this.handOn || this.pauseShown || this.terminalShown) return;
    const tracker = getHandTracker();
    const activation = ++this.handActivationGeneration;
    this.handStarting = true;
    this.setHandButton('HAND  •  STARTING', '#ffe083');
    const enabled = await tracker.enable();
    if (activation !== this.handActivationGeneration) return;
    this.handStarting = false;
    if (!this.sys.isActive() || this.pauseShown || this.terminalShown) {
      tracker.suspend();
      this.handOn = false;
      return;
    }
    this.handOn = enabled;
    this.handHasSeen = false;
    this.handLastSeenAt = 0;
    if (enabled) {
      tracker.setPreviewVisible(false);
      this.setHandButton('HAND  •  ON', '#76f0c7');
      this.setStatus('SEARCHING FOR HAND  •  KEEP PALM IN FRAME', '#ffe083');
    } else {
      this.setHandButton('HAND  •  ERROR', '#ff9a99');
      this.setStatus(handFailureMessage(tracker.getLastFailure()), '#ff9a99');
    }
  }

  private suspendHandTracking(): void {
    this.handActivationGeneration += 1;
    this.handStarting = false;
    this.handOn = false;
    this.handHasSeen = false;
    this.pinchControl.reset();
    this.handAimPredictor.reset();
    this.handContinuity.reset();
    this.handDrag.cancel();
    this.handBoosterTarget = null;
    this.clearSelection();
    this.handCursor?.setVisible(false);
    getHandTracker().suspend();
  }

  private setHandButton(label: string, color: string): void {
    this.handButtonText?.setText(label).setColor(color);
  }

  private handFrame(sample: HandSample, cell: Match3Coordinate | null): HandGridDragFrame {
    return {
      timestampMs: sample.timestampMs,
      cell,
      palmX: sample.palmX,
      palmY: sample.palmY,
      palmScale: sample.palmScale,
      mirrorX: sample.mirrorX,
    };
  }

  private measuredHandPoint(sample: Pick<HandSample, 'x' | 'y'>): { x: number; y: number } {
    return {
      x: BOARD_X + Phaser.Math.Clamp(sample.x, 0, 1) * (BOARD_WIDTH - 0.001),
      y: BOARD_Y + Phaser.Math.Clamp(sample.y, 0, 1) * (BOARD_HEIGHT - 0.001),
    };
  }

  private pollHand(): void {
    const now = performance.now();
    const sample = getHandTracker().sample();
    if (!sample) {
      if (!this.handHasSeen) {
        this.setStatus('SEARCHING FOR HAND  •  KEEP PALM IN FRAME', '#ffe083');
        return;
      }
      const lostFor = now - this.handLastSeenAt;
      if (this.pinchControl.cancelForLoss(now, this.handLastSeenAt) === 'cancelled') {
        this.handDrag.cancel();
        this.handBoosterTarget = null;
        this.clearSelection();
      }
      if (lostFor > HAND_LOSS_HIDE_MS) {
        this.handCursor?.setVisible(false);
        this.handAimPredictor.reset();
      }
      if (lostFor > HAND_LOSS_RESET_MS) {
        this.pinchControl.reset();
        this.handContinuity.reset();
        this.handDrag.cancel();
        this.handBoosterTarget = null;
        this.setStatus('HAND LOST — SHOW YOUR HAND TO CAMERA', '#ffb27d');
      }
      return;
    }

    this.handHasSeen = true;
    this.handLastSeenAt = now;
    const measuredPoint = this.measuredHandPoint(sample);
    const measuredCell = this.cellAtPoint(measuredPoint.x, measuredPoint.y);
    const visuallyOpen = sample.rawPinch >= this.handReleaseThreshold;
    if (visuallyOpen) {
      this.handAimPredictor.push({ x: sample.x, y: sample.y }, sample.timestampMs, now);
    }

    const frame = this.handFrame(sample, measuredCell);
    const continuity = this.handContinuity.observe(
      sample.gestureStable && sample.usableForGesture,
      sample.timestampMs,
    );
    if (continuity !== 'usable') {
      if (continuity === 'cancel') {
        this.pinchControl.resetForContinuity();
        this.handDrag.cancel();
        this.handBoosterTarget = null;
        this.clearSelection();
      } else {
        this.pinchControl.holdForUncertainty(sample.timestampMs);
      }
      this.setStatus(sample.gestureStable ? 'HAND UNCERTAIN — HOLD POSITION' : 'HAND STABILIZING', '#ffe083');
      return;
    }

    if (!this.pinchControl.isEngaged()
      && sample.confidenceState === 'tracked'
      && sample.pinch >= this.handReleaseThreshold) {
      this.handDrag.observeOpen(frame);
    }

    const wasLatched = this.pinchControl.isLatched();
    if (wasLatched) {
      const dragCandidate = this.handDrag.updateContact(frame);
      if (dragCandidate) {
        this.candidate = { ...dragCandidate };
        this.drawSelection(this.selected, this.candidate);
      }
    }
    const event = this.pinchControl.update(sample);
    if (event === 'latched') {
      const source = this.handDrag.latch(frame);
      if (!source) return;
      this.selected = { ...source };
      const sourcePoint = cellCenter(source);
      this.handCursor?.setVisible(true).setPosition(sourcePoint.x, sourcePoint.y);
      this.handBoosterTarget = this.activeBooster ? { ...source } : null;
      this.candidate = null;
      this.drawSelection();
      this.setStatus(
        this.activeBooster ? 'RELEASE TO APPLY BOOSTER' : 'PINCHED — MOVE PALM ONE CELL, THEN RELEASE',
        '#76f0c7',
      );
    } else if (event === 'cancelled') {
      this.handDrag.cancel();
      this.handBoosterTarget = null;
      this.clearSelection();
      this.setStatus('GESTURE CANCELLED SAFELY — TRY AGAIN', '#ffb27d');
    } else if (event === 'released') {
      const boosterTarget = this.handBoosterTarget;
      const swap = this.handDrag.release();
      this.handBoosterTarget = null;
      if (this.activeBooster && boosterTarget) {
        const booster = this.activeBooster;
        this.activeBooster = null;
        void this.applyBooster(booster, boosterTarget);
      } else if (swap) {
        void this.attemptSwap(swap.from, swap.to);
      } else {
        this.clearSelection();
        this.setStatus('NO DOMINANT PALM SWIPE — NO MOVE SPENT', '#aebdd1');
      }
    } else if (!this.pinchControl.isLatched()) {
      this.setStatus('HAND READY  •  PINCH, SWIPE ONE CELL, RELEASE', '#76f0c7');
    }
  }

  /** Render-only prediction; logical source/candidate always use measured palm frames. */
  private advanceHandCursor(): void {
    const predicted = this.handAimPredictor.predict(performance.now());
    if (!predicted || !this.handCursor) return;
    const point = this.measuredHandPoint(predicted);
    this.handCursor.setVisible(true).setPosition(point.x, point.y);
  }
}

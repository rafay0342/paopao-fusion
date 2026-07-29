import Phaser from 'phaser';
import {
  COLOR_KEYS,
  COLORS,
  orbTexture,
  VIEW,
} from '../config';
import {
  MEMORY_CONSTELLATION_CARD_COUNT,
  MEMORY_CONSTELLATION_COLUMNS,
  createMemoryConstellationState,
  resolveMemoryConstellationMismatch,
  revealMemoryConstellationCard,
  type MemoryConstellationState,
} from '../game/arcade';
import { arcadeWorldTextureKey } from '../game/arcade-art';
import { recordArcadeResult } from '../game/arcade-progress';
import {
  HandGestureContinuityGate,
  PinchDoubleTapControl,
} from '../game/handcontrol';
import { getHandSettings } from '../game/handsettings';
import {
  getHandTracker,
  type HandTrackingFailure,
  type VisionTrackingMode,
} from '../game/handtracking';
import {
  DoubleBlinkControl,
  GazeAimController,
  GazeDwellControl,
} from '../game/gazecontrol';
import {
  currentGazeCalibrationIdentity,
  gazeCalibrationMatches,
  getGazeSettings,
} from '../game/gazesettings';
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
  addWorldBackground,
  DISPLAY_FONT,
  fitText,
  prefersReducedMotion,
  sharpenSceneText,
  TYPE,
  UI_COLORS,
  UI_FONT,
  updateArtButtonAccessibility,
} from '../gfx/ui';

interface MemoryConstellationSceneData {
  seed?: number;
}

interface CardIdentity {
  label: string;
  rune: string;
  accent: number;
  texture: (skin: ReturnType<typeof getMeta>['equippedSkin']) => string;
}

const BOARD_X = 58;
const BOARD_Y = 246;
const CARD_WIDTH = 142;
const CARD_HEIGHT = 148;
const CARD_GAP = 12;
const BOARD_WIDTH = CARD_WIDTH * 4 + CARD_GAP * 3;
const BOARD_HEIGHT = CARD_HEIGHT * 4 + CARD_GAP * 3;
const MISMATCH_HIDE_MS = 650;
const CAMERA_FRAME_MAX_AGE_MS = 180;
const CAMERA_LOSS_HIDE_MS = 450;
const CAMERA_LOSS_RESET_MS = 1_200;
const UTC_DAY_MS = 86_400_000;

const ORB_RUNES = ['▲', '◆', '✦', '♧', '✶', '⬡'] as const;
const IDENTITY_LABELS = ['EMBER', 'TIDE', 'LEAF', 'SUN', 'NEXUS', 'AURORA'] as const;

const CARD_IDENTITIES: readonly CardIdentity[] = Object.freeze([
  ...COLOR_KEYS.map((color, index) => ({
    label: IDENTITY_LABELS[index],
    rune: ORB_RUNES[index],
    accent: COLORS[color].hex,
    texture: (skin: ReturnType<typeof getMeta>['equippedSkin']) => orbTexture(skin, color),
  })),
  {
    label: 'CHRONO',
    rune: '⌛',
    accent: 0x7be8ff,
    texture: () => 'artifact_chrono',
  },
  {
    label: 'FORTUNE',
    rune: '☼',
    accent: 0xffd56f,
    texture: () => 'artifact_fortune',
  },
]);

const facetedCardPoints = (): Phaser.Types.Math.Vector2Like[] => [
  { x: -CARD_WIDTH / 2 + 13, y: -CARD_HEIGHT / 2 },
  { x: CARD_WIDTH / 2 - 13, y: -CARD_HEIGHT / 2 },
  { x: CARD_WIDTH / 2, y: -CARD_HEIGHT / 2 + 13 },
  { x: CARD_WIDTH / 2, y: CARD_HEIGHT / 2 - 13 },
  { x: CARD_WIDTH / 2 - 13, y: CARD_HEIGHT / 2 },
  { x: -CARD_WIDTH / 2 + 13, y: CARD_HEIGHT / 2 },
  { x: -CARD_WIDTH / 2, y: CARD_HEIGHT / 2 - 13 },
  { x: -CARD_WIDTH / 2, y: -CARD_HEIGHT / 2 + 13 },
];

const cardCenter = (index: number): { x: number; y: number } => ({
  x: BOARD_X + (index % MEMORY_CONSTELLATION_COLUMNS) * (CARD_WIDTH + CARD_GAP) + CARD_WIDTH / 2,
  y: BOARD_Y + Math.floor(index / MEMORY_CONSTELLATION_COLUMNS) * (CARD_HEIGHT + CARD_GAP) + CARD_HEIGHT / 2,
});

const normalizedSeed = (value: unknown): number | null => (
  typeof value === 'number' && Number.isSafeInteger(value) ? value >>> 0 : null
);

/** Stable UTC-day seed. Restarting a board retains this exact seed. */
export function memoryConstellationDailySeed(timestampMs = Date.now()): number {
  const utcDay = Math.floor(timestampMs / UTC_DAY_MS);
  const label = `paopao-memory-constellation-v1:${utcDay}`;
  let hash = 0x811c9dc5;
  for (let index = 0; index < label.length; index += 1) {
    hash = Math.imul(hash ^ label.charCodeAt(index), 0x01000193) >>> 0;
  }
  return hash || 1;
}

/** Score depends only on elapsed time and completed moves, never on purchases. */
export function memoryConstellationScore(timeMs: number, moves: number): number {
  const safeTime = Phaser.Math.Clamp(Math.trunc(Number(timeMs) || 0), 0, 86_400_000);
  const safeMoves = Phaser.Math.Clamp(Math.trunc(Number(moves) || 0), 0, 10_000);
  return Math.max(1_000, 120_000 - Math.floor(safeTime / 25) - safeMoves * 1_100);
}

function cameraFailureMessage(failure: HandTrackingFailure): string {
  if (failure === 'permission-denied') return 'CAMERA BLOCKED — ALLOW CAMERA, THEN RETRY';
  if (failure === 'no-camera') return 'NO CAMERA FOUND';
  if (failure === 'camera-busy') return 'CAMERA IS BUSY IN ANOTHER APP';
  if (failure === 'insecure-context') return 'CAMERA INPUT REQUIRES HTTPS';
  if (failure === 'unsupported') return 'CAMERA INPUT IS NOT SUPPORTED HERE';
  if (failure === 'model-load-failed') return 'VISION MODEL FAILED — RELOAD AND RETRY';
  return 'CAMERA INPUT COULD NOT START';
}

export class MemoryConstellationScene extends Phaser.Scene {
  private seed = 1;
  private state: MemoryConstellationState = createMemoryConstellationState(1);
  private startedAtMs = 0;
  private selectedIndex = 0;
  private pointerArmedIndex: number | null = null;
  private inputLocked = false;
  private terminalShown = false;
  private mismatchGeneration = 0;
  private requireFreshPointerAfterContext = false;

  private cardViews: Phaser.GameObjects.Container[] = [];
  private cardA11y: AccessibilityButtonRegistration[] = [];
  private selectionGraphics?: Phaser.GameObjects.Graphics;
  private movesText?: Phaser.GameObjects.Text;
  private pairsText?: Phaser.GameObjects.Text;
  private timerText?: Phaser.GameObjects.Text;
  private statusText?: Phaser.GameObjects.Text;
  private a11y?: AccessibilitySceneSession;

  private handOn = false;
  private handStarting = false;
  private handActivationGeneration = 0;
  private handHasSeen = false;
  private handLastSeenAt = 0;
  private handLockedIndex: number | null = null;
  private visionMode: VisionTrackingMode = 'hand';
  private pinchControl = new PinchDoubleTapControl(undefined, undefined, {
    fireOnFirstRelease: true,
  });
  private readonly handContinuity = new HandGestureContinuityGate();
  private readonly gazeAimController = new GazeAimController();
  private readonly gazeBlinkControl = new DoubleBlinkControl();
  private gazeDwellControl = new GazeDwellControl();
  private gazeHasSeen = false;
  private gazeLastSeenAt = 0;
  private gazeTarget: { x: number; y: number } | null = null;
  private gazeCursor: { x: number; y: number } | null = null;
  private gazeStableIndex: { index: number; timestampMs: number } | null = null;
  private gazeBlinkIndex: { index: number; timestampMs: number } | null = null;
  private handCursor?: Phaser.GameObjects.Arc;
  private cameraButton?: Phaser.GameObjects.Container;
  private cameraButtonText?: Phaser.GameObjects.Text;

  private readonly handleRenderContextBoundary = (): void => {
    if (!this.scene.isActive()) return;
    this.requireFreshPointerAfterContext = true;
    this.pointerArmedIndex = null;
    this.resetVisionAuthority();
    this.handCursor?.setVisible(false);
    this.setStatus(`${this.visionLabel()} STABILIZING — NO CARD SELECTED`, '#ffe083');
  };

  private readonly handleBack = (): void => this.leaveScene();
  private readonly keyLeft = (): void => this.moveKeyboard(0, -1);
  private readonly keyRight = (): void => this.moveKeyboard(0, 1);
  private readonly keyUp = (): void => this.moveKeyboard(-1, 0);
  private readonly keyDown = (): void => this.moveKeyboard(1, 0);
  private readonly keyActivate = (): void => this.activateCard(this.selectedIndex, 'keyboard');
  private readonly keyCamera = (): void => { void this.toggleVision(); };

  constructor() {
    super('MemoryConstellation');
  }

  init(data: MemoryConstellationSceneData = {}): void {
    this.seed = normalizedSeed(data.seed) ?? memoryConstellationDailySeed();
    this.state = createMemoryConstellationState(this.seed);
    this.startedAtMs = 0;
    this.selectedIndex = 0;
    this.pointerArmedIndex = null;
    this.inputLocked = false;
    this.terminalShown = false;
    this.mismatchGeneration += 1;
    this.requireFreshPointerAfterContext = false;
    this.cardViews = [];
    this.cardA11y = [];
    this.a11y = undefined;
    this.handOn = false;
    this.handStarting = false;
    this.handHasSeen = false;
    this.handLastSeenAt = 0;
    this.handLockedIndex = null;
    const gazeSettings = getGazeSettings();
    this.visionMode = gazeSettings.mode === 'off' ? 'hand' : gazeSettings.mode;
    this.gazeDwellControl = new GazeDwellControl(gazeSettings.dwellMs);
    const handSettings = getHandSettings();
    this.pinchControl = new PinchDoubleTapControl(
      handSettings.pinchOn,
      handSettings.pinchOff,
      { fireOnFirstRelease: true },
    );
    this.resetVisionAuthority();
  }

  create(): void {
    const meta = getMeta();
    this.a11y = accessibilityRuntimeForCanvas(this.game.canvas).mountScene({
      id: 'memory-constellation',
      heading: 'Memory Constellation daily challenge',
      description: 'Restore eight matching pairs on a deterministic four by four board. Each identity has a distinct rune as well as a colour. Use pointer, touch, arrow keys or W A S D plus Enter or Space, calibrated eyes, or measured pinch contact and release.',
      status: 'Sixteen cards hidden. Zero moves.',
      lifecycle: this.events,
    });

    addWorldBackground(
      this,
      arcadeWorldTextureKey('memory', meta.quality),
      0.14,
    );
    addAmbientMotes(this, 0xffcf70, 18, 2);
    this.cameras.main.fadeIn(prefersReducedMotion() ? 0 : 180, 0, 0, 0);

    this.add.text(VIEW.width / 2, 48, 'MEMORY CONSTELLATION', {
      fontFamily: DISPLAY_FONT,
      fontSize: TYPE.screen,
      color: '#ffffff',
      fontStyle: 'bold',
      stroke: '#25143f',
      strokeThickness: 7,
      letterSpacing: 1,
    }).setOrigin(0.5).setDepth(12).setShadow(0, 5, '#000000', 10);
    fitText(this.add.text(
      VIEW.width / 2,
      94,
      `DAILY SKY ${this.seed.toString(16).toUpperCase().padStart(8, '0')}  •  SAME-SEED REPLAY`,
      {
        fontFamily: UI_FONT,
        fontSize: TYPE.caption,
        color: '#ffe39a',
        fontStyle: 'bold',
        letterSpacing: 0.8,
      },
    ).setOrigin(0.5).setDepth(12), 650);

    addArtPanel(this, VIEW.width / 2, 166, 636, 94, 8, 0.97);
    this.movesText = this.add.text(92, 166, 'MOVES  0', {
      fontFamily: UI_FONT,
      fontSize: TYPE.metric,
      color: '#ffffff',
      fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(12);
    this.pairsText = this.add.text(VIEW.width / 2, 166, 'PAIRS  0 / 8', {
      fontFamily: UI_FONT,
      fontSize: TYPE.metric,
      color: '#ffe39a',
      fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(12);
    this.timerText = this.add.text(VIEW.width - 92, 166, 'TIME  0:00', {
      fontFamily: UI_FONT,
      fontSize: TYPE.control,
      color: '#9ef2ff',
      fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(12);

    addArtPanel(
      this,
      VIEW.width / 2,
      BOARD_Y + BOARD_HEIGHT / 2,
      BOARD_WIDTH + 24,
      BOARD_HEIGHT + 24,
      5,
      0.93,
    );
    this.selectionGraphics = this.add.graphics().setDepth(23);
    this.createCards();
    this.renderCards();

    fitText(this.add.text(
      VIEW.width / 2,
      924,
      'MATCH SYMBOL + MATERIAL  •  MISMATCHES CLOSE AFTER 650ms',
      {
        fontFamily: UI_FONT,
        fontSize: TYPE.caption,
        color: '#dce9f7',
        fontStyle: 'bold',
        letterSpacing: 0.4,
      },
    ).setOrigin(0.5).setDepth(12), 660);

    addArtButton(this, 190, 1_006, 'ARCADE HUB', () => this.leaveScene(), 294, 62, 18);
    addArtButton(this, 530, 1_006, 'RESTART SKY', () => this.restartSameSeed(), 294, 62, 18);
    this.cameraButton = addArtButton(
      this,
      190,
      1_116,
      `${this.visionLabel()}  •  OFF`,
      () => { void this.toggleVision(); },
      294,
      62,
      18,
    );
    this.cameraButtonText = this.cameraButton.list.find(
      (child): child is Phaser.GameObjects.Text => child instanceof Phaser.GameObjects.Text,
    );
    addArtButton(this, 530, 1_116, 'CAMERA SETUP', () => {
      this.suspendVision();
      this.scene.start('GazeSetup');
    }, 294, 62, 18);

    this.statusText = this.add.text(
      VIEW.width / 2,
      1_196,
      'POINTER / TOUCH  •  ARROWS + ENTER  •  CAMERA OPTIONAL',
      {
        fontFamily: UI_FONT,
        fontSize: TYPE.caption,
        color: '#b9c8da',
        fontStyle: 'bold',
        align: 'center',
      },
    ).setOrigin(0.5).setDepth(22);
    fitText(this.statusText, 658);
    this.handCursor = this.add.circle(0, 0, 22, 0x76edff, 0.12)
      .setStrokeStyle(4, 0xffffff, 0.94)
      .setDepth(30)
      .setVisible(false);

    this.bindInput();
    window.addEventListener('paopao:render-context-boundary', this.handleRenderContextBoundary);
    this.events.on('paopao:back-request', this.handleBack);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      window.removeEventListener('paopao:render-context-boundary', this.handleRenderContextBoundary);
      this.events.off('paopao:back-request', this.handleBack);
      this.unbindInput();
      this.mismatchGeneration += 1;
      this.cardA11y.forEach((registration) => registration.unregister());
      this.cardA11y = [];
      this.suspendVision();
    });

    this.startedAtMs = performance.now();
    const tracker = getHandTracker();
    if (tracker.isWanted()) void this.startVision(false);
    else void tracker.prepare().catch(() => undefined);
    this.updateHud();
    this.drawSelection();
    sharpenSceneText(this);
  }

  update(_time: number, delta: number): void {
    if (!this.terminalShown && this.startedAtMs > 0) {
      this.timerText?.setText(`TIME  ${this.formatTime(performance.now() - this.startedAtMs)}`);
    }
    if (!this.handOn || this.terminalShown) return;
    if (this.visionMode === 'hand') this.pollHand();
    else {
      this.pollGaze();
      if (this.visionMode === 'gaze-hand') this.pollGazeHand();
      this.advanceGazeCursor(delta);
    }
  }

  private createCards(): void {
    for (let index = 0; index < MEMORY_CONSTELLATION_CARD_COUNT; index += 1) {
      const point = cardCenter(index);
      const container = this.add.container(point.x, point.y).setDepth(15);
      container.setSize(CARD_WIDTH, CARD_HEIGHT).setInteractive({ useHandCursor: true });
      container.on('pointerover', () => {
        if (this.inputLocked || this.terminalShown) return;
        this.selectedIndex = index;
        this.drawSelection();
      });
      container.on('pointerdown', () => {
        if (this.inputLocked || this.terminalShown) return;
        this.requireFreshPointerAfterContext = false;
        this.pointerArmedIndex = index;
        this.selectedIndex = index;
        this.drawSelection();
      });
      container.on('pointerup', () => {
        if (this.requireFreshPointerAfterContext || this.pointerArmedIndex !== index) return;
        this.pointerArmedIndex = null;
        this.activateCard(index, 'pointer');
      });
      container.on('pointerout', () => {
        if (this.pointerArmedIndex === index) this.pointerArmedIndex = null;
      });
      this.cardViews.push(container);

      const row = Math.floor(index / MEMORY_CONSTELLATION_COLUMNS) + 1;
      const column = index % MEMORY_CONSTELLATION_COLUMNS + 1;
      const registration = this.a11y?.registerButton({
        id: `memory-card-${index + 1}`,
        label: `Card row ${row}, column ${column}, hidden`,
        description: 'Reveal this memory card.',
        onActivate: () => this.activateCard(index, 'accessibility'),
        onFocusChange: (focused) => {
          if (!focused || this.inputLocked || this.terminalShown) return;
          this.selectedIndex = index;
          this.drawSelection();
        },
      });
      if (registration) this.cardA11y.push(registration);
    }
  }

  private renderCards(): void {
    const skin = getMeta().equippedSkin;
    this.state.cards.forEach((card, index) => {
      const container = this.cardViews[index];
      if (!container) return;
      container.removeAll(true);
      const identity = CARD_IDENTITIES[card.pairIndex];
      const visible = card.state !== 'hidden';
      const matched = card.state === 'matched';
      const shell = this.add.graphics();
      const points = facetedCardPoints();
      shell.fillStyle(0x07091a, 0.52);
      shell.fillPoints(points.map((point) => ({ x: point.x + 3, y: point.y + 5 })), true);
      shell.fillGradientStyle(
        visible ? 0x433068 : 0x2b1b55,
        visible ? 0x2b234e : 0x1c163e,
        visible ? 0x181b35 : 0x0f1633,
        0x100b24,
        matched ? 0.84 : 0.98,
        matched ? 0.84 : 0.98,
        0.98,
        0.98,
      );
      shell.fillPoints(points, true);
      shell.fillStyle(visible ? identity.accent : UI_COLORS.cyan, visible ? 0.14 : 0.07);
      shell.fillTriangle(
        -CARD_WIDTH / 2 + 13,
        -CARD_HEIGHT / 2,
        CARD_WIDTH / 2 - 13,
        -CARD_HEIGHT / 2,
        0,
        0,
      );
      shell.fillStyle(UI_COLORS.gold, visible ? 0.1 : 0.055);
      shell.fillTriangle(
        CARD_WIDTH / 2,
        -CARD_HEIGHT / 2 + 13,
        CARD_WIDTH / 2,
        CARD_HEIGHT / 2 - 13,
        0,
        0,
      );
      shell.lineStyle(matched ? 4 : 2, matched ? 0x7ef0bb : visible ? identity.accent : 0x8e82c4, matched ? 0.95 : 0.72);
      shell.strokePoints(points, true);
      shell.lineStyle(1, visible ? UI_COLORS.gold : UI_COLORS.cyan, 0.44);
      shell.strokeRoundedRect(-CARD_WIDTH / 2 + 8, -CARD_HEIGHT / 2 + 8, CARD_WIDTH - 16, CARD_HEIGHT - 16, 8);
      container.add(shell);

      if (!visible) {
        const backGlow = this.add.circle(0, -4, 38, 0x342064, 0.46)
          .setStrokeStyle(2, UI_COLORS.cyan, 0.22);
        const backRune = this.add.text(0, -7, '✦', {
          fontFamily: DISPLAY_FONT,
          fontSize: '50px',
          color: '#d3f9ff',
          fontStyle: 'bold',
          stroke: '#2b1459',
          strokeThickness: 5,
        }).setOrigin(0.5);
        const backLabel = this.add.text(0, 52, 'PAO', {
          fontFamily: UI_FONT,
          fontSize: TYPE.caption,
          color: '#c5b8e4',
          fontStyle: 'bold',
          letterSpacing: 2,
        }).setOrigin(0.5);
        container.add([backGlow, backRune, backLabel]);
      } else {
        const image = this.add.image(0, -13, identity.texture(skin))
          .setDisplaySize(card.pairIndex < 6 ? 82 : 76, card.pairIndex < 6 ? 82 : 76);
        if (matched) image.setAlpha(0.72);
        const runePlate = this.add.circle(42, -45, 20, 0x090d20, 0.9)
          .setStrokeStyle(2, identity.accent, 0.96);
        const rune = this.add.text(42, -46, identity.rune, {
          fontFamily: DISPLAY_FONT,
          fontSize: '24px',
          color: '#ffffff',
          fontStyle: 'bold',
          stroke: '#080b19',
          strokeThickness: 3,
        }).setOrigin(0.5);
        const label = this.add.text(0, 52, matched ? `${identity.label}  ✓` : identity.label, {
          fontFamily: UI_FONT,
          fontSize: TYPE.caption,
          color: matched ? '#91f1c2' : '#fff2d5',
          fontStyle: 'bold',
          letterSpacing: 0.6,
        }).setOrigin(0.5);
        fitText(label, CARD_WIDTH - 20);
        container.add([image, runePlate, rune, label]);
      }
    });
    this.updateCardAccessibility();
    this.drawSelection();
  }

  private updateCardAccessibility(): void {
    this.state.cards.forEach((card, index) => {
      const row = Math.floor(index / MEMORY_CONSTELLATION_COLUMNS) + 1;
      const column = index % MEMORY_CONSTELLATION_COLUMNS + 1;
      const identity = CARD_IDENTITIES[card.pairIndex];
      const stateLabel = card.state === 'hidden'
        ? 'hidden'
        : card.state === 'matched'
          ? `matched ${identity.label}, rune ${identity.rune}`
          : `revealed ${identity.label}, rune ${identity.rune}`;
      this.cardA11y[index]?.update({
        label: `Card row ${row}, column ${column}, ${stateLabel}`,
        description: card.state === 'hidden'
          ? 'Reveal this memory card.'
          : card.state === 'matched'
            ? 'This pair is already restored.'
            : 'This card is currently face up.',
        disabled: this.inputLocked || this.terminalShown || card.state !== 'hidden',
      });
    });
  }

  private drawSelection(): void {
    if (!this.selectionGraphics) return;
    const point = cardCenter(this.selectedIndex);
    const graphics = this.selectionGraphics.clear();
    const card = this.state.cards[this.selectedIndex];
    const accent = card ? CARD_IDENTITIES[card.pairIndex].accent : UI_COLORS.cyan;
    graphics.lineStyle(4, card?.state === 'hidden' ? UI_COLORS.cyan : accent, 0.96);
    graphics.strokeRoundedRect(
      point.x - CARD_WIDTH / 2 - 5,
      point.y - CARD_HEIGHT / 2 - 5,
      CARD_WIDTH + 10,
      CARD_HEIGHT + 10,
      14,
    );
    graphics.lineStyle(2, UI_COLORS.gold, 0.72);
    graphics.strokeRoundedRect(
      point.x - CARD_WIDTH / 2 - 10,
      point.y - CARD_HEIGHT / 2 - 10,
      CARD_WIDTH + 20,
      CARD_HEIGHT + 20,
      18,
    );
  }

  private activateCard(
    index: number,
    source: 'pointer' | 'keyboard' | 'accessibility' | 'hand' | 'gaze' | 'gaze-hand',
  ): void {
    if (this.inputLocked || this.terminalShown) return;
    const result = revealMemoryConstellationCard(this.state, index);
    if (!result.accepted) return;
    this.state = result.state;
    this.selectedIndex = index;
    this.renderCards();
    this.updateHud();
    SFX.click();

    if (result.event === 'first-reveal') {
      const identity = CARD_IDENTITIES[this.state.cards[index].pairIndex];
      this.setStatus(`${identity.label} REVEALED  •  FIND THE SAME RUNE`, '#9ef2ff');
      this.announce(`${identity.label}, rune ${identity.rune}, revealed.`);
      return;
    }
    if (result.event === 'match') {
      const identity = CARD_IDENTITIES[this.state.cards[index].pairIndex];
      SFX.pop(this.state.matchedPairs);
      this.setStatus(`${identity.label} PAIR RESTORED  •  ${this.state.matchedPairs} OF 8`, '#85f0bd');
      this.announce(`${identity.label} pair restored. ${this.state.matchedPairs} of 8 pairs complete.`);
      return;
    }
    if (result.event === 'completed') {
      SFX.win();
      this.completeGame(source);
      return;
    }

    this.inputLocked = true;
    this.updateCardAccessibility();
    SFX.drop();
    this.setStatus('NOT A PAIR  •  MEMORIZE BOTH RUNES', '#ffb783');
    this.announce('Not a pair. Both cards will close after 650 milliseconds.');
    const generation = ++this.mismatchGeneration;
    this.time.delayedCall(MISMATCH_HIDE_MS, () => {
      if (!this.sys.isActive() || generation !== this.mismatchGeneration) return;
      const resolved = resolveMemoryConstellationMismatch(this.state);
      if (!resolved.accepted) {
        this.inputLocked = false;
        this.updateCardAccessibility();
        return;
      }
      this.state = resolved.state;
      this.inputLocked = false;
      this.renderCards();
      this.updateHud();
      this.setStatus('CARDS CLOSED  •  CHOOSE AGAIN', '#c2d2e6');
      this.announce('Cards closed. Choose another card.');
    });
  }

  private completeGame(source: string): void {
    if (this.terminalShown) return;
    this.terminalShown = true;
    this.inputLocked = true;
    this.mismatchGeneration += 1;
    const timeMs = Math.max(1, Math.round(performance.now() - this.startedAtMs));
    const score = memoryConstellationScore(timeMs, this.state.moves);
    recordArcadeResult('memory-constellation', {
      score,
      timeMs,
      moves: this.state.moves,
    });
    this.timerText?.setText(`TIME  ${this.formatTime(timeMs)}`);
    this.updateCardAccessibility();
    this.suspendVision();
    this.a11y?.setStatus(
      `All eight pairs restored in ${this.state.moves} moves and ${this.formatTime(timeMs)}. Score ${score}. Local arcade record only.`,
    );
    this.announce('Memory Constellation complete. Local score recorded. No wallet or campaign state changed.', 'assertive');

    const dim = this.add.rectangle(0, 0, VIEW.width, VIEW.height, 0x02040d, 0.82)
      .setOrigin(0)
      .setDepth(50);
    const panel = addArtPanel(this, VIEW.width / 2, 636, 630, 650, 51, 0.99);
    const title = this.add.text(VIEW.width / 2, 382, 'SKY RESTORED', {
      fontFamily: DISPLAY_FONT,
      fontSize: TYPE.screen,
      color: '#ffe39a',
      fontStyle: 'bold',
      stroke: '#25143f',
      strokeThickness: 7,
    }).setOrigin(0.5).setDepth(52);
    const stats = this.add.text(
      VIEW.width / 2,
      512,
      `SCORE  ${score.toLocaleString()}\nMOVES  ${this.state.moves}   •   TIME  ${this.formatTime(timeMs)}\nINPUT  ${source.toUpperCase()}`,
      {
        fontFamily: UI_FONT,
        fontSize: TYPE.title,
        color: '#ffffff',
        fontStyle: 'bold',
        align: 'center',
        lineSpacing: 12,
      },
    ).setOrigin(0.5).setDepth(52);
    const authority = this.add.text(
      VIEW.width / 2,
      682,
      'LOCAL ARCADE RECORD ONLY\nNO COINS, WALLET BALANCE, INVENTORY, CAMPAIGN,\nPURCHASE, OR SERVER REWARD CHANGED.',
      {
        fontFamily: UI_FONT,
        fontSize: TYPE.body,
        color: '#bcebdc',
        fontStyle: 'bold',
        align: 'center',
        lineSpacing: 8,
      },
    ).setOrigin(0.5).setDepth(52);
    const again = addArtButton(
      this,
      VIEW.width / 2,
      826,
      'REPLAY SAME SKY',
      () => this.restartSameSeed(),
      390,
      70,
      53,
    );
    const hub = addArtButton(
      this,
      VIEW.width / 2,
      928,
      'ARCADE HUB',
      () => this.leaveScene(),
      390,
      70,
      53,
    );
    // Grouping preserves a single terminal depth while each button retains its
    // own pointer and accessibility registration.
    this.add.container(0, 0, [dim, panel, title, stats, authority, again, hub]).setDepth(50);
    sharpenSceneText(this);
  }

  private updateHud(): void {
    this.movesText?.setText(`MOVES  ${this.state.moves}`);
    this.pairsText?.setText(`PAIRS  ${this.state.matchedPairs} / 8`);
    this.a11y?.setStatus(
      `${this.state.matchedPairs} of 8 pairs restored. ${this.state.moves} moves. ${
        this.inputLocked ? 'Mismatch is visible; input is temporarily locked.' : 'Choose a hidden card.'
      }`,
    );
  }

  private moveKeyboard(rowDelta: number, columnDelta: number): void {
    if (this.inputLocked || this.terminalShown) return;
    const row = Math.floor(this.selectedIndex / MEMORY_CONSTELLATION_COLUMNS);
    const column = this.selectedIndex % MEMORY_CONSTELLATION_COLUMNS;
    const nextRow = Phaser.Math.Wrap(row + rowDelta, 0, 4);
    const nextColumn = Phaser.Math.Wrap(column + columnDelta, 0, 4);
    this.selectedIndex = nextRow * MEMORY_CONSTELLATION_COLUMNS + nextColumn;
    this.drawSelection();
    const card = this.state.cards[this.selectedIndex];
    this.announce(
      `Row ${nextRow + 1}, column ${nextColumn + 1}, ${
        card.state === 'hidden' ? 'hidden' : card.state
      }.`,
    );
  }

  private bindInput(): void {
    const keyboard = this.input.keyboard;
    keyboard?.on('keydown-LEFT', this.keyLeft);
    keyboard?.on('keydown-A', this.keyLeft);
    keyboard?.on('keydown-RIGHT', this.keyRight);
    keyboard?.on('keydown-D', this.keyRight);
    keyboard?.on('keydown-UP', this.keyUp);
    keyboard?.on('keydown-W', this.keyUp);
    keyboard?.on('keydown-DOWN', this.keyDown);
    keyboard?.on('keydown-S', this.keyDown);
    keyboard?.on('keydown-ENTER', this.keyActivate);
    keyboard?.on('keydown-SPACE', this.keyActivate);
    keyboard?.on('keydown-H', this.keyCamera);
  }

  private unbindInput(): void {
    const keyboard = this.input.keyboard;
    keyboard?.off('keydown-LEFT', this.keyLeft);
    keyboard?.off('keydown-A', this.keyLeft);
    keyboard?.off('keydown-RIGHT', this.keyRight);
    keyboard?.off('keydown-D', this.keyRight);
    keyboard?.off('keydown-UP', this.keyUp);
    keyboard?.off('keydown-W', this.keyUp);
    keyboard?.off('keydown-DOWN', this.keyDown);
    keyboard?.off('keydown-S', this.keyDown);
    keyboard?.off('keydown-ENTER', this.keyActivate);
    keyboard?.off('keydown-SPACE', this.keyActivate);
    keyboard?.off('keydown-H', this.keyCamera);
  }

  private cellAtPoint(x: number, y: number): number | null {
    if (x < BOARD_X || x >= BOARD_X + BOARD_WIDTH || y < BOARD_Y || y >= BOARD_Y + BOARD_HEIGHT) {
      return null;
    }
    const column = Math.floor((x - BOARD_X) / (CARD_WIDTH + CARD_GAP));
    const row = Math.floor((y - BOARD_Y) / (CARD_HEIGHT + CARD_GAP));
    if (column < 0 || column >= 4 || row < 0 || row >= 4) return null;
    const localX = x - BOARD_X - column * (CARD_WIDTH + CARD_GAP);
    const localY = y - BOARD_Y - row * (CARD_HEIGHT + CARD_GAP);
    if (localX >= CARD_WIDTH || localY >= CARD_HEIGHT) return null;
    return row * MEMORY_CONSTELLATION_COLUMNS + column;
  }

  private measuredHandIndex(x: number, y: number): number | null {
    const pointX = BOARD_X + Phaser.Math.Clamp(x, 0, 1) * (BOARD_WIDTH - 0.001);
    const pointY = BOARD_Y + Phaser.Math.Clamp(y, 0, 1) * (BOARD_HEIGHT - 0.001);
    return this.cellAtPoint(pointX, pointY);
  }

  private async toggleVision(): Promise<void> {
    if (this.handStarting || this.terminalShown) return;
    if (this.handOn) {
      this.suspendVision();
      this.setCameraButton(`${this.visionLabel()}  •  OFF`, '#f2e8d4');
      this.setStatus('POINTER, TOUCH AND KEYBOARD READY', '#b9c8da');
      return;
    }
    await this.startVision(true);
  }

  private async startVision(showError: boolean): Promise<void> {
    if (this.handStarting || this.handOn || this.terminalShown) return;
    const tracker = getHandTracker();
    if (this.visionMode !== 'hand') {
      const gaze = getGazeSettings();
      const hand = getHandSettings();
      const identity = currentGazeCalibrationIdentity(hand.deviceId, hand.mirror);
      if (!gazeCalibrationMatches(gaze.calibration, identity)) {
        this.setCameraButton(`${this.visionLabel()}  •  CALIBRATE`, '#ff9a99');
        this.setStatus('EYE CALIBRATION REQUIRED — OPEN CAMERA SETUP', '#ff9a99');
        return;
      }
    }
    const activation = ++this.handActivationGeneration;
    this.handStarting = true;
    this.setCameraButton(`${this.visionLabel()}  •  STARTING`, '#ffe083');
    const enabled = await tracker.enable(this.visionMode);
    if (activation !== this.handActivationGeneration) return;
    this.handStarting = false;
    if (!this.sys.isActive() || this.terminalShown) {
      tracker.suspend();
      this.handOn = false;
      return;
    }
    if (enabled && this.visionMode !== 'hand') {
      const resolvedCameraId = tracker.getActiveCameraDeviceId();
      const gaze = getGazeSettings();
      const hand = getHandSettings();
      const identity = currentGazeCalibrationIdentity(resolvedCameraId, hand.mirror);
      if (!resolvedCameraId || !gazeCalibrationMatches(gaze.calibration, identity)) {
        tracker.disable();
        this.handOn = false;
        this.setCameraButton(`${this.visionLabel()}  •  RECALIBRATE`, '#ff9a99');
        this.setStatus('ACTIVE CAMERA CHANGED — OPEN CAMERA SETUP', '#ff9a99');
        return;
      }
    }
    this.handOn = enabled;
    this.handHasSeen = false;
    this.handLastSeenAt = 0;
    this.gazeHasSeen = false;
    this.gazeLastSeenAt = 0;
    if (enabled) {
      tracker.setPreviewVisible(false);
      this.setCameraButton(`${this.visionLabel()}  •  ON`, '#76f0c7');
      this.setStatus(
        this.visionMode === 'hand'
          ? 'MOVE OVER A CARD  •  PINCH, THEN RELEASE TO REVEAL'
          : this.visionMode === 'gaze'
            ? 'LOOK AT A CARD  •  DWELL OR DOUBLE BLINK'
            : 'LOOK AT A CARD  •  PINCH, THEN RELEASE',
        '#ffe083',
      );
    } else {
      this.setCameraButton(`${this.visionLabel()}  •  ERROR`, '#ff9a99');
      this.setStatus(cameraFailureMessage(tracker.getLastFailure()), '#ff9a99');
      if (showError) SFX.drop();
    }
  }

  private suspendVision(): void {
    this.handActivationGeneration += 1;
    this.handStarting = false;
    this.handOn = false;
    this.resetVisionAuthority();
    this.handCursor?.setVisible(false);
    getHandTracker().suspend();
  }

  private resetVisionAuthority(): void {
    this.handHasSeen = false;
    this.handLastSeenAt = 0;
    this.handLockedIndex = null;
    this.pinchControl.resetForContinuity();
    this.handContinuity.reset();
    this.gazeAimController.reset();
    this.gazeBlinkControl.reset();
    this.gazeDwellControl.reset();
    this.gazeHasSeen = false;
    this.gazeLastSeenAt = 0;
    this.gazeTarget = null;
    this.gazeCursor = null;
    this.gazeStableIndex = null;
    this.gazeBlinkIndex = null;
  }

  private pollHand(): void {
    const now = performance.now();
    const sample = getHandTracker().sample();
    if (!sample) {
      this.handleHandLoss(now);
      return;
    }
    this.handHasSeen = true;
    this.handLastSeenAt = now;
    const ageMs = now - sample.timestampMs;
    const index = this.measuredHandIndex(sample.x, sample.y);
    if (index !== null) {
      const point = cardCenter(index);
      this.handCursor?.setVisible(true).setPosition(point.x, point.y);
      if (!this.pinchControl.isEngaged()) {
        this.selectedIndex = index;
        this.drawSelection();
      }
    }
    const usable = ageMs >= 0
      && ageMs <= CAMERA_FRAME_MAX_AGE_MS
      && sample.gestureStable
      && sample.usableForGesture;
    const continuity = this.handContinuity.observe(usable, sample.timestampMs);
    if (continuity !== 'usable') {
      if (continuity === 'cancel') {
        this.pinchControl.resetForContinuity();
        this.handLockedIndex = null;
      } else {
        this.pinchControl.holdForUncertainty(sample.timestampMs);
      }
      this.setStatus('HAND FRAME UNCERTAIN — NO CARD SELECTED', '#ffe083');
      return;
    }
    const event = this.pinchControl.update(sample);
    if (event === 'latched') {
      if (index === null || this.state.cards[index]?.state !== 'hidden' || this.inputLocked) {
        this.pinchControl.resetForContinuity();
        this.handLockedIndex = null;
        return;
      }
      this.handLockedIndex = index;
      this.selectedIndex = index;
      this.drawSelection();
      this.setStatus('PINCHED  •  RELEASE TO REVEAL LOCKED CARD', '#76f0c7');
    } else if (event === 'cancelled') {
      this.handLockedIndex = null;
      this.setStatus('GESTURE CANCELLED SAFELY — NO CARD SELECTED', '#ffb783');
    } else if (event === 'released') {
      const lockedIndex = this.handLockedIndex;
      this.handLockedIndex = null;
      if (lockedIndex === null) {
        this.pinchControl.resetForContinuity();
        return;
      }
      this.activateCard(lockedIndex, 'hand');
    } else if (!this.pinchControl.isEngaged()) {
      this.setStatus('HAND READY  •  PINCH A HIDDEN CARD', '#76f0c7');
    }
  }

  private handleHandLoss(now: number): void {
    if (!this.handHasSeen) {
      this.setStatus('SEARCHING FOR HAND  •  KEEP FINGERTIPS IN FRAME', '#ffe083');
      return;
    }
    const lostFor = now - this.handLastSeenAt;
    if (this.pinchControl.cancelForLoss(now, this.handLastSeenAt) === 'cancelled') {
      this.handLockedIndex = null;
      this.setStatus('HAND LOST — NO CARD SELECTED', '#ffb783');
    }
    if (lostFor > CAMERA_LOSS_HIDE_MS) this.handCursor?.setVisible(false);
    if (lostFor > CAMERA_LOSS_RESET_MS) {
      this.pinchControl.resetForContinuity();
      this.handContinuity.reset();
      this.handLockedIndex = null;
      this.handHasSeen = false;
    }
  }

  private pollGaze(): void {
    const now = performance.now();
    const observation = getHandTracker().sampleGaze();
    if (!observation) {
      if (!this.gazeHasSeen) {
        this.setStatus('SEARCHING FOR FACE  •  KEEP BOTH EYES IN FRAME', '#ffe083');
        return;
      }
      const lostFor = now - this.gazeLastSeenAt;
      if (lostFor > CAMERA_LOSS_HIDE_MS) {
        this.gazeTarget = null;
        this.gazeCursor = null;
        this.gazeStableIndex = null;
        this.gazeBlinkIndex = null;
        this.handCursor?.setVisible(false);
        this.gazeBlinkControl.reset();
        this.gazeDwellControl.update({
          targetId: null,
          timestampMs: now,
          usableForAction: false,
          stableForAction: false,
        });
      }
      if (lostFor > CAMERA_LOSS_RESET_MS) {
        this.gazeAimController.reset();
        this.gazeHasSeen = false;
        this.setStatus('FACE LOST — NO CARD SELECTED', '#ffb783');
      }
      return;
    }

    const settings = getGazeSettings();
    const handSettings = getHandSettings();
    const activeCameraId = getHandTracker().getActiveCameraDeviceId();
    const identity = currentGazeCalibrationIdentity(activeCameraId, handSettings.mirror);
    const profile = settings.calibration;
    if (!activeCameraId || !gazeCalibrationMatches(profile, identity)) {
      getHandTracker().disable();
      this.handOn = false;
      this.resetVisionAuthority();
      this.handCursor?.setVisible(false);
      this.setCameraButton(`${this.visionLabel()}  •  RECALIBRATE`, '#ff9a99');
      this.setStatus('ACTIVE CAMERA CHANGED — OPEN CAMERA SETUP', '#ff9a99');
      return;
    }
    const aim = profile
      ? this.gazeAimController.update(observation, profile, now, {
        sensitivity: settings.sensitivity,
        responsiveness: settings.responsiveness,
      })
      : null;
    if (!aim) {
      this.gazeStableIndex = null;
      this.gazeBlinkIndex = null;
      this.gazeBlinkControl.reset();
      this.gazeDwellControl.update({
        targetId: null,
        timestampMs: observation.timestampMs,
        usableForAction: false,
        stableForAction: false,
      });
      this.handCursor?.setVisible(false);
      this.setStatus('EYE INPUT UNCERTAIN — NO CARD SELECTED', '#ffe083');
      return;
    }

    this.gazeHasSeen = true;
    this.gazeLastSeenAt = now;
    const point = { x: aim.x * VIEW.width, y: aim.y * VIEW.height };
    const index = this.cellAtPoint(point.x, point.y);
    this.gazeTarget = index === null ? point : cardCenter(index);
    if (!this.gazeCursor) this.gazeCursor = { ...this.gazeTarget };
    const stable = index !== null
      && aim.usableForAction
      && aim.stableForAction
      && now - observation.timestampMs <= CAMERA_FRAME_MAX_AGE_MS;
    const bothEyesOpen = observation.leftBlink <= 0.32 && observation.rightBlink <= 0.32;
    if (stable && bothEyesOpen) {
      this.gazeStableIndex = { index, timestampMs: observation.timestampMs };
      this.selectedIndex = index;
      this.drawSelection();
    }
    if (index === null) {
      this.gazeStableIndex = null;
      this.gazeBlinkIndex = null;
      this.gazeBlinkControl.reset();
      this.gazeDwellControl.update({
        targetId: null,
        timestampMs: observation.timestampMs,
        usableForAction: stable,
        stableForAction: aim.stableForAction,
      });
      this.setStatus('LOOK INSIDE THE CARD GRID', '#ffe083');
      return;
    }
    if (this.visionMode === 'gaze-hand') {
      this.gazeBlinkIndex = null;
      this.setStatus(stable ? 'GAZE LOCKED  •  PINCH, THEN RELEASE' : 'HOLD GAZE STEADY', stable ? '#76f0c7' : '#ffe083');
      return;
    }

    let action = false;
    if (settings.activation === 'dwell') {
      const dwell = this.gazeDwellControl.update({
        timestampMs: observation.timestampMs,
        targetId: `memory-card-${index}`,
        usableForAction: stable && bothEyesOpen && !this.inputLocked,
        stableForAction: aim.stableForAction,
      });
      action = dwell.action;
      this.setStatus(`EYE DWELL  •  ${Math.round(dwell.progress * 100)}%`, '#76f0c7');
    } else {
      const blink = this.gazeBlinkControl.update({
        timestampMs: observation.timestampMs,
        leftBlink: observation.leftBlink,
        rightBlink: observation.rightBlink,
        usableForAction: aim.usableForAction && !this.inputLocked,
        stableForAction: aim.stableForAction,
      });
      action = blink === 'action';
      if (blink !== 'action') {
        if (this.gazeBlinkControl.isSequenceEngaged()) {
          const locked = this.gazeStableIndex
            && now - this.gazeStableIndex.timestampMs <= 260
            ? this.gazeStableIndex
            : null;
          if (!this.gazeBlinkIndex && locked) this.gazeBlinkIndex = { ...locked };
        } else {
          this.gazeBlinkIndex = null;
        }
      }
      this.setStatus(
        aim.stableForAction ? 'GAZE LOCKED  •  DOUBLE BLINK TO REVEAL' : 'HOLD GAZE STEADY',
        aim.stableForAction ? '#76f0c7' : '#ffe083',
      );
    }
    if (!action) return;
    const authority = settings.activation === 'double-blink'
      ? this.gazeBlinkIndex
      : this.gazeStableIndex;
    const maxAge = settings.activation === 'double-blink' ? 1_000 : 260;
    const authoritativeIndex = authority && now - authority.timestampMs <= maxAge
      ? authority.index
      : null;
    this.gazeBlinkIndex = null;
    this.gazeBlinkControl.reset();
    if (authoritativeIndex !== null) this.activateCard(authoritativeIndex, 'gaze');
  }

  private pollGazeHand(): void {
    const now = performance.now();
    const sample = getHandTracker().sample();
    if (!sample) {
      if (this.pinchControl.cancelForLoss(now, this.handLastSeenAt) === 'cancelled') {
        this.handLockedIndex = null;
      }
      return;
    }
    this.handHasSeen = true;
    this.handLastSeenAt = now;
    const ageMs = now - sample.timestampMs;
    const usable = ageMs >= 0
      && ageMs <= CAMERA_FRAME_MAX_AGE_MS
      && sample.gestureStable
      && sample.usableForGesture;
    const continuity = this.handContinuity.observe(usable, sample.timestampMs);
    if (continuity !== 'usable') {
      if (continuity === 'cancel') {
        this.pinchControl.resetForContinuity();
        this.handLockedIndex = null;
      } else {
        this.pinchControl.holdForUncertainty(sample.timestampMs);
      }
      return;
    }
    const event = this.pinchControl.update(sample);
    if (event === 'latched') {
      const stable = this.gazeStableIndex
        && now - this.gazeStableIndex.timestampMs <= 260
        ? this.gazeStableIndex.index
        : null;
      if (stable === null || this.state.cards[stable]?.state !== 'hidden' || this.inputLocked) {
        this.pinchControl.resetForContinuity();
        this.handLockedIndex = null;
        return;
      }
      this.handLockedIndex = stable;
      this.selectedIndex = stable;
      this.drawSelection();
      this.setStatus('GAZE CARD LOCKED  •  RELEASE PINCH TO REVEAL', '#76f0c7');
    } else if (event === 'cancelled') {
      this.handLockedIndex = null;
      this.setStatus('GESTURE CANCELLED SAFELY — NO CARD SELECTED', '#ffb783');
    } else if (event === 'released') {
      const lockedIndex = this.handLockedIndex;
      this.handLockedIndex = null;
      if (lockedIndex !== null) this.activateCard(lockedIndex, 'gaze-hand');
    }
  }

  private advanceGazeCursor(deltaMs: number): void {
    if (!this.gazeTarget || !this.handCursor) return;
    if (!this.gazeCursor) this.gazeCursor = { ...this.gazeTarget };
    const follow = 1 - Math.exp(-Math.min(50, Math.max(1, deltaMs)) / 22);
    this.gazeCursor.x = Phaser.Math.Linear(this.gazeCursor.x, this.gazeTarget.x, follow);
    this.gazeCursor.y = Phaser.Math.Linear(this.gazeCursor.y, this.gazeTarget.y, follow);
    this.handCursor.setVisible(getGazeSettings().showCursor).setPosition(
      this.gazeCursor.x,
      this.gazeCursor.y,
    );
  }

  private setCameraButton(label: string, color: string): void {
    this.cameraButtonText?.setText(label).setColor(color);
    updateArtButtonAccessibility(this.cameraButton, {
      label,
      pressed: label.includes('ON'),
      disabled: label.includes('STARTING'),
    });
  }

  private visionLabel(): string {
    if (this.visionMode === 'gaze') return 'EYES';
    if (this.visionMode === 'gaze-hand') return 'EYES + PINCH';
    return 'HAND';
  }

  private setStatus(message: string, color: string): void {
    this.statusText?.setText(message).setColor(color);
    if (this.statusText) fitText(this.statusText, 658);
    this.a11y?.setStatus(message);
  }

  private announce(message: string, priority: 'polite' | 'assertive' = 'polite'): void {
    this.a11y?.announce(message, priority);
  }

  private formatTime(timeMs: number): string {
    const totalSeconds = Math.max(0, Math.floor(timeMs / 1_000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }

  private restartSameSeed(): void {
    this.suspendVision();
    this.scene.restart({ seed: this.seed });
  }

  private leaveScene(): void {
    this.suspendVision();
    this.scene.start('ArcadeHub');
  }
}

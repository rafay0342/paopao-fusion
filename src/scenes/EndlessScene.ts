import Phaser from 'phaser';
import { COLOR_KEYS, COLORS, orbTexture, VIEW, type ColorKey } from '../config';
import type { RunReceiptV3, RunSubmissionV3 } from '../game/contracts';
import {
  ENDLESS_REPLAY_RULES,
  EndlessTraceRecorder,
  buildEndlessTargetSequence,
  createEndlessHexGrid,
  endlessLaneForBoardX,
  finalizeEndlessRunSubmission,
  resolveEndlessSessionV3,
  simulateEndlessReplay,
  type EndlessHexGrid,
  type EndlessSessionV3,
} from '../game/endless';
import {
  HandAimPredictor,
  HandGestureContinuityGate,
  mapHandToAim,
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
import { getBootstrapV3, submitRunV3, syncClassicProgressV4 } from '../game/platform';
import { SFX } from '../game/sfx';
import {
  addAmbientMotes,
  addArtButton,
  addArtPanel,
  addWorldBackground,
  DISPLAY_FONT,
  fitText,
  sharpenSceneText,
  TYPE,
  UI_FONT,
} from '../gfx/ui';

type EndlessTarget = ReturnType<typeof buildEndlessTargetSequence>[number];
type EndlessSceneData = { event?: boolean };

const BOARD_TOP = 244;
const BOARD_ROWS = 7;
const LAUNCHER_Y = 1_036;
const AUTO_BANK_IDLE_MS = 12_000;
const BOSS_TEXTURES: Record<string, string> = {
  'prism-warden': 'boss_prism',
  'heartwood-guardian': 'boss_heartwood',
  'astral-sentinel': 'boss_astral',
  'inferno-sovereign': 'boss_inferno',
};

function runId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return `endless_${crypto.randomUUID()}`;
  } catch { /* timestamp fallback below */ }
  return `endless_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 14)}`;
}

function failureMessage(failure: HandTrackingFailure): string {
  if (failure === 'permission-denied') return 'CAMERA BLOCKED — ALLOW CAMERA AND RETRY';
  if (failure === 'no-camera') return 'NO CAMERA FOUND';
  if (failure === 'insecure-context') return 'HAND MODE REQUIRES HTTPS';
  if (failure === 'unsupported') return 'HAND MODE IS NOT SUPPORTED HERE';
  return 'HAND CAMERA COULD NOT START';
}

export class EndlessScene extends Phaser.Scene {
  private preferEvent = false;
  private session?: EndlessSessionV3;
  private grid?: EndlessHexGrid;
  private targets: EndlessTarget[] = [];
  private recorder?: EndlessTraceRecorder;
  private selectedLane = 5;
  private running = false;
  private flying = false;
  private submitting = false;
  private startedAtMs = 0;
  private createdAt = '';
  private pendingSubmission?: RunSubmissionV3;
  private targetSprite?: Phaser.GameObjects.Image;
  private targetHalo?: Phaser.GameObjects.Arc;
  private aimGraphics?: Phaser.GameObjects.Graphics;
  private launcher?: Phaser.GameObjects.Image;
  private handCursor?: Phaser.GameObjects.Arc;
  private handStatus?: Phaser.GameObjects.Text;
  private stateText?: Phaser.GameObjects.Text;
  private scoreText?: Phaser.GameObjects.Text;
  private waveText?: Phaser.GameObjects.Text;
  private accuracyText?: Phaser.GameObjects.Text;
  private targetText?: Phaser.GameObjects.Text;
  private fuseText?: Phaser.GameObjects.Text;
  private comboText?: Phaser.GameObjects.Text;
  private bossHpFill?: Phaser.GameObjects.Rectangle;
  private bossHpWidth = 0;
  private handOn = false;
  private handStarting = false;
  private visionMode: VisionTrackingMode = 'hand';
  private handHasSeen = false;
  private handLastSeenAt = 0;
  private handReleaseThreshold = 0.5;
  private handLockedLane: number | null = null;
  private handOpenLane: { lane: number; timestampMs: number } | null = null;
  private requireFreshPointerAfterContext = false;
  private pinchControl = new PinchDoubleTapControl(undefined, undefined, { fireOnFirstRelease: true });
  private readonly handAimPredictor = new HandAimPredictor();
  private readonly handContinuity = new HandGestureContinuityGate();
  private readonly gazeAimController = new GazeAimController();
  private readonly gazeBlinkControl = new DoubleBlinkControl();
  private gazeDwellControl = new GazeDwellControl();
  private gazeHasSeen = false;
  private gazeLastSeenAt = 0;
  private gazeStableLane: { lane: number; timestampMs: number } | null = null;
  private gazeBlinkLane: { lane: number; timestampMs: number } | null = null;
  private gazeCursorTarget: { x: number; y: number } | null = null;
  private gazeCursorSmooth: { x: number; y: number } | null = null;
  private readonly handleRenderContextBoundary = (event: Event): void => {
    if (!this.scene.isActive()) return;
    const phase = (event as CustomEvent<{ phase?: string }>).detail?.phase;
    this.pinchControl.resetForContinuity();
    this.handHasSeen = false;
    this.handLastSeenAt = 0;
    this.handLockedLane = null;
    this.handOpenLane = null;
    this.handAimPredictor.reset();
    this.handContinuity.reset();
    this.gazeAimController.reset();
    this.gazeBlinkControl.reset();
    this.gazeDwellControl.reset();
    this.gazeHasSeen = false;
    this.gazeLastSeenAt = 0;
    this.gazeStableLane = null;
    this.gazeBlinkLane = null;
    this.gazeCursorTarget = null;
    this.gazeCursorSmooth = null;
    this.handCursor?.setVisible(false);
    this.handStatus?.setText(`${this.visionLabel()} STABILIZING`).setColor('#ffe083');
    if (phase === 'restored') this.requireFreshPointerAfterContext = true;
  };

  constructor() {
    super('Endless');
  }

  init(data: EndlessSceneData = {}): void {
    this.preferEvent = data.event === true;
    this.session = undefined;
    this.grid = undefined;
    this.targets = [];
    this.recorder = undefined;
    this.selectedLane = 5;
    this.running = false;
    this.flying = false;
    this.submitting = false;
    this.pendingSubmission = undefined;
    this.targetSprite = undefined;
    this.targetHalo = undefined;
    this.handOn = false;
    this.handStarting = false;
    this.handHasSeen = false;
    this.handLastSeenAt = 0;
    this.handLockedLane = null;
    this.handOpenLane = null;
    this.handAimPredictor.reset();
    this.handContinuity.reset();
    this.requireFreshPointerAfterContext = false;
    const settings = getHandSettings();
    const gazeSettings = getGazeSettings();
    this.visionMode = gazeSettings.mode === 'off' ? 'hand' : gazeSettings.mode;
    this.gazeDwellControl = new GazeDwellControl(gazeSettings.dwellMs);
    this.gazeAimController.reset();
    this.gazeBlinkControl.reset();
    this.gazeHasSeen = false;
    this.gazeLastSeenAt = 0;
    this.gazeStableLane = null;
    this.gazeBlinkLane = null;
    this.gazeCursorTarget = null;
    this.gazeCursorSmooth = null;
    this.handReleaseThreshold = settings.pinchOff;
    this.pinchControl = new PinchDoubleTapControl(
      settings.pinchOn,
      settings.pinchOff,
      { fireOnFirstRelease: true },
    );
  }

  create(): void {
    addWorldBackground(this, 'world_nexus', 0.22);
    addAmbientMotes(this, 0xa88cff, 16, 2);
    this.cameras.main.fadeIn(180, 0, 0, 0);
    this.add.text(VIEW.width / 2, 52, this.preferEvent ? 'LIVE CROWNFALL' : 'ENDLESS NEXUS', {
      fontFamily: DISPLAY_FONT,
      fontSize: TYPE.screen,
      color: '#ffffff',
      fontStyle: 'bold',
      stroke: '#251752',
      strokeThickness: 7,
    }).setOrigin(0.5).setDepth(12);
    fitText(this.add.text(VIEW.width / 2, 98, 'SERVER-SEEDED • VERIFIED REPLAY • 11-LANE HEX FIELD', {
      fontFamily: UI_FONT,
      fontSize: TYPE.caption,
      color: '#c9b7ff',
      fontStyle: 'bold',
      letterSpacing: 1,
    }).setOrigin(0.5).setDepth(12), 680);
    this.add.text(34, 35, '‹  BACK', {
      fontFamily: UI_FONT, fontSize: TYPE.body, color: '#e7e1ff', fontStyle: 'bold',
    }).setDepth(14).setInteractive({ useHandCursor: true }).on('pointerup', () => this.leaveScene());

    addArtPanel(this, VIEW.width / 2, 154, 650, 76, 8, 0.97);
    this.stateText = this.add.text(VIEW.width / 2, 154, 'VERIFYING CURRENT SIGNED LIVE CONFIG…', {
      fontFamily: UI_FONT, fontSize: TYPE.control, color: '#ffe39a', fontStyle: 'bold', align: 'center',
      wordWrap: { width: 620 },
    }).setOrigin(0.5).setDepth(12);

    const handleBack = (): void => this.leaveScene();
    this.events.on('paopao:back-request', handleBack);
    window.addEventListener('paopao:render-context-boundary', this.handleRenderContextBoundary);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.events.off('paopao:back-request', handleBack);
      window.removeEventListener('paopao:render-context-boundary', this.handleRenderContextBoundary);
      this.pinchControl.reset();
      this.handLockedLane = null;
      getHandTracker().suspend();
    });
    void this.bootstrapRun();
  }

  update(): void {
    if (!this.running || !this.session || !this.recorder) return;
    if (this.visionMode === 'hand') {
      this.pollHand();
      this.advanceHandAim();
    } else {
      this.pollGaze();
      if (this.visionMode === 'gaze-hand') this.pollHybridHand();
      this.advanceGazeAim();
    }
    const now = performance.now();
    const trace = this.recorder.snapshot();
    const target = this.targets[trace.length];
    if (target?.fuseMs != null) {
      const previousAt = trace[trace.length - 1]?.atMs ?? 0;
      const elapsed = Math.max(0, Math.floor(now - this.startedAtMs) - previousAt);
      const remaining = Math.max(0, target.fuseMs - elapsed);
      this.fuseText?.setText(`FUSE  ${(remaining / 1000).toFixed(2)}s`).setColor(remaining > 300 ? '#ffe08a' : '#ff7388');
    } else this.fuseText?.setText('FUSE  ∞').setColor('#8fead6');

    const correctedNow = Date.now() + this.session.serverTimeOffsetMs;
    if (correctedNow >= Date.parse(this.session.endsAt)) {
      this.failClosed('LIVE WINDOW ENDED — THIS RUN CANNOT MINT A REWARD');
      return;
    }
    const lastAt = trace[trace.length - 1]?.atMs;
    if (lastAt !== undefined && !this.flying && now - this.startedAtMs - lastAt >= AUTO_BANK_IDLE_MS) {
      void this.finishRun('AUTO-BANKED AFTER 12s IDLE');
    }
  }

  private async bootstrapRun(): Promise<void> {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      this.showGate('OFFLINE — ENDLESS REWARDS REQUIRE THE AUTHORITATIVE SERVER', 'RETRY');
      return;
    }
    try {
      const bootstrap = await getBootstrapV3();
      if (!this.sys.isActive()) return;
      const resolved = resolveEndlessSessionV3(bootstrap, this.preferEvent);
      if (!resolved.ok) {
        this.showGate(
          resolved.error === 'authentication-required'
            ? 'SIGN IN REQUIRED — CLIENT-SIDE REWARDS ARE DISABLED'
            : `LIVE CONFIG REJECTED — ${resolved.error.toUpperCase().replace(/-/g, ' ')}`,
          resolved.error === 'authentication-required' ? 'OPEN ACCOUNT' : 'RETRY',
          resolved.error === 'authentication-required',
        );
        return;
      }
      this.session = resolved.session;
      this.buildPlayableField();
    } catch {
      if (this.sys.isActive()) this.showGate('SERVER UNREACHABLE — NO OFFLINE SCORE OR REWARD WAS CREATED', 'RETRY');
    }
  }

  private showGate(message: string, action: string, account = false): void {
    this.running = false;
    this.stateText?.setText(message).setColor('#ff9ca9');
    addArtButton(this, VIEW.width / 2, 260, action, () => {
      SFX.click();
      if (account) this.scene.start('Account');
      else this.scene.restart({ event: this.preferEvent });
    }, 330, 64, 20);
    this.add.text(VIEW.width / 2, 330, 'FAIL-CLOSED: CAMERA FRAMES STAY LOCAL; WALLET AND EVENT PROGRESS STAY SERVER-OWNED.', {
      fontFamily: UI_FONT, fontSize: TYPE.caption, color: '#b9c6d9', fontStyle: 'bold', align: 'center',
      wordWrap: { width: 620 },
    }).setOrigin(0.5).setDepth(20);
    sharpenSceneText(this);
  }

  private buildPlayableField(): void {
    const session = this.session!;
    const event = session.event;
    this.stateText?.setText(event
      ? `${event.boss.replace(/-/g, ' ').toUpperCase()}  •  ${event.modifier.replace(/-/g, ' ').toUpperCase()}  •  WIN ◆ ${event.reward.amount}`
      : `${session.seasonId.toUpperCase()}  •  BANK FOR SERVER VERIFICATION`)
      .setColor(event ? '#ffe39a' : '#a9f5e7');

    this.grid = createEndlessHexGrid(VIEW.width, BOARD_TOP, BOARD_ROWS);
    this.targets = buildEndlessTargetSequence({
      seed: session.seed,
      shotCount: session.maximumShots,
      modifier: session.modifier,
    });
    this.startedAtMs = performance.now();
    this.createdAt = new Date(Date.now() + session.serverTimeOffsetMs).toISOString();
    this.recorder = new EndlessTraceRecorder(this.startedAtMs, session.maximumShots);

    addArtPanel(this, VIEW.width / 2, 516, 680, 665, 5, 0.86);
    this.drawHexField();
    this.drawHud();
    this.launcher = this.add.image(VIEW.width / 2, LAUNCHER_Y + 75, 'crystal_launcher')
      .setOrigin(0.5, 0.74).setDisplaySize(218, 218).setDepth(8);
    this.aimGraphics = this.add.graphics().setDepth(7);
    this.handCursor = this.add.circle(0, 0, 22, 0x000000, 0)
      .setStrokeStyle(3, 0xaefcff, 0.9).setDepth(16).setVisible(false);

    addArtButton(this, 184, 1_205, 'BANK RUN', () => void this.finishRun('PLAYER BANKED RUN'), 300, 62, 22);
    addArtButton(this, 536, 1_205, `${this.visionLabel()} CAMERA`, () => void this.toggleHand(), 300, 62, 22);
    this.handStatus = this.add.text(536, 1_160, `${this.visionLabel()} OFF`, {
      fontFamily: UI_FONT, fontSize: TYPE.caption, color: '#8595aa', fontStyle: 'bold', letterSpacing: 1,
    }).setOrigin(0.5).setDepth(23);

    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      if (pointer.worldY >= BOARD_TOP - 45 && pointer.worldY <= LAUNCHER_Y) this.selectLaneAt(pointer.worldX);
    });
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (pointer.worldY >= BOARD_TOP - 45 && pointer.worldY <= LAUNCHER_Y) {
        this.requireFreshPointerAfterContext = false;
        this.selectLaneAt(pointer.worldX);
      }
    });
    this.input.on('pointerup', (pointer: Phaser.Input.Pointer) => {
      if (this.requireFreshPointerAfterContext) return;
      if (pointer.worldY < BOARD_TOP - 45 || pointer.worldY > LAUNCHER_Y) return;
      this.selectLaneAt(pointer.worldX);
      this.fireSelectedLane('pointer');
    });
    const keyboard = this.input.keyboard;
    const left = (): void => this.selectLane(this.selectedLane - 1);
    const right = (): void => this.selectLane(this.selectedLane + 1);
    const fire = (): void => this.fireSelectedLane('keyboard');
    const hand = (): void => { void this.toggleHand(); };
    keyboard?.on('keydown-LEFT', left);
    keyboard?.on('keydown-A', left);
    keyboard?.on('keydown-RIGHT', right);
    keyboard?.on('keydown-D', right);
    keyboard?.on('keydown-SPACE', fire);
    keyboard?.on('keydown-ENTER', fire);
    keyboard?.on('keydown-H', hand);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      keyboard?.off('keydown-LEFT', left);
      keyboard?.off('keydown-A', left);
      keyboard?.off('keydown-RIGHT', right);
      keyboard?.off('keydown-D', right);
      keyboard?.off('keydown-SPACE', fire);
      keyboard?.off('keydown-ENTER', fire);
      keyboard?.off('keydown-H', hand);
    });

    const tracker = getHandTracker();
    if (tracker.isWanted()) void this.startHandTracking(false);
    else void tracker.prepare().catch(() => undefined);
    this.running = true;
    this.selectLane(5);
    this.renderTarget();
    this.toast('AIM WITH POINTER / ← → / CAMERA  •  RELEASE, SPACE, DOUBLE BLINK, OR PINCH TO FIRE');
    sharpenSceneText(this);
  }

  private drawHexField(): void {
    const grid = this.grid!;
    const field = this.add.graphics().setDepth(6);
    for (const cell of grid.cells) {
      const points = Array.from({ length: 6 }, (_, index) => {
        const angle = Phaser.Math.DegToRad(index * 60 + 30);
        return { x: cell.x + Math.cos(angle) * grid.radius, y: cell.y + Math.sin(angle) * grid.radius };
      });
      field.fillStyle((cell.row + cell.lane) % 2 ? 0x101936 : 0x0a132b, 0.34);
      field.fillPoints(points, true);
      field.lineStyle(1, cell.lane === 5 ? 0xb894ff : 0x5575a6, cell.lane === 5 ? 0.28 : 0.15);
      field.strokePoints(points, true);
    }
    fitText(this.add.text(VIEW.width / 2, 205, 'SIGNED TARGET STREAM  •  ONE SEED STEP PER SHOT', {
      fontFamily: UI_FONT, fontSize: TYPE.caption, color: '#9eb1ca', fontStyle: 'bold', letterSpacing: 1,
    }).setOrigin(0.5).setDepth(9), 670);
  }

  private drawHud(): void {
    this.scoreText = this.add.text(38, 830, 'SCORE  0', {
      fontFamily: UI_FONT, fontSize: TYPE.metric, color: '#ffffff', fontStyle: 'bold', stroke: '#070b18', strokeThickness: 4,
    }).setDepth(12);
    this.waveText = this.add.text(VIEW.width / 2, 830, 'WAVE  1  •  SHOT  1', {
      fontFamily: UI_FONT, fontSize: TYPE.control, color: '#ffe39a', fontStyle: 'bold',
    }).setOrigin(0.5, 0).setDepth(12);
    this.accuracyText = this.add.text(VIEW.width - 38, 830, 'HITS  0 / 0', {
      fontFamily: UI_FONT, fontSize: TYPE.control, color: '#9ce8db', fontStyle: 'bold',
    }).setOrigin(1, 0).setDepth(12);
    this.targetText = this.add.text(38, 878, 'TARGET  —', {
      fontFamily: UI_FONT, fontSize: TYPE.control, color: '#c7b4ff', fontStyle: 'bold',
    }).setDepth(12);
    this.fuseText = this.add.text(VIEW.width - 38, 878, 'FUSE  ∞', {
      fontFamily: UI_FONT, fontSize: TYPE.control, color: '#8fead6', fontStyle: 'bold',
    }).setOrigin(1, 0).setDepth(12);
    this.comboText = this.add.text(VIEW.width / 2, 930, 'READY', {
      fontFamily: DISPLAY_FONT, fontSize: TYPE.title, color: '#ffffff', fontStyle: 'bold', stroke: '#251752', strokeThickness: 5,
    }).setOrigin(0.5).setDepth(12);
    if (this.session?.event) {
      const maxHp = 8 + (this.session.level % 5);
      const texture = BOSS_TEXTURES[this.session.event.boss] ?? 'boss_astral';
      this.add.image(67, 742, texture).setDisplaySize(82, 82).setDepth(11);
      this.add.rectangle(120, 754, 500, 18, 0x030612, 0.94).setOrigin(0, 0.5).setStrokeStyle(2, 0xffda8a, 0.55).setDepth(10);
      this.bossHpWidth = 496;
      this.bossHpFill = this.add.rectangle(122, 754, this.bossHpWidth, 14, 0xb47cff, 0.95).setOrigin(0, 0.5).setDepth(11);
      this.add.text(122, 721, `${this.session.event.boss.replace(/-/g, ' ').toUpperCase()}  •  HP ${maxHp}`, {
        fontFamily: UI_FONT, fontSize: TYPE.caption, color: '#ffe39a', fontStyle: 'bold',
      }).setDepth(12);
    }
  }

  private gridCell(row: number, lane: number): { x: number; y: number } {
    return this.grid?.cells.find((cell) => cell.row === row && cell.lane === lane)
      ?? { x: VIEW.width / 2, y: BOARD_TOP };
  }

  private renderTarget(): void {
    this.clearTargetVisual();
    if (!this.running || !this.recorder) return;
    const sequence = this.recorder.snapshot().length;
    const target = this.targets[sequence];
    if (!target) {
      void this.finishRun('MAXIMUM TRACE LENGTH REACHED');
      return;
    }
    const row = 1 + target.pressure;
    const point = this.gridCell(row, target.lane);
    const color = COLOR_KEYS[target.colorIndex] as ColorKey;
    this.targetHalo = this.add.circle(point.x, point.y, (this.grid?.radius ?? 24) + 7, COLORS[color].hex, 0.08)
      .setStrokeStyle(3, 0xffe18b, 0.86).setDepth(9);
    this.targetSprite = this.add.image(point.x, point.y, orbTexture(getMeta().equippedSkin, color))
      .setDisplaySize((this.grid?.radius ?? 24) * 1.72, (this.grid?.radius ?? 24) * 1.72).setDepth(10);
    const spriteScaleX = this.targetSprite.scaleX;
    const spriteScaleY = this.targetSprite.scaleY;
    this.tweens.add({ targets: this.targetHalo, scaleX: 1.08, scaleY: 1.08, duration: 440, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    this.tweens.add({
      targets: this.targetSprite,
      scaleX: spriteScaleX * 1.08,
      scaleY: spriteScaleY * 1.08,
      duration: 440,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });
    this.targetText?.setText(`TARGET  LANE ${target.lane + 1}  •  ${target.toleranceLanes ? 'NEAR HIT ±1' : 'EXACT ONLY'}`);
    this.waveText?.setText(`WAVE  ${target.wave}  •  SHOT  ${sequence + 1}`);
  }

  private selectLaneAt(x: number): void {
    if (!this.grid) return;
    this.selectLane(endlessLaneForBoardX(this.grid, x));
  }

  private selectLane(lane: number): void {
    if (!this.grid || !this.running || this.handLockedLane !== null) return;
    this.selectedLane = Phaser.Math.Clamp(Math.trunc(lane), 0, ENDLESS_REPLAY_RULES.laneCount - 1);
    this.drawAim();
  }

  private gazeLaneAtX(x: number): number {
    const grid = this.grid;
    if (!grid) return this.selectedLane;
    const measured = endlessLaneForBoardX(grid, x);
    const current = this.gazeStableLane?.lane ?? this.selectedLane;
    if (measured === current) return measured;
    const currentPoint = this.gridCell(1, current);
    const nextLane = measured > current
      ? Math.min(current + 1, ENDLESS_REPLAY_RULES.laneCount - 1)
      : Math.max(current - 1, 0);
    const nextPoint = this.gridCell(1, nextLane);
    const boundary = (currentPoint.x + nextPoint.x) / 2;
    const margin = Math.abs(nextPoint.x - currentPoint.x) * 0.18;
    if (nextLane > current && x < boundary + margin) return current;
    if (nextLane < current && x > boundary - margin) return current;
    return measured;
  }

  private drawAim(lane = this.selectedLane): void {
    if (!this.aimGraphics || !this.grid || !this.launcher) return;
    const target = this.targets[this.recorder?.snapshot().length ?? 0];
    const row = target ? 1 + target.pressure : 1;
    const point = this.gridCell(row, lane);
    const graphics = this.aimGraphics.clear();
    graphics.lineStyle(3, 0x9df5ff, 0.72).lineBetween(VIEW.width / 2, LAUNCHER_Y, point.x, point.y);
    graphics.lineStyle(1, 0xffdf8c, 0.36);
    for (const cell of this.grid.cells.filter((cell) => cell.lane === lane)) graphics.strokeCircle(cell.x, cell.y, this.grid.radius + 2);
    const angle = -30 + lane * 6;
    this.launcher.setAngle(angle);
  }

  private fireSelectedLane(source: 'pointer' | 'keyboard' | 'hand' | 'gaze' | 'gaze-hand'): void {
    if (!this.running || this.flying || this.submitting || !this.recorder || !this.session) return;
    const result = this.recorder.recordLane(this.selectedLane, performance.now());
    if (!result.ok) {
      if (result.error === 'replay-shot-too-soon') this.toast(`STEADY  •  ${result.retryAfterMs ?? 0}ms`);
      else this.failClosed(result.error.toUpperCase().replace(/-/g, ' '));
      return;
    }
    this.pinchControl.resetForShot();
    this.handLockedLane = null;
    const target = this.targets[result.shot.sequence];
    const trace = this.recorder.snapshot();
    const provisionalDuration = Math.max(500, result.shot.atMs + ENDLESS_REPLAY_RULES.minimumSettlementMs);
    const simulation = simulateEndlessReplay({
      seed: this.session.seed,
      level: this.session.level,
      durationMs: provisionalDuration,
      shotTrace: trace,
      modifier: this.session.modifier,
      eventBoss: Boolean(this.session.event),
    });
    if (!simulation.ok) {
      this.failClosed(`LOCAL AUTHORITY REJECTED TRACE — ${simulation.error}`);
      return;
    }
    const outcome = simulation.outcomes[simulation.outcomes.length - 1];
    const hit = outcome.hit === true;
    const exact = outcome.exact === true;
    const destination = this.gridCell(1 + target.pressure, this.selectedLane);
    const color = COLOR_KEYS[target.colorIndex] as ColorKey;
    const projectile = this.add.image(VIEW.width / 2, LAUNCHER_Y, orbTexture(getMeta().equippedSkin, color))
      .setDisplaySize(48, 48).setDepth(13);
    this.flying = true;
    SFX.shoot();
    this.tweens.add({
      targets: projectile,
      x: destination.x,
      y: destination.y,
      scale: 0.82,
      duration: 250,
      ease: 'Cubic.easeIn',
      onComplete: () => {
        projectile.destroy();
        if (!this.sys.isActive()) return;
        this.resolveShotVisual(hit, exact, destination, simulation.result, outcome, source);
      },
    });
  }

  private resolveShotVisual(
    hit: boolean,
    exact: boolean,
    destination: { x: number; y: number },
    result: { score: number; hits: number; shots: number; wave: number; maxCombo: number; won: boolean; boss: { maxHp: number; hp: number } | null },
    outcome: Record<string, number | boolean>,
    source: string,
  ): void {
    this.flying = false;
    const ring = this.add.circle(destination.x, destination.y, 20, hit ? 0x73f2c6 : 0xff667b, 0.2)
      .setStrokeStyle(4, hit ? 0x73f2c6 : 0xff667b, 0.95).setDepth(14);
    this.tweens.add({ targets: ring, scale: 2.5, alpha: 0, duration: 360, onComplete: () => ring.destroy() });
    if (hit) {
      SFX.pop(result.maxCombo);
      this.targetSprite?.setTint(0xffffff);
      this.comboText?.setText(exact ? `PERFECT  +${Number(outcome.points)}` : `HIT  +${Number(outcome.points)}`).setColor(exact ? '#ffe580' : '#80f0cd');
    } else {
      SFX.drop();
      this.targetSprite?.setTint(0xff6579);
      this.comboText?.setText('MISS').setColor('#ff8999');
    }
    this.scoreText?.setText(`SCORE  ${result.score.toLocaleString()}`);
    this.accuracyText?.setText(`HITS  ${result.hits} / ${result.shots}`);
    if (result.boss && this.bossHpFill) {
      this.bossHpFill.width = this.bossHpWidth * (result.boss.hp / result.boss.maxHp);
    }
    const cameraSource = source === 'hand' || source === 'gaze' || source === 'gaze-hand';
    this.handStatus?.setText(
      this.handOn
        ? `${this.visionLabel()} ${cameraSource ? 'FIRED' : 'READY'}`
        : `${this.visionLabel()} OFF`,
    );
    this.clearTargetVisual();
    if (result.won && this.session?.event) {
      SFX.win();
      this.time.delayedCall(280, () => void this.finishRun('EVENT BOSS DEFEATED'));
      return;
    }
    if (result.shots >= (this.session?.maximumShots ?? ENDLESS_REPLAY_RULES.maximumShots)) {
      this.time.delayedCall(280, () => void this.finishRun('MAXIMUM TRACE LENGTH REACHED'));
      return;
    }
    this.renderTarget();
    this.drawAim();
  }

  private async finishRun(reason: string): Promise<void> {
    if (!this.running || this.submitting || !this.recorder || !this.session) return;
    if (this.flying) {
      this.time.delayedCall(90, () => void this.finishRun(reason));
      return;
    }
    const sealed = this.recorder.seal(performance.now());
    if (!sealed.ok) {
      if (sealed.error === 'replay-settlement-pending') {
        this.stateText?.setText(`SETTLING LAST SHOT  •  ${sealed.retryAfterMs ?? 0}ms`).setColor('#ffe39a');
        this.time.delayedCall(Math.max(1, sealed.retryAfterMs ?? 1), () => void this.finishRun(reason));
      } else this.toast(sealed.error === 'replay-empty' ? 'FIRE AT LEAST ONE SHOT BEFORE BANKING' : sealed.error.toUpperCase().replace(/-/g, ' '));
      return;
    }
    this.running = false;
    this.submitting = true;
    this.pinchControl.reset();
    this.handCursor?.setVisible(false);
    getHandTracker().suspend();
    this.stateText?.setText(`${reason}  •  BUILDING CANONICAL SHA-256 REPLAY…`).setColor('#ffe39a');
    try {
      this.pendingSubmission = await finalizeEndlessRunSubmission({
        runId: runId(),
        client: 'classic',
        level: this.session.level,
        durationMs: sealed.durationMs,
        contentVersion: this.session.contentVersion,
        seasonId: this.session.seasonId,
        seed: this.session.seed,
        shotTrace: sealed.shotTrace,
        createdAt: this.createdAt,
        ...(this.session.event ? { event: this.session.event } : {}),
      });
      await this.submitPending();
    } catch (error) {
      this.showSubmissionFailure(error instanceof Error ? error.message : 'submission-build-failed');
    }
  }

  private async submitPending(): Promise<void> {
    if (!this.pendingSubmission) return;
    this.submitting = true;
    this.stateText?.setText('SUBMITTING EXACT TRACE TO SERVER AUTHORITY…').setColor('#ffe39a');
    try {
      const receipt = await submitRunV3(this.pendingSubmission);
      if (!this.sys.isActive()) return;
      this.presentReceipt(receipt);
    } catch (error) {
      if (this.sys.isActive()) this.showSubmissionFailure(error instanceof Error ? error.message : 'network-unavailable');
    }
  }

  private showSubmissionFailure(reason: string): void {
    this.submitting = false;
    this.stateText?.setText(`NOT SETTLED — ${reason.toUpperCase().replace(/-/g, ' ')}  •  NO REWARD CREATED`).setColor('#ff8fa2');
    addArtButton(this, 192, 1_102, 'RETRY SAME TRACE', () => void this.submitPending(), 300, 64, 40);
    addArtButton(this, 528, 1_102, 'EXIT WITHOUT REWARD', () => this.leaveScene(), 300, 64, 40);
    sharpenSceneText(this);
  }

  private presentReceipt(receipt: RunReceiptV3): void {
    this.submitting = false;
    const verification = receipt.replayVerification;
    if (verification?.status !== 'authoritative' || verification.authoritative !== true || !verification.result) {
      this.showSubmissionFailure(verification?.reason ?? 'authoritative-verification-required');
      return;
    }
    const result = verification.result;
    this.stateText?.setText('AUTHORITATIVE REPLAY VERIFIED  •  SERVER STATE COMMITTED').setColor('#76f0c7');
    const overlay = this.add.container(0, 0).setDepth(50);
    const dim = this.add.rectangle(0, 0, VIEW.width, VIEW.height, 0x02040b, 0.84).setOrigin(0);
    const panel = addArtPanel(this, VIEW.width / 2, 625, 640, 720, 51, 0.99);
    const title = this.add.text(VIEW.width / 2, 348, this.session?.event ? (result.won ? 'EVENT VERIFIED' : 'RUN VERIFIED') : 'ENDLESS VERIFIED', {
      fontFamily: DISPLAY_FONT, fontSize: TYPE.screen, color: result.won ? '#ffe28a' : '#83eed0', fontStyle: 'bold',
      stroke: '#21164a', strokeThickness: 7,
    }).setOrigin(0.5).setDepth(52);
    const stats = this.add.text(VIEW.width / 2, 440,
      `SCORE  ${result.score.toLocaleString()}\nWAVE  ${result.wave}   •   HITS  ${result.hits}/${result.shots}\nMAX COMBO  ${result.maxCombo}   •   SEASON +${result.seasonPoints}`,
      { fontFamily: UI_FONT, fontSize: TYPE.title, color: '#ffffff', fontStyle: 'bold', align: 'center', lineSpacing: 13 },
    ).setOrigin(0.5).setDepth(52);
    const progression = receipt.progression?.applied
      ? `SEASON TOTAL  ${receipt.progression.seasonPoints.toLocaleString()}  •  TIER ${receipt.progression.rewardTrackTier}`
      : `PROGRESSION NOT APPLIED  •  ${receipt.progression?.reason ?? 'SERVER DECISION'}`;
    const reward = receipt.reward
      ? receipt.reward.granted
        ? `SERVER REWARD  ◆ ${receipt.reward.amount}  •  WALLET ${receipt.reward.balance}`
        : receipt.reward.alreadyClaimed
          ? 'EVENT REWARD ALREADY CLAIMED — NO DUPLICATE GRANT'
          : `NO EVENT REWARD  •  ${receipt.reward.reason ?? 'WIN REQUIRED'}`
      : 'ENDLESS PROGRESSION ONLY — NO CLIENT-MINTED WALLET CHANGE';
    const authority = this.add.text(VIEW.width / 2, 620,
      `${progression}\n\n${reward}\n\nCHECKSUM  ${result.stateChecksum.toUpperCase()}`,
      { fontFamily: UI_FONT, fontSize: TYPE.body, color: '#d3def0', fontStyle: 'bold', align: 'center', lineSpacing: 9, wordWrap: { width: 560 } },
    ).setOrigin(0.5).setDepth(52);
    const replayed = this.add.text(VIEW.width / 2, 805,
      receipt.replayed ? 'IDEMPOTENT RECEIPT REPLAYED — NOTHING WAS GRANTED TWICE' : 'NEW SERVER RECEIPT SAVED',
      { fontFamily: UI_FONT, fontSize: TYPE.caption, color: '#9ce8db', fontStyle: 'bold' },
    ).setOrigin(0.5).setDepth(52);
    const again = addArtButton(this, VIEW.width / 2, 900, 'PLAY NEW RUN', () => this.scene.restart({ event: this.preferEvent }), 380, 70, 53);
    const exit = addArtButton(this, VIEW.width / 2, 992, 'RETURN', () => this.leaveScene(), 380, 70, 53);
    overlay.add([dim, panel, title, stats, authority, replayed, again, exit]);
    void syncClassicProgressV4().catch(() => undefined);
    sharpenSceneText(this);
  }

  private async startHandTracking(showError: boolean): Promise<void> {
    if (this.handStarting) return;
    if (this.visionMode !== 'hand') {
      const gazeSettings = getGazeSettings();
      const handSettings = getHandSettings();
      const identity = currentGazeCalibrationIdentity(handSettings.deviceId, handSettings.mirror);
      if (!gazeCalibrationMatches(gazeSettings.calibration, identity)) {
        this.handStatus?.setText(`${this.visionLabel()} NEEDS CALIBRATION`).setColor('#ff8fa2');
        if (showError) this.toast('OPEN CAMERA CONTROLS AND COMPLETE ALL 9 EYE POINTS');
        return;
      }
    }
    this.handStarting = true;
    this.handStatus?.setText(`${this.visionLabel()} STARTING`).setColor('#ffe083');
    const tracker = getHandTracker();
    const ok = await tracker.enable(this.visionMode);
    this.handStarting = false;
    if (!this.sys.isActive()) {
      tracker.suspend();
      return;
    }
    if (ok && this.visionMode !== 'hand') {
      const resolvedCameraId = tracker.getActiveCameraDeviceId();
      const gazeSettings = getGazeSettings();
      const handSettings = getHandSettings();
      const activeIdentity = currentGazeCalibrationIdentity(resolvedCameraId, handSettings.mirror);
      if (!resolvedCameraId || !gazeCalibrationMatches(gazeSettings.calibration, activeIdentity)) {
        tracker.disable();
        this.handOn = false;
        this.handStatus?.setText(`${this.visionLabel()} NEEDS RECALIBRATION`).setColor('#ff8fa2');
        if (showError) this.toast('ACTIVE CAMERA CHANGED  •  RECALIBRATE IN CAMERA CONTROLS');
        return;
      }
    }
    this.handOn = ok;
    this.handHasSeen = false;
    this.handLastSeenAt = 0;
    if (ok) tracker.setPreviewVisible(false);
    this.handStatus?.setText(ok ? `${this.visionLabel()} SEARCHING` : `${this.visionLabel()} ERROR`)
      .setColor(ok ? '#ffe083' : '#ff8fa2');
    if (showError && !ok) this.toast(failureMessage(tracker.getLastFailure()));
  }

  private async toggleHand(): Promise<void> {
    if (this.handStarting) return;
    const tracker = getHandTracker();
    if (this.handOn) {
      tracker.disable();
      this.handOn = false;
      this.handHasSeen = false;
      this.handLockedLane = null;
      this.handOpenLane = null;
      this.pinchControl.reset();
      this.handAimPredictor.reset();
      this.handContinuity.reset();
      this.gazeAimController.reset();
      this.gazeBlinkControl.reset();
      this.gazeDwellControl.reset();
      this.gazeHasSeen = false;
      this.gazeCursorTarget = null;
      this.gazeCursorSmooth = null;
      this.gazeStableLane = null;
      this.gazeBlinkLane = null;
      this.handCursor?.setVisible(false);
      this.handStatus?.setText(`${this.visionLabel()} OFF`).setColor('#8595aa');
      return;
    }
    await this.startHandTracking(true);
  }

  private visionLabel(): string {
    if (this.visionMode === 'gaze') return 'EYES';
    if (this.visionMode === 'gaze-hand') return 'EYES + PINCH';
    return 'HAND';
  }

  private pollHand(): void {
    if (!this.handOn || !this.grid) return;
    const now = performance.now();
    const sample = getHandTracker().sample();
    if (!sample) {
      if (!this.handHasSeen) {
        this.handStatus?.setText('HAND SEARCHING').setColor('#ffe083');
        return;
      }
      const lostFor = now - this.handLastSeenAt;
      if (this.pinchControl.cancelForLoss(now, this.handLastSeenAt) === 'cancelled') {
        this.handLockedLane = null;
        this.handStatus?.setText('HAND LOST').setColor('#ffb075');
      }
      if (lostFor > 450) {
        this.handAimPredictor.reset();
        this.handCursor?.setVisible(false);
      }
      if (lostFor > 1_200) {
        this.handLockedLane = null;
        this.handOpenLane = null;
        this.pinchControl.reset();
        this.handAimPredictor.reset();
        this.handContinuity.reset();
        this.handCursor?.setVisible(false);
      }
      return;
    }
    this.handHasSeen = true;
    this.handLastSeenAt = now;
    const visuallyOpen = sample.rawPinch >= this.handReleaseThreshold;
    if (visuallyOpen) {
      this.handAimPredictor.push({ x: sample.x, y: sample.y }, sample.timestampMs, now);
    }
    const point = mapHandToAim({ x: sample.x, y: sample.y }, VIEW.width, BOARD_TOP, LAUNCHER_Y);
    const lane = endlessLaneForBoardX(this.grid, point.x);
    if (visuallyOpen && this.handLockedLane === null && !this.flying) {
      this.selectedLane = lane;
      this.drawAim();
    }
    if (visuallyOpen && this.handLockedLane === null) {
      this.handCursor?.setVisible(true).setPosition(point.x, point.y);
    }
    if (this.flying) {
      this.pinchControl.resetForShot();
      this.handContinuity.reset();
      this.handLockedLane = null;
      return;
    }
    const continuity = this.handContinuity.observe(
      sample.gestureStable && sample.usableForGesture,
      sample.timestampMs,
    );
    if (continuity !== 'usable') {
      if (continuity === 'cancel') {
        this.pinchControl.resetForContinuity();
        this.handLockedLane = null;
      } else {
        this.pinchControl.holdForUncertainty(sample.timestampMs);
      }
      this.handStatus?.setText(sample.gestureStable ? 'HAND UNCERTAIN — HOLD STILL' : 'HAND STABILIZING')
        .setColor('#ffe083');
      return;
    }
    if (!this.pinchControl.isEngaged() && visuallyOpen) {
      this.handOpenLane = { lane, timestampMs: sample.timestampMs };
    }
    const event = this.pinchControl.update(sample);
    if (event === 'latched') {
      // Lock the lane from this measured contact frame. Prediction remains a
      // render-only cursor aid and cannot alter the verified replay input.
      const lockedLane = this.handOpenLane
        && sample.timestampMs - this.handOpenLane.timestampMs <= 260
        ? this.handOpenLane.lane
        : lane;
      this.handLockedLane = lockedLane;
      this.selectedLane = lockedLane;
      this.drawAim();
    } else if (event === 'aim-locked') {
      // Double-tap mode can report this phase, but gameplay's first-release
      // mode already owns an immutable measured lane from `latched`.
    } else if (event === 'cancelled') this.handLockedLane = null;
    else if (event === 'released') {
      const lockedLane = this.handLockedLane;
      const predictedRelease = this.handAimPredictor.predict(now);
      if (predictedRelease && lockedLane === null) {
        const releasePoint = mapHandToAim(
          predictedRelease,
          VIEW.width,
          BOARD_TOP,
          LAUNCHER_Y,
        );
        // Legacy authority path intentionally retired:
        // this.selectedLane = endlessLaneForBoardX(this.grid, releasePoint.x);
        this.handCursor?.setPosition(releasePoint.x, releasePoint.y);
      }
      this.handLockedLane = null;
      if (lockedLane === null) {
        this.pinchControl.resetForContinuity();
        return;
      }
      this.selectedLane = lockedLane;
      this.drawAim();
      this.fireSelectedLane('hand');
    }
    const phase = this.pinchControl.getPhase();
    this.handStatus?.setText(phase === 'ready' ? 'HAND READY' : this.pinchControl.isContacting() ? 'PINCHED — RELEASE TO FIRE' : 'HAND TRACKING')
      .setColor('#76f0c7');
  }

  private pollGaze(): void {
    if (!this.handOn || !this.grid) return;
    const now = performance.now();
    const observation = getHandTracker().sampleGaze();
    if (!observation) {
      if (!this.gazeHasSeen) {
        this.handStatus?.setText('SEARCHING FOR FACE').setColor('#ffe083');
        return;
      }
      const lostFor = now - this.gazeLastSeenAt;
      if (lostFor > 260) {
        this.gazeBlinkControl.reset();
        this.gazeDwellControl.update({
          targetId: null,
          timestampMs: now,
          usableForAction: false,
          stableForAction: false,
        });
        this.handLockedLane = null;
        this.gazeStableLane = null;
        this.gazeBlinkLane = null;
      }
      if (lostFor > 450) {
        this.gazeCursorTarget = null;
        this.gazeCursorSmooth = null;
        this.handCursor?.setVisible(false);
      }
      if (lostFor > 1_200) {
        this.gazeAimController.reset();
        this.gazeHasSeen = false;
        this.handStatus?.setText('FACE LOST — NO SHOT').setColor('#ffb075');
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
      this.gazeAimController.reset();
      this.gazeBlinkControl.reset();
      this.gazeDwellControl.reset();
      this.gazeStableLane = null;
      this.gazeBlinkLane = null;
      this.handLockedLane = null;
      this.handCursor?.setVisible(false);
      this.handStatus?.setText('EYES NEED RECALIBRATION').setColor('#ff8fa2');
      return;
    }
    const aim = profile
      ? this.gazeAimController.update(observation, profile, now, {
        sensitivity: settings.sensitivity,
        responsiveness: settings.responsiveness,
      })
      : null;
    if (!aim) {
      this.gazeBlinkControl.reset();
      this.gazeDwellControl.update({
        targetId: null,
        timestampMs: observation.timestampMs,
        usableForAction: false,
        stableForAction: false,
      });
      this.gazeStableLane = null;
      this.gazeBlinkLane = null;
      this.handCursor?.setVisible(false);
      this.handStatus?.setText('EYE INPUT UNCERTAIN').setColor('#ffe083');
      return;
    }

    const point = {
      x: Phaser.Math.Clamp(aim.x * VIEW.width, 0, VIEW.width),
      y: Phaser.Math.Clamp(aim.y * VIEW.height, BOARD_TOP - 45, LAUNCHER_Y),
    };
    const insidePlayfield = aim.y * VIEW.height >= BOARD_TOP - 45
      && aim.y * VIEW.height <= LAUNCHER_Y;
    const lane = this.gazeLaneAtX(point.x);
    this.gazeHasSeen = true;
    this.gazeLastSeenAt = now;
    this.gazeCursorTarget = point;
    if (!this.gazeCursorSmooth) this.gazeCursorSmooth = { ...point };
    if (!this.flying && this.handLockedLane === null) {
      this.selectedLane = lane;
      this.drawAim();
    }
    const stableTarget = aim.usableForAction
      && aim.stableForAction
      && now - observation.timestampMs <= 180;
    const bothEyesOpen = observation.leftBlink <= 0.32 && observation.rightBlink <= 0.32;
    if (!insidePlayfield) {
      this.gazeBlinkControl.reset();
      this.gazeDwellControl.update({
        targetId: null,
        timestampMs: observation.timestampMs,
        usableForAction: stableTarget && bothEyesOpen,
        stableForAction: aim.stableForAction,
      });
      this.gazeStableLane = null;
      this.gazeBlinkLane = null;
      this.handStatus?.setText('LOOK INSIDE THE HEX FIELD').setColor('#ffe083');
      return;
    }
    if (stableTarget && bothEyesOpen) {
      this.gazeStableLane = { lane, timestampMs: observation.timestampMs };
    }
    if (this.visionMode === 'gaze-hand') {
      this.gazeBlinkLane = null;
      const locked = this.gazeStableLane && now - this.gazeStableLane.timestampMs <= 260;
      this.handStatus?.setText(locked ? 'GAZE LOCKED  •  PINCH' : 'HOLD GAZE STEADY')
        .setColor(locked ? '#76f0c7' : '#ffe083');
      return;
    }

    let action = false;
    if (settings.activation === 'dwell') {
      const dwell = this.gazeDwellControl.update({
        timestampMs: observation.timestampMs,
        targetId: `lane-${lane}`,
        usableForAction: stableTarget && bothEyesOpen && !this.flying,
        stableForAction: aim.stableForAction,
      });
      action = dwell.action;
      this.handStatus?.setText(`EYE DWELL  ${Math.round(dwell.progress * 100)}%`).setColor('#76f0c7');
    } else {
      const blinkEvent = this.gazeBlinkControl.update({
        timestampMs: observation.timestampMs,
        leftBlink: observation.leftBlink,
        rightBlink: observation.rightBlink,
        usableForAction: aim.usableForAction && !this.flying,
        stableForAction: aim.stableForAction,
      });
      action = blinkEvent === 'action';
      if (blinkEvent !== 'action') {
        if (this.gazeBlinkControl.isSequenceEngaged()) {
          const stableLane = this.gazeStableLane
            && now - this.gazeStableLane.timestampMs <= 260
            ? this.gazeStableLane
            : null;
          if (!this.gazeBlinkLane && stableLane) this.gazeBlinkLane = { ...stableLane };
        } else {
          this.gazeBlinkLane = null;
        }
      }
      this.handStatus?.setText(aim.stableForAction ? 'DOUBLE BLINK TO FIRE' : 'HOLD GAZE STEADY')
        .setColor(aim.stableForAction ? '#76f0c7' : '#ffe083');
    }
    if (!action || this.flying) return;
    const selectedLane = settings.activation === 'double-blink'
      ? this.gazeBlinkLane
      : this.gazeStableLane;
    const authoritativeAgeMs = settings.activation === 'double-blink' ? 1_000 : 260;
    const authoritativeLane = selectedLane
      && now - selectedLane.timestampMs <= authoritativeAgeMs
      ? selectedLane.lane
      : null;
    if (authoritativeLane === null) {
      this.gazeBlinkLane = null;
      return;
    }
    this.handLockedLane = authoritativeLane;
    this.selectedLane = authoritativeLane;
    this.drawAim();
    this.fireSelectedLane('gaze');
    this.handLockedLane = null;
    this.gazeBlinkControl.reset();
    this.gazeBlinkLane = null;
  }

  private pollHybridHand(): void {
    if (!this.handOn || !this.grid) return;
    const now = performance.now();
    const sample = getHandTracker().sample();
    if (!sample) {
      if (this.pinchControl.cancelForLoss(now, this.handLastSeenAt) === 'cancelled') {
        this.handLockedLane = null;
      }
      return;
    }
    this.handHasSeen = true;
    this.handLastSeenAt = now;
    if (this.flying) {
      this.pinchControl.resetForShot();
      this.handContinuity.reset();
      this.handLockedLane = null;
      return;
    }
    const continuity = this.handContinuity.observe(
      sample.gestureStable && sample.usableForGesture,
      sample.timestampMs,
    );
    if (continuity !== 'usable') {
      if (continuity === 'cancel') {
        this.pinchControl.resetForContinuity();
        this.handLockedLane = null;
      } else {
        this.pinchControl.holdForUncertainty(sample.timestampMs);
      }
      return;
    }
    const event = this.pinchControl.update(sample);
    if (event === 'latched') {
      const stableLane = this.gazeStableLane
        && now - this.gazeStableLane.timestampMs <= 260
        ? this.gazeStableLane.lane
        : null;
      if (stableLane === null) {
        this.pinchControl.resetForContinuity();
        return;
      }
      this.handLockedLane = stableLane;
      this.handStatus?.setText('PINCHED  •  RELEASE TO FIRE').setColor('#76f0c7');
    } else if (event === 'cancelled') {
      this.handLockedLane = null;
      this.handStatus?.setText('GESTURE CANCELLED SAFELY').setColor('#ffb075');
    } else if (event === 'released') {
      const lane = this.handLockedLane;
      this.handLockedLane = null;
      if (lane === null) {
        this.pinchControl.resetForContinuity();
        return;
      }
      this.selectedLane = lane;
      this.drawAim();
      this.fireSelectedLane('gaze-hand');
    }
  }

  private advanceGazeAim(): void {
    if (!this.handOn || !this.gazeCursorTarget || !this.handCursor) return;
    if (!this.gazeCursorSmooth) this.gazeCursorSmooth = { ...this.gazeCursorTarget };
    this.gazeCursorSmooth.x = Phaser.Math.Linear(
      this.gazeCursorSmooth.x,
      this.gazeCursorTarget.x,
      0.46,
    );
    this.gazeCursorSmooth.y = Phaser.Math.Linear(
      this.gazeCursorSmooth.y,
      this.gazeCursorTarget.y,
      0.46,
    );
    this.handCursor.setVisible(getGazeSettings().showCursor).setPosition(
      this.gazeCursorSmooth.x,
      this.gazeCursorSmooth.y,
    );
  }

  /** Fill recognition gaps at render cadence without using prediction for gestures. */
  private advanceHandAim(): void {
    if (!this.handOn || !this.grid) return;
    const predicted = this.handAimPredictor.predict(performance.now());
    if (!predicted) return;
    const point = mapHandToAim(predicted, VIEW.width, BOARD_TOP, LAUNCHER_Y);
    if (this.handLockedLane === null && !this.flying) {
      const visualLane = endlessLaneForBoardX(this.grid, point.x);
      this.drawAim(visualLane);
      this.handCursor?.setVisible(true).setPosition(point.x, point.y);
    }
  }

  private failClosed(message: string): void {
    if (!this.running) return;
    this.running = false;
    this.pinchControl.reset();
    this.handAimPredictor.reset();
    this.handContinuity.reset();
    getHandTracker().suspend();
    this.stateText?.setText(message).setColor('#ff8fa2');
    this.toast('RUN CLOSED WITHOUT REWARD');
    addArtButton(this, VIEW.width / 2, 1_102, 'RESTART VERIFIED RUN', () => this.scene.restart({ event: this.preferEvent }), 380, 66, 40);
  }

  private clearTargetVisual(): void {
    if (this.targetSprite) this.tweens.killTweensOf(this.targetSprite);
    if (this.targetHalo) this.tweens.killTweensOf(this.targetHalo);
    this.targetSprite?.destroy();
    this.targetHalo?.destroy();
    this.targetSprite = undefined;
    this.targetHalo = undefined;
  }

  private leaveScene(): void {
    this.running = false;
    this.pinchControl.reset();
    getHandTracker().suspend();
    this.scene.start(this.preferEvent ? 'Challenges' : 'ModeSelect');
  }

  private toast(message: string): void {
    const toast = this.add.text(VIEW.width / 2, 1_112, message, {
      fontFamily: UI_FONT, fontSize: TYPE.control, color: '#fff5d5', fontStyle: 'bold', align: 'center',
      backgroundColor: 'rgba(4,8,20,0.94)', padding: { x: 16, y: 10 }, wordWrap: { width: 610 },
    }).setOrigin(0.5).setDepth(70);
    fitText(toast, 620);
    this.tweens.add({ targets: toast, alpha: 0, delay: 2_600, duration: 400, onComplete: () => toast.destroy() });
  }
}

import Phaser from 'phaser';
import {
  COLORS,
  COLOR_KEYS,
  getOrbSkin,
  orbTexture,
  ATLAS_KEY,
  GRID,
  LEVELS,
  campaignStageNumber,
  nextStoryLevel,
  VIEW,
  worldForLevel,
  type ColorKey,
  type OrbSkinId,
} from '../config';
import {
  cellPos,
  clampedUpwardAimVector,
  colsInRow,
  computeGeom,
  nearestFreeHexCell,
  type HexGeom,
} from '../game/grid';
import { clusterOf, floaters, type Cell } from '../game/matcher';
import { SFX } from '../game/sfx';
import { PHASER_RELEASE_FEATURES } from '../game/release-profile';
import {
  getHandTracker,
  type HandTrackingFailure,
  type VisionTrackingMode,
} from '../game/handtracking';
import { getHandSettings } from '../game/handsettings';
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
import {
  HandAimPredictor,
  HandGestureContinuityGate,
  mapHandToAim,
  PinchDoubleTapControl,
} from '../game/handcontrol';
import { submitScore } from '../game/leaderboard';
import {
  addObjectiveProgress,
  advanceEmberCountdown,
  applyBossDamage,
  canSpecialRemoveMechanic,
  calculateBossDamage,
  coolEmber,
  createMechanicRunState,
  damageCrystalArmor,
  decidePortalTeleport,
  getObjectiveProgress,
  isObjectiveComplete,
  isRunFailed,
  pairPortalIds,
  protectsDetachedBubble,
  recordShot,
  rotateRowAssignments,
  RunTerminalLatch,
  selectVineSpreadTarget,
  setRunBoss,
  tickPortalCooldowns,
  type BossDamageEvent,
  type MechanicKind,
  type MechanicRunState,
  type PortalCooldown,
  type PortalPair,
} from '../game/mechanics';
import { campaignLevelScore, getProgress, recordLevelClear } from '../game/progression';
import { queueArtBundle } from '../game/art-v14';
import { resolveWorldPresentation } from '../game/world-presentation';
import {
  addCoins,
  addMysteryKeys,
  getArtifact,
  getMeta,
  getQualityProfile,
  MODE_DEFS,
  recordRunStats,
  type ArtifactDef,
  type GameMode,
  type QualityProfile,
} from '../game/meta';
import {
  addAmbientMotes,
  addArtButton,
  addArtPanel,
  addWorldBackground,
  applyLiveSceneQuality,
  fitText,
  prefersReducedMotion,
  sharpenSceneText,
  TYPE,
  UI_COLORS,
  UI_FONT,
} from '../gfx/ui';
import { accessibilityRuntimeForCanvas } from '../gfx/accessibility';
import {
  createRunSummary,
  normalizeGhostTrace,
  recordRunSummary,
  seededRandom,
  type ChallengeDef,
  type GhostShot,
} from '../game/retention';
import {
  flushGameplayTelemetry,
  trackGameplayEvent,
  type GameplayInputMode,
  type GameplayTelemetryReason,
} from '../game/gameplay-telemetry';
import { consumeInventoryItem, getInventory, grantInventoryItem } from '../game/inventory';
import {
  ArenaConnection,
  beginClassicRunAuthorityV3,
  consumeInventoryV2,
  createClassicRunSubmissionV3,
  getPlatformAccount,
  hasPlatformAccountBinding,
  recordClassicAuthorityShotV3,
  settleClassicRunV3,
  usesAuthoritativePlatformEconomy,
  type ClassicAuthorityTargetV3,
  type ClassicAuthorityTicketV3,
  type ArenaMessage,
} from '../game/platform';
import { scheduleOnlineSync } from '../game/online';
import { startMusic } from '../game/music';
import { storyBeatForLevel } from '../game/story';
import { ARENA_REPLAY_RULES } from '../../shared/runtime/arena-replay.mjs';
import {
  advanceShotQueue,
  buildCampaignOpening,
  campaignMechanicSeed,
  createCampaignShotQueue,
  createShotQueue,
  preloadShotQueue,
  reconcileShotQueue,
  swapShotQueue,
  type ShotQueueState,
} from '../game/campaign-generation';
import {
  LEVEL_ZERO_TUTORIAL_FIXTURE,
  LevelZeroTutorialMachine,
  TutorialProgressStore,
  decideLevelZeroTutorialLaunch,
  type TutorialSignal,
  type TutorialStepId,
} from '../game/tutorial';

type PowerUp = 'bomb' | 'rainbow';

interface BubbleMechanic {
  kind: 'crystal' | 'vine' | 'ember' | 'ice' | 'polarity';
  armor?: number;
  countdown?: number;
}

interface Bub {
  id: number;
  row: number;
  col: number;
  color: ColorKey;
  sprite: Phaser.GameObjects.Sprite;
  active: boolean;
  mechanic?: BubbleMechanic;
  mechanicOverlay?: Phaser.GameObjects.Image;
}

interface PortalEndpoint {
  id: string;
  sprite: Phaser.GameObjects.Image;
}

interface ArenaRunData {
  matchId: string;
  seed: number;
  startsAt: number;
  serverTime: number;
  clientReceivedAt: number;
  userId: string;
}

interface GameSceneData {
  level?: number;
  score?: number;
  mode?: GameMode;
  challenge?: ChallengeDef;
  ghost?: GhostShot[];
  arena?: Partial<ArenaRunData>;
  tutorialReplay?: boolean;
}

const ARENA_RESULT_WAIT_MS = 15_000;
const GHOST_REPLAY_MAX_DELAY_MS = 30_000;
const ARENA_ID_PATTERN = /^(?:match|usr)_[A-Za-z0-9_-]{8,120}$/;
// The 720-wide authored canvas scales to 0.44375 at the 320x568 baseline.
// Keeping command targets at 100 design pixels preserves a 44 CSS pixel floor.
const MIN_MOBILE_COMMAND_TARGET = 100;
const telemetryReasonForTerminalMessage = (message: string): GameplayTelemetryReason => {
  if (message === 'TIME EXPIRED') return 'timer';
  if (message === 'OUT OF SHOTS' || message === 'PRECISION BROKEN') return 'shot-limit';
  if (message === 'GRID OVERRUN') return 'danger-line';
  return message === 'YOU WON!' ? 'completed' : 'unknown';
};

export class GameScene extends Phaser.Scene {
  private geom!: HexGeom;
  private bubbles: Bub[] = [];
  private idc = 0;
  private offsetY = 0;

  private shooter = { x: 0, y: 0 };
  private loaded!: ColorKey;
  private loadedSprite!: Phaser.GameObjects.Sprite;
  private shotQueue?: ShotQueueState;
  private nextOrbSprite?: Phaser.GameObjects.Sprite;
  private queueActionText?: Phaser.GameObjects.Text;
  private replayQueueIndex = 0;
  private tutorialMachine?: LevelZeroTutorialMachine;
  private tutorialReplayRequested = false;
  private tutorialPanel?: Phaser.GameObjects.Container;
  private tutorialTitleText?: Phaser.GameObjects.Text;
  private tutorialInstructionText?: Phaser.GameObjects.Text;
  private tutorialProgressText?: Phaser.GameObjects.Text;
  private tutorialActionText?: Phaser.GameObjects.Text;
  private tutorialTargetRing?: Phaser.GameObjects.Arc;
  private tutorialShotPending = false;
  private tutorialInputMode: GameplayInputMode = 'unknown';
  private aimGfx!: Phaser.GameObjects.Graphics;
  private launcher!: Phaser.GameObjects.Image;
  private launcherFocus!: Phaser.GameObjects.Container;
  private launcherPivotY = 0;

  private flying = false;
  private vel = { x: 0, y: 0 };
  private ballSprite?: Phaser.GameObjects.Sprite;

  private score = 0;
  private combo = 0;
  private scoreText!: Phaser.GameObjects.Text;
  private levelText!: Phaser.GameObjects.Text;
  private comboText!: Phaser.GameObjects.Text;
  private handStatusText!: Phaser.GameObjects.Text;
  private running = false;
  private loseLineY = 0;

  private level = 0;
  private palette: ColorKey[] = COLOR_KEYS;

  private handOn = false;
  private handStarting = false;
  private visionMode: VisionTrackingMode = 'hand';
  private handHasSeen = false;
  private handLastSeenAt = 0;
  private handReleaseThreshold = 0.5;
  private handSmooth: { x: number; y: number } | null = null;
  private handTarget: { x: number; y: number } | null = null;
  private handLockedAim: { x: number; y: number } | null = null;
  private handOpenAim: { x: number; y: number; timestampMs: number } | null = null;
  private pinchControl = new PinchDoubleTapControl(undefined, undefined, { fireOnFirstRelease: true });
  private readonly handAimPredictor = new HandAimPredictor();
  private readonly handContinuity = new HandGestureContinuityGate();
  private readonly gazeAimController = new GazeAimController();
  private readonly gazeBlinkControl = new DoubleBlinkControl();
  private gazeDwellControl = new GazeDwellControl();
  private gazeHasSeen = false;
  private gazeLastSeenAt = 0;
  private gazeStableAim: { x: number; y: number; timestampMs: number } | null = null;
  private gazeBlinkAim: { x: number; y: number; timestampMs: number } | null = null;
  private handPinching = false;
  private handCursor?: Phaser.GameObjects.Arc;
  private handBtn?: Phaser.GameObjects.Text;
  private bombBtn?: Phaser.GameObjects.Image;
  private rainbowBtn?: Phaser.GameObjects.Image;
  private bombCountText?: Phaser.GameObjects.Text;
  private rainbowCountText?: Phaser.GameObjects.Text;
  private powerUps: Record<PowerUp, number> = { bomb: 1, rainbow: 1 };
  private powerUsePending = false;
  private lastAim = { x: VIEW.width / 2, y: VIEW.height * 0.35 };
  private scoreSubmitted = false;
  private suppressNextShot = false;
  private requireFreshPointerAfterContext = false;
  private levelStartScore = 0;
  private pauseOverlay?: Phaser.GameObjects.Container;
  private mode: GameMode = 'classic';
  private artifact!: ArtifactDef;
  private skinId: OrbSkinId = 'nova';
  private quality!: QualityProfile;
  private reducedMotion = false;
  private timerMs = 0;
  private elapsedMs = 0;
  private timerFrozenUntil = 0;
  private timerText!: Phaser.GameObjects.Text;
  private hitText!: Phaser.GameObjects.Text;
  private runCoinText!: Phaser.GameObjects.Text;
  private shots = 0;
  private hits = 0;
  private misses = 0;
  private specialHits = 0;
  private streak = 0;
  private maxStreak = 0;
  private shotBounces = 0;
  private runCoins = 0;
  private superCharge = 0;
  private superBtn?: Phaser.GameObjects.Image;
  private superText?: Phaser.GameObjects.Text;
  private rewardClaimed = false;
  private serverRewardMessage = '';
  private serverRewardText?: Phaser.GameObjects.Text;
  private classicAuthority?: ClassicAuthorityTicketV3;
  private classicAuthorityStarting = false;
  private classicAuthorityFailed = false;
  private classicAuthorityShotPending = false;
  private classicAuthorityAck = '';
  private classicAuthorityTerminalChallenge = '';
  private classicAuthorityTarget?: ClassicAuthorityTargetV3;
  private classicAuthorityShotPipeline: Promise<void> = Promise.resolve();
  private classicAuthorityTrace: GhostShot[] = [];
  private classicAuthorityStartedAt = 0;
  private classicAuthorityHitsAtStart = 0;
  private runGeneration = 0;
  private mechanicState!: MechanicRunState;
  private objectiveText?: Phaser.GameObjects.Text;
  private objectiveProgressText?: Phaser.GameObjects.Text;
  private bossHpFill?: Phaser.GameObjects.Rectangle;
  private bossHpWidth = 0;
  private bossIcon?: Phaser.GameObjects.Image;
  private portalEndpoints: PortalEndpoint[] = [];
  private portalPairs: PortalPair<string>[] = [];
  private portalCooldowns: PortalCooldown<string>[] = [];
  private portalTeleportedThisShot = false;
  private challenge?: ChallengeDef;
  private rng: () => number = Math.random;
  private runRecorded = false;
  private runStartedAt = 0;
  private scoreMultiplier = 1;
  private shotTrace: GhostShot[] = [];
  private replayTrace?: GhostShot[];
  private arena?: ArenaRunData;
  private arenaConnection?: ArenaConnection;
  private arenaOpponentText?: Phaser.GameObjects.Text;
  private arenaCompletionPending = false;
  private arenaResultResolved = false;
  private arenaDrawResolved = false;
  private arenaWaitOverlay?: Phaser.GameObjects.Container;
  private arenaWaitStatus?: Phaser.GameObjects.Text;
  private arenaResultTimer?: Phaser.Time.TimerEvent;
  private arenaStartMonotonicMs = 0;
  private arenaLastSubmittedAtMs = 0;
  private arenaInputSeq = 0;
  private arenaVerifiedScore = 0;
  private readonly terminalLatch = new RunTerminalLatch();
  private readonly handleLiveQualityChange = (): void => {
    if (!this.scene.isActive()) return;
    this.quality = getQualityProfile();
    applyLiveSceneQuality(this, this.quality);
  };
  private readonly handleRenderContextBoundary = (event: Event): void => {
    if (!this.scene.isActive()) return;
    const phase = (event as CustomEvent<{ phase?: string }>).detail?.phase;
    this.pinchControl.resetForContinuity();
    this.handHasSeen = false;
    this.handLastSeenAt = 0;
    this.handSmooth = null;
    this.handTarget = null;
    this.handLockedAim = null;
    this.handOpenAim = null;
    this.handAimPredictor.reset();
    this.handContinuity.reset();
    this.gazeAimController.reset();
    this.gazeBlinkControl.reset();
    this.gazeDwellControl.reset();
    this.gazeHasSeen = false;
    this.gazeLastSeenAt = 0;
    this.gazeStableAim = null;
    this.gazeBlinkAim = null;
    this.handPinching = false;
    this.handCursor?.setVisible(false);
    this.aimGfx?.clear();
    if (phase === 'restored') this.requireFreshPointerAfterContext = true;
  };

  constructor() {
    super('Game');
  }

  init(data: GameSceneData = {}): void {
    this.runGeneration = (this.runGeneration + 1) >>> 0;
    const requestedLevel = Number(data.level);
    const requestedScore = Number(data.score);
    this.level = Number.isFinite(requestedLevel)
      ? Phaser.Math.Clamp(Math.trunc(requestedLevel), 0, LEVELS.length - 1)
      : 0;
    this.score = Number.isFinite(requestedScore)
      ? Phaser.Math.Clamp(Math.trunc(requestedScore), 0, 1_000_000_000)
      : 0;
    this.levelStartScore = this.score;
    this.mode = typeof data.mode === 'string' && Object.prototype.hasOwnProperty.call(MODE_DEFS, data.mode)
      ? data.mode
      : getMeta().mode;
    this.challenge = data.challenge;
    const rawArena = data.arena;
    const matchId = typeof rawArena?.matchId === 'string' ? rawArena.matchId.trim() : '';
    const userId = typeof rawArena?.userId === 'string' ? rawArena.userId.trim() : '';
    const seed = Number(rawArena?.seed);
    const startsAt = Number(rawArena?.startsAt);
    const serverTime = Number(rawArena?.serverTime);
    const clientReceivedAt = Number(rawArena?.clientReceivedAt);
    this.arena = ARENA_ID_PATTERN.test(matchId)
      && matchId.startsWith('match_')
      && ARENA_ID_PATTERN.test(userId)
      && userId.startsWith('usr_')
      && Number.isSafeInteger(seed)
      && seed >= 0
      && seed <= 0x7fffffff
      && Number.isSafeInteger(startsAt)
      && Number.isSafeInteger(serverTime)
      && Number.isSafeInteger(clientReceivedAt)
      && Math.abs(serverTime - clientReceivedAt) <= 5 * 60_000
      ? { matchId, userId, seed, startsAt, serverTime, clientReceivedAt }
      : undefined;
    const handSettings = getHandSettings();
    const gazeSettings = getGazeSettings();
    const savedVisionMode = gazeSettings.mode;
    this.visionMode = savedVisionMode === 'off' ? 'hand' : savedVisionMode;
    this.gazeDwellControl = new GazeDwellControl(gazeSettings.dwellMs);
    this.handReleaseThreshold = handSettings.pinchOff;
    this.pinchControl = new PinchDoubleTapControl(
      handSettings.pinchOn,
      handSettings.pinchOff,
      { fireOnFirstRelease: true },
    );
    this.handAimPredictor.reset();
    this.handContinuity.reset();
    this.gazeAimController.reset();
    this.gazeBlinkControl.reset();
    this.gazeDwellControl.reset();
    this.rng = this.challenge
      ? seededRandom(this.challenge.seed)
      : this.arena
        ? seededRandom(this.arena.seed)
        : seededRandom(campaignMechanicSeed({ level: this.level, mode: this.mode }));
    this.scoreMultiplier = this.challenge?.modifier === 'score_frenzy' ? 1.25 : 1;
    this.replayTrace = normalizeGhostTrace(data.ghost);
    this.shotQueue = undefined;
    this.replayQueueIndex = 0;
    this.tutorialMachine = undefined;
    this.tutorialReplayRequested = data.tutorialReplay === true;
    this.tutorialPanel = undefined;
    this.tutorialTitleText = undefined;
    this.tutorialInstructionText = undefined;
    this.tutorialProgressText = undefined;
    this.tutorialActionText = undefined;
    this.tutorialTargetRing = undefined;
    this.tutorialShotPending = false;
    this.tutorialInputMode = 'unknown';
  }

  preload(): void {
    const theme = worldForLevel(this.level);
    queueArtBundle(this, `realm-${theme.id}`);
  }

  create(): void {
    const { width, height } = VIEW;
    const meta = getMeta();
    this.artifact = getArtifact(meta.equippedArtifact);
    this.skinId = meta.equippedSkin;
    this.quality = getQualityProfile();
    window.addEventListener('paopao:quality-adapted', this.handleLiveQualityChange);
    window.addEventListener('paopao:render-context-boundary', this.handleRenderContextBoundary);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      window.removeEventListener('paopao:quality-adapted', this.handleLiveQualityChange);
      window.removeEventListener('paopao:render-context-boundary', this.handleRenderContextBoundary);
    });
    const modeDef = MODE_DEFS[this.mode];
    const reducedMotion = prefersReducedMotion();
    this.reducedMotion = reducedMotion;
    this.cameras.main.fadeIn(reducedMotion ? 0 : 220, 0, 0, 0);
    const theme = worldForLevel(this.level);
    const progress = getProgress();
    const presentation = resolveWorldPresentation({
      worldId: theme.id,
      worldIndex: LEVELS[this.level]?.world ?? 0,
      finalLevel: theme.levels[theme.levels.length - 1],
      clearedLevels: progress.cleared,
      mode: 'bubble-shooter',
      backgroundKey: theme.background,
    });
    addWorldBackground(this, theme.background, 0.25, presentation);
    addAmbientMotes(this, theme.accent, theme.id === 'ember' ? 18 : 12, 1);

    const def = LEVELS[Math.min(this.level, LEVELS.length - 1)];
    const displayStage = campaignStageNumber(this.level);
    const a11y = accessibilityRuntimeForCanvas(this.game.canvas).mountScene({
      id: `game-level-${this.level + 1}`,
      heading: `PaoPao Fusion stage ${displayStage}: ${def.title}`,
      description: `${def.objective}. Aim with pointer, touch, hand tracking, calibrated eyes, or keyboard. Release pointer, deliberately double blink, pinch-release, or press Space to launch.`,
      status: `${MODE_DEFS[this.mode].name} mode. Score ${this.score.toLocaleString()}.`,
      lifecycle: this.events,
    });
    startMusic(def.goal === 'boss' ? 'boss' : 'game');
    this.palette = COLOR_KEYS.slice(0, def.colors);
    this.configureTutorialSession();

    this.geom = computeGeom(width);
    // The unified HUD ends at y=118. Keep one quiet visual gap before the
    // first bubble row instead of reserving space for stacked card rows.
    this.geom.topPad = this.isTutorialActive() ? 288 : 154;
    this.shooter.x = width / 2;
    this.shooter.y = height - Math.max(110, height * 0.14);
    this.loseLineY = this.shooter.y - this.geom.radius * 2.6;

    this.bubbles = [];
    this.idc = 0;
    this.offsetY = 0;
    // Scene.restart() reuses this GameScene instance. Never allow projectile
    // state or the previous terminal latch to leak into the next attempt.
    this.flying = false;
    this.vel = { x: 0, y: 0 };
    this.ballSprite = undefined;
    this.lastAim = { x: VIEW.width / 2, y: VIEW.height * 0.35 };
    this.terminalLatch.reset();
    this.arenaCompletionPending = false;
    this.arenaResultResolved = false;
    this.arenaDrawResolved = false;
    this.arenaWaitOverlay = undefined;
    this.arenaWaitStatus = undefined;
    this.arenaResultTimer = undefined;
    this.arenaStartMonotonicMs = 0;
    this.arenaLastSubmittedAtMs = 0;
    this.arenaInputSeq = 0;
    this.arenaVerifiedScore = 0;
    this.combo = 0;
    const inventory = getInventory();
    this.powerUps = { bomb: inventory.balances.bomb, rainbow: inventory.balances.rainbow };
    this.powerUsePending = false;
    this.scoreSubmitted = false;
    this.handOn = false;
    this.handStarting = false;
    this.handHasSeen = false;
    this.handLastSeenAt = 0;
    this.gazeHasSeen = false;
    this.gazeLastSeenAt = 0;
    this.gazeStableAim = null;
    this.gazeBlinkAim = null;
    this.handSmooth = null;
    this.handTarget = null;
    this.handLockedAim = null;
    this.handOpenAim = null;
    this.pinchControl.reset();
    this.handPinching = false;
    this.suppressNextShot = false;
    this.requireFreshPointerAfterContext = false;
    this.pauseOverlay = undefined;
    this.timerMs = ((modeDef.timerSeconds ?? 0) + (this.artifact.id === 'chrono' && modeDef.timerSeconds != null ? 5 : 0)) * 1000;
    this.elapsedMs = 0;
    this.timerFrozenUntil = 0;
    this.shots = 0;
    this.hits = 0;
    this.misses = 0;
    this.specialHits = 0;
    this.streak = 0;
    this.maxStreak = 0;
    this.shotBounces = 0;
    this.runCoins = 0;
    this.superCharge = 0;
    this.superBtn = undefined;
    this.superText = undefined;
    this.rewardClaimed = false;
    this.serverRewardMessage = '';
    this.serverRewardText = undefined;
    this.classicAuthority = undefined;
    this.classicAuthorityStarting = false;
    this.classicAuthorityFailed = false;
    this.classicAuthorityShotPending = false;
    this.classicAuthorityAck = '';
    this.classicAuthorityTerminalChallenge = '';
    this.classicAuthorityTarget = undefined;
    this.classicAuthorityShotPipeline = Promise.resolve();
    this.classicAuthorityTrace = [];
    this.classicAuthorityStartedAt = 0;
    this.classicAuthorityHitsAtStart = 0;
    this.objectiveText = undefined;
    this.objectiveProgressText = undefined;
    this.bossHpFill = undefined;
    this.bossHpWidth = 0;
    this.bossIcon = undefined;
    this.portalEndpoints = [];
    this.portalPairs = [];
    this.portalCooldowns = [];
    this.portalTeleportedThisShot = false;
    this.runRecorded = false;
    this.runStartedAt = Date.now();
    this.shotTrace = [];
    trackGameplayEvent({
      type: 'level-start',
      level: this.level,
      mode: this.arena ? 'arena' : this.mode,
      inputMode: 'unknown',
      outcome: 'started',
    });
    if (this.challenge?.modifier === 'short_fuse' && modeDef.timerSeconds != null) this.timerMs = Math.floor(this.timerMs * 0.8);

    const runMechanic: MechanicKind = def.mechanic === 'none'
      ? theme.id === 'emerald'
        ? 'vine'
        : theme.id === 'celestial'
          ? 'portal'
          : theme.id === 'ember'
            ? 'ember'
            : theme.id === 'frost'
              ? 'ice'
              : theme.id === 'nexus'
                ? 'polarity'
                : 'crystal'
      : def.mechanic;
    const objectiveTarget = def.goal === 'clear'
      ? 1
      : def.goal === 'boss'
        ? def.boss?.hp ?? 1
        : Math.max(1, def.mechanicCount);
    this.mechanicState = createMechanicRunState({
      mechanic: runMechanic,
      objective: { kind: def.goal, target: objectiveTarget },
      shots: def.shotLimit ?? null,
      missLimit: this.mode === 'precision' ? (this.challenge?.modifier === 'precision_plus' ? 3 : 5) : null,
      bossHp: def.boss?.hp,
    });

    const campaignOpening = this.isTutorialActive()
      ? LEVEL_ZERO_TUTORIAL_FIXTURE.opening
      : !this.challenge && !this.arena && !this.replayTrace
        ? buildCampaignOpening({ level: this.level, mode: this.mode })
        : undefined;
    this.buildGrid(def.rows, campaignOpening?.grid);
    if (def.goal !== 'boss') this.seedLevelMechanics(def.mechanicCount);
    if (runMechanic === 'portal') this.createPortalPair();

    // lose line
    const ll = this.add.graphics().setDepth(2);
    ll.lineStyle(2, 0xff5a6e, 0.34);
    ll.lineBetween(0, this.loseLineY, width, this.loseLineY);
    const dangerLabel = this.add.text(width - 18, this.loseLineY - 24, 'DANGER ZONE', {
      fontFamily: UI_FONT, fontSize: TYPE.caption, color: '#ff8796', fontStyle: 'bold',
    }).setOrigin(1, 0.5).setAlpha(0.72).setDepth(3);
    if (!this.reducedMotion) {
      this.tweens.add({ targets: [ll, dangerLabel], alpha: 0.34, duration: 760, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    }

    this.aimGfx = this.add.graphics().setDepth(2);

    // The launcher art stays premium and readable, while the old expanding
    // radius circles are replaced by compact angular energy brackets.
    this.launcherPivotY = this.shooter.y + 111;
    this.launcher = this.add.image(this.shooter.x, this.launcherPivotY, 'crystal_launcher')
      .setOrigin(0.5, 0.74)
      .setDisplaySize(226, 226)
      .setDepth(4);
    const focusSeed = this.muzzlePosition();
    this.launcherFocus = this.add.container(focusSeed.x, focusSeed.y).setDepth(3);
    const focusGlow = this.add.ellipse(0, 7, 102, 42, theme.accent, 0.055)
      .setStrokeStyle(1, theme.accent, 0.18);
    const focusFrame = this.add.graphics();
    focusFrame.lineStyle(4, 0x9cf8ff, 0.8);
    focusFrame.beginPath();
    focusFrame.moveTo(-46, -8); focusFrame.lineTo(-46, -25); focusFrame.lineTo(-28, -39);
    focusFrame.moveTo(46, -8); focusFrame.lineTo(46, -25); focusFrame.lineTo(28, -39);
    focusFrame.moveTo(-46, 8); focusFrame.lineTo(-46, 25); focusFrame.lineTo(-28, 39);
    focusFrame.moveTo(46, 8); focusFrame.lineTo(46, 25); focusFrame.lineTo(28, 39);
    focusFrame.strokePath();
    focusFrame.lineStyle(2, 0xffdd87, 0.62);
    focusFrame.beginPath();
    focusFrame.moveTo(-18, -45); focusFrame.lineTo(0, -52); focusFrame.lineTo(18, -45);
    focusFrame.moveTo(-18, 45); focusFrame.lineTo(0, 52); focusFrame.lineTo(18, 45);
    focusFrame.strokePath();
    focusFrame.setAlpha(0.5);
    this.launcherFocus.add([focusGlow, focusFrame]);
    this.initializeShotQueue();
    this.loaded = this.currentQueueColor();
    const muzzle = this.muzzlePosition();
    this.loadedSprite = this.makeSprite(this.loaded, muzzle.x, muzzle.y).setDepth(5);
    this.pulse(this.loadedSprite);

    // One command bar replaces the previous stack of six competing cards.
    const hudBar = this.addHudPlate(width / 2, 42, width - 24, 72, theme.accent, 19);
    const dividers = this.add.graphics();
    dividers.lineStyle(1, theme.accent, 0.28);
    for (const x of [-290, -94, 48, 160, 224, 288]) dividers.lineBetween(x, -25, x, 25);
    hudBar.add(dividers);

    this.addHudIconControl(hudBar, -318, 'back', 'MAP', () => {
      SFX.click();
      this.running = false;
      getHandTracker().suspend();
      this.scene.start('WorldMap', { world: LEVELS[this.level].world });
    }, theme.accent);
    this.addHudIconControl(hudBar, 246, 'pause', 'PAUSE', () => this.showPauseCard(), theme.accent);
    this.addHudIconControl(hudBar, 320, 'sound', SFX.isMuted() ? 'OFF' : 'SFX', (label) => {
      const muted = SFX.toggleMute();
      label.setText(muted ? 'OFF' : 'SFX');
      SFX.click();
    }, theme.accent);

    this.scoreText = this.add.text(-276, -23, this.visibleScore().toLocaleString(), {
      fontFamily: UI_FONT, fontSize: '24px', color: '#ffffff', fontStyle: 'bold', stroke: '#07101f', strokeThickness: 3,
    }).setOrigin(0, 0);
    this.hitText = this.add.text(-276, 13, 'HITS 0  •  0%', {
      fontFamily: UI_FONT, fontSize: TYPE.caption, color: '#aeefff', fontStyle: 'bold', letterSpacing: 1,
    }).setOrigin(0, 0);
    hudBar.add([this.scoreText, this.hitText]);

    this.timerText = this.add.text(-22, -15, this.formatClock(), {
      fontFamily: UI_FONT, fontSize: TYPE.control, color: MODE_DEFS[this.mode].accentCss, fontStyle: 'bold',
      stroke: '#08101d', strokeThickness: 3,
    }).setOrigin(0.5, 0);
    const timerMode = fitText(this.add.text(-22, 12, MODE_DEFS[this.mode].name, {
      fontFamily: UI_FONT, fontSize: TYPE.caption, color: '#d2deef', fontStyle: 'bold', letterSpacing: 1,
    }).setOrigin(0.5, 0), 126);
    hudBar.add([this.timerText, timerMode]);

    this.levelText = this.add.text(64, 0, `STAGE ${String(campaignStageNumber(this.level)).padStart(2, '0')}`, {
      fontFamily: UI_FONT, fontSize: TYPE.control, color: theme.accentCss, fontStyle: 'bold', stroke: '#07101f', strokeThickness: 3,
    }).setOrigin(0, 0.5);
    this.runCoinText = this.add.text(214, 0, '◆  0', {
      fontFamily: UI_FONT, fontSize: TYPE.caption, color: '#ffdc64', fontStyle: 'bold', stroke: '#101225', strokeThickness: 2,
    }).setOrigin(1, 0.5);
    hudBar.add([this.levelText, this.runCoinText]);

    this.comboText = this.add.text(width / 2, 101, '', {
      fontFamily: UI_FONT, fontSize: TYPE.label, color: '#ffe27a', fontStyle: 'bold',
      stroke: '#09101e', strokeThickness: 4,
      backgroundColor: 'rgba(41,20,82,0.92)', padding: { x: 12, y: 4 },
    }).setOrigin(0.5).setDepth(22).setAlpha(0);
    const modeRibbon = this.addSlimHudStrip(width / 2, 101, width - 48, 34, theme.accent, 18);
    if (this.mechanicState.boss) {
      const bossTexture: Record<MechanicKind, string> = {
        crystal: 'boss_prism', vine: 'boss_heartwood', portal: 'boss_astral', ember: 'boss_inferno',
        ice: 'boss_frost', polarity: 'boss_nexus',
      };
      this.bossIcon = this.add.image(-316, 0, bossTexture[this.mechanicState.mechanic]).setDisplaySize(28, 28);
      this.objectiveText = fitText(this.add.text(-296, 0, def.boss?.name ?? 'BOSS', {
        fontFamily: UI_FONT, fontSize: TYPE.caption, color: theme.accentCss, fontStyle: 'bold', letterSpacing: 1,
      }).setOrigin(0, 0.5), 180);
      const hpBack = this.add.rectangle(-104, 0, 230, 7, 0x020711, 0.95).setOrigin(0, 0.5)
        .setStrokeStyle(1, 0xffdf91, 0.45);
      this.bossHpWidth = 230;
      this.bossHpFill = this.add.rectangle(-104, 0, this.bossHpWidth, 5, theme.accent, 0.96).setOrigin(0, 0.5);
      this.objectiveProgressText = this.add.text(316, 0, '', {
        fontFamily: UI_FONT, fontSize: TYPE.caption, color: '#ffe7a6', fontStyle: 'bold', letterSpacing: 1,
      }).setOrigin(1, 0.5);
      modeRibbon.add([this.bossIcon, this.objectiveText, hpBack, this.bossHpFill, this.objectiveProgressText]);
    } else {
      this.objectiveText = fitText(this.add.text(-316, 0, def.objective.toUpperCase(), {
        fontFamily: UI_FONT, fontSize: TYPE.caption, color: theme.accentCss, fontStyle: 'bold', letterSpacing: 1,
      }).setOrigin(0, 0.5), 356);
      this.objectiveProgressText = this.add.text(316, 0, '', {
        fontFamily: UI_FONT, fontSize: TYPE.caption, color: '#d7e5f4', fontStyle: 'bold', letterSpacing: 1,
      }).setOrigin(1, 0.5);
      modeRibbon.add([this.objectiveText, this.objectiveProgressText]);
    }

    // Hand cursor is hidden until tracking is active.
    this.handCursor = this.add.circle(0, 0, 24, 0x000000, 0).setStrokeStyle(3, 0xffffff, 0.8).setDepth(6).setVisible(false);

    const powerY = height - 50;
    const bombX = 50;
    const rainbowX = 150;
    const superX = 250;
    this.addSlimHudStrip(150, powerY, 300, 76, theme.accent, 18);
    this.bombBtn = this.add.image(bombX, powerY - 2, 'power_bomb').setDisplaySize(46, 46).setDepth(20);
    this.rainbowBtn = this.add.image(rainbowX, powerY - 2, 'power_rainbow').setDisplaySize(46, 46).setDepth(20);
    this.superBtn = this.add.image(superX, powerY - 2, this.artifact.texture).setDisplaySize(46, 46).setDepth(20).setAlpha(0.52);
    this.bombCountText = this.add.text(68, powerY - 25, '×1', { fontFamily: UI_FONT, fontSize: TYPE.caption, color: '#ffd24b', fontStyle: 'bold' }).setOrigin(0.5).setDepth(21);
    this.rainbowCountText = this.add.text(168, powerY - 25, '×1', { fontFamily: UI_FONT, fontSize: TYPE.caption, color: '#d6bcff', fontStyle: 'bold' }).setOrigin(0.5).setDepth(21);
    this.superText = this.add.text(superX, powerY + 22, '0%', {
      fontFamily: UI_FONT, fontSize: TYPE.caption, color: this.artifact.accentCss, fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(21);
    const bombHit = this.add.zone(
      bombX,
      powerY,
      MIN_MOBILE_COMMAND_TARGET,
      MIN_MOBILE_COMMAND_TARGET,
    ).setDepth(22).setInteractive({ useHandCursor: true });
    const rainbowHit = this.add.zone(
      rainbowX,
      powerY,
      MIN_MOBILE_COMMAND_TARGET,
      MIN_MOBILE_COMMAND_TARGET,
    ).setDepth(22).setInteractive({ useHandCursor: true });
    const superHit = this.add.zone(
      superX,
      powerY,
      MIN_MOBILE_COMMAND_TARGET,
      MIN_MOBILE_COMMAND_TARGET,
    ).setDepth(22).setInteractive({ useHandCursor: true });
    bombHit.on('pointerdown', () => { this.suppressNextShot = true; void this.usePowerUp('bomb'); });
    rainbowHit.on('pointerdown', () => { this.suppressNextShot = true; void this.usePowerUp('rainbow'); });
    superHit.on('pointerdown', () => { this.suppressNextShot = true; this.useArtifactSuper(); });

    const queueCard = this.addSlimHudStrip(width - 170, powerY, 136, 76, theme.accent, 19);
    const nextLabel = this.add.text(-46, -15, 'NEXT', {
      fontFamily: UI_FONT, fontSize: TYPE.caption, color: '#aeefff', fontStyle: 'bold', letterSpacing: 1,
    }).setOrigin(0, 0.5);
    this.nextOrbSprite = this.makeSprite(this.nextQueueColor(), 25, -6)
      .setScale(this.scaleFor() * 0.54)
      .setDepth(20);
    this.queueActionText = fitText(this.add.text(-46, 17, '', {
      fontFamily: UI_FONT, fontSize: TYPE.caption, color: '#ffe08a', fontStyle: 'bold', letterSpacing: 1,
    }).setOrigin(0, 0.5), 78, 0.76);
    queueCard.add([nextLabel, this.nextOrbSprite, this.queueActionText]);
    queueCard.setSize(136, MIN_MOBILE_COMMAND_TARGET).setInteractive({ useHandCursor: true });
    queueCard.on('pointerdown', () => {
      this.suppressNextShot = true;
      this.handleQueueCardPressed();
    });
    this.updateQueueHud();

    const handCard = this.addSlimHudStrip(width - 50, powerY, 96, 76, theme.accent, 19);
    const trackerGlyph = this.add.graphics();
    trackerGlyph.lineStyle(2, 0x8ff6ff, 0.9);
    trackerGlyph.beginPath();
    trackerGlyph.moveTo(-15, -6); trackerGlyph.lineTo(-15, -17); trackerGlyph.lineTo(-5, -17);
    trackerGlyph.moveTo(5, -17); trackerGlyph.lineTo(15, -17); trackerGlyph.lineTo(15, -6);
    trackerGlyph.moveTo(-15, 5); trackerGlyph.lineTo(-15, 12); trackerGlyph.lineTo(-6, 12);
    trackerGlyph.moveTo(6, 12); trackerGlyph.lineTo(15, 12); trackerGlyph.lineTo(15, 5);
    trackerGlyph.strokePath();
    trackerGlyph.fillStyle(0x8ff6ff, 0.78).fillPoint(0, -2, 4);
    this.handBtn = fitText(this.add.text(0, 20, this.visionControlLabel(), {
      fontFamily: UI_FONT, fontSize: TYPE.caption, color: '#b9c5d6', fontStyle: 'bold', letterSpacing: 1,
    }).setOrigin(0.5), 48, 0.72);
    this.handStatusText = this.add.text(16, -18, '●', {
      fontFamily: UI_FONT, fontSize: TYPE.caption, color: '#6f8094', fontStyle: 'bold',
    }).setOrigin(0.5);
    handCard.add([trackerGlyph, this.handBtn, this.handStatusText]);
    handCard.setSize(MIN_MOBILE_COMMAND_TARGET, MIN_MOBILE_COMMAND_TARGET).setInteractive({ useHandCursor: true });
    handCard.on('pointerdown', () => {
      this.suppressNextShot = true;
      void this.toggleHand();
    });
    if (this.isTutorialActive()) this.createTutorialHud(theme.accent);

    // input: aim on move/down, fire on release (mouse + touch)
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      this.requireFreshPointerAfterContext = false;
      this.updateAimAt(p.worldX, p.worldY);
    });
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => this.updateAimAt(p.worldX, p.worldY));
    this.input.on('pointerup', (p: Phaser.Input.Pointer) => {
      if (this.requireFreshPointerAfterContext) return;
      if (this.suppressNextShot) {
        this.suppressNextShot = false;
        return;
      }
      this.shootAt(p.worldX, p.worldY);
    });

    const returnToMap = (): void => {
      SFX.click();
      this.running = false;
      getHandTracker().suspend();
      this.scene.start('WorldMap', { world: LEVELS[this.level].world });
    };
    const keyboardFire = (): void => this.shootAt(this.lastAim.x, this.lastAim.y);
    a11y.registerButton({
      id: 'game-aim-left',
      label: 'Aim launcher left',
      description: 'Moves the launcher three degrees left.',
      onActivate: () => this.nudgeKeyboardAim(-3),
    });
    a11y.registerButton({
      id: 'game-aim-right',
      label: 'Aim launcher right',
      description: 'Moves the launcher three degrees right.',
      onActivate: () => this.nudgeKeyboardAim(3),
    });
    a11y.registerButton({
      id: 'game-fire',
      label: 'Launch current Pao',
      description: 'Fires at the current launcher angle.',
      onActivate: keyboardFire,
    });
    a11y.registerButton({
      id: 'game-bomb',
      label: `Use bomb. ${this.powerUps.bomb} available`,
      onActivate: () => { void this.usePowerUp('bomb'); },
    });
    a11y.registerButton({
      id: 'game-rainbow',
      label: `Use rainbow. ${this.powerUps.rainbow} available`,
      onActivate: () => { void this.usePowerUp('rainbow'); },
    });
    a11y.registerButton({
      id: 'game-artifact',
      label: `Use ${this.artifact.name} power`,
      onActivate: () => this.useArtifactSuper(),
    });
    a11y.registerButton({
      id: 'game-hand-tracking',
      label: 'Toggle camera hand tracking',
      description: 'Camera frames stay on this device.',
      onActivate: () => { void this.toggleHand(); },
    });
    a11y.registerButton({
      id: 'game-pause',
      label: 'Pause adventure',
      onActivate: () => this.showPauseCard(),
    });
    a11y.registerButton({
      id: 'game-map',
      label: 'Return to adventure map',
      onActivate: returnToMap,
    });
    if (this.isTutorialActive()) {
      a11y.registerButton({
        id: 'game-tutorial-action',
        label: 'Advance current tutorial instruction',
        description: this.tutorialMachine?.snapshot().currentPrompt?.instruction,
        onActivate: () => this.handleTutorialPanelAction(),
      });
      a11y.registerButton({
        id: 'game-tutorial-skip',
        label: 'Skip tutorial',
        onActivate: () => this.skipTutorial(),
      });
    }
    const handleKeyboardControls = (event: KeyboardEvent): void => {
      const activeTag = document.activeElement?.tagName;
      if (activeTag === 'BUTTON' || activeTag === 'INPUT' || activeTag === 'TEXTAREA' || event.repeat) return;
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        this.nudgeKeyboardAim(-3);
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        this.nudgeKeyboardAim(3);
      } else if (event.key === ' ' || event.code === 'Space') {
        event.preventDefault();
        keyboardFire();
      } else if (event.key.toLowerCase() === 'h') {
        void this.toggleHand();
      } else if (event.key.toLowerCase() === 'b') {
        void this.usePowerUp('bomb');
      } else if (event.key.toLowerCase() === 'r') {
        void this.usePowerUp('rainbow');
      } else if (event.key.toLowerCase() === 'p' || event.key === 'Escape') {
        this.showPauseCard();
      }
    };
    this.input.keyboard?.on('keydown', handleKeyboardControls);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.input.keyboard?.off('keydown', handleKeyboardControls);
    });

    // resume hand-tracking if it was enabled on a previous level
    const tracker = getHandTracker();
    if (tracker.isWanted()) {
      void this.startHandTracking(false);
    } else {
      // This is idempotent with app-start warm-up and also covers a recoverable
      // background-load failure before the player presses HAND.
      void tracker.prepare().catch(() => undefined);
    }

    // release the camera when leaving this scene (preference is remembered)
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.pinchControl.reset();
      this.handLockedAim = null;
      getHandTracker().suspend();
    });
    const handleBackRequest = (): void => this.showPauseCard();
    this.events.on('paopao:back-request', handleBackRequest);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.events.off('paopao:back-request', handleBackRequest);
    });

    if (this.arena) {
      const estimatedServerNow = Date.now() + (this.arena.serverTime - this.arena.clientReceivedAt);
      this.arenaStartMonotonicMs = performance.now() - (estimatedServerNow - this.arena.startsAt);
      this.connectArena();
    }

    this.running = !this.arena || this.arenaElapsedMs() >= 0;
    if (this.running && usesAuthoritativePlatformEconomy()
      && !this.challenge && !this.arena && !this.replayTrace && !this.isTutorialActive()) {
      this.beginClassicAuthority();
    }
    if (this.arena && !this.running) {
      this.time.delayedCall(Math.max(0, -this.arenaElapsedMs()), () => {
        if (!this.scene.isActive()) return;
        this.running = true; this.runStartedAt = Date.now(); this.toast('LIVE ARENA  •  FUSION!');
      });
    }
    if (this.replayTrace?.length) this.startGhostReplay();
    this.updateStatsHud();
    this.updateObjectiveHud();
    this.addSuperCharge(0);
    if (def.mechanic !== 'none') {
      this.time.delayedCall(620, () => {
        if (this.running) this.toast(this.mechanicTutorial());
      });
    }
    sharpenSceneText(this);
  }

  /** Build a faceted crystal command plate without nesting dashboard cards. */
  private addHudPlate(
    x: number,
    y: number,
    width: number,
    height: number,
    accent: number,
    depth = 19,
  ): Phaser.GameObjects.Container {
    const plate = this.add.container(x, y).setDepth(depth);
    const surface = this.add.graphics();
    const halfW = width / 2;
    const halfH = height / 2;
    const cut = Math.min(22, Math.max(10, height * 0.3));
    const points = [
      { x: -halfW + cut, y: -halfH },
      { x: halfW - cut * 1.45, y: -halfH },
      { x: halfW, y: -halfH + cut },
      { x: halfW, y: halfH - cut * 0.62 },
      { x: halfW - cut * 0.8, y: halfH },
      { x: -halfW + cut * 1.65, y: halfH },
      { x: -halfW, y: halfH - cut },
      { x: -halfW, y: -halfH + cut * 0.58 },
    ];
    const shadow = points.map(({ x: px, y: py }) => ({ x: px + 2, y: py + 6 }));
    surface.fillStyle(0x14062d, 0.44);
    surface.fillPoints(shadow, true);
    surface.fillGradientStyle(0x4b3278, 0x35245f, UI_COLORS.surface, 0x160d35, 0.92, 0.92, 0.96, 0.96);
    surface.fillPoints(points, true);

    // Static colour planes make the HUD belong to the current realm without
    // putting a shine pass over its labels or controls.
    surface.fillStyle(accent, 0.1);
    surface.fillTriangle(-halfW, -halfH + cut * 0.58, -halfW + cut, -halfH, -halfW + width * 0.24, -halfH);
    surface.fillTriangle(halfW, -halfH + cut, halfW, halfH - cut * 0.62, halfW - width * 0.13, halfH);
    surface.fillStyle(UI_COLORS.gold, 0.055);
    surface.fillTriangle(halfW - cut * 1.45, -halfH, halfW, -halfH + cut, halfW - width * 0.18, 0);
    surface.lineStyle(1, UI_COLORS.quietBorder, 0.94);
    surface.strokePoints(points, true);
    surface.lineStyle(2, accent, 0.72);
    surface.lineBetween(-halfW + cut, -halfH + 1, -halfW + Math.min(154, width * 0.25), -halfH + 1);
    surface.lineStyle(1, UI_COLORS.gold, 0.54);
    surface.lineBetween(halfW - Math.min(118, width * 0.2), halfH - 1, halfW - cut * 0.8, halfH - 1);
    surface.lineStyle(1, accent, 0.3);
    surface.lineBetween(-halfW + cut * 0.7, halfH - 8, -halfW + width * 0.18, -halfH + 9);
    plate.add(surface);
    plate.setSize(width, height);
    if (!prefersReducedMotion()) {
      plate.setY(y + 5).setAlpha(0);
      this.tweens.add({ targets: plate, y, alpha: 1, duration: 190, ease: 'Cubic.easeOut' });
    }
    return plate;
  }

  /** One quiet cut-crystal rail for objectives and compact bottom controls. */
  private addSlimHudStrip(
    x: number,
    y: number,
    width: number,
    height: number,
    accent: number,
    depth = 18,
  ): Phaser.GameObjects.Container {
    const strip = this.add.container(x, y).setDepth(depth).setAlpha(this.reducedMotion ? 1 : 0);
    const surface = this.add.graphics();
    const halfW = width / 2;
    const halfH = height / 2;
    const cut = Math.min(14, Math.max(7, height * 0.22));
    const points = [
      { x: -halfW + cut, y: -halfH },
      { x: halfW - cut * 1.6, y: -halfH },
      { x: halfW, y: -halfH + cut },
      { x: halfW - cut * 0.45, y: halfH },
      { x: -halfW + cut * 1.25, y: halfH },
      { x: -halfW, y: halfH - cut },
      { x: -halfW, y: -halfH + cut * 0.72 },
    ];
    surface.fillStyle(0x14062d, 0.42);
    surface.fillPoints(points.map(({ x: px, y: py }) => ({ x: px + 1, y: py + 4 })), true);
    surface.fillGradientStyle(0x442d70, 0x302158, 0x211443, 0x160d35, 0.89, 0.89, 0.94, 0.94);
    surface.fillPoints(points, true);
    surface.fillStyle(accent, 0.105);
    surface.fillTriangle(-halfW, -halfH + cut * 0.72, -halfW + cut, -halfH, -halfW + width * 0.34, -halfH);
    surface.fillStyle(UI_COLORS.gold, 0.045);
    surface.fillTriangle(halfW - cut * 1.6, -halfH, halfW, -halfH + cut, halfW - width * 0.12, halfH);
    surface.lineStyle(1, accent, 0.66);
    surface.strokePoints(points, true);
    surface.lineStyle(1, UI_COLORS.gold, 0.55);
    surface.lineBetween(-Math.min(72, width * 0.18), -halfH + 1, Math.min(72, width * 0.18), -halfH + 1);
    strip.add(surface);
    strip.setSize(width, height);
    if (!this.reducedMotion) {
      this.tweens.add({ targets: strip, alpha: 1, duration: 220, ease: 'Quad.easeOut' });
    }
    return strip;
  }

  /** Glyph-only controls that share the main HUD shell instead of nesting cards. */
  private addHudIconControl(
    parent: Phaser.GameObjects.Container,
    x: number,
    kind: 'back' | 'pause' | 'sound',
    caption: string,
    onPress: (label: Phaser.GameObjects.Text) => void,
    accent: number,
  ): { button: Phaser.GameObjects.Container; label: Phaser.GameObjects.Text } {
    const button = this.add.container(x, 0);
    const hover = this.add.graphics();
    const hoverPoints = [
      { x: -25, y: -28 }, { x: 17, y: -28 }, { x: 29, y: -16 },
      { x: 25, y: 28 }, { x: -18, y: 28 }, { x: -29, y: 17 }, { x: -29, y: -18 },
    ];
    const drawHover = (alpha: number, borderAlpha: number): void => {
      hover.clear();
      hover.fillStyle(accent, alpha);
      hover.fillPoints(hoverPoints, true);
      hover.fillStyle(UI_COLORS.gold, alpha * 0.36);
      hover.fillTriangle(17, -28, 29, -16, 25, 9);
      hover.lineStyle(1, accent, borderAlpha);
      hover.strokePoints(hoverPoints, true);
    };
    drawHover(0.015, 0.16);
    const icon = this.add.graphics();
    icon.lineStyle(3, 0xe9fbff, 0.96);
    if (kind === 'back') {
      icon.lineBetween(4, -15, -6, -7);
      icon.lineBetween(-6, -7, 4, 1);
      icon.lineBetween(-5, -7, 8, -7);
    } else if (kind === 'pause') {
      icon.fillStyle(0xe9fbff, 0.96);
      icon.fillRoundedRect(-7, -16, 5, 18, 2);
      icon.fillRoundedRect(3, -16, 5, 18, 2);
    } else {
      icon.fillStyle(0xe9fbff, 0.96);
      icon.fillPoints([
        { x: -9, y: -11 }, { x: -3, y: -11 }, { x: 4, y: -17 },
        { x: 4, y: 3 }, { x: -3, y: -3 }, { x: -9, y: -3 },
      ], true);
      icon.lineStyle(2, 0xe9fbff, 0.78);
      icon.beginPath();
      icon.arc(4, -7, 8, -0.78, 0.78, false);
      icon.strokePath();
    }
    const label = fitText(this.add.text(0, 17, caption, {
      fontFamily: UI_FONT, fontSize: TYPE.caption, color: '#dce9f7', fontStyle: 'bold', letterSpacing: 1,
    }).setOrigin(0.5), 54);
    button.add([hover, icon, label]);
    button.setSize(100, 100).setInteractive({ useHandCursor: true });
    button.on('pointerover', () => drawHover(0.11, 0.46));
    button.on('pointerout', () => drawHover(0.015, 0.16));
    button.on('pointerdown', () => {
      this.suppressNextShot = true;
      this.tweens.add({ targets: button, scale: 0.92, duration: 55, yoyo: true, ease: 'Quad.easeOut' });
    });
    button.on('pointerup', () => onPress(label));
    parent.add(button);
    return { button, label };
  }

  /** Small icon-first command control for map, pause and audio actions. */
  private addHudControl(
    x: number,
    y: number,
    width: number,
    kind: 'back' | 'pause' | 'sound',
    caption: string,
    onPress: (label: Phaser.GameObjects.Text) => void,
    accent: number,
  ): { button: Phaser.GameObjects.Container; label: Phaser.GameObjects.Text } {
    const button = this.addHudPlate(x, y, width, 56, accent, 24);
    const icon = this.add.graphics();
    const iconX = -width / 2 + 22;
    icon.lineStyle(4, 0xe9fbff, 0.96);
    if (kind === 'back') {
      icon.lineBetween(iconX + 7, -9, iconX - 3, 0);
      icon.lineBetween(iconX - 3, 0, iconX + 7, 9);
      icon.lineBetween(iconX - 1, 0, iconX + 12, 0);
    } else if (kind === 'pause') {
      icon.fillStyle(0xe9fbff, 0.96);
      icon.fillRoundedRect(iconX - 7, -10, 6, 20, 2);
      icon.fillRoundedRect(iconX + 3, -10, 6, 20, 2);
    } else {
      icon.fillStyle(0xe9fbff, 0.96);
      icon.fillPoints([
        { x: iconX - 9, y: -4 }, { x: iconX - 3, y: -4 }, { x: iconX + 4, y: -10 },
        { x: iconX + 4, y: 10 }, { x: iconX - 3, y: 4 }, { x: iconX - 9, y: 4 },
      ], true);
      icon.lineStyle(2, 0xe9fbff, 0.8);
      icon.beginPath();
      icon.arc(iconX + 4, 0, 8, -0.78, 0.78, false);
      icon.strokePath();
    }
    const label = this.add.text(11, 0, caption, {
      fontFamily: UI_FONT,
      fontSize: TYPE.caption,
      color: '#eaf8ff',
      fontStyle: 'bold',
      stroke: '#06101e',
      strokeThickness: 3,
      letterSpacing: 1,
    }).setOrigin(0.5);
    fitText(label, width - 42, 0.78);
    button.add([icon, label]);
    button.setSize(Math.max(100, width), 100).setInteractive({ useHandCursor: true });
    button.on('pointerdown', () => {
      this.suppressNextShot = true;
      this.tweens.add({ targets: button, scale: 0.95, duration: 65, yoyo: true, ease: 'Quad.easeOut' });
    });
    button.on('pointerup', () => onPress(label));
    return { button, label };
  }

  private mechanicTutorial(): string {
    switch (this.mechanicState.mechanic) {
      case 'crystal':
        return 'CRYSTAL SHELLS  •  MATCH THEM TWICE TO BREAK THE ARMOUR';
      case 'vine':
        return 'LIVING VINES  •  YOUR FIRST MATCH UNBINDS THE TRAPPED ORB';
      case 'portal':
        return 'ASTRAL PORTALS  •  GUIDE A SHOT THROUGH A GATE, THEN COMPLETE A MATCH';
      case 'ember':
        return 'MAGMA CORES  •  MATCH THEM BEFORE THEIR SHOT COUNTDOWN REACHES ZERO';
      case 'ice':
        return 'ICE ARMOUR  •  CRACK IT WITH ONE MATCH, THEN CLEAR IT WITH THE NEXT';
      case 'polarity':
        return 'POLARITY NODES  •  DISCHARGE THEM BEFORE THE FIELD SHIFTS AGAIN';
    }
  }

  private configureTutorialSession(): void {
    if (this.level !== 0 || this.challenge || this.arena || this.replayTrace) return;
    const progress = getProgress();
    const isReturningPlayer = progress.unlocked > 1
      || progress.cleared.length > 0
      || progress.bestScores.some((score) => score > 0)
      || progress.stars.some((stars) => stars > 0);
    let storage: Storage | undefined;
    try {
      storage = window.localStorage;
    } catch {
      storage = undefined;
    }
    const progressStore = new TutorialProgressStore({ storage });
    const decision = decideLevelZeroTutorialLaunch(progressStore.read(), {
      isReturningPlayer,
      forceReplay: this.tutorialReplayRequested,
    });
    if (!decision.shouldStart || !decision.runMode) return;
    this.tutorialInputMode = getHandTracker().isWanted()
      ? getHandTracker().getActiveMode()
      : navigator.maxTouchPoints > 0
        ? 'touch'
        : 'mouse';
    this.tutorialMachine = new LevelZeroTutorialMachine({
      inputMode: this.tutorialInputMode,
      runMode: decision.runMode,
      progressStore,
    });
    const transition = this.tutorialMachine.start();
    const firstStep = transition.snapshot.currentStep;
    if (firstStep) {
      trackGameplayEvent({
        type: 'tutorial-step',
        level: 0,
        mode: 'tutorial',
        inputMode: this.tutorialInputMode,
        step: firstStep,
        outcome: 'started',
      });
    }
  }

  private isTutorialActive(): boolean {
    return this.tutorialMachine?.snapshot().status === 'active';
  }

  private createTutorialHud(accent: number): void {
    const panel = this.addHudPlate(VIEW.width / 2, 190, VIEW.width - 36, 132, accent, 24);
    this.tutorialPanel = panel;
    this.tutorialTitleText = fitText(this.add.text(-318, -46, '', {
      fontFamily: UI_FONT,
      fontSize: TYPE.label,
      color: '#ffe7a6',
      fontStyle: 'bold',
      letterSpacing: 1,
    }).setOrigin(0, 0.5), 470, 0.78);
    this.tutorialInstructionText = this.add.text(-318, -13, '', {
      fontFamily: UI_FONT,
      fontSize: TYPE.caption,
      color: '#dce8f7',
      fontStyle: 'bold',
      lineSpacing: 2,
      wordWrap: { width: 470, useAdvancedWrap: true },
    }).setOrigin(0, 0);
    this.tutorialProgressText = this.add.text(-318, 51, '', {
      fontFamily: UI_FONT,
      fontSize: TYPE.caption,
      color: '#8fefff',
      fontStyle: 'bold',
      letterSpacing: 1,
    }).setOrigin(0, 0.5);
    this.tutorialActionText = this.add.text(230, 40, '', {
      fontFamily: UI_FONT,
      fontSize: TYPE.caption,
      color: '#06101a',
      backgroundColor: '#ffe08a',
      padding: { x: 11, y: 7 },
      fontStyle: 'bold',
      letterSpacing: 1,
    }).setOrigin(0.5);
    const skip = this.add.text(316, -46, 'SKIP', {
      fontFamily: UI_FONT,
      fontSize: TYPE.caption,
      color: '#aebdd0',
      fontStyle: 'bold',
      letterSpacing: 1,
    }).setOrigin(1, 0.5);
    const tutorialActionHit = this.add.zone(
      230,
      48,
      160,
      MIN_MOBILE_COMMAND_TARGET,
    ).setInteractive({ useHandCursor: true });
    const skipHit = this.add.zone(
      310,
      -48,
      MIN_MOBILE_COMMAND_TARGET,
      MIN_MOBILE_COMMAND_TARGET,
    ).setInteractive({ useHandCursor: true });
    tutorialActionHit.on('pointerdown', () => {
      this.suppressNextShot = true;
      this.handleTutorialPanelAction();
    });
    skipHit.on('pointerdown', () => {
      this.suppressNextShot = true;
      this.skipTutorial();
    });
    panel.add([
      this.tutorialTitleText,
      this.tutorialInstructionText,
      this.tutorialProgressText,
      tutorialActionHit,
      skipHit,
      this.tutorialActionText,
      skip,
    ]);
    const target = LEVEL_ZERO_TUTORIAL_FIXTURE.guaranteedShot.target;
    const position = cellPos(this.geom, target.row, target.col, this.offsetY);
    this.tutorialTargetRing = this.add.circle(position.x, position.y, this.geom.radius * 1.12, 0x000000, 0)
      .setStrokeStyle(4, 0xffdf78, 0.96)
      .setDepth(15)
      .setVisible(false);
    if (!this.reducedMotion) {
      this.tweens.add({
        targets: this.tutorialTargetRing,
        scale: 1.18,
        alpha: 0.52,
        duration: 620,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });
    }
    this.renderTutorialHud();
  }

  private tutorialActionLabel(step: TutorialStepId): string {
    if (step === 'objective') return 'SHOW OBJECTIVE';
    if (step === 'danger-line') return 'SHOW DANGER';
    if (step === 'next-orb') return 'USE NEXT CARD';
    if (step === 'swap') return 'USE NEXT CARD';
    if (step === 'aim') return 'AIM AT RING';
    if (step === 'fire') {
      if (this.tutorialInputMode === 'hand' || this.tutorialInputMode === 'gaze-hand') {
        return 'PINCH + RELEASE';
      }
      return this.tutorialInputMode === 'gaze' ? 'DOUBLE BLINK' : 'RELEASE TO FIRE';
    }
    if (step === 'hand-touch-one') return 'PINCH + RELEASE';
    if (step === 'hand-touch-two') return 'TOUCH + RELEASE';
    return 'WATCH RESULT';
  }

  private renderTutorialHud(): void {
    const snapshot = this.tutorialMachine?.snapshot();
    const prompt = snapshot?.currentPrompt;
    if (!snapshot || snapshot.status !== 'active' || !prompt) return;
    this.tutorialTitleText?.setText(prompt.title.toUpperCase());
    this.tutorialInstructionText?.setText(prompt.instruction);
    this.tutorialProgressText?.setText(
      `TRAINING  ${snapshot.stepIndex + 1}/${snapshot.stepCount}  •  ${snapshot.runMode === 'replay' ? 'REPLAY' : 'FIRST RUN'}`,
    );
    this.tutorialActionText?.setText(this.tutorialActionLabel(prompt.step));
    fitText(this.tutorialActionText!, 142, 0.7);
    const showTarget = prompt.step === 'aim'
      || prompt.step === 'fire'
      || prompt.step === 'hand-touch-one'
      || prompt.step === 'hand-touch-two';
    this.tutorialTargetRing?.setVisible(showTarget);
    this.updateQueueHud();
  }

  private handleTutorialPanelAction(): void {
    const step = this.tutorialMachine?.snapshot().currentStep;
    if (step === 'objective') {
      this.dispatchTutorial({
        type: 'objective-viewed',
        visible: true,
        kind: LEVEL_ZERO_TUTORIAL_FIXTURE.objective.kind,
        current: LEVEL_ZERO_TUTORIAL_FIXTURE.objective.current,
        target: LEVEL_ZERO_TUTORIAL_FIXTURE.objective.target,
      });
      this.objectiveText?.setScale(1.04);
      this.tweens.add({ targets: [this.objectiveText, this.objectiveProgressText], alpha: 0.42, duration: 130, yoyo: true });
      return;
    }
    if (step === 'danger-line') {
      this.dispatchTutorial({
        type: 'danger-line-viewed',
        visible: true,
        row: LEVEL_ZERO_TUTORIAL_FIXTURE.dangerLineRow,
      });
      if (!this.reducedMotion) this.cameras.main.flash(90, 255, 92, 112, false);
      return;
    }
    if (step === 'next-orb' || step === 'swap') {
      this.toast('TAP THE NEXT ORB CARD AT THE BOTTOM RIGHT');
      return;
    }
    if (step) this.toast(this.tutorialMachine?.snapshot().currentPrompt?.instruction ?? 'FOLLOW THE GUIDE');
  }

  private skipTutorial(): void {
    const machine = this.tutorialMachine;
    if (!machine || !this.isTutorialActive()) return;
    const step = machine.snapshot().currentStep;
    machine.skip();
    if (step) {
      trackGameplayEvent({
        type: 'tutorial-step',
        level: 0,
        mode: 'tutorial',
        inputMode: this.tutorialInputMode,
        step,
        outcome: 'quit',
        reason: 'player-exit',
      });
    }
    SFX.click();
    this.scene.restart({ level: 0, score: this.levelStartScore, mode: this.mode });
  }

  private dispatchTutorial(signal: TutorialSignal): boolean {
    const machine = this.tutorialMachine;
    if (!machine || !this.isTutorialActive()) return false;
    const transition = machine.dispatch(signal);
    if (!transition.accepted) return false;
    for (const step of transition.completedSteps) {
      trackGameplayEvent({
        type: 'tutorial-step',
        level: 0,
        mode: 'tutorial',
        inputMode: this.tutorialInputMode,
        step,
        outcome: 'completed',
      });
    }
    if (transition.snapshot.status === 'completed') {
      if (this.tutorialTargetRing) {
        this.tweens.killTweensOf(this.tutorialTargetRing);
        this.tutorialTargetRing.destroy();
      }
      this.tutorialTargetRing = undefined;
      const panel = this.tutorialPanel;
      this.tutorialPanel = undefined;
      if (panel) {
        this.tweens.add({
          targets: panel,
          y: panel.y - 18,
          alpha: 0,
          duration: 260,
          ease: 'Quad.easeIn',
          onComplete: () => panel.destroy(true),
        });
      }
      this.toast('TRAINING COMPLETE  •  CLEAR THE REMAINING ORBS');
      this.updateQueueHud();
      if (usesAuthoritativePlatformEconomy()
        && !this.challenge && !this.arena && !this.replayTrace) {
        this.beginClassicAuthority();
      }
      return true;
    }
    const nextStep = transition.snapshot.currentStep;
    if (nextStep) {
      trackGameplayEvent({
        type: 'tutorial-step',
        level: 0,
        mode: 'tutorial',
        inputMode: this.tutorialInputMode,
        step: nextStep,
        outcome: 'started',
      });
    }
    this.renderTutorialHud();
    return true;
  }

  private seedLevelMechanics(count: number): void {
    if (count <= 0 || this.mechanicState.mechanic === 'portal') return;
    const eligible = this.bubbles
      .filter((bubble) => bubble.active)
      .sort((a, b) => a.row - b.row || a.col - b.col || a.id - b.id);
    const targetCount = Math.min(Math.max(0, Math.floor(count)), eligible.length);
    const selected = new Set<number>();
    for (let index = 0; index < targetCount; index++) {
      let candidateIndex = Math.floor(((index + 0.5) * eligible.length) / targetCount);
      while (selected.has(candidateIndex) && candidateIndex < eligible.length - 1) candidateIndex++;
      if (selected.has(candidateIndex)) {
        candidateIndex = eligible.findIndex((_bubble, position) => !selected.has(position));
      }
      if (candidateIndex < 0) break;
      selected.add(candidateIndex);
      this.attachBubbleMechanic(eligible[candidateIndex], this.mechanicState.mechanic);
    }
  }

  private attachBubbleMechanic(bubble: Bub, kind: MechanicKind): boolean {
    if (!bubble.active || bubble.mechanic || kind === 'portal') return false;
    const textureByMechanic: Record<Exclude<MechanicKind, 'portal'>, string> = {
      crystal: 'mechanic_crystal_seal',
      vine: 'mechanic_vine_bind',
      ember: 'mechanic_ember_core',
      ice: 'mechanic_ice_armor',
      polarity: 'mechanic_polarity_ring',
    };
    bubble.mechanic = kind === 'crystal' || kind === 'ice'
      ? { kind, armor: 2 }
      : kind === 'ember'
        ? { kind, countdown: 3 }
        : { kind };
    bubble.mechanicOverlay = this.add.image(bubble.sprite.x, bubble.sprite.y, textureByMechanic[kind])
      .setDisplaySize(this.geom.radius * 2.08, this.geom.radius * 2.08)
      .setDepth(6)
      .setAlpha(kind === 'vine' ? 0.9 : 0.94)
      .setAngle(kind === 'vine' ? (bubble.id % 2 ? 4 : -4) : 0);
    this.updateBubbleMechanicVisual(bubble);
    return true;
  }

  private updateBubbleMechanicVisual(bubble: Bub): void {
    const overlay = bubble.mechanicOverlay;
    const mechanic = bubble.mechanic;
    if (!overlay || !mechanic) return;
    overlay.setPosition(bubble.sprite.x, bubble.sprite.y);
    if (mechanic.kind === 'crystal' || mechanic.kind === 'ice') {
      overlay.setAlpha((mechanic.armor ?? 0) > 1 ? 0.96 : 0.68)
        .setTint((mechanic.armor ?? 0) > 1 ? 0xffffff : mechanic.kind === 'ice' ? 0xb7efff : 0x91dfff);
    } else if (mechanic.kind === 'ember') {
      const countdown = mechanic.countdown ?? 0;
      overlay.setTint(countdown >= 3 ? 0xffffff : countdown === 2 ? 0xffc15e : 0xff574f)
        .setAlpha(countdown > 1 ? 0.94 : 1);
    }
  }

  private clearBubbleMechanic(bubble: Bub): void {
    const overlay = bubble.mechanicOverlay;
    bubble.mechanic = undefined;
    bubble.mechanicOverlay = undefined;
    if (!overlay?.active) return;
    this.tweens.killTweensOf(overlay);
    this.tweens.add({
      targets: overlay,
      scale: overlay.scaleX * 1.28,
      alpha: 0,
      duration: 180,
      ease: 'Quad.easeOut',
      onComplete: () => overlay.destroy(),
    });
  }

  private createPortalPair(): void {
    const bottomRow = this.bubbles.reduce((max, bubble) => Math.max(max, bubble.row), 0);
    const gridBottom = this.geom.topPad + bottomRow * this.geom.rowH;
    const firstY = Phaser.Math.Clamp(gridBottom + 105, 650, this.shooter.y - 245);
    const secondY = Phaser.Math.Clamp(firstY + 128, firstY + 92, this.shooter.y - 112);
    const positions = [
      { x: 126, y: firstY },
      { x: VIEW.width - 126, y: secondY },
    ];
    this.portalEndpoints = positions.map((position, index) => ({
      id: `portal-${index + 1}`,
      sprite: this.add.image(position.x, position.y, 'mechanic_celestial_portal')
        .setDisplaySize(94, 94)
        .setDepth(3)
        .setAlpha(0.88)
        .setAngle(index === 0 ? -10 : 10),
    }));
    this.portalPairs = pairPortalIds(this.portalEndpoints.map((endpoint) => endpoint.id));
  }

  private tryPortalTeleport(): boolean {
    if (this.portalTeleportedThisShot || !this.ballSprite || this.portalEndpoints.length !== 2) return false;
    const entry = this.portalEndpoints.find((endpoint) => (
      Phaser.Math.Distance.Between(endpoint.sprite.x, endpoint.sprite.y, this.ballSprite!.x, this.ballSprite!.y) < 42
    ));
    if (!entry) return false;
    const decision = decidePortalTeleport(entry.id, this.portalPairs, this.portalCooldowns, 2);
    if (!decision.canTeleport || !decision.destinationId) return false;
    const destination = this.portalEndpoints.find((endpoint) => endpoint.id === decision.destinationId);
    if (!destination) return false;
    this.portalCooldowns = decision.cooldowns;

    const speed = Math.hypot(this.vel.x, this.vel.y) || 1;
    const exitOffset = Math.max(48, this.geom.radius * 2.05);
    this.ballSprite.setPosition(
      Phaser.Math.Clamp(destination.sprite.x + (this.vel.x / speed) * exitOffset, this.geom.radius, VIEW.width - this.geom.radius),
      destination.sprite.y + (this.vel.y / speed) * exitOffset,
    );
    this.portalTeleportedThisShot = true;
    for (const endpoint of [entry, destination]) {
      const ring = this.add.circle(endpoint.sprite.x, endpoint.sprite.y, 30, 0x000000, 0)
        .setStrokeStyle(4, 0x88e8ff, 0.9)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setDepth(7);
      this.tweens.add({ targets: ring, scale: 2, alpha: 0, duration: 280, onComplete: () => ring.destroy() });
    }
    return true;
  }

  private rotatePortalPair(): void {
    if (this.portalEndpoints.length !== 2) return;
    const [first, second] = this.portalEndpoints;
    const firstPosition = { x: first.sprite.x, y: first.sprite.y };
    const secondPosition = { x: second.sprite.x, y: second.sprite.y };
    this.tweens.add({
      targets: first.sprite,
      x: secondPosition.x,
      y: secondPosition.y,
      angle: first.sprite.angle + 180,
      duration: 420,
      ease: 'Cubic.easeInOut',
    });
    this.tweens.add({
      targets: second.sprite,
      x: firstPosition.x,
      y: firstPosition.y,
      angle: second.sprite.angle - 180,
      duration: 420,
      ease: 'Cubic.easeInOut',
    });
    this.toast('ASTRAL SHIFT  •  PORTAL ENDPOINTS ROTATED');
  }

  private shiftPolarityRow(): void {
    const rows = Array.from(new Set(this.bubbles.filter((bubble) => bubble.active).map((bubble) => bubble.row)))
      .filter((row) => this.bubbles.filter((bubble) => bubble.active && bubble.row === row).length >= 3)
      .sort((a, b) => a - b);
    if (!rows.length) return;
    const row = rows[this.mechanicState.shotsTaken % rows.length];
    const bubbles = this.bubbles.filter((bubble) => bubble.active && bubble.row === row).sort((a, b) => a.col - b.col);
    const oldCols = bubbles.map((bubble) => bubble.col);
    const direction: -1 | 1 = Math.floor(this.mechanicState.shotsTaken / 2) % 2 === 0 ? 1 : -1;
    const rotated = rotateRowAssignments(oldCols, direction);
    bubbles.forEach((bubble, index) => {
      bubble.col = rotated[index];
      const position = cellPos(this.geom, bubble.row, bubble.col, this.offsetY);
      this.tweens.add({ targets: bubble.sprite, x: position.x, y: position.y, duration: 360, ease: 'Cubic.easeInOut' });
      if (bubble.mechanicOverlay) {
        this.tweens.add({ targets: bubble.mechanicOverlay, x: position.x, y: position.y, angle: bubble.mechanicOverlay.angle + direction * 35, duration: 360, ease: 'Cubic.easeInOut' });
      }
    });
    if (!this.reducedMotion) this.cameras.main.shake(120, 0.0035);
    this.toast(`POLARITY SHIFT  •  ROW ${row + 1} ROTATED ${direction > 0 ? 'RIGHT' : 'LEFT'}`);
  }

  private updateObjectiveHud(): void {
    if (!this.mechanicState) return;
    const progress = getObjectiveProgress(this.mechanicState);
    const limits: string[] = [];
    if (this.mechanicState.shotsRemaining != null) limits.push(`SHOTS ${this.mechanicState.shotsRemaining}`);
    if (this.mechanicState.missLimit != null) {
      limits.push(`MISS ${this.mechanicState.misses}/${this.mechanicState.missLimit}`);
    }
    if (this.mechanicState.boss) {
      const ratio = this.mechanicState.boss.maxHp > 0
        ? this.mechanicState.boss.hp / this.mechanicState.boss.maxHp
        : 0;
      this.bossHpFill?.setScale(Phaser.Math.Clamp(ratio, 0, 1), 1);
      if (this.objectiveProgressText) {
        this.objectiveProgressText.setScale(1).setText(
          `HP ${this.mechanicState.boss.hp}/${this.mechanicState.boss.maxHp}${limits.length ? `  •  ${limits.join('  •  ')}` : ''}`,
        );
        fitText(this.objectiveProgressText, 180, 0.84);
      }
      return;
    }
    const objectiveKind = this.mechanicState.objective.kind;
    if (objectiveKind === 'boss') return;
    // This rail shares one line with the authored objective. Use compact,
    // unambiguous metric labels here; the full mechanic name remains in the
    // instruction rail and accessible scene description.
    const label: Record<'clear' | 'seals' | 'vines' | 'portal_cores' | 'embers' | 'ice_cores' | 'polarity_nodes', string> = {
      clear: 'CLEAR', seals: 'SEALS', vines: 'VINES', portal_cores: 'CORES', embers: 'COOLED',
      ice_cores: 'ICE', polarity_nodes: 'NODES',
    };
    if (this.objectiveProgressText) {
      this.objectiveProgressText.setScale(1).setText(
        `${label[objectiveKind]}  ${progress.current}/${progress.target}${limits.length ? `  •  ${limits.join('  •  ')}` : ''}`,
      );
      fitText(this.objectiveProgressText, 280, 0.84);
    }
  }

  private applyBossDamageEvent(event: BossDamageEvent): number {
    const boss = this.mechanicState.boss;
    if (!boss || calculateBossDamage(event) <= 0) return 0;
    const result = applyBossDamage(boss, event);
    this.mechanicState = setRunBoss(this.mechanicState, result.boss);
    this.updateObjectiveHud();
    if (result.damage > 0 && this.bossIcon) {
      this.tweens.killTweensOf(this.bossIcon);
      const scaleX = this.bossIcon.scaleX;
      const scaleY = this.bossIcon.scaleY;
      this.tweens.add({
        targets: this.bossIcon,
        scaleX: scaleX * 1.14,
        scaleY: scaleY * 1.14,
        angle: 8,
        duration: 110,
        yoyo: true,
        ease: 'Quad.easeOut',
      });
      if (!this.reducedMotion) this.cameras.main.flash(80, 100, 220, 255, false);
    }
    return result.damage;
  }

  private randomEligibleBubble(): Bub | undefined {
    const eligible = this.bubbles.filter((bubble) => bubble.active && !bubble.mechanic);
    const id = selectVineSpreadTarget({
      candidateIds: eligible.map((bubble) => bubble.id),
      rng: this.rng,
    });
    return id == null ? undefined : eligible.find((bubble) => bubble.id === id);
  }

  private runCounterAction(wasMiss: boolean): void {
    const def = LEVELS[this.level];
    if (isObjectiveComplete(this.mechanicState)) return;
    if (!def.boss || !this.mechanicState.boss) {
      if (this.mechanicState.mechanic === 'polarity' && this.mechanicState.shotsTaken > 0 && this.mechanicState.shotsTaken % 3 === 0) {
        this.shiftPolarityRow();
        return;
      }
      if (!wasMiss || this.mechanicState.mechanic !== 'vine') return;
      const target = this.randomEligibleBubble();
      if (target && this.attachBubbleMechanic(target, 'vine')) {
        this.toast('LIVING VINES SPREAD  •  A MISS CLAIMED ANOTHER ORB');
      }
      return;
    }
    const every = Math.max(1, def.boss.actionEvery);
    if (this.mechanicState.shotsTaken === 0 || this.mechanicState.shotsTaken % every !== 0) return;
    if (this.mechanicState.mechanic === 'portal') {
      this.rotatePortalPair();
      return;
    }
    if (this.mechanicState.mechanic === 'polarity') {
      this.shiftPolarityRow();
      return;
    }
    const target = this.randomEligibleBubble();
    if (!target || !this.attachBubbleMechanic(target, this.mechanicState.mechanic)) return;
    const message: Record<Exclude<MechanicKind, 'portal' | 'polarity'>, string> = {
      crystal: 'WARDEN DEFENCE  •  A CRYSTAL SHELL FORMED',
      vine: 'HEARTWOOD GROWTH  •  A VINE CLAIMED AN ORB',
      ember: 'INFERNO PULSE  •  A MAGMA CORE IS ARMED',
      ice: 'REGENT DEFENCE  •  AN ICE SHELL REFORMED',
    };
    this.toast(message[this.mechanicState.mechanic]);
  }

  private resolveMatchedMechanic(bubble: Bub): boolean {
    const mechanic = bubble.mechanic;
    if (!mechanic) return false;
    if (mechanic.kind === 'crystal' || mechanic.kind === 'ice') {
      const result = damageCrystalArmor({ id: bubble.id, armor: mechanic.armor ?? 0 });
      mechanic.armor = result.crystal.armor;
      if (result.justBroken) {
        this.mechanicState = addObjectiveProgress(this.mechanicState, mechanic.kind === 'ice' ? 'ice_cores' : 'seals', 1);
        this.clearBubbleMechanic(bubble);
        return false;
      }
      this.updateBubbleMechanicVisual(bubble);
      return true;
    }
    if (mechanic.kind === 'vine') {
      this.mechanicState = addObjectiveProgress(this.mechanicState, 'vines', 1);
      this.clearBubbleMechanic(bubble);
      return true;
    }
    if (mechanic.kind === 'polarity') {
      this.mechanicState = addObjectiveProgress(this.mechanicState, 'polarity_nodes', 1);
      this.clearBubbleMechanic(bubble);
      return false;
    }
    coolEmber({ id: bubble.id, countdown: mechanic.countdown ?? 0, cooled: false });
    this.mechanicState = addObjectiveProgress(this.mechanicState, 'embers', 1);
    this.clearBubbleMechanic(bubble);
    return false;
  }

  private isSpecialRemovable(bubble: Bub): boolean {
    return canSpecialRemoveMechanic(bubble.mechanic?.kind);
  }

  /** Commit mechanic progress only after the owning power-up has been paid. */
  private commitSpecialMechanicRemoval(bubble: Bub): void {
    if (bubble.mechanic?.kind === 'polarity') {
      this.mechanicState = addObjectiveProgress(this.mechanicState, 'polarity_nodes', 1);
      this.clearBubbleMechanic(bubble);
    }
    if (bubble.mechanic?.kind === 'ember') {
      coolEmber({ id: bubble.id, countdown: bubble.mechanic.countdown ?? 0, cooled: false });
      this.mechanicState = addObjectiveProgress(this.mechanicState, 'embers', 1);
      this.clearBubbleMechanic(bubble);
    }
  }

  private isFloaterProtected(bubble: Bub, protectedIds: ReadonlySet<number>): boolean {
    if (protectedIds.has(bubble.id)) return true;
    return protectsDetachedBubble(bubble.mechanic?.kind);
  }

  private dropDetached(protectedIds: ReadonlySet<number> = new Set<number>()): Bub[] {
    const candidates = floaters(this.toCells(), this.geom.cellW);
    const fell: Bub[] = [];
    for (const cell of candidates) {
      const bubble = this.bubbles.find((candidate) => candidate.id === cell.id && candidate.active);
      if (!bubble || this.isFloaterProtected(bubble, protectedIds)) continue;
      bubble.active = false;
      this.drop(bubble);
      fell.push(bubble);
    }
    return fell;
  }

  private advanceEmbersAfterShot(): boolean {
    const emberBubbles = this.bubbles.filter((bubble) => bubble.active && bubble.mechanic?.kind === 'ember');
    if (!emberBubbles.length) return false;
    const result = advanceEmberCountdown(emberBubbles.map((bubble) => ({
      id: bubble.id,
      countdown: bubble.mechanic?.countdown ?? 0,
      cooled: false,
    })));
    const stateById = new Map(result.embers.map((ember) => [ember.id, ember]));
    for (const bubble of emberBubbles) {
      const next = stateById.get(bubble.id);
      if (!next || bubble.mechanic?.kind !== 'ember') continue;
      bubble.mechanic.countdown = next.countdown;
      this.updateBubbleMechanicVisual(bubble);
    }
    for (const id of result.eruptedIds) {
      const bubble = this.bubbles.find((candidate) => candidate.id === id && candidate.active);
      if (!bubble || bubble.mechanic?.kind !== 'ember') continue;
      const nextColor = this.randColor();
      bubble.color = nextColor;
      bubble.mechanic.countdown = 3;
      if (ATLAS_KEY) bubble.sprite.setTexture(ATLAS_KEY, orbTexture(this.skinId, nextColor));
      else bubble.sprite.setTexture(orbTexture(this.skinId, nextColor));
      bubble.sprite.setScale(this.scaleFor()).setTint(0xff8b72);
      this.updateBubbleMechanicVisual(bubble);
      this.tweens.add({ targets: bubble.sprite, alpha: 0.58, duration: 110, yoyo: true, repeat: 2, onComplete: () => bubble.sprite.clearTint() });
    }
    if (result.eruptedIds.length) {
      this.toast('MAGMA CORE ERUPTED  •  MISS +1');
      if (!this.reducedMotion) {
        this.cameras.main.shake(190, 0.009);
        this.cameras.main.flash(130, 255, 75, 45, false);
      }
    }
    return result.eruptedIds.length > 0;
  }

  private setHandBtn(state: 'off' | 'loading' | 'on' | 'denied' | 'error'): void {
    if (!this.handBtn) return;
    const controlLabel = this.visionControlLabel();
    const visual: Record<typeof state, { label: string; text: string; dot: string }> = {
      off: { label: controlLabel, text: '#b9c5d6', dot: '#6f8094' },
      loading: { label: 'WAIT', text: '#ffd970', dot: '#ffd970' },
      on: { label: controlLabel, text: '#54e8cf', dot: '#54e8cf' },
      denied: { label: 'BLOCK', text: '#ff8496', dot: '#ff8496' },
      error: { label: 'ERROR', text: '#ffc56f', dot: '#ffc56f' },
    };
    const next = visual[state];
    this.handBtn.setText(next.label).setColor(next.text);
    this.handStatusText?.setText('●').setColor(next.dot);
  }

  private visionControlLabel(): string {
    if (this.visionMode === 'gaze') return 'EYES';
    if (this.visionMode === 'gaze-hand') return 'BOTH';
    return 'HAND';
  }

  private handFailureMessage(failure: HandTrackingFailure): string {
    switch (failure) {
      case 'permission-denied': return 'Camera is blocked — allow camera for this site, then tap CAMERA again';
      case 'no-camera': return 'No camera was found on this device';
      case 'camera-busy': return 'Camera is busy — close other camera apps and retry';
      case 'camera-constraints': return 'This camera mode is not supported — basic mode also failed';
      case 'model-load-failed': return 'On-device vision model could not start — reload and retry';
      case 'insecure-context': return 'Camera controls require HTTPS';
      case 'unsupported': return 'This browser does not support on-device camera controls';
      default: return 'Camera could not start — check browser permission and retry';
    }
  }

  private async startHandTracking(showError = true): Promise<void> {
    if (this.handStarting) return;
    const tracker = getHandTracker();
    if (this.visionMode !== 'hand') {
      const gazeSettings = getGazeSettings();
      const handSettings = getHandSettings();
      const identity = currentGazeCalibrationIdentity(handSettings.deviceId, handSettings.mirror);
      if (!gazeCalibrationMatches(gazeSettings.calibration, identity)) {
        this.setHandBtn('error');
        if (showError) this.toast('EYE CALIBRATION REQUIRED  •  OPEN CAMERA CONTROLS');
        return;
      }
    }
    this.handStarting = true;
    this.setHandBtn('loading');
    const ok = await tracker.enable(this.visionMode);
    if (!this.sys.isActive()) {
      this.handStarting = false;
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
        this.handStarting = false;
        this.handOn = false;
        this.setHandBtn('error');
        if (showError) this.toast('ACTIVE CAMERA CHANGED  •  RECALIBRATE EYES IN CAMERA CONTROLS');
        return;
      }
    }
    this.handStarting = false;

    this.handOn = ok;
    this.handHasSeen = false;
    this.handLastSeenAt = 0;
    if (ok) {
      // Gameplay keeps camera decoding/inference but removes the preview and
      // skeleton paint cost. Hand Control Lab remains the explicit preview UI.
      tracker.setPreviewVisible(false);
      this.setHandBtn('loading');
      if (showError) {
        this.toast(
          this.visionMode === 'gaze'
            ? 'EYES  •  LOOK TO AIM → HOLD STEADY → DOUBLE BLINK TO FIRE'
            : this.visionMode === 'gaze-hand'
              ? 'HYBRID  •  LOOK TO AIM → PINCH → RELEASE TO FIRE'
              : 'HAND  •  AIM → TOUCH THUMB + INDEX → SEPARATE SLIGHTLY TO FIRE',
        );
      }
      return;
    }

    const failure = tracker.getLastFailure();
    this.setHandBtn(failure === 'permission-denied' ? 'denied' : 'error');
    this.fallbackTutorialToPointerInput();
    if (showError) this.toast(this.handFailureMessage(failure));
  }

  private fallbackTutorialToPointerInput(): void {
    if (!this.isTutorialActive()
      || !['hand', 'gaze', 'gaze-hand'].includes(this.tutorialInputMode)) return;
    const pointerMode: GameplayInputMode = navigator.maxTouchPoints > 0 ? 'touch' : 'mouse';
    const transition = this.tutorialMachine?.fallbackToPointer(pointerMode);
    if (!transition?.accepted) return;
    this.tutorialInputMode = pointerMode;
    this.renderTutorialHud();
    this.toast('CAMERA CONTROL UNAVAILABLE  •  TRAINING CONTINUES WITH POINTER CONTROLS');
  }

  private async toggleHand(): Promise<void> {
    if (this.handStarting) return;
    const ht = getHandTracker();
    if (this.handOn) {
      ht.disable();
      this.handOn = false;
      this.pinchControl.reset();
      this.handPinching = false;
      this.handSmooth = null;
      this.handTarget = null;
      this.handLockedAim = null;
      this.handOpenAim = null;
      this.handAimPredictor.reset();
      this.handContinuity.reset();
      this.gazeAimController.reset();
      this.gazeBlinkControl.reset();
      this.gazeDwellControl.reset();
      this.gazeHasSeen = false;
      this.gazeLastSeenAt = 0;
      this.gazeStableAim = null;
      this.gazeBlinkAim = null;
      this.handCursor?.setVisible(false);
      this.setHandBtn('off');
      this.fallbackTutorialToPointerInput();
      return;
    }
    await this.startHandTracking(true);
  }

  private pollHand(): void {
    if (!this.handOn) return;
    const now = performance.now();
    const s = getHandTracker().sample();
    if (!s) {
      if (!this.handHasSeen) {
        this.handBtn?.setText('SEARCH').setColor('#ffe083');
        this.handStatusText?.setColor('#ffe083');
        return;
      }
      const lostFor = now - this.handLastSeenAt;
      if (this.pinchControl.cancelForLoss(now, this.handLastSeenAt) === 'cancelled') {
        this.handPinching = false;
        this.handLockedAim = null;
        this.handBtn?.setText('LOST').setColor('#ffc56f');
        this.handStatusText?.setColor('#ffc56f');
      }
      if (lostFor > 450) {
        this.handTarget = null;
        this.handAimPredictor.reset();
        this.handCursor?.setVisible(false);
      }
      if (lostFor > 1_200) {
        this.handCursor?.setVisible(false);
        this.handSmooth = null;
        this.handTarget = null;
        this.handLockedAim = null;
        this.handOpenAim = null;
        this.handAimPredictor.reset();
        this.handContinuity.reset();
        this.pinchControl.reset();
        this.handPinching = false;
        this.handBtn?.setText('SHOW').setColor('#ffc56f');
        this.handStatusText?.setColor('#ffc56f');
      }
      return;
    }
    this.handHasSeen = true;
    this.handLastSeenAt = now;
    if (s.rawPinch >= this.handReleaseThreshold) {
      this.handAimPredictor.push({ x: s.x, y: s.y }, s.timestampMs, now);
    }
    this.handTarget = mapHandToAim(
      { x: s.x, y: s.y },
      VIEW.width,
      VIEW.height * 0.12,
      this.shooter.y - 105,
    );
    if (!this.handSmooth) this.handSmooth = { ...this.handTarget };

    // Never carry a partly completed gesture across a projectile. Preserve only
    // the learned physical touch/release gap so the next shot does not demand a
    // wider hand opening.
    if (this.flying) {
      this.pinchControl.resetForShot();
      this.handContinuity.reset();
      this.handLockedAim = null;
      this.handPinching = false;
      this.handBtn?.setText('WAIT').setColor('#ffd970');
      this.handStatusText?.setColor('#ffd970');
      return;
    }

    // An uncertain result can still move the cursor but can never progress a
    // contact/release edge. Brief dips preserve a real pinch; sustained
    // uncertainty cancels fail-closed.
    const continuity = this.handContinuity.observe(s.gestureStable && s.usableForGesture, s.timestampMs);
    if (continuity !== 'usable') {
      if (continuity === 'cancel') {
        this.pinchControl.resetForContinuity();
        this.handLockedAim = null;
        this.handPinching = false;
      } else {
        this.pinchControl.holdForUncertainty(s.timestampMs);
      }
      this.handBtn?.setText(s.gestureStable ? 'UNCERTAIN' : 'STABLE').setColor('#ffd970');
      this.handStatusText?.setColor('#ffd970');
      return;
    }

    const handAim = this.handSmooth ?? this.handTarget;
    this.observeTutorialAim(this.aimVectorXY(handAim.x, handAim.y));
    if (!this.pinchControl.isEngaged()
      && s.rawPinch >= this.handReleaseThreshold
      && this.handTarget) {
      this.handOpenAim = { ...this.handTarget, timestampMs: s.timestampMs };
    }
    const pinchEvent = this.pinchControl.update(s);
    this.handPinching = this.pinchControl.isContacting();
    if (pinchEvent === 'latched') {
      // The confirmed contact frame is the shot's authority boundary. Lock the
      // measured aim and make the display agree with it; render prediction may
      // keep an open-hand cursor fluid, but it can never choose a shot target.
      const measuredAim = this.handOpenAim
        && s.timestampMs - this.handOpenAim.timestampMs <= 260
        ? this.handOpenAim
        : this.handTarget;
      this.handLockedAim = measuredAim ? { ...measuredAim } : null;
      if (!this.handLockedAim) {
        this.pinchControl.resetForContinuity();
        this.handPinching = false;
        return;
      }
      this.handSmooth = { ...this.handLockedAim };
      this.handCursor?.setPosition(this.handLockedAim.x, this.handLockedAim.y);
    } else if (pinchEvent === 'aim-locked') {
      this.dispatchTutorial({
        type: 'hand-touch-one',
        reliable: true,
        releaseConfirmed: true,
      });
    } else if (pinchEvent === 'cancelled') {
      this.handLockedAim = null;
    }
    if (pinchEvent === 'released') {
      this.handPinching = false;
      // Prediction is presentation-only. It may provide a final visual cursor
      // target when a malformed sequence has no latch, but only the measured
      // contact lock below is eligible to fire.
      const predictedRelease = this.handAimPredictor.predict(now);
      const predictedAim = predictedRelease
        ? mapHandToAim(predictedRelease, VIEW.width, VIEW.height * 0.12, this.shooter.y - 105)
        : null;
      const visualAim = this.handLockedAim ?? predictedAim ?? this.handTarget;
      const aim = this.handLockedAim;
      this.handLockedAim = null;
      if (!aim) {
        if (visualAim) this.handCursor?.setPosition(visualAim.x, visualAim.y);
        this.pinchControl.resetForContinuity();
        return;
      }
      this.handTarget = { ...aim };
      this.handSmooth = { ...aim };
      this.handCursor?.setPosition(aim.x, aim.y);
      this.dispatchTutorial({
        type: 'hand-touch-one',
        reliable: true,
        releaseConfirmed: true,
      });
      this.shootAt(aim.x, aim.y);
    }

    const phase = this.pinchControl.getPhase();
    const phaseLabel = this.handPinching
      ? 'TOUCH'
      : phase === 'open'
        ? 'FREE'
        : phase === 'ready'
          ? 'READY'
          : 'FREE';
    const contactColor = this.handPinching ? '#4be08a' : '#54e8cf';
    this.handBtn?.setText(phaseLabel).setColor(contactColor);
    this.handStatusText?.setText('●').setColor(contactColor);
  }

  private pollGaze(): void {
    if (!this.handOn) return;
    const now = performance.now();
    const observation = getHandTracker().sampleGaze();
    if (!observation) {
      if (!this.gazeHasSeen) {
        this.handBtn?.setText('FACE').setColor('#ffe083');
        this.handStatusText?.setColor('#ffe083');
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
        this.handLockedAim = null;
        this.gazeStableAim = null;
        this.gazeBlinkAim = null;
      }
      if (lostFor > 450) {
        this.handTarget = null;
        this.handSmooth = null;
        this.handCursor?.setVisible(false);
      }
      if (lostFor > 1_200) {
        this.gazeAimController.reset();
        this.gazeHasSeen = false;
        this.handBtn?.setText('FACE').setColor('#ffc56f');
        this.handStatusText?.setColor('#ffc56f');
      }
      return;
    }

    const gazeSettings = getGazeSettings();
    const handSettings = getHandSettings();
    const activeCameraId = getHandTracker().getActiveCameraDeviceId();
    const identity = currentGazeCalibrationIdentity(activeCameraId, handSettings.mirror);
    const profile = gazeSettings.calibration;
    if (!activeCameraId || !gazeCalibrationMatches(profile, identity)) {
      getHandTracker().disable();
      this.handOn = false;
      this.gazeAimController.reset();
      this.gazeBlinkControl.reset();
      this.gazeDwellControl.reset();
      this.gazeStableAim = null;
      this.gazeBlinkAim = null;
      this.handTarget = null;
      this.handCursor?.setVisible(false);
      this.handBtn?.setText('RECAL').setColor('#ff9a99');
      this.handStatusText?.setColor('#ff9a99');
      return;
    }
    const point = profile
      ? this.gazeAimController.update(observation, profile, now)
      : null;
    if (!point) {
      this.gazeBlinkControl.reset();
      this.gazeDwellControl.update({
        targetId: null,
        timestampMs: observation.timestampMs,
        usableForAction: false,
        stableForAction: false,
      });
      this.handTarget = null;
      this.gazeStableAim = null;
      this.gazeBlinkAim = null;
      this.handCursor?.setVisible(false);
      this.handBtn?.setText('CAL').setColor('#ff9a99');
      this.handStatusText?.setColor('#ff9a99');
      return;
    }

    this.gazeHasSeen = true;
    this.gazeLastSeenAt = now;
    const target = {
      x: Phaser.Math.Clamp(point.x * VIEW.width, 12, VIEW.width - 12),
      y: Phaser.Math.Clamp(point.y * VIEW.height, VIEW.height * 0.12, this.shooter.y - 105),
    };
    this.handTarget = target;
    if (!this.handSmooth) this.handSmooth = { ...target };
    const stableTarget = point.usableForAction
      && point.stableForAction
      && now - observation.timestampMs <= 180;
    const bothEyesOpen = observation.leftBlink <= 0.32 && observation.rightBlink <= 0.32;
    if (stableTarget && bothEyesOpen) {
      this.gazeStableAim = { ...target, timestampMs: observation.timestampMs };
    }

    // Hybrid mode deliberately ignores blinks: gaze supplies measured aim and
    // the existing physical pinch/release recognizer owns the action boundary.
    if (this.visionMode === 'gaze-hand') {
      this.gazeBlinkAim = null;
      const locked = this.gazeStableAim && now - this.gazeStableAim.timestampMs <= 260;
      this.handBtn?.setText(locked ? 'LOOK' : 'STEADY').setColor(locked ? '#54e8cf' : '#ffd970');
      this.handStatusText?.setColor(locked ? '#54e8cf' : '#ffd970');
      return;
    }

    let activate = false;
    const targetKey = `${Math.round(point.x * 14)}:${Math.round(point.y * 14)}`;
    if (gazeSettings.activation === 'dwell') {
      const dwell = this.gazeDwellControl.update({
        targetId: targetKey,
        timestampMs: observation.timestampMs,
        usableForAction: stableTarget && bothEyesOpen && !this.flying,
        stableForAction: point.stableForAction,
      });
      activate = dwell.action;
      const progress = Math.round(dwell.progress * 100);
      this.handBtn?.setText(stableTarget && progress > 0 ? `${progress}%` : 'DWELL')
        .setColor(stableTarget ? '#54e8cf' : '#ffd970');
    } else {
      const blinkEvent = this.gazeBlinkControl.update({
        timestampMs: observation.timestampMs,
        leftBlink: observation.leftBlink,
        rightBlink: observation.rightBlink,
        usableForAction: point.usableForAction && !this.flying,
        stableForAction: point.stableForAction,
      });
      activate = blinkEvent === 'action';
      if (blinkEvent !== 'action') {
        if (this.gazeBlinkControl.isSequenceEngaged()) {
          const stableAim = this.gazeStableAim
            && now - this.gazeStableAim.timestampMs <= 260
            ? this.gazeStableAim
            : null;
          if (!this.gazeBlinkAim && stableAim) this.gazeBlinkAim = { ...stableAim };
        } else {
          this.gazeBlinkAim = null;
        }
      }
      this.handBtn?.setText(
        point.stableForAction ? 'BLINK ×2' : 'HOLD',
      ).setColor('#54e8cf');
    }
    this.handStatusText?.setColor(stableTarget ? '#54e8cf' : '#ffd970');
    if (!activate || this.flying) return;

    // Only the fresh, calibrated sample that completed the deliberate action
    // can choose the shot target; render interpolation never changes it.
    const selectedAim = gazeSettings.activation === 'double-blink'
      ? this.gazeBlinkAim
      : this.gazeStableAim;
    const authoritativeAgeMs = gazeSettings.activation === 'double-blink' ? 1_000 : 260;
    const authoritativeAim = selectedAim
      && now - selectedAim.timestampMs <= authoritativeAgeMs
      ? selectedAim
      : null;
    if (!authoritativeAim) {
      this.gazeBlinkAim = null;
      return;
    }
    this.handLockedAim = { x: authoritativeAim.x, y: authoritativeAim.y };
    this.handSmooth = { x: authoritativeAim.x, y: authoritativeAim.y };
    this.handCursor?.setPosition(authoritativeAim.x, authoritativeAim.y);
    this.shootAt(authoritativeAim.x, authoritativeAim.y);
    this.handLockedAim = null;
    this.gazeBlinkControl.reset();
    this.gazeBlinkAim = null;
  }

  private pollHybridHand(): void {
    if (!this.handOn) return;
    const now = performance.now();
    const sample = getHandTracker().sample();
    if (!sample) {
      if (this.pinchControl.cancelForLoss(now, this.handLastSeenAt) === 'cancelled') {
        this.handLockedAim = null;
        this.handPinching = false;
      }
      return;
    }
    this.handHasSeen = true;
    this.handLastSeenAt = now;
    if (this.flying) {
      this.pinchControl.resetForShot();
      this.handContinuity.reset();
      this.handLockedAim = null;
      this.handPinching = false;
      return;
    }
    const continuity = this.handContinuity.observe(
      sample.gestureStable && sample.usableForGesture,
      sample.timestampMs,
    );
    if (continuity !== 'usable') {
      if (continuity === 'cancel') {
        this.pinchControl.resetForContinuity();
        this.handLockedAim = null;
        this.handPinching = false;
      } else {
        this.pinchControl.holdForUncertainty(sample.timestampMs);
      }
      return;
    }
    const event = this.pinchControl.update(sample);
    this.handPinching = this.pinchControl.isContacting();
    if (event === 'latched') {
      const freshGaze = this.gazeStableAim && now - this.gazeStableAim.timestampMs <= 260
        ? this.gazeStableAim
        : null;
      this.handLockedAim = freshGaze ? { x: freshGaze.x, y: freshGaze.y } : null;
      if (!this.handLockedAim) {
        this.pinchControl.resetForContinuity();
        this.handPinching = false;
      }
    } else if (event === 'cancelled') {
      this.handLockedAim = null;
      this.handPinching = false;
    } else if (event === 'released') {
      const aim = this.handLockedAim;
      this.handLockedAim = null;
      this.handPinching = false;
      if (!aim) {
        this.pinchControl.resetForContinuity();
        return;
      }
      this.handSmooth = { ...aim };
      this.shootAt(aim.x, aim.y);
    }
    this.handBtn?.setText(this.handPinching ? 'PINCH' : 'LOOK').setColor('#54e8cf');
    this.handStatusText?.setColor(this.handPinching ? '#4be08a' : '#54e8cf');
  }

  /** Interpolate every Phaser frame so 15–20 recognition FPS still feels fluid. */
  private advanceHandAim(deltaMs: number): void {
    const predicted = this.handAimPredictor.predict(performance.now());
    const predictedTarget = predicted
      ? mapHandToAim(predicted, VIEW.width, VIEW.height * 0.12, this.shooter.y - 105)
      : null;
    const target = this.handLockedAim ?? predictedTarget ?? this.handTarget;
    if (!this.handOn || !target) return;
    if (!this.handSmooth) this.handSmooth = { ...target };
    // The tracker already applies a responsive One Euro filter. Keep only a
    // light interpolation layer here so the cursor reaches new samples fast.
    const responseMs = this.pinchControl.isLatched() ? 14 : 12;
    const follow = 1 - Math.exp(-Math.min(50, Math.max(1, deltaMs)) / responseMs);
    this.handSmooth.x = Phaser.Math.Linear(this.handSmooth.x, target.x, follow);
    this.handSmooth.y = Phaser.Math.Linear(this.handSmooth.y, target.y, follow);
    this.updateAimAt(this.handSmooth.x, this.handSmooth.y, true);
    this.handCursor?.setVisible(true)
      .setPosition(this.handSmooth.x, this.handSmooth.y)
      .setStrokeStyle(3, this.handPinching ? 0x4be08a : 0xffffff, this.handPinching ? 1 : 0.82);
  }

  private toast(msg: string): void {
    const t = this.add
      .text(VIEW.width / 2, VIEW.height * 0.16, msg, {
        fontFamily: UI_FONT,
        fontSize: TYPE.body,
        color: '#ffe',
        backgroundColor: 'rgba(20,14,26,0.9)',
        padding: { x: 14, y: 10 },
        align: 'center',
        wordWrap: { width: VIEW.width * 0.8 },
      })
      .setOrigin(0.5)
      .setDepth(40);
    t.setResolution(Phaser.Math.Clamp(window.devicePixelRatio || 1, 1, 2));
    this.tweens.add({ targets: t, alpha: 0, delay: 3200, duration: 600, onComplete: () => t.destroy() });
  }

  private formatClock(): string {
    const source = MODE_DEFS[this.mode].timerSeconds == null ? this.elapsedMs : this.timerMs;
    const seconds = Math.max(0, MODE_DEFS[this.mode].timerSeconds == null ? Math.floor(source / 1000) : Math.ceil(source / 1000));
    const minutes = Math.floor(seconds / 60);
    const remainder = String(seconds % 60).padStart(2, '0');
    return MODE_DEFS[this.mode].timerSeconds == null ? `RUN  ${minutes}:${remainder}` : `TIME  ${minutes}:${remainder}`;
  }

  private updateModeClock(delta: number): void {
    if (!this.running) return;
    if (this.isTutorialActive()) return;
    this.elapsedMs += delta;
    if (MODE_DEFS[this.mode].timerSeconds != null && this.time.now >= this.timerFrozenUntil) {
      this.timerMs = Math.max(0, this.timerMs - delta);
      if (this.timerMs <= 0) {
        if (this.arena) {
          this.awaitArenaResult();
          return;
        }
        SFX.lose();
        this.endCard('TIME EXPIRED', 0xff5a6e);
        return;
      }
    }
    if (this.timerText) {
      this.timerText.setText(this.formatClock());
      const urgent = MODE_DEFS[this.mode].timerSeconds != null && this.timerMs <= 10_000;
      const frozen = this.time.now < this.timerFrozenUntil;
      this.timerText.setColor(frozen ? '#8cffff' : urgent ? '#ff667c' : MODE_DEFS[this.mode].accentCss);
    }
  }

  private updateStatsHud(): void {
    const accuracy = this.shots ? Math.round((this.hits / this.shots) * 100) : 0;
    if (this.hitText) {
      this.hitText.setScale(1).setText(`HITS ${this.hits}  •  ${accuracy}%`);
      fitText(this.hitText, 200, 0.84);
    }
    const projected = Math.round(this.runCoins * MODE_DEFS[this.mode].coinMultiplier * (this.artifact.id === 'fortune' ? 2 : 1));
    if (this.runCoinText) {
      this.runCoinText.setScale(1).setText(`◆  ${projected.toLocaleString()}`);
      fitText(this.runCoinText, 82, 0.84);
    }
    this.updateObjectiveHud();
  }

  private addRunCoins(amount: number): void {
    this.runCoins += Math.max(0, Math.floor(amount));
    this.updateStatsHud();
  }

  private addSuperCharge(amount: number): void {
    const multiplier = this.artifact.id === 'void' ? 1.25 : 1;
    this.superCharge = Phaser.Math.Clamp(this.superCharge + amount * multiplier, 0, 100);
    const ready = this.superCharge >= 100;
    this.superText?.setText(ready ? 'READY' : `${Math.floor(this.superCharge)}%`)
      .setColor(ready ? '#fff1a1' : this.artifact.accentCss);
    this.superBtn?.setAlpha(ready ? 1 : 0.52);
    if (ready && this.superBtn) {
      this.tweens.killTweensOf(this.superBtn);
      if (this.reducedMotion) {
        this.superBtn.setAngle(0).setAlpha(1);
      } else {
        this.tweens.add({ targets: this.superBtn, angle: 4, alpha: 0.78, duration: 520, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
      }
    }
  }

  private claimCoinReward(success: boolean): number {
    if (this.replayTrace) return 0;
    if (this.rewardClaimed) return 0;
    this.rewardClaimed = true;
    const scoreDelta = this.currentLevelScore();
    const base = this.runCoins + Math.floor(scoreDelta / 500) + (success ? 60 + this.level * 8 : 12);
    const modeReward = Math.round(base * MODE_DEFS[this.mode].coinMultiplier);
    const artifactReward = this.artifact.id === 'fortune' ? modeReward * 2 : modeReward;
    if (usesAuthoritativePlatformEconomy()) {
      recordRunStats(this.hits + this.specialHits, success);
    } else {
      addCoins(artifactReward, this.hits + this.specialHits, success);
    }
    if (success) addMysteryKeys(1);
    return usesAuthoritativePlatformEconomy() ? 0 : artifactReward;
  }

  private claimStoryShard(): number {
    if (this.challenge || this.arena || this.replayTrace) return 0;
    const claim = grantInventoryItem('storyShard', 1, 'story', `story-level-${this.level + 1}-shard`);
    if (!claim.ok || claim.duplicate) return 0;
    scheduleOnlineSync();
    return 1;
  }

  private beginClassicAuthority(): void {
    if (this.classicAuthorityStarting || this.classicAuthority || this.classicAuthorityFailed) return;
    const generation = this.runGeneration;
    this.classicAuthorityStarting = true;
    this.serverRewardMessage = 'SERVER RUN AUTHORITY STARTING…';
    void beginClassicRunAuthorityV3({ level: this.level, mode: this.mode }).then((ticket) => {
      if (!this.scene.isActive() || this.runRecorded || generation !== this.runGeneration) return;
      this.classicAuthority = ticket;
      this.classicAuthorityTarget = ticket.target;
      this.classicAuthorityTrace = [];
      this.classicAuthorityStartedAt = Date.now();
      this.classicAuthorityHitsAtStart = this.hits;
      this.serverRewardMessage = `SERVER RUN VERIFIED  •  ${ticket.requiredShots} INPUTS MIN`;
      const targetDegrees = Math.round(ticket.target.angleMilliDegrees / 1_000);
      this.toast(`SERVER RUN READY  •  AIM NEAR ${targetDegrees > 0 ? '+' : ''}${targetDegrees}° ON ONE SHOT`);
    }).catch((error) => {
      if (!this.scene.isActive() || generation !== this.runGeneration) return;
      this.classicAuthorityFailed = true;
      const reason = error instanceof Error ? error.message : 'server-run-unavailable';
      this.serverRewardMessage = reason === 'classic-authority-prerequisite-required'
        ? 'SERVER REWARD LOCKED  •  VERIFY THE PREVIOUS STAGE FIRST'
        : 'SERVER REWARD OFFLINE  •  GAMEPLAY CONTINUES';
      this.toast(this.serverRewardMessage);
    }).finally(() => {
      if (generation === this.runGeneration) this.classicAuthorityStarting = false;
    });
  }

  private recordClassicAuthorityShot(shot: {
    sequence: number;
    atMs: number;
    angleMilliDegrees: number;
  }): void {
    const ticket = this.classicAuthority;
    if (!ticket || this.classicAuthorityFailed) return;
    const generation = this.runGeneration;
    this.classicAuthorityShotPending = true;
    const pending = this.classicAuthorityShotPipeline.then(async () => {
      const receipt = await recordClassicAuthorityShotV3(ticket, shot, this.classicAuthorityAck);
      if (!this.scene.isActive() || generation !== this.runGeneration) return;
      this.classicAuthorityAck = receipt.ack;
      this.classicAuthorityTarget = receipt.nextTarget ?? undefined;
      if (receipt.terminalChallenge) this.classicAuthorityTerminalChallenge = receipt.terminalChallenge;
      if (receipt.completed) {
        this.serverRewardMessage = 'SERVER INPUT PROOF COMPLETE  •  FINISH THE STAGE';
      }
    });
    this.classicAuthorityShotPipeline = pending.catch((error) => {
      if (!this.scene.isActive() || generation !== this.runGeneration) return;
      this.classicAuthorityFailed = true;
      this.classicAuthorityTerminalChallenge = '';
      this.serverRewardMessage = 'SERVER INPUT PROOF LOST  •  RESTART FOR FIRST-CLEAR COINS';
      if (this.scene.isActive()) this.toast(this.serverRewardMessage);
      console.warn('Classic server input proof failed closed.', error);
    }).finally(() => {
      if (generation === this.runGeneration) this.classicAuthorityShotPending = false;
    });
  }

  private recordCompletedRun(won: boolean): void {
    if (this.replayTrace) return;
    if (this.runRecorded) return;
    this.runRecorded = true;
    const accuracy = this.shots ? Math.round((this.hits / this.shots) * 100) : 0;
    const summary = createRunSummary({
      level: this.level,
      mode: this.mode,
      score: this.currentLevelScore(),
      won,
      hits: this.hits,
      misses: this.misses,
      specialHits: this.specialHits,
      maxCombo: this.maxStreak,
      accuracy,
      durationMs: Math.max(0, Date.now() - this.runStartedAt),
      artifact: this.artifact.id,
      challengeId: this.challenge?.id,
      challengeToken: this.challenge?.submissionToken,
      ghost: this.challenge ? this.shotTrace.slice(0, 250) : undefined,
    });
    recordRunSummary(summary);
    if (usesAuthoritativePlatformEconomy() && !this.challenge && !this.arena) {
      this.setServerRewardMessage('SERVER WALLET REWARD VERIFYING…');
      void (async () => {
        await this.classicAuthorityShotPipeline;
        const ticket = this.classicAuthority;
        const terminalChallenge = this.classicAuthorityTerminalChallenge;
        if (!ticket || !terminalChallenge || this.classicAuthorityFailed) {
          this.setServerRewardMessage(won
            ? 'NO SERVER COINS  •  RESTART TO COMPLETE VERIFIED INPUT PROOF'
            : 'NO SERVER COINS  •  STAGE WAS NOT CLEARED');
          return;
        }
        const submission = createClassicRunSubmissionV3({
          runId: ticket.runId,
          level: summary.level,
          mode: summary.mode,
          score: summary.score,
          durationMs: Math.max(summary.durationMs, Date.now() - this.runStartedAt),
          won: summary.won,
          shots: this.classicAuthorityTrace.length,
          hits: Math.min(
            this.classicAuthorityTrace.length,
            Math.max(0, this.hits - this.classicAuthorityHitsAtStart),
          ),
          shotTrace: this.classicAuthorityTrace.map((shot) => ({
            atMs: Math.round(shot.atMs),
            angleMilliDegrees: Math.round(Phaser.Math.Clamp(shot.angle + 90, -30, 30) * 1_000),
          })),
          classicTicketId: ticket.ticketId,
          classicTicketToken: ticket.ticketToken,
          classicTerminalChallenge: terminalChallenge,
          createdAt: summary.createdAt,
        });
        const receipt = await settleClassicRunV3(submission);
        const reward = receipt.reward;
        if (reward?.granted) {
          this.setServerRewardMessage(`◆ +${reward.amount.toLocaleString()} SERVER COINS  •  WALLET ${reward.balance.toLocaleString()}`);
        } else if (reward?.alreadyClaimed) {
          this.setServerRewardMessage('FIRST-CLEAR WALLET REWARD ALREADY CLAIMED');
        } else {
          this.setServerRewardMessage('NO SERVER COINS  •  WIN THIS STAGE FOR ITS FIRST-CLEAR REWARD');
        }
      })().catch(() => this.setServerRewardMessage('SERVER REWARD QUEUED  •  RETRIES AFTER RECONNECT'));
    }
    scheduleOnlineSync();
  }

  private setServerRewardMessage(message: string): void {
    this.serverRewardMessage = message;
    if (!this.scene.isActive() || !this.serverRewardText) return;
    this.serverRewardText.setText(message);
    fitText(this.serverRewardText, 520, 0.72);
  }

  /** Preserve deterministic challenge/replay inputs across a local retry. */
  private restartRunData(): {
    level: number;
    score: number;
    mode: GameMode;
    challenge?: ChallengeDef;
    ghost?: GhostShot[];
    tutorialReplay?: boolean;
  } {
    return {
      level: this.level,
      score: this.levelStartScore,
      mode: this.mode,
      ...(this.challenge ? { challenge: this.challenge } : {}),
      ...(this.replayTrace ? { ghost: this.replayTrace.slice() } : {}),
      ...(this.tutorialReplayRequested ? { tutorialReplay: true } : {}),
    };
  }

  // ── helpers ────────────────────────────────────────────────────────
  private scaleFor(): number {
    const frame = this.textures.getFrame(orbTexture(this.skinId, 'red'));
    const visualWidth = (frame?.width || 256) * getOrbSkin(this.skinId).visualFill;
    return (this.geom.radius * 2) / visualWidth;
  }

  private makeSprite(color: ColorKey, x: number, y: number): Phaser.GameObjects.Sprite {
    const texture = orbTexture(this.skinId, color);
    const s = ATLAS_KEY
      ? this.add.sprite(x, y, ATLAS_KEY, texture)
      : this.add.sprite(x, y, texture);
    s.setScale(this.scaleFor());
    return s;
  }

  private pulse(s: Phaser.GameObjects.Sprite): void {
    if (this.reducedMotion) return;
    const baseScale = this.scaleFor();
    this.tweens.add({
      targets: s,
      scaleX: baseScale * 1.018,
      scaleY: baseScale * 1.018,
      alpha: 0.96,
      duration: 1150,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });
  }

  private randColor(): ColorKey {
    const present = new Set(this.bubbles.filter((b) => b.active).map((b) => b.color));
    const pool = present.size ? this.palette.filter((c) => present.has(c)) : this.palette;
    const from = pool.length ? pool : this.palette;
    return from[(this.rng() * from.length) | 0];
  }

  private activeBoardColors(): ColorKey[] {
    const present = new Set(this.bubbles.filter((bubble) => bubble.active).map((bubble) => bubble.color));
    const active = this.palette.filter((color) => present.has(color));
    return active.length ? active : [...this.palette];
  }

  private replayColorAt(index: number): ColorKey | undefined {
    const color = this.replayTrace?.[index]?.color;
    return COLOR_KEYS.includes(color as ColorKey) ? color as ColorKey : undefined;
  }

  private initializeShotQueue(): void {
    const active = this.activeBoardColors();
    if (!this.challenge && !this.arena) {
      this.shotQueue = createCampaignShotQueue({ level: this.level, mode: this.mode }, active);
    } else {
      const authoritySeed = this.challenge?.seed ?? this.arena?.seed ?? 0;
      this.shotQueue = createShotQueue((authoritySeed ^ 0x51f15e5d) >>> 0, active);
    }
    if (this.replayTrace?.length) {
      this.shotQueue = {
        ...this.shotQueue,
        current: this.replayColorAt(0) ?? this.shotQueue.current,
        next: this.replayColorAt(1) ?? this.shotQueue.next,
      };
    }
    if (this.isTutorialActive()) {
      this.shotQueue = preloadShotQueue(
        this.shotQueue,
        LEVEL_ZERO_TUTORIAL_FIXTURE.initialQueue,
      );
    }
  }

  private currentQueueColor(): ColorKey {
    return this.replayColorAt(this.replayQueueIndex) ?? this.shotQueue?.current ?? this.randColor();
  }

  private nextQueueColor(): ColorKey {
    return this.replayColorAt(this.replayQueueIndex + 1) ?? this.shotQueue?.next ?? this.randColor();
  }

  private canSwapPreShotOrbs(): boolean {
    return !this.challenge && !this.arena && !this.replayTrace;
  }

  private reconcilePreShotQueueWithBoard(): void {
    if (!this.shotQueue || this.flying || this.replayTrace) return;
    this.shotQueue = reconcileShotQueue(this.shotQueue, this.activeBoardColors());
    this.loaded = this.shotQueue.current;
    if (this.loadedSprite?.active) this.setOrbTexture(this.loadedSprite, this.loaded);
    this.updateQueueHud();
  }

  private setOrbTexture(sprite: Phaser.GameObjects.Sprite, color: ColorKey): void {
    const texture = orbTexture(this.skinId, color);
    if (ATLAS_KEY) sprite.setTexture(ATLAS_KEY, texture);
    else sprite.setTexture(texture);
  }

  private updateQueueHud(): void {
    if (this.nextOrbSprite) {
      this.setOrbTexture(this.nextOrbSprite, this.nextQueueColor());
      this.nextOrbSprite.setAlpha(this.flying ? 0.72 : 1);
    }
    if (!this.queueActionText) return;
    const tutorialStep = this.isTutorialActive()
      ? this.tutorialMachine?.snapshot().currentStep
      : null;
    if (tutorialStep === 'next-orb') {
      this.queueActionText.setText('TAP TO VIEW').setColor('#8ff6ff');
    } else if (tutorialStep === 'swap') {
      this.queueActionText.setText('TAP TO SWAP').setColor('#ffe08a');
    } else if (tutorialStep) {
      this.queueActionText.setText('WAIT').setColor('#92a2b8');
    } else if (!this.canSwapPreShotOrbs()) {
      this.queueActionText.setText('LOCKED').setColor('#92a2b8');
    } else if (this.flying) {
      this.queueActionText.setText('IN FLIGHT').setColor('#92a2b8');
    } else if (this.shotQueue?.swappedThisShot) {
      this.queueActionText.setText('SWAP USED').setColor('#ffbd7a');
    } else {
      this.queueActionText.setText('TAP SWAP').setColor('#ffe08a');
    }
    fitText(this.queueActionText, 78, 0.72);
  }

  private handleQueueCardPressed(): void {
    const step = this.isTutorialActive()
      ? this.tutorialMachine?.snapshot().currentStep
      : null;
    if (step === 'next-orb') {
      const accepted = this.dispatchTutorial({
        type: 'next-orb-viewed',
        visible: true,
        currentColor: this.loaded,
        nextColor: this.nextQueueColor(),
      });
      if (accepted) {
        SFX.click();
        this.tweens.add({
          targets: this.nextOrbSprite,
          scale: this.scaleFor() * 0.64,
          duration: 110,
          yoyo: true,
          ease: 'Back.easeOut',
        });
      }
      return;
    }
    if (step === 'swap') {
      const beforeCurrent = this.loaded;
      const beforeNext = this.nextQueueColor();
      this.swapPreShotOrbs();
      this.dispatchTutorial({
        type: 'orb-swapped',
        beforeCurrent,
        beforeNext,
        afterCurrent: this.loaded,
        afterNext: this.nextQueueColor(),
      });
      return;
    }
    if (step) {
      this.toast(this.tutorialMachine?.snapshot().currentPrompt?.instruction ?? 'FOLLOW THE TRAINING GUIDE');
      return;
    }
    this.swapPreShotOrbs();
  }

  private swapPreShotOrbs(): void {
    if (!this.running || this.flying || this.powerUsePending || !this.shotQueue) return;
    if (!this.canSwapPreShotOrbs()) {
      this.toast('NEXT ORB PREVIEW  •  SWAP IS LOCKED IN VERIFIED RUNS');
      return;
    }
    const result = swapShotQueue(this.shotQueue, this.activeBoardColors());
    this.shotQueue = result.state;
    if (!result.applied) {
      this.toast('ONE SAFE SWAP PER SHOT  •  FIRE TO RECHARGE');
      this.updateQueueHud();
      return;
    }
    this.loaded = this.shotQueue.current;
    this.setOrbTexture(this.loadedSprite, this.loaded);
    this.updateQueueHud();
    SFX.click();
    this.tweens.add({
      targets: [this.loadedSprite, this.nextOrbSprite],
      scaleX: (target: Phaser.GameObjects.Sprite) => target === this.loadedSprite
        ? this.scaleFor() * 1.12
        : this.scaleFor() * 0.62,
      scaleY: (target: Phaser.GameObjects.Sprite) => target === this.loadedSprite
        ? this.scaleFor() * 1.12
        : this.scaleFor() * 0.62,
      duration: 95,
      yoyo: true,
      ease: 'Quad.easeOut',
    });
  }

  private buildGrid(
    rows: number,
    authoredGrid?: readonly (readonly (ColorKey | null)[])[],
  ): void {
    for (let r = 0; r < rows; r++) {
      const n = colsInRow(this.geom, r);
      for (let c = 0; c < n; c++) {
        const authoredColor = authoredGrid?.[r]?.[c];
        if (authoredColor === null) continue;
        const color = authoredColor ?? this.palette[(this.rng() * this.palette.length) | 0];
        const p = cellPos(this.geom, r, c, this.offsetY);
        const sprite = this.makeSprite(color, p.x, p.y).setDepth(4);
        const finalScale = this.scaleFor();
        if (this.reducedMotion) {
          sprite.setScale(finalScale).setAlpha(1).setAngle(0);
        } else {
          sprite.setScale(finalScale * 0.15).setAlpha(0).setAngle(Phaser.Math.FloatBetween(-4, 4));
          this.tweens.add({
            targets: sprite,
            scale: finalScale,
            alpha: 1,
            angle: 0,
            delay: r * 48 + c * 18,
            duration: 360,
            ease: 'Back.easeOut',
            onComplete: () => {
              if (!sprite.active || !this.quality.parallax) return;
              this.tweens.add({
                targets: sprite,
                angle: Phaser.Math.FloatBetween(-1.15, 1.15),
                scaleX: finalScale * 1.014,
                scaleY: finalScale * 0.986,
                duration: Phaser.Math.Between(1900, 3100),
                yoyo: true,
                repeat: -1,
                ease: 'Sine.easeInOut',
              });
            },
          });
        }
        this.bubbles.push({ id: this.idc++, row: r, col: c, color, sprite, active: true });
      }
    }
  }

  private toCells(): Cell[] {
    return this.bubbles.map((b) => ({
      id: b.id,
      row: b.row,
      col: b.col,
      color: b.color,
      active: b.active,
      x: b.sprite.x,
      y: b.sprite.y,
    }));
  }

  // ── aim + shoot ────────────────────────────────────────────────────
  private aimVectorXY(x: number, y: number): { x: number; y: number } {
    return clampedUpwardAimVector(this.shooter.x, this.shooter.y, x, y, 30, 12);
  }

  private muzzlePosition(): { x: number; y: number } {
    const angle = Phaser.Math.DegToRad(this.launcher?.angle ?? 0);
    const barrelLength = 111;
    return {
      x: (this.launcher?.x ?? this.shooter.x) + Math.sin(angle) * barrelLength,
      y: (this.launcher?.y ?? this.launcherPivotY) - Math.cos(angle) * barrelLength,
    };
  }

  private tutorialTargetPoint(): { x: number; y: number } {
    const target = LEVEL_ZERO_TUTORIAL_FIXTURE.guaranteedShot.target;
    return cellPos(this.geom, target.row, target.col, this.offsetY);
  }

  private observeTutorialAim(direction: { x: number; y: number }): void {
    if (!this.isTutorialActive() || this.tutorialMachine?.snapshot().currentStep !== 'aim') return;
    const targetPoint = this.tutorialTargetPoint();
    const expected = this.aimVectorXY(targetPoint.x, targetPoint.y);
    const actualAngle = Phaser.Math.RadToDeg(Math.atan2(direction.x, -direction.y));
    const expectedAngle = Phaser.Math.RadToDeg(Math.atan2(expected.x, -expected.y));
    const angularErrorDegrees = Math.abs(Phaser.Math.Angle.WrapDegrees(actualAngle - expectedAngle));
    this.dispatchTutorial({
      type: 'aim-targeted',
      target: LEVEL_ZERO_TUTORIAL_FIXTURE.guaranteedShot.target,
      angularErrorDegrees,
    });
  }

  private updateAimAt(x: number, y: number, handInput = false): void {
    if (this.flying || this.powerUsePending || !this.running) return;
    // Predicted hand motion is allowed to move the launcher and cursor only.
    // Pointer input and a measured, latched hand aim may update gameplay state.
    if (!handInput || this.handLockedAim) this.lastAim = { x, y };
    const d = this.aimVectorXY(x, y);
    this.observeTutorialAim(d);
    const rawAngle = Phaser.Math.RadToDeg(Math.atan2(d.y, d.x)) + 90;
    const targetAngle = Phaser.Math.Clamp(rawAngle, -30, 30);
    // Camera aim is already adaptively filtered and interpolated above. A
    // third fixed lerp made the launcher trail the fingertip by 40–80ms.
    this.launcher.angle = handInput
      ? targetAngle
      : Phaser.Math.Linear(this.launcher.angle, targetAngle, 0.34);
    const muzzle = this.muzzlePosition();
    this.loadedSprite.setPosition(muzzle.x, muzzle.y);
    this.launcherFocus.setPosition(muzzle.x, muzzle.y).setAngle(this.launcher.angle * 0.16);
    this.aimGfx.clear();
    this.aimGfx.fillStyle(0x9cf8ff, 0.66);
    let px = muzzle.x;
    let py = muzzle.y;
    let sx = d.x;
    let sy = d.y;
    const step = this.geom.radius * 0.9;
    const r = this.geom.radius;
    for (let i = 0; i < 46; i++) {
      px += sx * step;
      py += sy * step;
      if (px < r) {
        px = r;
        sx = -sx;
      }
      if (px > VIEW.width - r) {
        px = VIEW.width - r;
        sx = -sx;
      }
      if (py < this.geom.topPad + this.offsetY) break;
      if (i % 2 === 0) this.aimGfx.fillCircle(px, py, 3.5);
    }
  }

  private nudgeKeyboardAim(deltaDegrees: number): void {
    const angle = Phaser.Math.Clamp(this.launcher.angle + deltaDegrees, -30, 30);
    const radians = Phaser.Math.DegToRad(angle - 90);
    const distance = 620;
    const x = this.shooter.x + Math.cos(radians) * distance;
    const y = this.shooter.y + Math.sin(radians) * distance;
    this.updateAimAt(x, y);
  }

  private shootAt(x: number, y: number): void {
    if (this.flying || this.powerUsePending || !this.running) return;
    if (!this.replayTrace) this.reconcilePreShotQueueWithBoard();
    if (this.isTutorialActive() && !this.tutorialMachine?.canPerform('fire')) {
      this.toast(this.tutorialMachine?.snapshot().currentPrompt?.instruction ?? 'COMPLETE THE CURRENT TRAINING STEP');
      return;
    }
    if (usesAuthoritativePlatformEconomy() && !this.challenge && !this.arena && !this.replayTrace) {
      if (this.classicAuthorityStarting) {
        this.toast('SERVER RUN AUTHORITY STARTING  •  ONE MOMENT');
        return;
      }
      if (this.classicAuthority && this.classicAuthorityShotPending) {
        this.toast('SERVER INPUT RECEIPT VERIFYING  •  ONE MOMENT');
        return;
      }
      if (this.classicAuthority && this.classicAuthorityTrace.length === 0
        && Date.now() - this.classicAuthorityStartedAt < 140) {
        this.toast('SERVER AIM CALIBRATING  •  HOLD FOR A MOMENT');
        return;
      }
    }
    const tutorialTarget = this.isTutorialActive() ? this.tutorialTargetPoint() : null;
    const d = this.aimVectorXY(tutorialTarget?.x ?? x, tutorialTarget?.y ?? y);
    const authorityAngleMilliDegrees = Math.round(Phaser.Math.Clamp(
      Phaser.Math.RadToDeg(Math.atan2(d.y, d.x)) + 90,
      -30,
      30,
    ) * 1_000);
    if (this.arena) {
      const atMs = Math.round(this.arenaElapsedMs());
      const minimumInterval = this.arenaInputSeq === 0
        ? ARENA_REPLAY_RULES.minimumFirstShotMs
        : ARENA_REPLAY_RULES.minimumShotIntervalMs;
      const elapsedSinceLast = atMs - this.arenaLastSubmittedAtMs;
      if (elapsedSinceLast < minimumInterval) {
        this.toast(`ARENA AIM SETTLING  •  ${minimumInterval - elapsedSinceLast}ms`);
        return;
      }
      if (elapsedSinceLast > ARENA_REPLAY_RULES.maximumShotIntervalMs) {
        this.toast('ARENA INPUT WINDOW EXPIRED  •  LOCKING VERIFIED SCORE');
        this.awaitArenaResult();
        return;
      }
      const seq = this.arenaInputSeq + 1;
      this.arenaConnection?.send({
        type: 'input', matchId: this.arena.matchId, seq, atMs, angleMilliDegrees: authorityAngleMilliDegrees,
      });
      this.arenaInputSeq = seq;
      this.arenaLastSubmittedAtMs = atMs;
    }
    if (this.isTutorialActive()) {
      const accepted = this.dispatchTutorial({
        type: 'shot-fired',
        fixtureId: LEVEL_ZERO_TUTORIAL_FIXTURE.id,
        color: this.loaded,
        target: LEVEL_ZERO_TUTORIAL_FIXTURE.guaranteedShot.target,
      });
      if (!accepted) {
        this.toast('SWAP TO RED AND AIM AT THE GOLD GUIDE BEFORE FIRING');
        return;
      }
      this.tutorialShotPending = true;
    }
    this.pinchControl.resetForShot();
    this.handLockedAim = null;
    this.handPinching = false;
    this.shots++;
    this.shotBounces = 0;
    this.portalTeleportedThisShot = false;
    this.updateStatsHud();
    const traceAtMs = Math.max(0, Date.now() - this.runStartedAt);
    this.shotTrace.push({
      atMs: traceAtMs,
      angle: Math.round(Phaser.Math.RadToDeg(Math.atan2(d.y, d.x)) * 100) / 100,
      color: this.loaded,
    });
    if (this.classicAuthority && !this.classicAuthorityFailed && !this.challenge && !this.arena && !this.replayTrace) {
      const authorityTraceAtMs = Math.max(0, Date.now() - this.classicAuthorityStartedAt);
      this.classicAuthorityTrace.push({
        atMs: authorityTraceAtMs,
        angle: Math.round(Phaser.Math.RadToDeg(Math.atan2(d.y, d.x)) * 100) / 100,
        color: this.loaded,
      });
      this.recordClassicAuthorityShot({
        sequence: this.classicAuthorityTrace.length - 1,
        atMs: Math.round(authorityTraceAtMs),
        angleMilliDegrees: authorityAngleMilliDegrees,
      });
    }
    // Keep projectile travel independent of render FPS. The old per-frame
    // velocity made shots crawl on throttled mobile/in-app browsers.
    const speed = 920;
    this.vel = { x: d.x * speed, y: d.y * speed };
    this.flying = true;
    this.updateQueueHud();
    SFX.shoot();
    this.tweens.killTweensOf(this.loadedSprite);
    this.loadedSprite.setScale(this.scaleFor()).setAlpha(1).setAngle(0);
    this.ballSprite = this.loadedSprite;
    this.aimGfx.clear();
    // Art-synced recoil, muzzle energy and projectile squash.
    this.tweens.killTweensOf(this.launcher);
    this.tweens.add({
      targets: this.launcher,
      y: this.launcherPivotY + 12,
      duration: 70,
      yoyo: true,
      ease: 'Quad.easeOut',
    });
    const muzzle = this.muzzlePosition();
    const flash = this.add.circle(muzzle.x, muzzle.y, 28, 0xc9fbff, 0.95)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(6);
    this.tweens.add({
      targets: flash,
      scale: 2.2,
      alpha: 0,
      duration: 180,
      ease: 'Quad.easeOut',
      onComplete: () => flash.destroy(),
    });
    const sparks = this.add.particles(muzzle.x, muzzle.y, 'spark', {
      speed: { min: 70, max: 210 },
      angle: { min: Phaser.Math.RadToDeg(Math.atan2(d.y, d.x)) - 22, max: Phaser.Math.RadToDeg(Math.atan2(d.y, d.x)) + 22 },
      scale: { start: 0.38, end: 0 },
      lifespan: 260,
      tint: 0x78efff,
      blendMode: 'ADD',
      emitting: false,
    });
    sparks.explode(Math.max(4, Math.round(10 * this.quality.particles)));
    this.time.delayedCall(320, () => sparks.destroy());
    this.tweens.add({ targets: this.ballSprite, scale: this.scaleFor() * 0.86, duration: 60, yoyo: true });
  }

  private startGhostReplay(): void {
    const trace = this.replayTrace ?? [];
    this.input.enabled = false;
    this.time.delayedCall(350, () => this.toast(`GHOST REPLAY  •  ${trace.length} RECORDED SHOTS`));
    const playSequentially = (index: number, delayMs: number): void => {
      this.time.delayedCall(delayMs, () => {
        if (!this.scene.isActive() || this.terminalLatch.isEntered() || index >= trace.length) return;
        if (!this.running || this.flying || this.replayQueueIndex !== index) {
          playSequentially(index, 32);
          return;
        }
        const shot = trace[index];
        const radians = Phaser.Math.DegToRad(shot.angle);
        const distance = 620;
        this.updateAimAt(this.shooter.x + Math.cos(radians) * distance, this.shooter.y + Math.sin(radians) * distance);
        this.shootAt(this.shooter.x + Math.cos(radians) * distance, this.shooter.y + Math.sin(radians) * distance);
        if (!this.flying) {
          playSequentially(index, 32);
          return;
        }
        const next = trace[index + 1];
        if (next) {
          playSequentially(
            index + 1,
            Math.min(GHOST_REPLAY_MAX_DELAY_MS, Math.max(100, next.atMs - shot.atMs)),
          );
        }
      });
    };
    const first = trace[0];
    if (first) {
      playSequentially(
        0,
        Math.min(GHOST_REPLAY_MAX_DELAY_MS, Math.max(400, first.atMs + 400)),
      );
    }
  }

  private refreshPowerButtons(): void {
    this.bombCountText?.setText(`×${this.powerUps.bomb}`);
    this.rainbowCountText?.setText(`×${this.powerUps.rainbow}`);
    this.bombBtn?.setAlpha(this.powerUps.bomb ? 1 : 0.35);
    this.rainbowBtn?.setAlpha(this.powerUps.rainbow ? 1 : 0.35);
    this.bombCountText?.setAlpha(this.powerUps.bomb ? 1 : 0.35);
    this.rainbowCountText?.setAlpha(this.powerUps.rainbow ? 1 : 0.35);
  }

  private async usePowerUp(kind: PowerUp): Promise<void> {
    if (!this.running || this.flying || this.powerUsePending || this.powerUps[kind] < 1) return;
    if (this.isTutorialActive()) {
      this.toast('COMPLETE TRAINING BEFORE USING SUPPLIES');
      return;
    }
    const active = this.bubbles.filter((b) => b.active);
    const bombAnchor = active.reduce<Bub | undefined>((closest, bubble) => {
      if (!closest) return bubble;
      const current = Phaser.Math.Distance.Between(bubble.sprite.x, bubble.sprite.y, this.lastAim.x, this.lastAim.y);
      const best = Phaser.Math.Distance.Between(closest.sprite.x, closest.sprite.y, this.lastAim.x, this.lastAim.y);
      return current < best ? bubble : closest;
    }, undefined);
    const fxPoint = kind === 'bomb' && bombAnchor
      ? { x: bombAnchor.sprite.x, y: bombAnchor.sprite.y }
      : { x: VIEW.width / 2, y: VIEW.height * 0.46 };
    const targets = kind === 'bomb'
      ? active.filter((b) => Phaser.Math.Distance.Between(b.sprite.x, b.sprite.y, fxPoint.x, fxPoint.y) < this.geom.cellW * 2.25)
      : active.filter((b) => b.color === this.loaded);
    const fallback = active.find((bubble) => this.isSpecialRemovable(bubble));
    const affected = (targets.length ? targets : (fallback ? [fallback] : []))
      .filter((bubble) => this.isSpecialRemovable(bubble));
    if (!affected.length) {
      this.toast('NO VALID TARGETS  •  SUPPLY NOT USED');
      return;
    }
    this.powerUsePending = true;
    let inventoryAfter = getInventory();
    try {
      const account = await getPlatformAccount();
      if (!this.scene.isActive() || !this.running || this.flying) return;
      if (account) {
        inventoryAfter = (await consumeInventoryV2(kind, 1)).local;
      } else if (hasPlatformAccountBinding()) {
        this.toast('SERVER INVENTORY OFFLINE  •  SUPPLY WAS NOT USED');
        return;
      } else {
        const consumed = consumeInventoryItem(kind);
        inventoryAfter = consumed.inventory;
        if (!consumed.ok) {
          this.toast('SUPPLY VAULT EMPTY  •  VISIT THE STORE');
          return;
        }
      }
      if (!this.scene.isActive() || !this.running || this.flying) return;
    } catch (error) {
      if (this.scene.isActive()) this.toast(error instanceof Error && error.message === 'inventory-insufficient'
        ? 'SUPPLY VAULT EMPTY  •  VISIT THE STORE'
        : 'SERVER INVENTORY CHECK FAILED  •  SUPPLY WAS NOT USED');
      return;
    } finally {
      this.powerUsePending = false;
    }
    this.powerUps = {
      bomb: inventoryAfter.balances.bomb,
      rainbow: inventoryAfter.balances.rainbow,
    };
    this.refreshPowerButtons();
    scheduleOnlineSync();
    const powerFx = this.add.image(fxPoint.x, fxPoint.y, kind === 'bomb' ? 'power_bomb' : 'power_rainbow')
      .setDisplaySize(150, 150).setDepth(25).setAlpha(0.95);
    const powerScaleX = powerFx.scaleX;
    const powerScaleY = powerFx.scaleY;
    powerFx.setScale(powerScaleX * 0.2, powerScaleY * 0.2);
    const powerRing = this.add.circle(fxPoint.x, fxPoint.y, 38, 0x000000, 0)
      .setStrokeStyle(5, kind === 'bomb' ? 0x71ecff : 0xffe58b, 0.9)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(24);
    this.tweens.add({
      targets: powerRing,
      scale: 3.1,
      alpha: 0,
      duration: 560,
      ease: 'Quad.easeOut',
      onComplete: () => powerRing.destroy(),
    });
    this.tweens.add({
      targets: powerFx,
      scaleX: powerScaleX * 1.2,
      scaleY: powerScaleY * 1.2,
      alpha: 0,
      angle: kind === 'bomb' ? 24 : 180,
      duration: 520,
      ease: 'Back.easeOut',
      onComplete: () => powerFx.destroy(),
    });
    const powerSparks = this.add.particles(fxPoint.x, fxPoint.y, 'spark', {
      speed: { min: 80, max: 300 },
      scale: { start: kind === 'bomb' ? 0.5 : 0.42, end: 0 },
      lifespan: { min: 340, max: 620 },
      tint: kind === 'bomb' ? [0x7d6cff, 0x66f4ff, 0xffd36b] : [0xff526d, 0xffd84d, 0x4fe48a, 0x4db8ff, 0xb46bff],
      blendMode: 'ADD',
      emitting: false,
    });
    powerSparks.explode(Math.max(10, Math.round((kind === 'bomb' ? 26 : 32) * this.quality.particles)));
    this.time.delayedCall(700, () => powerSparks.destroy());
    for (const b of affected) {
      this.commitSpecialMechanicRemoval(b);
      b.active = false;
      this.pop(b);
    }
    const fell = this.dropDetached();
    const rawGain = affected.length * (kind === 'bomb' ? 90 : 75);
    const fallGain = fell.length * 40;
    const gained = Math.round((rawGain + fallGain) * (this.artifact.id === 'phoenix' ? 1.1 : 1));
    this.score += Math.round(gained * this.scoreMultiplier);
    this.scoreText.setText(this.visibleScore().toLocaleString());
    if (affected.length) {
      this.specialHits++;
      this.addRunCoins(Math.max(3, affected.length * 2 + fell.length));
      this.addSuperCharge(8);
      this.popupScore(gained, fxPoint.x, fxPoint.y);
      SFX.pop(this.combo + 1);
      if (!this.reducedMotion) {
        this.cameras.main.flash(140, kind === 'bomb' ? 255 : 160, kind === 'bomb' ? 150 : 220, 255, false);
      }
    }
    if (fell.length) SFX.drop();
    this.applyBossDamageEvent({ bomb: kind === 'bomb' && affected.length > 0, floaters: fell.length });
    this.updateStatsHud();
    this.bubbles = this.bubbles.filter((b) => b.active || b.sprite.active);
    this.reconcilePreShotQueueWithBoard();
    this.checkBoardState();
  }

  private useArtifactSuper(): void {
    if (!this.running || this.flying) return;
    if (this.isTutorialActive()) {
      this.toast('COMPLETE TRAINING BEFORE USING ARTIFACT POWERS');
      return;
    }
    if (this.superCharge < 100) {
      this.toast(`${this.artifact.superName}  •  ${Math.floor(this.superCharge)}% CHARGED`);
      return;
    }
    this.superCharge = 0;
    if (this.superBtn) {
      this.tweens.killTweensOf(this.superBtn);
      this.superBtn.setAngle(0).setAlpha(0.52);
    }
    this.superText?.setText('0%').setColor(this.artifact.accentCss);

    const active = this.bubbles.filter((bubble) => bubble.active);
    let targets: Bub[] = [];
    let bonusScore = 0;
    if (this.artifact.id === 'chrono') {
      if (MODE_DEFS[this.mode].timerSeconds != null) {
        this.timerMs += 15_000;
        this.timerFrozenUntil = this.time.now + 3000;
        this.toast('TIME WARP  •  CLOCK FROZEN  •  +15 SECONDS');
      } else {
        bonusScore = 500;
        this.addRunCoins(18);
        this.toast('TIME WARP  •  +500 SCORE');
      }
    } else if (this.artifact.id === 'phoenix') {
      const rows = Array.from(new Set(active.map((bubble) => bubble.row))).sort((a, b) => b - a).slice(0, 2);
      targets = active.filter((bubble) => rows.includes(bubble.row));
      this.toast('PHOENIX SWEEP  •  LOWEST ROWS PURIFIED');
    } else if (this.artifact.id === 'void') {
      targets = active.filter((bubble) => bubble.color === this.loaded);
      if (!targets.length && active.length) targets = [active[0]];
      this.toast(`PRISM SEEK  •  ${COLORS[this.loaded].name.toUpperCase()} ORBS ERASED`);
    } else {
      targets = Phaser.Utils.Array.Shuffle([...active]).slice(0, 6);
      this.addRunCoins(35);
      bonusScore = 300;
      this.toast('GOLDEN RAIN  •  BONUS COINS SUMMONED');
    }
    targets = targets.filter((bubble) => this.isSpecialRemovable(bubble));

    const fx = this.add.image(VIEW.width / 2, VIEW.height * 0.47, this.artifact.texture)
      .setDisplaySize(210, 210).setDepth(27).setAlpha(0.96);
    const fxScaleX = fx.scaleX;
    const fxScaleY = fx.scaleY;
    fx.setScale(fxScaleX * 0.2, fxScaleY * 0.2);
    const ring = this.add.circle(fx.x, fx.y, 52, 0x000000, 0)
      .setStrokeStyle(6, this.artifact.accent, 0.94).setBlendMode(Phaser.BlendModes.ADD).setDepth(26);
    this.tweens.add({ targets: ring, scale: 4, alpha: 0, duration: 720, ease: 'Quad.easeOut', onComplete: () => ring.destroy() });
    this.tweens.add({
      targets: fx,
      scaleX: fxScaleX * 1.25,
      scaleY: fxScaleY * 1.25,
      angle: this.artifact.id === 'void' ? 180 : 18,
      alpha: 0,
      duration: 760,
      ease: 'Back.easeOut',
      onComplete: () => fx.destroy(),
    });
    const sparks = this.add.particles(fx.x, fx.y, 'spark', {
      speed: { min: 100, max: 360 },
      scale: { start: 0.55, end: 0 },
      lifespan: { min: 360, max: 760 },
      tint: [this.artifact.accent, 0xffdf7a, 0xe9ffff],
      blendMode: 'ADD',
      emitting: false,
    });
    sparks.explode(Math.max(12, Math.round(34 * this.quality.particles)));
    this.time.delayedCall(850, () => sparks.destroy());

    for (const bubble of targets) {
      this.commitSpecialMechanicRemoval(bubble);
      bubble.active = false;
      this.pop(bubble);
    }
    const fell = this.dropDetached();
    this.specialHits++;
    bonusScore += targets.length * 115 + fell.length * 40;
    if (this.artifact.id === 'phoenix') bonusScore = Math.round(bonusScore * 1.1);
    this.score += Math.round(bonusScore * this.scoreMultiplier);
    if (targets.length) this.addRunCoins(Math.max(4, targets.length * 2 + fell.length));
    this.scoreText.setText(this.visibleScore().toLocaleString());
    this.bubbles = this.bubbles.filter((bubble) => bubble.active || bubble.sprite.active);
    this.reconcilePreShotQueueWithBoard();
    this.updateStatsHud();
    SFX.pop(Math.max(1, this.combo + 2));
    if (fell.length) SFX.drop();
    this.applyBossDamageEvent({ artifactSuper: true, floaters: fell.length });
    if (!this.reducedMotion) this.cameras.main.flash(190, 170, 220, 255, false);
    this.checkBoardState();
  }

  update(_time: number, delta: number): void {
    this.updateModeClock(delta);
    if (!this.running) return;
    if (this.visionMode === 'hand') {
      this.pollHand();
    } else {
      this.pollGaze();
      if (this.visionMode === 'gaze-hand') this.pollHybridHand();
    }
    this.advanceHandAim(delta);
    if (!this.flying || !this.ballSprite) return;
    const r = this.geom.radius;
    const frameSeconds = Math.min(delta, 320) / 1000;
    const distance = Math.hypot(this.vel.x, this.vel.y) * frameSeconds;
    const steps = Math.max(3, Math.ceil(distance / Math.max(8, r * 0.55)));
    for (let s = 0; s < steps; s++) {
      this.ballSprite.x += (this.vel.x * frameSeconds) / steps;
      this.ballSprite.y += (this.vel.y * frameSeconds) / steps;

      if (this.ballSprite.x < r) {
        this.ballSprite.x = r;
        this.vel.x *= -1;
        this.shotBounces++;
      }
      if (this.ballSprite.x > VIEW.width - r) {
        this.ballSprite.x = VIEW.width - r;
        this.vel.x *= -1;
        this.shotBounces++;
      }
      if (this.tryPortalTeleport()) continue;
      if (this.ballSprite.y <= this.geom.topPad + this.offsetY) {
        this.land();
        return;
      }
      for (const b of this.bubbles) {
        if (!b.active) continue;
        const d = Phaser.Math.Distance.Between(b.sprite.x, b.sprite.y, this.ballSprite.x, this.ballSprite.y);
        if (d < r * 1.9) {
          this.land();
          return;
        }
      }
      if (this.ballSprite.y > VIEW.height + r) {
        this.missReset();
        return;
      }
    }
  }

  // ── landing + resolution ───────────────────────────────────────────
  private snap(bx: number, by: number): { row: number; col: number } {
    return nearestFreeHexCell(
      this.geom,
      bx,
      by,
      this.bubbles.filter((bubble) => bubble.active).map(({ row, col }) => ({ row, col })),
      this.offsetY,
    );
  }

  private land(): void {
    if (!this.ballSprite) return;
    this.flying = false;
    const cell = this.tutorialShotPending
      ? { ...LEVEL_ZERO_TUTORIAL_FIXTURE.guaranteedShot.target }
      : this.snap(this.ballSprite.x, this.ballSprite.y);
    const p = cellPos(this.geom, cell.row, cell.col, this.offsetY);
    const placed: Bub = {
      id: this.idc++,
      row: cell.row,
      col: cell.col,
      color: this.loaded,
      sprite: this.ballSprite,
      active: true,
    };
    placed.sprite.setPosition(p.x, p.y);
    this.bubbles.push(placed);
    this.ballSprite = undefined;

    // squash-on-land juice
    this.tweens.add({
      targets: placed.sprite,
      scaleX: this.scaleFor() * 1.18,
      scaleY: this.scaleFor() * 0.82,
      duration: 90,
      yoyo: true,
      ease: 'Quad.easeOut',
    });

    this.resolve(placed);
    if (this.running) this.loadNext();
  }

  private resolve(placed: Bub): void {
    const cells = this.toCells();
    const start = cells.find((c) => c.id === placed.id);
    if (!start) return;

    const cluster = clusterOf(start, cells, this.geom.cellW);
    const matched = cluster.length >= 3;
    let fell: Bub[] = [];
    if (matched) {
      this.combo++;
      this.hits++;
      this.streak++;
      this.maxStreak = Math.max(this.maxStreak, this.streak);
      SFX.pop(this.combo);
      const bankBonus = Math.min(2, this.shotBounces) * 170;
      const baseGain = cluster.length * 100 * (1 + this.combo * 0.15) + bankBonus;
      const gained = Math.floor(baseGain * (this.artifact.id === 'phoenix' ? 1.1 : 1));
      this.score += Math.round(gained * this.scoreMultiplier);
      const hitCallout = this.shotBounces > 0
        ? `BANK SHOT ×${Math.min(2, this.shotBounces)}  •  +${bankBonus}`
        : this.mode === 'rush'
          ? `${this.combo > 1 ? `COMBO ×${this.combo}` : 'MATCH!'}  •  +TIME`
          : this.combo > 1 ? `COMBO ×${this.combo}` : 'MATCH!';
      this.objectiveText?.setVisible(false);
      this.objectiveProgressText?.setVisible(false);
      this.comboText.setScale(1).setText(hitCallout).setAlpha(1);
      this.tweens.killTweensOf(this.comboText);
      this.tweens.add({
        targets: this.comboText,
        scale: 1.18,
        duration: 120,
        yoyo: true,
        onComplete: () => this.tweens.add({
          targets: this.comboText,
          alpha: 0,
          delay: 700,
          duration: 360,
          onComplete: () => {
            this.objectiveText?.setVisible(true);
            this.objectiveProgressText?.setVisible(true);
          },
        }),
      });
      this.popupScore(gained, placed.sprite.x, placed.sprite.y);

      const ids = new Set<number>();
      const protectedIds = new Set<number>();
      for (const cell of cluster) {
        const bubble = this.bubbles.find((candidate) => candidate.id === cell.id && candidate.active);
        if (!bubble) continue;
        if (this.resolveMatchedMechanic(bubble)) protectedIds.add(bubble.id);
        else ids.add(bubble.id);
      }
      for (const b of this.bubbles) {
        if (ids.has(b.id) && b.active) {
          b.active = false;
          this.pop(b);
        }
      }
      // detached bubbles fall
      fell = this.dropDetached(protectedIds);
      if (fell.length > 0) {
        this.score += Math.round(fell.length * 40 * (this.artifact.id === 'phoenix' ? 1.1 : 1) * this.scoreMultiplier);
        SFX.drop();
      }
      this.addRunCoins(cluster.length * 3 + fell.length * 2 + this.combo * 2 + Math.min(2, this.shotBounces) * 3);
      this.addSuperCharge(cluster.length * 10 + this.combo * 4);
      if (this.mode === 'rush') this.timerMs += Math.min(6_000, 2_000 + cluster.length * 500);
      if (this.portalTeleportedThisShot) {
        this.mechanicState = addObjectiveProgress(this.mechanicState, 'portal_cores', 1);
      }
      this.applyBossDamageEvent({ successfulMatch: true, combo: this.combo, floaters: fell.length });
      if (!this.reducedMotion) this.cameras.main.shake(120, 0.004);
    } else {
      this.combo = 0;
      this.streak = 0;
    }

    if (this.tutorialShotPending) {
      this.tutorialShotPending = false;
      const tutorialResolution: TutorialSignal = {
        type: 'shot-resolved',
        fixtureId: LEVEL_ZERO_TUTORIAL_FIXTURE.id,
        matched: matched ? cluster.length : 0,
        dropped: fell.length,
      };
      this.dispatchTutorial({ ...tutorialResolution, dropped: 0 });
      if (matched && fell.length > 0) {
        this.time.delayedCall(680, () => {
          if (!this.scene.isActive()
            || this.tutorialMachine?.snapshot().currentStep !== 'drop-cluster') return;
          this.dispatchTutorial(tutorialResolution);
        });
      }
    }
    this.scoreText.setText(this.visibleScore().toLocaleString());
    this.bubbles = this.bubbles.filter((b) => b.active || b.sprite.active);
    const emberErupted = this.advanceEmbersAfterShot();
    this.finishResolvedShot(matched, emberErupted);
  }

  private finishResolvedShot(matched: boolean, emberErupted = false): void {
    const successful = matched && !emberErupted;
    this.mechanicState = recordShot(this.mechanicState, { matched: successful });
    this.portalCooldowns = tickPortalCooldowns(this.portalCooldowns);
    this.misses = this.mechanicState.misses;
    this.updateStatsHud();
    if (this.checkBoardState()) return;
    this.runCounterAction(!successful);
    this.updateObjectiveHud();
    this.checkBoardState();
  }

  private addPlayableRow(): void {
    const row = 0;
    const count = colsInRow(this.geom, row);
    for (let col = 0; col < count; col++) {
      const color = this.palette[(this.rng() * this.palette.length) | 0];
      const position = cellPos(this.geom, row, col, this.offsetY);
      const sprite = this.makeSprite(color, position.x, position.y).setDepth(4).setAlpha(0).setScale(this.scaleFor() * 0.35);
      this.tweens.add({ targets: sprite, alpha: 1, scale: this.scaleFor(), duration: 300, delay: col * 20, ease: 'Back.easeOut' });
      this.bubbles.push({ id: this.idc++, row, col, color, sprite, active: true });
    }
    this.toast(this.mechanicState.boss ? 'BOSS REFORGED A PLAYABLE ROW' : 'THE OBJECTIVE CONTINUES  •  NEW ORBS ARRIVED');
  }

  private checkBoardState(): boolean {
    if (this.terminalLatch.isEntered() || this.arenaCompletionPending || this.arenaResultResolved) return true;
    const active = this.bubbles.filter((b) => b.active);
    if (active.length === 0 && this.mechanicState.objective.kind === 'clear') {
      this.mechanicState = addObjectiveProgress(this.mechanicState, 'clear', 1);
    }
    this.updateObjectiveHud();
    if (isObjectiveComplete(this.mechanicState)) {
      if (this.arena) {
        this.awaitArenaResult();
        return true;
      }
      SFX.win();
      if (this.challenge) this.endCard('YOU WON!', 0x46e0c8);
      else if (nextStoryLevel(this.level) != null) this.levelClearCard();
      else this.endCard('YOU WON!', 0x46e0c8);
      return true;
    }
    if (isRunFailed(this.mechanicState)) {
      if (this.arena) {
        this.awaitArenaResult();
        return true;
      }
      SFX.lose();
      const reason = this.mechanicState.missLimit != null && this.mechanicState.misses > this.mechanicState.missLimit
        ? 'PRECISION BROKEN'
        : 'OUT OF SHOTS';
      this.endCard(reason, 0xff5a6e);
      return true;
    }
    if (active.length === 0) {
      this.addPlayableRow();
      return false;
    }
    if (active.some((b) => b.sprite.y > this.loseLineY)) {
      if (this.arena) {
        this.awaitArenaResult();
        return true;
      }
      SFX.lose();
      this.endCard('GRID OVERRUN', 0xff5a6e);
      return true;
    }
    return false;
  }

  private levelClearCard(): void {
    if (!this.terminalLatch.tryEnter()) return;
    this.running = false;
    this.handOn = false;
    this.handCursor?.setVisible(false);
    getHandTracker().suspend();
    const progress = recordLevelClear(this.level, this.currentLevelScore());
    this.recordCompletedRun(true);
    const shardAwarded = this.claimStoryShard();
    const stars = progress.stars[this.level] ?? 1;
    const coinsAwarded = this.claimCoinReward(true);
    const accuracy = this.shots ? Math.round((this.hits / this.shots) * 100) : 0;
    trackGameplayEvent({
      type: 'level-end',
      level: this.level,
      mode: this.mode,
      inputMode: 'unknown',
      outcome: 'won',
      reason: 'completed',
      shots: this.shots,
      hits: this.hits,
      won: true,
    });
    void flushGameplayTelemetry();
    const { width, height } = VIEW;
    const reveal = (text: Phaser.GameObjects.Text, delay: number, rise = 14): Phaser.GameObjects.Text => {
      const y = text.y;
      if (this.reducedMotion) return text.setY(y).setAlpha(1);
      text.setY(y + rise).setAlpha(0);
      this.tweens.add({ targets: text, y, alpha: 1, delay, duration: 360, ease: 'Cubic.easeOut' });
      return text;
    };
    const dim = this.add.rectangle(0, 0, width, height, 0x05070c, 0.72).setOrigin(0).setDepth(30)
      .setAlpha(this.reducedMotion ? 1 : 0);
    if (!this.reducedMotion) this.tweens.add({ targets: dim, alpha: 1, duration: 260, ease: 'Quad.easeOut' });
    addArtPanel(this, width / 2, height * 0.52, 610, 820, 31, 0.98);
    const crestAura = this.add.circle(width / 2, height * 0.28, 106, worldForLevel(this.level).accent, 0.12)
      .setStrokeStyle(3, 0xffdd83, 0.35).setBlendMode(Phaser.BlendModes.ADD).setDepth(32).setScale(0.55).setAlpha(0);
    const crest = this.add.image(width / 2, height * 0.28, 'level_medallion').setDisplaySize(190, 190).setDepth(32);
    const crestScaleX = crest.scaleX;
    const crestScaleY = crest.scaleY;
    if (this.reducedMotion) {
      crest.setScale(crestScaleX, crestScaleY).setAngle(0).setAlpha(1);
      crestAura.setScale(1.1).setAlpha(0.22);
    } else {
      crest.setScale(crestScaleX * 0.58, crestScaleY * 0.58).setAngle(-10).setAlpha(0);
      this.tweens.add({ targets: crest, scaleX: crestScaleX, scaleY: crestScaleY, angle: 0, alpha: 1, delay: 120, duration: 520, ease: 'Back.easeOut' });
      this.tweens.add({ targets: crestAura, scale: 1.1, alpha: 0.32, delay: 120, duration: 620, ease: 'Back.easeOut' });
      this.tweens.add({ targets: crestAura, scale: 1.18, alpha: 0.18, delay: 820, duration: 1000, yoyo: true, ease: 'Sine.easeInOut' });
    }
    reveal(this.add.text(width / 2, height * 0.278, String(campaignStageNumber(this.level)), {
      fontFamily: UI_FONT, fontSize: '48px', color: '#ffffff', fontStyle: 'bold', stroke: '#19152f', strokeThickness: 7,
    }).setOrigin(0.5).setDepth(33), 250, 6);
    reveal(this.add.text(width / 2, height * 0.39, 'STAGE CLEAR', {
      fontFamily: UI_FONT, fontSize: TYPE.screen, color: worldForLevel(this.level).accentCss, fontStyle: 'bold',
      stroke: '#111326', strokeThickness: 6,
    }).setOrigin(0.5).setDepth(33).setShadow(0, 5, '#000000', 10), 300);
    reveal(this.add.text(width / 2, height * 0.445, LEVELS[this.level].title, {
      fontFamily: UI_FONT, fontSize: TYPE.section, color: '#ffe7a6', fontStyle: 'bold', letterSpacing: 2,
    }).setOrigin(0.5).setDepth(33), 350);
    const starLine = reveal(this.add.text(width / 2, height * 0.505, `${'★'.repeat(stars)}${'☆'.repeat(3 - stars)}`, {
      fontFamily: UI_FONT, fontSize: '42px', color: '#ffe277', fontStyle: 'bold', letterSpacing: 5,
    }).setOrigin(0.5).setDepth(33).setShadow(0, 3, '#000000', 8), 400);
    if (!this.reducedMotion) {
      this.tweens.add({ targets: starLine, scale: 1.08, delay: 620, duration: 280, yoyo: true, ease: 'Back.easeOut' });
    }
    reveal(this.add.text(width / 2, height * 0.565, `RUN SCORE   ${this.visibleScore().toLocaleString()}`, {
      fontFamily: UI_FONT, fontSize: '21px', color: '#dce6f5', fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(33), 450);
    const clearRewardIcon = this.add.image(width / 2 - 250, height * 0.605, 'mystery_chest_closed')
      .setDisplaySize(66, 66).setDepth(33).setScale(0.2).setAlpha(0);
    if (this.reducedMotion) {
      clearRewardIcon.setScale(1).setAlpha(1).setAngle(0);
    } else {
      this.tweens.add({ targets: clearRewardIcon, scale: 1, alpha: 1, angle: { from: -8, to: 0 }, delay: 470, duration: 430, ease: 'Back.easeOut' });
      this.tweens.add({ targets: clearRewardIcon, y: clearRewardIcon.y - 4, delay: 920, duration: 850, yoyo: true, ease: 'Sine.easeInOut' });
    }
    this.serverRewardText = reveal(this.add.text(width / 2, height * 0.605, this.serverRewardMessage
      || `◆ +${coinsAwarded.toLocaleString()} COINS   •   KEY +1${shardAwarded ? '   •   SHARD +1' : ''}`, {
      fontFamily: UI_FONT, fontSize: TYPE.body, color: '#ffdd68', fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(33), 490);
    fitText(this.serverRewardText, 520, 0.72);
    reveal(this.add.text(width / 2, height * 0.637, `${this.hits} HITS  •  ${this.specialHits} SPECIAL  •  ${accuracy}% ACC  •  BEST ×${this.maxStreak}`, {
      fontFamily: UI_FONT, fontSize: TYPE.label, color: '#c8d4e5', fontStyle: 'bold', letterSpacing: 1,
    }).setOrigin(0.5).setDepth(33), 520);
    reveal(this.add.text(width / 2, height * 0.678, storyBeatForLevel(this.level).aftermath, {
      fontFamily: UI_FONT,
      fontSize: TYPE.caption,
      color: '#dce6f5',
      fontStyle: 'bold',
      align: 'center',
      lineSpacing: 4,
      wordWrap: { width: 520, useAdvancedWrap: true },
    }).setOrigin(0.5).setDepth(33), 550, 8);
    addArtButton(this, width / 2, height * 0.748, PHASER_RELEASE_FEATURES.completeGameplay ? 'NEXT STAGE' : 'FOUNDATION COMPLETE', () => {
      SFX.click();
      if (!PHASER_RELEASE_FEATURES.completeGameplay) {
        this.scene.start('Menu');
        return;
      }
      const nextLevel = nextStoryLevel(this.level);
      if (nextLevel == null) this.scene.start('Ending', { level: this.level, score: this.score, mode: this.mode });
      else this.scene.start('Story', { level: nextLevel, score: this.score, mode: this.mode });
    }, 320, 78, 33);
    addArtButton(this, width / 2, height * 0.82, 'ADVENTURE MAP', () => {
      SFX.click();
      this.scene.start('WorldMap', { world: LEVELS[this.level].world });
    }, 280, 64, 33);
    sharpenSceneText(this);
  }

  private showPauseCard(): void {
    if (this.arenaCompletionPending && !this.arenaResultResolved) {
      this.scene.start('Competitive');
      return;
    }
    if (!this.running || this.pauseOverlay) return;
    this.running = false;
    this.handOn = false;
    this.pinchControl.reset();
    this.handLockedAim = null;
    this.handPinching = false;
    this.handCursor?.setVisible(false);
    this.aimGfx.clear();
    getHandTracker().suspend();
    const { width, height } = VIEW;
    const overlay = this.add.container(0, this.reducedMotion ? 0 : 18).setDepth(60)
      .setAlpha(this.reducedMotion ? 1 : 0);
    this.pauseOverlay = overlay;
    const dim = this.add.rectangle(0, 0, width, height, 0x02040a, 0.78).setOrigin(0);
    const panel = addArtPanel(this, width / 2, height * 0.48, 610, 690, 60, 0.98);
    const crestAura = this.add.circle(width / 2, height * 0.285, 96, worldForLevel(this.level).accent, 0.1)
      .setStrokeStyle(3, 0xffde8a, 0.28).setBlendMode(Phaser.BlendModes.ADD);
    const crest = this.add.image(width / 2, height * 0.285, 'level_medallion').setDisplaySize(170, 170).setDepth(61);
    const crestScaleX = crest.scaleX;
    const crestScaleY = crest.scaleY;
    crest.setScale(
      this.reducedMotion ? crestScaleX : crestScaleX * 0.7,
      this.reducedMotion ? crestScaleY : crestScaleY * 0.7,
    ).setAngle(this.reducedMotion ? 0 : -7);
    const level = this.add.text(width / 2, height * 0.285, String(campaignStageNumber(this.level)), {
      fontFamily: UI_FONT, fontSize: '43px', color: '#ffffff', fontStyle: 'bold', stroke: '#17152e', strokeThickness: 7,
    }).setOrigin(0.5).setDepth(62);
    const title = this.add.text(width / 2, height * 0.405, 'ADVENTURE PAUSED', {
      fontFamily: UI_FONT, fontSize: TYPE.screen, color: worldForLevel(this.level).accentCss, fontStyle: 'bold',
      stroke: '#101225', strokeThickness: 6,
    }).setOrigin(0.5).setDepth(62);
    const subtitle = this.add.text(width / 2, height * 0.455, LEVELS[this.level].title, {
      fontFamily: UI_FONT, fontSize: TYPE.section, color: '#ffe7a6', fontStyle: 'bold', letterSpacing: 2,
    }).setOrigin(0.5).setDepth(62);
    const details = this.add.text(width / 2, height * 0.495, `${MODE_DEFS[this.mode].name}  •  ${this.formatClock()}  •  ${this.hits} HITS\n${this.artifact.name}  •  ${Math.floor(this.superCharge)}% SUPER`, {
      fontFamily: UI_FONT, fontSize: TYPE.label, color: '#c7d4e7', fontStyle: 'bold', align: 'center', lineSpacing: 7,
    }).setOrigin(0.5).setDepth(62);
    const resume = addArtButton(this, width / 2, height * 0.55, 'RESUME', () => {
      SFX.click();
      overlay.destroy(true);
      this.pauseOverlay = undefined;
      this.running = true;
      this.suppressNextShot = true;
      if (getHandTracker().isWanted()) void this.startHandTracking(false);
    }, 310, 76, 62);
    const restart = addArtButton(this, width / 2, height * 0.64, this.arena ? 'RETURN TO ARENA' : 'RESTART STAGE', () => {
      SFX.click();
      if (this.arena) {
        this.scene.start('Competitive');
        return;
      }
      this.scene.restart(this.restartRunData());
    }, 290, 66, 62);
    const map = addArtButton(this, width / 2, height * 0.72, 'ADVENTURE MAP', () => {
      SFX.click();
      this.scene.start('WorldMap', { world: LEVELS[this.level].world });
    }, 270, 62, 62);
    overlay.add([dim, panel, crestAura, crest, level, title, subtitle, details, resume, restart, map]);
    if (this.reducedMotion) {
      crestAura.setScale(1.08).setAlpha(0.2);
    } else {
      this.tweens.add({ targets: overlay, y: 0, alpha: 1, duration: 360, ease: 'Cubic.easeOut' });
      this.tweens.add({ targets: crest, scaleX: crestScaleX, scaleY: crestScaleY, angle: 0, duration: 480, ease: 'Back.easeOut' });
      this.tweens.add({ targets: crestAura, scale: 1.14, alpha: 0.26, duration: 980, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    }
    sharpenSceneText(this);
  }

  // ── fx ─────────────────────────────────────────────────────────────
  private pop(b: Bub): void {
    const s = b.sprite;
    this.tweens.killTweensOf(s);
    const ring = this.add.circle(s.x, s.y, this.geom.radius * 0.64, 0x000000, 0)
      .setStrokeStyle(4, COLORS[b.color].hex, 0.9)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(8);
    this.tweens.add({
      targets: ring,
      scale: 2.35,
      alpha: 0,
      duration: 280,
      ease: 'Quad.easeOut',
      onComplete: () => ring.destroy(),
    });
    const em = this.add.particles(s.x, s.y, 'spark', {
      speed: { min: 60, max: 240 },
      scale: { start: 0.55, end: 0 },
      lifespan: 420,
      tint: COLORS[b.color].hex,
      blendMode: 'ADD',
      emitting: false,
    });
    em.explode(Math.max(6, Math.round(14 * this.quality.particles)));
    this.time.delayedCall(520, () => em.destroy());
    this.tweens.add({
      targets: s,
      scale: this.scaleFor() * 1.55,
      alpha: 0,
      duration: 220,
      ease: 'Quad.easeOut',
      onComplete: () => s.destroy(),
    });
  }

  private drop(b: Bub): void {
    const s = b.sprite;
    this.tweens.add({
      targets: s,
      y: VIEW.height + 80,
      alpha: 0.15,
      angle: Phaser.Math.Between(-200, 200),
      duration: 650,
      ease: 'Quad.easeIn',
      onComplete: () => s.destroy(),
    });
  }

  private popupScore(pts: number, x: number, y: number): void {
    const t = this.add
      .text(x, y, '+' + pts, { fontFamily: 'Arial, sans-serif', fontSize: '22px', color: '#ffe27a', fontStyle: 'bold' })
      .setOrigin(0.5)
      .setDepth(15);
    this.tweens.add({ targets: t, y: y - 50, alpha: 0, duration: 700, ease: 'Quad.easeOut', onComplete: () => t.destroy() });
  }

  private loadNext(): void {
    if (this.shotQueue) {
      this.shotQueue = advanceShotQueue(this.shotQueue, this.activeBoardColors());
    }
    if (this.replayTrace?.length) this.replayQueueIndex += 1;
    this.loaded = this.currentQueueColor();
    if (this.shotQueue && !this.replayTrace) {
      this.shotQueue = reconcileShotQueue(this.shotQueue, this.activeBoardColors());
      this.loaded = this.shotQueue.current;
    }
    const muzzle = this.muzzlePosition();
    this.launcherFocus.setPosition(muzzle.x, muzzle.y).setAngle(this.launcher.angle * 0.16);
    this.loadedSprite = this.makeSprite(this.loaded, muzzle.x, muzzle.y).setDepth(5).setScale(0);
    this.updateQueueHud();
    this.tweens.add({
      targets: this.loadedSprite,
      scale: this.scaleFor(),
      duration: 200,
      ease: 'Back.easeOut',
      onComplete: () => {
        if (!this.flying) this.pulse(this.loadedSprite);
      },
    });
  }

  private missReset(): void {
    this.flying = false;
    if (this.ballSprite) {
      this.ballSprite.destroy();
      this.ballSprite = undefined;
    }
    this.combo = 0;
    this.streak = 0;
    const emberErupted = this.advanceEmbersAfterShot();
    this.finishResolvedShot(false, emberErupted);
    if (this.running) this.loadNext();
  }

  /**
   * Lock local play and submit the final input boundary. Arena rewards are
   * intentionally deferred until the server broadcasts a matching result.
   */
  private awaitArenaResult(): void {
    if (!this.arena || this.arenaCompletionPending || this.arenaResultResolved) return;
    this.arenaCompletionPending = true;
    this.running = false;
    this.handOn = false;
    this.pinchControl.reset();
    this.handLockedAim = null;
    this.handPinching = false;
    this.handCursor?.setVisible(false);
    this.aimGfx.clear();
    getHandTracker().suspend();
    this.sendArenaFinish();
    this.arenaOpponentText?.setText('SCORE LOCKED  •  VERIFYING ARENA RESULT');
    this.showArenaWaitCard();
    this.arenaResultTimer = this.time.delayedCall(ARENA_RESULT_WAIT_MS, () => {
      if (!this.scene.isActive() || !this.arenaCompletionPending || this.arenaResultResolved) return;
      this.arenaOpponentText?.setText('ARENA RESULT UNAVAILABLE  •  SAFE TO EXIT');
      this.arenaWaitStatus?.setText('SERVER RESULT IS STILL UNAVAILABLE\nNO LOCAL WIN OR REWARD WAS GRANTED').setColor('#ffc879');
    });
  }

  private sendArenaFinish(): void {
    if (!this.arena || !this.arenaCompletionPending || this.arenaResultResolved) return;
    this.arenaConnection?.send({ type: 'finish', matchId: this.arena.matchId });
  }

  private showArenaWaitCard(): void {
    if (this.arenaWaitOverlay) return;
    const { width, height } = VIEW;
    const overlay = this.add.container(0, 18).setDepth(60).setAlpha(0);
    this.arenaWaitOverlay = overlay;
    const dim = this.add.rectangle(0, 0, width, height, 0x02040a, 0.78).setOrigin(0);
    const panel = addArtPanel(this, width / 2, height * 0.48, 590, 470, 60, 0.98);
    const crest = this.add.image(width / 2, height * 0.34, 'level_medallion').setDisplaySize(145, 145).setDepth(61);
    const title = this.add.text(width / 2, height * 0.445, 'SCORE LOCKED', {
      fontFamily: UI_FONT, fontSize: TYPE.screen, color: '#7ff1d0', fontStyle: 'bold',
      stroke: '#101225', strokeThickness: 6,
    }).setOrigin(0.5).setDepth(62);
    const score = this.add.text(width / 2, height * 0.5, `VERIFIED SCORE   ${this.visibleScore().toLocaleString()}`, {
      fontFamily: UI_FONT, fontSize: TYPE.body, color: '#ffe7a6', fontStyle: 'bold', letterSpacing: 2,
    }).setOrigin(0.5).setDepth(62);
    this.arenaWaitStatus = this.add.text(width / 2, height * 0.555, 'WAITING FOR THE VERIFIED MATCH RESULT\nRECONNECTS WILL RESUBMIT YOUR FINISH SAFELY', {
      fontFamily: UI_FONT, fontSize: TYPE.label, color: '#cbd6e7', fontStyle: 'bold', align: 'center', lineSpacing: 7,
    }).setOrigin(0.5).setDepth(62);
    const exit = addArtButton(this, width / 2, height * 0.64, 'RETURN TO ARENA LOBBY', () => {
      SFX.click();
      this.scene.start('Competitive');
    }, 360, 70, 62);
    overlay.add([dim, panel, crest, title, score, this.arenaWaitStatus, exit]);
    this.tweens.add({ targets: overlay, y: 0, alpha: 1, duration: 300, ease: 'Cubic.easeOut' });
    sharpenSceneText(this);
  }

  private resolveArenaResult(message: ArenaMessage): void {
    if (!this.arena || this.arenaResultResolved) return;
    if (message.matchId !== this.arena.matchId) return;
    this.applyArenaState(message);
    const isTie = message.isTie === true;
    const tiedUserIds = Array.isArray(message.tiedUserIds)
      ? message.tiedUserIds.filter((entry): entry is string => typeof entry === 'string').slice(0, 2)
      : [];
    const winnerUserId = typeof message.winnerUserId === 'string' ? message.winnerUserId.trim() : '';
    if (isTie) {
      if (!tiedUserIds.includes(this.arena.userId)) return;
    } else if (!ARENA_ID_PATTERN.test(winnerUserId) || !winnerUserId.startsWith('usr_')) return;
    this.arenaResultResolved = true;
    this.arenaDrawResolved = isTie;
    this.arenaCompletionPending = false;
    this.arenaResultTimer?.remove(false);
    this.arenaResultTimer = undefined;
    this.pauseOverlay?.destroy(true);
    this.pauseOverlay = undefined;
    this.arenaWaitOverlay?.destroy(true);
    this.arenaWaitOverlay = undefined;
    this.arenaWaitStatus = undefined;
    const won = !isTie && winnerUserId === this.arena.userId;
    this.arenaOpponentText?.setText(isTie ? 'ARENA DRAW VERIFIED' : won ? 'ARENA VICTORY VERIFIED' : 'RIVAL FINISHED AHEAD');
    if (won) SFX.win();
    else if (!isTie) SFX.lose();
    this.endCard(isTie ? 'ARENA DRAW' : won ? 'YOU WON!' : 'RIVAL FINISHED AHEAD', isTie ? 0xffc879 : won ? 0x46e0c8 : 0xff5a6e);
  }

  private endCard(msg: string, color: number): void {
    if (this.arena && !this.arenaResultResolved) {
      this.awaitArenaResult();
      return;
    }
    if (!this.terminalLatch.tryEnter()) return;
    this.running = false;
    this.handOn = false;
    this.handCursor?.setVisible(false);
    getHandTracker().suspend();
    const won = msg === 'YOU WON!';
    const draw = this.arenaDrawResolved && msg === 'ARENA DRAW';
    const finalStoryVictory = won
      && nextStoryLevel(this.level) == null
      && !this.challenge
      && !this.arena
      && !this.replayTrace;
    const storyAftermath = won && !this.challenge && !this.arena && !this.replayTrace
      ? storyBeatForLevel(this.level).aftermath
      : '';
    if (won && !this.challenge && !this.arena && !this.replayTrace) {
      recordLevelClear(this.level, this.currentLevelScore());
    }
    this.recordCompletedRun(won);
    const shardAwarded = won ? this.claimStoryShard() : 0;
    const coinsAwarded = this.claimCoinReward(won);
    const accuracy = this.shots ? Math.round((this.hits / this.shots) * 100) : 0;
    trackGameplayEvent({
      type: 'level-end',
      level: this.level,
      mode: this.arena ? 'arena' : this.mode,
      inputMode: 'unknown',
      outcome: won ? 'won' : draw ? 'completed' : 'lost',
      reason: telemetryReasonForTerminalMessage(msg),
      shots: this.shots,
      hits: this.hits,
      won,
    });
    void flushGameplayTelemetry();
    if (!this.replayTrace && !this.scoreSubmitted && this.currentLevelScore() > 0) {
      submitScore(this.currentLevelScore(), this.level);
      this.scoreSubmitted = true;
    }
    const { width, height } = VIEW;
    this.input.enabled = true;
    const reveal = (text: Phaser.GameObjects.Text, delay: number, rise = 14): Phaser.GameObjects.Text => {
      const y = text.y;
      if (this.reducedMotion) return text.setY(y).setAlpha(1);
      text.setY(y + rise).setAlpha(0);
      this.tweens.add({ targets: text, y, alpha: 1, delay, duration: 360, ease: 'Cubic.easeOut' });
      return text;
    };
    const dim = this.add.rectangle(0, 0, width, height, 0x05070c, 0.74).setOrigin(0).setDepth(30)
      .setAlpha(this.reducedMotion ? 1 : 0);
    if (!this.reducedMotion) this.tweens.add({ targets: dim, alpha: 1, duration: 260, ease: 'Quad.easeOut' });
    addArtPanel(this, width / 2, height * 0.5, 610, 780, 31, 0.98);
    const crestAura = this.add.circle(width / 2, height * 0.29, 106, color, 0.12)
      .setStrokeStyle(3, 0xffdc82, 0.34).setBlendMode(Phaser.BlendModes.ADD).setDepth(32).setScale(0.55).setAlpha(0);
    const crest = this.add.image(width / 2, height * 0.29, 'level_medallion').setDisplaySize(188, 188).setDepth(32)
      .setTint(won || draw ? 0xffffff : 0x9d7582);
    const crestScaleX = crest.scaleX;
    const crestScaleY = crest.scaleY;
    if (this.reducedMotion) {
      crest.setScale(crestScaleX, crestScaleY).setAngle(0).setAlpha(1);
      crestAura.setScale(1.1).setAlpha(0.22);
    } else {
      crest.setScale(crestScaleX * 0.58, crestScaleY * 0.58).setAngle(won ? -9 : 7).setAlpha(0);
      this.tweens.add({ targets: crest, scaleX: crestScaleX, scaleY: crestScaleY, angle: 0, alpha: 1, delay: 110, duration: 520, ease: 'Back.easeOut' });
      this.tweens.add({ targets: crestAura, scale: 1.12, alpha: 0.28, delay: 110, duration: 600, ease: 'Back.easeOut' });
      this.tweens.add({ targets: crestAura, scale: 1.2, alpha: 0.16, delay: 800, duration: 1050, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    }
    reveal(this.add.text(width / 2, height * 0.29, won ? '♛' : draw ? '=' : '!', {
      fontFamily: UI_FONT, fontSize: '54px', color: Phaser.Display.Color.IntegerToColor(color).rgba, fontStyle: 'bold',
      stroke: '#161426', strokeThickness: 7,
    }).setOrigin(0.5).setDepth(33), 250, 6);
    reveal(this.add.text(width / 2, height * 0.397, won ? 'VICTORY' : draw ? 'DRAW' : 'GAME OVER', {
      fontFamily: UI_FONT, fontSize: TYPE.screen, color: Phaser.Display.Color.IntegerToColor(color).rgba, fontStyle: 'bold',
      stroke: '#101225', strokeThickness: 6,
    }).setOrigin(0.5).setDepth(33).setShadow(0, 5, '#000000', 10), 310);
    reveal(this.add.text(width / 2, height * 0.442, msg, {
      fontFamily: UI_FONT, fontSize: TYPE.body, color: '#ffe7a6', fontStyle: 'bold', letterSpacing: 2,
    }).setOrigin(0.5).setDepth(33), 345);
    reveal(this.add.text(width / 2, height * 0.482, `RUN SCORE   ${this.visibleScore().toLocaleString()}`, {
      fontFamily: UI_FONT, fontSize: '21px', color: '#e4ecf8', fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(33), 375);
    const endRewardIcon = this.add.image(width / 2 - 250, height * 0.52, won ? 'mystery_chest_closed' : 'coin_stack')
      .setDisplaySize(64, 64).setDepth(33).setScale(0.2).setAlpha(0);
    if (this.reducedMotion) {
      endRewardIcon.setScale(1).setAlpha(1).setAngle(0);
    } else {
      this.tweens.add({ targets: endRewardIcon, scale: 1, alpha: 1, angle: { from: won ? -8 : 8, to: 0 }, delay: 390, duration: 430, ease: 'Back.easeOut' });
    }
    this.serverRewardText = reveal(this.add.text(width / 2, height * 0.52, this.serverRewardMessage
      || `${won ? `◆ +${coinsAwarded.toLocaleString()} COINS   •   KEY +1${shardAwarded ? '   •   SHARD +1' : ''}` : `◆ +${coinsAwarded.toLocaleString()} COINS`}`, {
      fontFamily: UI_FONT, fontSize: TYPE.body, color: '#ffdd68', fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(33), 405);
    fitText(this.serverRewardText, 520, 0.72);
    reveal(this.add.text(width / 2, height * 0.555, `${this.hits} HITS  •  ${this.specialHits} SPECIAL  •  ${accuracy}% ACC  •  BEST ×${this.maxStreak}`, {
      fontFamily: UI_FONT, fontSize: TYPE.label, color: '#cbd6e7', fontStyle: 'bold', letterSpacing: 1,
    }).setOrigin(0.5).setDepth(33), 435);
    reveal(this.add.text(width / 2, height * 0.588, storyAftermath || 'SAVED TO THE HALL OF HEROES', {
      fontFamily: UI_FONT,
      fontSize: storyAftermath ? TYPE.caption : TYPE.label,
      color: '#ffe7a6',
      fontStyle: 'bold',
      letterSpacing: storyAftermath ? 0 : 2,
      align: 'center',
      lineSpacing: 4,
      wordWrap: { width: 520, useAdvancedWrap: true },
    }).setOrigin(0.5).setDepth(33), 465);
    const primaryAction = this.arena
      ? 'ARENA LOBBY'
      : this.replayTrace
        ? 'REPLAY GHOST'
        : this.challenge
          ? 'REPLAY CHALLENGE'
          : finalStoryVictory
            ? 'RESTORE THE CROWN'
            : won
              ? 'NEW ADVENTURE'
              : 'RETRY STAGE';
    addArtButton(this, width / 2, height * 0.66, primaryAction, () => {
      SFX.click();
      if (this.arena) {
        this.scene.start('Competitive');
        return;
      }
      if (finalStoryVictory) {
        this.scene.start('Ending', { score: this.score, mode: this.mode });
        return;
      }
      if (this.challenge || this.replayTrace) {
        this.scene.restart(this.restartRunData());
        return;
      }
      this.scene.restart({
        level: won ? 0 : this.level,
        score: won ? 0 : this.levelStartScore,
        mode: this.mode,
        ...(this.tutorialReplayRequested ? { tutorialReplay: true } : {}),
      });
    }, 320, 76, 33);
    addArtButton(this, width / 2, height * 0.745, 'ADVENTURE MAP', () => {
      SFX.click();
      this.scene.start('WorldMap', { world: LEVELS[this.level].world });
    }, 280, 64, 33);
    addArtButton(this, width / 2, height * 0.81, 'MAIN MENU', () => {
      SFX.click();
      this.scene.start('Menu');
    }, 240, 60, 33);
    sharpenSceneText(this);
  }

  private visibleScore(): number {
    return this.currentLevelScore();
  }

  private currentLevelScore(): number {
    return this.arena
      ? Math.max(0, this.arenaVerifiedScore)
      : campaignLevelScore(this.score, this.levelStartScore);
  }

  private arenaElapsedMs(): number {
    if (!this.arena || !Number.isFinite(this.arenaStartMonotonicMs)) return 0;
    return performance.now() - this.arenaStartMonotonicMs;
  }

  private syncArenaClock(serverTimeValue: unknown): void {
    if (!this.arena || this.arenaInputSeq > 0) return;
    const serverTime = Number(serverTimeValue);
    if (!Number.isSafeInteger(serverTime)) return;
    const elapsedMs = serverTime - this.arena.startsAt;
    if (elapsedMs < -60_000 || elapsedMs > 60 * 60_000) return;
    this.arenaStartMonotonicMs = performance.now() - elapsedMs;
  }

  private applyArenaState(message: ArenaMessage): void {
    if (!this.arena || !Array.isArray(message.players)) return;
    const players = message.players.slice(0, 2).filter((player): player is { userId: string; score: number; shots: number } => {
      if (!player || typeof player !== 'object') return false;
      const candidate = player as Record<string, unknown>;
      return typeof candidate.userId === 'string'
        && Number.isFinite(Number(candidate.score))
        && Number.isFinite(Number(candidate.shots));
    }).map((player) => ({
      userId: player.userId,
      score: Phaser.Math.Clamp(Math.trunc(Number(player.score)), 0, 10_000_000),
      shots: Phaser.Math.Clamp(Math.trunc(Number(player.shots)), 0, ARENA_REPLAY_RULES.maximumShots),
    }));
    const self = players.find((player) => player.userId === this.arena?.userId);
    if (self) {
      this.arenaVerifiedScore = self.score;
      this.score = self.score;
      this.arenaInputSeq = Math.max(this.arenaInputSeq, self.shots);
      this.scoreText?.setText(self.score.toLocaleString());
    }
    const opponent = players.find((player) => player.userId !== this.arena?.userId);
    const opponentScore = opponent?.score ?? 0;
    this.arenaOpponentText?.setText(`LIVE RIVAL  ${opponentScore.toLocaleString()}  •  YOU ${this.arenaVerifiedScore.toLocaleString()} VERIFIED`);
  }

  private connectArena(): void {
    if (!this.arena) return;
    this.arenaOpponentText = this.add.text(VIEW.width / 2, 126, 'LIVE ARENA  •  CONNECTING', {
      fontFamily: UI_FONT, fontSize: TYPE.caption, color: '#cbbdff', fontStyle: 'bold', backgroundColor: 'rgba(3,6,17,.82)', padding: { x: 12, y: 7 },
    }).setOrigin(0.5).setDepth(28);
    this.arenaConnection = new ArenaConnection();
    this.arenaConnection.connect((message: ArenaMessage) => {
      if (!this.scene.isActive() || !this.arena) return;
      if (message.type === 'match-state' && message.matchId === this.arena.matchId) {
        this.applyArenaState(message);
      } else if (message.type === 'match-result') {
        this.resolveArenaResult(message);
      } else if (message.type === 'match-resumed' && message.matchId === this.arena.matchId) {
        this.syncArenaClock(message.serverTime);
        this.applyArenaState(message);
        if (this.arenaCompletionPending) this.sendArenaFinish();
      } else if (message.type === 'arena-ready' && this.arenaCompletionPending) {
        this.sendArenaFinish();
      } else if (message.type === 'input-rejected' && message.matchId !== this.arena.matchId) {
        return;
      } else if (message.type === 'input-rejected') {
        this.arenaOpponentText?.setText(`ARENA INPUT REJECTED  •  ${String(message.error ?? 'INVALID INPUT').toUpperCase()}`);
        this.awaitArenaResult();
      } else if (message.type === 'finish-ack' && message.matchId === this.arena.matchId && this.arenaCompletionPending) {
        this.arenaWaitStatus?.setText('FINISH VERIFIED  •  WAITING FOR YOUR RIVAL').setColor('#cbd6e7');
      } else if (message.type === 'player-finished' && message.matchId === this.arena.matchId) {
        if (message.userId === this.arena.userId && this.arenaCompletionPending) {
          this.arenaWaitStatus?.setText('FINISH VERIFIED  •  WAITING FOR YOUR RIVAL').setColor('#cbd6e7');
        } else if (!this.arenaCompletionPending) {
          this.arenaOpponentText?.setText('RIVAL FINISHED  •  COMPLETE YOUR RUN');
        }
      } else if (message.type === 'error' && message.error === 'match-not-found' && this.arenaCompletionPending) {
        this.arenaOpponentText?.setText('ARENA RESULT UNAVAILABLE  •  SAFE TO EXIT');
        this.arenaWaitStatus?.setText('SERVER COULD NOT RESTORE THIS RESULT\nNO LOCAL WIN OR REWARD WAS GRANTED').setColor('#ffc879');
      }
    }, (state) => {
      if (!this.scene.isActive()) return;
      if (this.arenaCompletionPending) {
        this.arenaOpponentText?.setText(state === 'closed'
          ? 'CONNECTION LOST  •  RETRYING RESULT VERIFICATION'
          : `ARENA RESULT  •  ${state.toUpperCase()}`);
        return;
      }
      this.arenaOpponentText?.setText(`LIVE ARENA  •  ${state.toUpperCase()}`);
    });
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.arenaConnection?.close());
  }
}

import Phaser from 'phaser';
import { VIEW } from '../config';
import {
  applyGazeCalibration,
  fitGazeCalibration,
  type GazeCalibrationObservation,
} from '../game/gazecontrol';
import {
  currentGazeCalibrationIdentity,
  gazeCalibrationMatches,
  getGazeSettings,
  saveGazeCalibration,
  updateGazeSettings,
  type CameraControlMode,
  type GazeCalibrationIdentity,
  type GazeResponsiveness,
} from '../game/gazesettings';
import { getHandSettings, updateHandSettings } from '../game/handsettings';
import {
  getHandTracker,
  type GazeObservation,
  type VisionTrackingMode,
} from '../game/handtracking';
import { SFX } from '../game/sfx';
import {
  accessibilityRuntimeForCanvas,
  type AccessibilitySceneSession,
} from '../gfx/accessibility';
import {
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

const CALIBRATION_POINTS = [
  { x: 0.5, y: 0.5, label: 'CENTRE' },
  { x: 0.12, y: 0.16, label: 'TOP LEFT' },
  { x: 0.88, y: 0.84, label: 'BOTTOM RIGHT' },
  { x: 0.88, y: 0.16, label: 'TOP RIGHT' },
  { x: 0.12, y: 0.84, label: 'BOTTOM LEFT' },
  { x: 0.12, y: 0.5, label: 'MIDDLE LEFT' },
  { x: 0.88, y: 0.5, label: 'MIDDLE RIGHT' },
  { x: 0.5, y: 0.16, label: 'TOP CENTRE' },
  { x: 0.5, y: 0.84, label: 'BOTTOM CENTRE' },
] as const;

const FRAMES_PER_POINT = 15;
const POINT_SETTLE_MS = 560;
const POINT_RETRY_MS = 8_500;
const FIXATION_WINDOW_FRAMES = 7;
const FIXATION_WINDOW_MS = 180;

const MODE_LABELS: Record<CameraControlMode, string> = {
  off: 'OFF / POINTER',
  hand: 'HAND',
  gaze: 'EYES / GAZE',
  'gaze-hand': 'GAZE + HAND',
};

type MainObject = Phaser.GameObjects.Container | Phaser.GameObjects.Text;

/**
 * Device-local camera input centre. This scene never treats looking at a menu
 * control as activation: camera access is explicit, and calibration only
 * collects compact ten-number V2 observations after the player starts it.
 */
export class GazeSetupScene extends Phaser.Scene {
  private a11y?: AccessibilitySceneSession;
  private mainObjects: MainObject[] = [];
  private mainButtons: Phaser.GameObjects.Container[] = [];
  private cancelButton?: Phaser.GameObjects.Container;
  private profileText?: Phaser.GameObjects.Text;
  private status?: Phaser.GameObjects.Text;
  private cameraStatus?: Phaser.GameObjects.Text;
  private calibrationBackdrop?: Phaser.GameObjects.Graphics;
  private calibrationHeader?: Phaser.GameObjects.Text;
  private calibrationPrompt?: Phaser.GameObjects.Text;
  private calibrationTarget?: Phaser.GameObjects.Container;
  private calibrationTargetArt?: Phaser.GameObjects.Graphics;
  private calibrating = false;
  private cameraRunning = false;
  private calibrationPoint = 0;
  private calibrationSamples: GazeCalibrationObservation[] = [];
  private pointSamples: GazeCalibrationObservation[] = [];
  private fixationWindow: GazeObservation[] = [];
  private pointCaptureArmed = false;
  private calibrationIdentity?: GazeCalibrationIdentity;
  private pointReadyAt = 0;
  private pointStartedAt = 0;
  private lastObservationTimestamp = Number.NEGATIVE_INFINITY;
  private lastLiveStatusAt = 0;

  constructor() {
    super('GazeSetup');
  }

  create(): void {
    const settings = getGazeSettings();
    this.a11y = accessibilityRuntimeForCanvas(this.game.canvas).mountScene({
      id: 'camera-control-lab',
      heading: 'Camera control lab',
      description: 'Choose pointer and touch, hand, eyes, or eyes plus hand. Camera access starts only when you activate Start Camera. Eye calibration stays on this device and no video is uploaded.',
      status: `${MODE_LABELS[settings.mode]} is selected. Camera is off until Start Camera is activated.`,
      lifecycle: this.events,
    });

    addWorldBackground(this, 'world_celestial', 0.28);
    this.composeMainInterface();
    this.composeCalibrationOverlay();
    this.refreshProfileSummary();
    this.setCalibrationUi(false);

    // Loading the local model does not request camera permission. Avoid even
    // that cost until the player has selected an eye-enabled mode.
    if (settings.mode === 'gaze' || settings.mode === 'gaze-hand') {
      void getHandTracker().prepareGaze().catch(() => undefined);
    }

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.calibrating = false;
      getHandTracker().suspend();
    });
    sharpenSceneText(this);
  }

  update(): void {
    if (this.calibrating) {
      this.collectCalibrationFrame();
      return;
    }
    this.updateLiveCameraStatus();
  }

  private trackMain<T extends MainObject>(object: T): T {
    this.mainObjects.push(object);
    return object;
  }

  private trackMainButton(button: Phaser.GameObjects.Container): Phaser.GameObjects.Container {
    this.mainObjects.push(button);
    this.mainButtons.push(button);
    return button;
  }

  private composeMainInterface(): void {
    const settings = getGazeSettings();
    this.trackMain(addArtPanel(this, VIEW.width / 2, 101, 630, 178, 8, 0.98));
    this.trackMain(this.add.text(410, 84, 'CAMERA INPUT LAB', {
      fontFamily: DISPLAY_FONT,
      fontSize: TYPE.screen,
      color: '#ffffff',
      fontStyle: 'bold',
      stroke: '#132e51',
      strokeThickness: 7,
    }).setOrigin(0.5).setDepth(12));
    this.trackMain(fitText(this.add.text(
      VIEW.width / 2,
      142,
      'ON-DEVICE ONLY  •  NO VIDEO UPLOAD\nCAMERA FRAMES NEVER LEAVE THIS DEVICE',
      {
        fontFamily: UI_FONT,
        fontSize: '22px',
        color: '#8af3ff',
        fontStyle: 'bold',
        align: 'center',
        lineSpacing: 2,
      },
    ).setOrigin(0.5).setDepth(12), 570, 0.86));
    this.trackMainButton(addArtButton(this, 82, 52, '‹  BACK', () => {
      SFX.click();
      this.scene.start('ModeSelect');
    }, 140, 70, 18));

    this.trackMain(addArtPanel(this, VIEW.width / 2, 260, 630, 132, 8, 0.97));
    this.status = this.trackMain(this.add.text(VIEW.width / 2, 224, '', {
      fontFamily: UI_FONT,
      fontSize: TYPE.section,
      color: '#ffe7a6',
      fontStyle: 'bold',
      align: 'center',
    }).setOrigin(0.5).setDepth(12));
    this.profileText = this.trackMain(this.add.text(VIEW.width / 2, 282, '', {
      fontFamily: UI_FONT,
      fontSize: '22px',
      color: '#dce6f5',
      align: 'center',
      lineSpacing: 3,
    }).setOrigin(0.5).setDepth(12));

    this.trackMain(addArtPanel(this, VIEW.width / 2, 510, 630, 322, 8, 0.97));
    this.trackMain(this.add.text(VIEW.width / 2, 382, 'CHOOSE ONE INPUT MODE', {
      fontFamily: UI_FONT,
      fontSize: TYPE.section,
      color: '#ffe7a6',
      fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(12));

    const modeButton = (
      x: number,
      y: number,
      mode: CameraControlMode,
      label: string,
    ): void => {
      const active = settings.mode === mode;
      this.trackMainButton(addArtButton(
        this,
        x,
        y,
        `${active ? '●' : '○'}  ${label}`,
        () => this.selectMode(mode),
        270,
        76,
        18,
      ));
    };
    modeButton(205, 454, 'off', 'OFF / POINTER');
    modeButton(515, 454, 'hand', 'HAND');
    modeButton(205, 565, 'gaze', 'EYES / GAZE');
    modeButton(515, 565, 'gaze-hand', 'GAZE + HAND');
    this.trackMain(this.add.text(
      VIEW.width / 2,
      642,
      'Eyes aim. Gaze + hand confirms the aimed shot with a real pinch release.',
      {
        fontFamily: UI_FONT,
        fontSize: '24px',
        color: '#d2dcef',
        align: 'center',
        wordWrap: { width: 560 },
      },
    ).setOrigin(0.5).setDepth(12));

    this.trackMain(addArtPanel(this, VIEW.width / 2, 790, 630, 160, 8, 0.97));
    this.trackMainButton(addArtButton(this, 205, 770, 'START CAMERA', () => {
      void this.startCamera();
    }, 280, 72, 18));
    this.trackMainButton(addArtButton(this, 515, 770, 'STOP CAMERA', () => this.stopCamera(), 260, 72, 18));
    this.cameraStatus = this.trackMain(this.add.text(VIEW.width / 2, 837, 'CAMERA OFF  •  START IS ALWAYS EXPLICIT', {
      fontFamily: UI_FONT,
      fontSize: '24px',
      color: '#cbd6e7',
      fontStyle: 'bold',
      align: 'center',
    }).setOrigin(0.5).setDepth(12));

    this.trackMain(addArtPanel(this, VIEW.width / 2, 1032, 630, 270, 8, 0.97));
    this.trackMain(this.add.text(VIEW.width / 2, 922, 'EYE CALIBRATION', {
      fontFamily: UI_FONT,
      fontSize: TYPE.section,
      color: '#ffe7a6',
      fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(12));
    this.trackMain(this.add.text(
      VIEW.width / 2,
      968,
      'Look at nine targets with your head naturally steady. Capture is automatic; gaze never activates this menu.',
      {
        fontFamily: UI_FONT,
        fontSize: '24px',
        color: '#d2dcef',
        align: 'center',
        wordWrap: { width: 570 },
      },
    ).setOrigin(0.5).setDepth(12));
    const calibrationLabel = settings.calibration ? 'RECALIBRATE EYES' : 'CALIBRATE EYES';
    this.trackMainButton(addArtButton(this, 205, 1064, calibrationLabel, () => {
      void this.startCalibration();
    }, 290, 72, 18));
    this.trackMainButton(addArtButton(this, 515, 1064, 'USE / TUNE HAND', () => {
      SFX.click();
      updateGazeSettings({ mode: 'hand' });
      getHandTracker().suspend();
      this.scene.start('HandSetup');
    }, 270, 72, 18));
    const activationLabel = settings.activation === 'double-blink'
      ? 'ACTION  BLINK ×2'
      : `ACTION  DWELL ${settings.dwellMs}`;
    this.trackMainButton(addArtButton(this, 130, 1184, `SENS  ${settings.sensitivity.toFixed(2)}×`, () => {
      SFX.click();
      const levels = [0.8, 1, 1.18, 1.35];
      const currentIndex = levels.findIndex((value) => Math.abs(value - getGazeSettings().sensitivity) < 0.03);
      updateGazeSettings({ sensitivity: levels[(currentIndex + 1 + levels.length) % levels.length] });
      getHandTracker().suspend();
      this.scene.restart();
    }, 200, 76, 18));
    this.trackMainButton(addArtButton(
      this,
      VIEW.width / 2,
      1184,
      `FEEL  ${settings.responsiveness.toUpperCase()}`,
      () => {
        SFX.click();
        const next: Record<GazeResponsiveness, GazeResponsiveness> = {
          fast: 'balanced',
          balanced: 'steady',
          steady: 'fast',
        };
        updateGazeSettings({ responsiveness: next[getGazeSettings().responsiveness] });
        getHandTracker().suspend();
        this.scene.restart();
      },
      210,
      76,
      18,
    ));
    this.trackMainButton(addArtButton(this, 590, 1184, activationLabel, () => {
      SFX.click();
      updateGazeSettings({
        activation: getGazeSettings().activation === 'double-blink' ? 'dwell' : 'double-blink',
      });
      getHandTracker().suspend();
      this.scene.restart();
    }, 200, 76, 18));
  }

  private composeCalibrationOverlay(): void {
    this.calibrationBackdrop = this.add.graphics().setDepth(40).setVisible(false);
    this.calibrationBackdrop.fillStyle(0x050313, 0.96);
    this.calibrationBackdrop.fillRect(0, 0, VIEW.width, VIEW.height);
    this.calibrationBackdrop.lineStyle(2, UI_COLORS.cyan, 0.35);
    this.calibrationBackdrop.strokeRect(18, 18, VIEW.width - 36, VIEW.height - 36);

    this.calibrationHeader = this.add.text(430, 62, '', {
      fontFamily: DISPLAY_FONT,
      fontSize: TYPE.title,
      color: '#fff3dd',
      fontStyle: 'bold',
      stroke: '#132e51',
      strokeThickness: 5,
    }).setOrigin(0.5).setDepth(44).setVisible(false);
    this.calibrationPrompt = this.add.text(VIEW.width / 2, 112, '', {
      fontFamily: UI_FONT,
      fontSize: TYPE.body,
      color: '#bfeeff',
      fontStyle: 'bold',
      align: 'center',
      wordWrap: { width: 500 },
    }).setOrigin(0.5).setDepth(44).setVisible(false);

    this.calibrationTargetArt = this.add.graphics();
    this.calibrationTarget = this.add.container(0, 0, [this.calibrationTargetArt])
      .setDepth(46)
      .setVisible(false);

    this.cancelButton = addArtButton(this, 82, 50, 'CANCEL', () => this.cancelCalibration(), 136, 52, 48);
    this.cancelButton.setVisible(false);
    updateArtButtonAccessibility(this.cancelButton, { disabled: true });
  }

  private refreshProfileSummary(message?: string): void {
    const settings = getGazeSettings();
    const hand = getHandSettings();
    const identity = currentGazeCalibrationIdentity(hand.deviceId, hand.mirror);
    const profileReady = gazeCalibrationMatches(settings.calibration, identity);
    const profileState = profileReady
      ? `EYE PROFILE V2 READY  •  HELD-OUT ERROR ${Math.round((settings.calibration?.quality.rmse ?? 0) * 100)}%`
      : settings.calibration
        ? 'EYE PROFILE NEEDS THIS CAMERA / SCREEN RECALIBRATION'
        : 'EYE PROFILE NOT CALIBRATED';
    this.status?.setText(message ?? `${MODE_LABELS[settings.mode]} SELECTED`);
    fitText(this.status as Phaser.GameObjects.Text, 570, 0.86);
    const registrationState = profileReady
      ? 'OPEN-EYE + HEAD-POSE PROFILE SAVED LOCALLY'
      : 'CALIBRATION USES BOTH IRISES + HEAD POSE';
    this.profileText?.setText(`${profileState}\n${registrationState}`);
    fitText(this.profileText as Phaser.GameObjects.Text, 560, 0.82);
    this.a11y?.setStatus(`${MODE_LABELS[settings.mode]} selected. ${profileState}. Camera is ${this.cameraRunning ? 'running' : 'off'}.`);
  }

  private setCameraStatusText(text: string, color: string, minScale = 0.72): void {
    if (!this.cameraStatus) return;
    this.cameraStatus.setText(text).setColor(color).setScale(1);
    fitText(this.cameraStatus, 590, minScale);
  }

  private selectMode(mode: CameraControlMode): void {
    SFX.click();
    updateGazeSettings({ mode });
    // A mode choice never inherits a live stream. START CAMERA remains the
    // only activation boundary after every selection.
    getHandTracker().disable();
    this.cameraRunning = false;
    this.scene.restart();
  }

  private activeVisionMode(): VisionTrackingMode | null {
    const mode = getGazeSettings().mode;
    return mode === 'off' ? null : mode;
  }

  private async startCamera(): Promise<boolean> {
    const mode = this.activeVisionMode();
    if (!mode) {
      this.setCameraStatusText('CHOOSE HAND, EYES OR EYES + HAND FIRST', '#ffc879');
      this.a11y?.announce('Choose hand, eyes, or eyes plus hand before starting the camera.', 'assertive');
      return false;
    }
    this.setCameraStatusText(`LOADING ${MODE_LABELS[mode].toUpperCase()} MODEL ON DEVICE…`, '#ffe7a6');
    this.a11y?.setStatus(`Starting the camera for ${MODE_LABELS[mode]}.`);
    const ok = await getHandTracker().enable(mode);
    if (!this.scene.isActive()) return false;
    this.cameraRunning = ok;
    if (!ok) {
      const failure = getHandTracker().getLastFailure().replace(/-/g, ' ').toUpperCase();
      this.setCameraStatusText(`CAMERA ERROR  •  ${failure}`, '#ff9b9b', 0.66);
      this.a11y?.announce(`Camera could not start. ${failure}.`, 'assertive');
      return false;
    }
    const resolvedDeviceId = getHandTracker().getActiveCameraDeviceId();
    if (mode === 'gaze' || mode === 'gaze-hand') {
      // Setup must visibly prove which irises are registered. This local
      // preview is never recorded or uploaded and closes with the scene.
      getHandTracker().setPreviewVisible(true);
    }
    if (mode !== 'hand' && !resolvedDeviceId) {
      getHandTracker().disable();
      this.cameraRunning = false;
      this.setCameraStatusText(
        'CAMERA ID UNAVAILABLE\nEYE CALIBRATION CANNOT BE BOUND SAFELY',
        '#ff9b9b',
        0.72,
      );
      this.a11y?.announce(
        'This browser did not expose the active camera identity. Eye calibration cannot start safely.',
        'assertive',
      );
      return false;
    }
    if (resolvedDeviceId && resolvedDeviceId !== getHandSettings().deviceId) {
      updateHandSettings({ deviceId: resolvedDeviceId });
    }
    this.setCameraStatusText(`CAMERA READY  •  ${MODE_LABELS[mode].toUpperCase()}`, '#7de2b8');
    this.a11y?.announce(`Camera ready for ${MODE_LABELS[mode]}.`);
    return true;
  }

  private stopCamera(): void {
    SFX.click();
    getHandTracker().disable();
    this.cameraRunning = false;
    this.setCameraStatusText('CAMERA OFF  •  START IS ALWAYS EXPLICIT', '#cbd6e7');
    this.a11y?.setStatus(`${MODE_LABELS[getGazeSettings().mode]} remains selected. Camera is off.`);
    this.a11y?.announce('Camera stopped.');
  }

  private async startCalibration(): Promise<void> {
    if (this.calibrating) return;
    const current = getGazeSettings();
    const mode: VisionTrackingMode = current.mode === 'gaze-hand' ? 'gaze-hand' : 'gaze';
    if (current.mode !== mode) updateGazeSettings({ mode });
    const ready = await this.startCamera();
    if (!ready || !this.scene.isActive()) return;

    const hand = getHandSettings();
    this.calibrationIdentity = currentGazeCalibrationIdentity(hand.deviceId, hand.mirror);
    this.calibrating = true;
    this.calibrationPoint = 0;
    this.calibrationSamples = [];
    this.pointSamples = [];
    this.fixationWindow = [];
    this.pointCaptureArmed = false;
    this.lastObservationTimestamp = Number.NEGATIVE_INFINITY;
    this.setCalibrationUi(true);
    this.beginCalibrationPoint();
    this.a11y?.setHeading(
      'Nine point eye calibration',
      'Look at each bright target and keep your head naturally steady. Samples are captured automatically on this device. Activate Cancel to stop.',
    );
    this.a11y?.announce('Eye calibration started. Look at the centre target.');
  }

  private beginCalibrationPoint(): void {
    const point = CALIBRATION_POINTS[this.calibrationPoint];
    if (!point || !this.calibrationTarget) return;
    const now = performance.now();
    this.pointSamples = [];
    this.fixationWindow = [];
    this.pointCaptureArmed = false;
    this.pointStartedAt = now;
    this.pointReadyAt = now + POINT_SETTLE_MS;
    this.calibrationTarget.setPosition(point.x * VIEW.width, point.y * VIEW.height);
    this.calibrationHeader?.setText(`EYE CALIBRATION  •  POINT ${this.calibrationPoint + 1} / ${CALIBRATION_POINTS.length}`);
    fitText(this.calibrationHeader as Phaser.GameObjects.Text, 510, 0.72);
    this.calibrationPrompt?.setText(`LOOK AT ${point.label.replace('CENTRE', 'CENTER')}  •  HOLD NATURALLY`);
    this.drawCalibrationTarget(0, false);
  }

  private collectCalibrationFrame(): void {
    const point = CALIBRATION_POINTS[this.calibrationPoint];
    if (!point) return;
    const now = performance.now();
    if (now < this.pointReadyAt) return;
    const observation = getHandTracker().peekGaze(240);
    if (!observation || observation.timestampMs <= this.lastObservationTimestamp) {
      if (now - this.pointStartedAt > 900) {
        this.calibrationPrompt?.setText('KEEP BOTH EYES VISIBLE  •  FACE THE CAMERA');
      }
      this.drawCalibrationTarget(this.pointSamples.length / FRAMES_PER_POINT, false);
      this.retryCalibrationPointIfNeeded(now);
      return;
    }
    this.lastObservationTimestamp = observation.timestampMs;
    const usable = observation.usableForAction
      && observation.qualityReason === 'ready'
      && observation.confidence >= 0.68
      && observation.leftBlink <= 0.32
      && observation.rightBlink <= 0.32
      && observation.headMotion <= 0.78
      && observation.binocularAgreement >= 0.38;
    if (!usable) {
      this.fixationWindow = [];
      this.pointCaptureArmed = false;
      this.pointSamples = [];
      this.calibrationPrompt?.setText(this.calibrationQualityPrompt(observation));
      this.drawCalibrationTarget(this.pointSamples.length / FRAMES_PER_POINT, false);
      this.retryCalibrationPointIfNeeded(now);
      return;
    }

    this.fixationWindow.push(observation);
    if (this.fixationWindow.length > FIXATION_WINDOW_FRAMES) this.fixationWindow.shift();
    const fixationStable = this.fixationWindowStable();
    if (!this.pointCaptureArmed) {
      if (!fixationStable) {
        this.calibrationPrompt?.setText('LOCKING BOTH IRISES  •  KEEP LOOKING AT THE DOT');
        this.drawCalibrationTarget(0, false);
        this.retryCalibrationPointIfNeeded(now);
        return;
      }
      this.pointCaptureArmed = true;
      this.pointSamples = [];
    } else if (!fixationStable) {
      // Stability is a continuous capture contract, not a one-time arm. A
      // head/eye drift discards the unfinished target instead of poisoning its
      // affine fit with samples aimed somewhere else.
      this.pointCaptureArmed = false;
      this.pointSamples = [];
      this.calibrationPrompt?.setText('TARGET DRIFTED  •  HOLD THE SAME DOT AGAIN');
      this.drawCalibrationTarget(0, false);
      this.retryCalibrationPointIfNeeded(now);
      return;
    }

    this.pointSamples.push({
      targetX: point.x,
      targetY: point.y,
      features: observation.features,
      confidence: observation.confidence,
      registration: {
        leftOpenness: observation.leftOpenness,
        rightOpenness: observation.rightOpenness,
        faceScale: observation.features[6],
        headYaw: observation.headYaw,
        headPitch: observation.headPitch,
        headRoll: observation.headRoll,
      },
    });
    const frameProgress = this.pointSamples.length / FRAMES_PER_POINT;
    this.calibrationPrompt?.setText(
      `${point.label.replace('CENTRE', 'CENTER')}  •  FRAME ${this.pointSamples.length} / ${FRAMES_PER_POINT}`,
    );
    this.drawCalibrationTarget(frameProgress, true);
    if (this.pointSamples.length < FRAMES_PER_POINT) return;

    this.calibrationSamples.push(...this.pointSamples);
    SFX.click();
    this.calibrationPoint += 1;
    if (this.calibrationPoint >= CALIBRATION_POINTS.length) {
      this.finishCalibration();
      return;
    }
    const next = CALIBRATION_POINTS[this.calibrationPoint];
    this.a11y?.announce(`Point ${this.calibrationPoint} captured. Look at ${next.label.toLowerCase()}.`);
    this.beginCalibrationPoint();
  }

  private fixationWindowStable(): boolean {
    const window = this.fixationWindow;
    if (window.length < FIXATION_WINDOW_FRAMES) return false;
    if (window[window.length - 1].timestampMs - window[0].timestampMs < FIXATION_WINDOW_MS) return false;
    const span = (index: number): number => {
      const values = window.map((sample) => sample.features[index]);
      return Math.max(...values) - Math.min(...values);
    };
    return [0, 1, 2, 3].every((index) => span(index) <= 0.075)
      && Math.hypot(span(4), span(5)) <= 0.028
      && span(6) <= 0.018
      && span(7) <= 0.12
      && span(8) <= 0.12
      && span(9) <= 0.065
      && window.every((sample) => sample.headMotion <= 0.78);
  }

  private calibrationQualityPrompt(observation: GazeObservation): string {
    const prompts: Partial<Record<GazeObservation['qualityReason'], string>> = {
      'face-too-far': 'MOVE CLOSER  •  BOTH IRISES NEED MORE DETAIL',
      'face-off-center': 'CENTER YOUR FACE  •  KEEP BOTH EYES VISIBLE',
      'head-angle': 'FACE THE CAMERA MORE DIRECTLY',
      'head-moving': 'HOLD YOUR HEAD NATURALLY STEADY',
      'eyes-closed': 'OPEN BOTH EYES NATURALLY',
      'iris-uncertain': 'IRIS RINGS UNCLEAR  •  IMPROVE LIGHT OR REMOVE GLARE',
      'binocular-mismatch': 'BOTH EYES MUST LOOK AT THE SAME DOT',
      'poor-lighting': 'ADD SOFT FRONT LIGHT  •  AVOID BACKLIGHT',
    };
    return prompts[observation.qualityReason] ?? 'KEEP BOTH EYES VISIBLE  •  HOLD STEADY';
  }

  private retryCalibrationPointIfNeeded(now: number): void {
    if (now - this.pointStartedAt < POINT_RETRY_MS) return;
    this.pointSamples = [];
    this.fixationWindow = [];
    this.pointCaptureArmed = false;
    this.pointStartedAt = now;
    this.pointReadyAt = now + POINT_SETTLE_MS;
    this.calibrationPrompt?.setText('NO STABLE SAMPLE  •  CENTRE YOUR FACE AND KEEP LOOKING');
    this.a11y?.announce('No stable eye sample yet. Centre your face, open both eyes naturally, and keep looking at the same target.');
  }

  private finishCalibration(): void {
    this.calibrationTarget?.setVisible(false);
    this.calibrationHeader?.setText('VALIDATING DEVICE-LOCAL EYE PROFILE…');
    fitText(this.calibrationHeader as Phaser.GameObjects.Text, 510, 0.72);
    this.calibrationPrompt?.setText('CHECKING COVERAGE AND ACCURACY');
    const identity = this.calibrationIdentity;
    const profile = identity ? fitGazeCalibration(this.calibrationSamples, identity) : null;
    if (!profile) {
      this.restoreMainInterface('CALIBRATION NEEDS ANOTHER PASS');
      this.setCameraStatusText('PROFILE NOT SAVED  •  KEEP HEAD STEADIER AND RETRY', '#ffc879', 0.68);
      this.a11y?.announce('Calibration was not accurate enough and was not saved. Keep your head steadier and retry.', 'assertive');
      return;
    }
    try {
      const saved = saveGazeCalibration(profile);
      SFX.click();
      this.restoreMainInterface(
        `EYE PROFILE SAVED  •  ERROR ${Math.round((saved.calibration?.quality.rmse ?? profile.quality.rmse) * 100)}%`,
      );
      this.setCameraStatusText('CAMERA READY  •  LOOK, THEN DOUBLE BLINK TO CONFIRM', '#7de2b8', 0.68);
      this.a11y?.announce('Eye calibration saved on this device.');
    } catch {
      const sessionProfile = getGazeSettings().calibration;
      if (identity && gazeCalibrationMatches(sessionProfile, identity)) {
        this.restoreMainInterface('EYE PROFILE ACTIVE FOR THIS SESSION');
        this.setCameraStatusText('LOCAL STORAGE UNAVAILABLE  •  RECALIBRATE AFTER RELOAD', '#ffc879', 0.68);
        this.a11y?.announce(
          'Eye calibration is active for this session only. Local storage is unavailable, so recalibrate after reloading.',
          'assertive',
        );
      } else {
        this.restoreMainInterface('CALIBRATION COULD NOT BE SAVED');
        this.setCameraStatusText('LOCAL STORAGE UNAVAILABLE  •  PROFILE NOT SAVED', '#ff9b9b', 0.68);
        this.a11y?.announce('Eye calibration could not be saved on this device.', 'assertive');
      }
    }
  }

  private cancelCalibration(): void {
    if (!this.calibrating) return;
    SFX.click();
    this.restoreMainInterface('CALIBRATION CANCELLED  •  EXISTING PROFILE KEPT');
    this.a11y?.announce('Eye calibration cancelled. The existing profile was kept.');
  }

  private restoreMainInterface(message: string): void {
    this.calibrating = false;
    this.calibrationSamples = [];
    this.pointSamples = [];
    this.fixationWindow = [];
    this.pointCaptureArmed = false;
    this.setCalibrationUi(false);
    this.refreshProfileSummary(message);
    this.a11y?.setHeading(
      'Camera control lab',
      'Choose pointer and touch, hand, eyes, or eyes plus hand. Camera access starts only when you activate Start Camera.',
    );
  }

  private setCalibrationUi(active: boolean): void {
    for (const object of this.mainObjects) object.setVisible(!active);
    for (const button of this.mainButtons) updateArtButtonAccessibility(button, { disabled: active });
    this.calibrationBackdrop?.setVisible(active);
    this.calibrationHeader?.setVisible(active);
    this.calibrationPrompt?.setVisible(active);
    this.calibrationTarget?.setVisible(active);
    this.cancelButton?.setVisible(active);
    updateArtButtonAccessibility(this.cancelButton, { disabled: !active });
  }

  private drawCalibrationTarget(progress: number, valid: boolean): void {
    const art = this.calibrationTargetArt;
    if (!art) return;
    const boundedProgress = Phaser.Math.Clamp(progress, 0, 1);
    const accent = valid ? 0x7de2b8 : UI_COLORS.cyan;
    art.clear();
    art.fillStyle(0x150a31, 0.96);
    art.fillCircle(0, 0, 52);
    art.lineStyle(3, 0xffffff, 0.88);
    art.strokeCircle(0, 0, 40);
    art.lineStyle(7, accent, 0.95);
    art.beginPath();
    art.arc(0, 0, 50, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * boundedProgress);
    art.strokePath();
    art.fillStyle(UI_COLORS.gold, 1);
    art.fillCircle(0, 0, 13);
    art.lineStyle(3, 0x09041b, 1);
    art.lineBetween(-28, 0, -10, 0);
    art.lineBetween(10, 0, 28, 0);
    art.lineBetween(0, -28, 0, -10);
    art.lineBetween(0, 10, 0, 28);
    if (!prefersReducedMotion()) {
      this.calibrationTarget?.setScale(1 + Math.sin(performance.now() / 180) * 0.025);
    }
  }

  private updateLiveCameraStatus(): void {
    if (!this.cameraRunning || performance.now() - this.lastLiveStatusAt < 160) return;
    this.lastLiveStatusAt = performance.now();
    const mode = getGazeSettings().mode;
    if (mode === 'gaze' || mode === 'gaze-hand') {
      const observation = getHandTracker().peekGaze(260);
      if (!observation) {
        this.setCameraStatusText('CAMERA READY  •  KEEP BOTH EYES IN FRAME', '#ffc879');
        return;
      }
      const hand = getHandSettings();
      const identity = currentGazeCalibrationIdentity(hand.deviceId, hand.mirror);
      const profile = getGazeSettings().calibration;
      const point = applyGazeCalibration(observation, profile, identity);
      const aim = point ? `  •  AIM ${Math.round(point.x * 100)},${Math.round(point.y * 100)}` : '';
      const quality = observation.qualityReason.replace(/-/g, ' ').toUpperCase();
      const eyes = observation.qualityReason === 'eyes-closed' ? 'CHECK EYELIDS' : 'IRISES L✓ R✓';
      this.setCameraStatusText(
        `EYES ${Math.round(observation.confidence * 100)}%  •  ${observation.trackingFps.toFixed(0)} FPS  •  ${quality}\n`
        + `${eyes}  •  YAW ${observation.headYaw.toFixed(2)}  PITCH ${observation.headPitch.toFixed(2)}`
        + `  •  ${Math.round(observation.inferenceMs)} MS${aim}`,
        observation.usableForAction ? '#7de2b8' : '#ffc879',
        0.68,
      );
      return;
    }
    if (mode === 'hand') {
      const sample = getHandTracker().peekSample(260);
      this.setCameraStatusText(
        sample
          ? `HAND ${Math.round(sample.confidence * 100)}%  •  ${sample.trackingFps.toFixed(0)} FPS`
          : 'CAMERA READY  •  KEEP YOUR HAND IN FRAME',
        sample?.usableForGesture ? '#7de2b8' : '#ffc879',
      );
    }
  }
}

import Phaser from 'phaser';
import { VIEW } from '../config';
import { updateGazeSettings } from '../game/gazesettings';
import { getHandTracker } from '../game/handtracking';
import { calibrateHand, getHandSettings, minimumContactCalibrationGap, updateHandSettings } from '../game/handsettings';
import { SFX } from '../game/sfx';
import { addArtButton, addArtPanel, addWorldBackground, DISPLAY_FONT, fitText, sharpenSceneText, TYPE, UI_FONT } from '../gfx/ui';

export class HandSetupScene extends Phaser.Scene {
  private releaseDistance?: number;
  private pinchDistance?: number;
  private releaseNoise = 0;
  private pinchNoise = 0;
  private status?: Phaser.GameObjects.Text;
  private metrics?: Phaser.GameObjects.Text;
  private captureBusy = false;
  constructor() { super('HandSetup'); }

  create(): void {
    const settings = getHandSettings();
    // Start loading the local model while the player reads the setup screen;
    // camera permission is still requested only after START CAMERA is pressed.
    void getHandTracker().prepare().catch(() => undefined);
    addWorldBackground(this, 'world_celestial', 0.27);
    addArtPanel(this, VIEW.width / 2, 118, 630, 210, 8, 0.98);
    this.add.text(VIEW.width / 2, 70, 'HAND CONTROL LAB', { fontFamily: DISPLAY_FONT, fontSize: TYPE.screen, color: '#ffffff', fontStyle: 'bold', stroke: '#132e51', strokeThickness: 7 }).setOrigin(0.5).setDepth(12);
    this.add.text(VIEW.width / 2, 125, 'CAMERA-SAFE  •  ON-DEVICE LANDMARKS  •  NO VIDEO UPLOAD', { fontFamily: UI_FONT, fontSize: TYPE.label, color: '#79d9ff', fontStyle: 'bold' }).setOrigin(0.5).setDepth(12);
    addArtButton(this, 86, 46, '‹  BACK', () => this.scene.start('GazeSetup'), 140, 50, 18);
    addArtPanel(this, VIEW.width / 2, 430, 630, 340, 8, 0.97);
    this.status = this.add.text(VIEW.width / 2, 325, 'START CAMERA TO CALIBRATE', { fontFamily: UI_FONT, fontSize: TYPE.section, color: '#ffe7a6', fontStyle: 'bold' }).setOrigin(0.5).setDepth(12);
    this.metrics = this.add.text(VIEW.width / 2, 405, `PROFILE ${settings.calibrated ? 'CALIBRATED' : 'DEFAULT'}\nTOUCH ${settings.pinchOn.toFixed(2)} / RELEASE ${settings.pinchOff.toFixed(2)}\nTARGET ${settings.targetFps} FPS`, { fontFamily: 'monospace', fontSize: TYPE.body, color: '#dce6f5', align: 'center', lineSpacing: 10 }).setOrigin(0.5).setDepth(12);
    addArtButton(this, 210, 545, 'START CAMERA', () => void this.startCamera(), 300, 58, 14);
    addArtButton(this, 510, 545, 'CHANGE CAMERA', () => void this.changeCamera(), 250, 58, 14);
    addArtPanel(this, VIEW.width / 2, 790, 630, 310, 8, 0.97);
    this.add.text(VIEW.width / 2, 675, 'TWO-POINT CALIBRATION', { fontFamily: UI_FONT, fontSize: TYPE.section, color: '#ffe7a6', fontStyle: 'bold' }).setOrigin(0.5).setDepth(12);
    this.add.text(VIEW.width / 2, 725, 'Keep thumb and index naturally apart — no open palm needed — capture RELEASE, then touch both tips and capture PINCH.', { fontFamily: UI_FONT, fontSize: TYPE.body, color: '#cbd6e7', align: 'center', wordWrap: { width: 560 } }).setOrigin(0.5).setDepth(12);
    addArtButton(this, 210, 835, 'CAPTURE RELEASE', () => void this.capture('release'), 280, 62, 14);
    addArtButton(this, 510, 835, 'CAPTURE PINCH', () => void this.capture('pinch'), 280, 62, 14);
    addArtButton(this, VIEW.width / 2, 930, 'SAVE CALIBRATION', () => this.saveCalibration(), 380, 66, 14);
    addArtButton(this, 185, 1080, `MIRROR  ${settings.mirror ? 'ON' : 'OFF'}`, () => { updateHandSettings({ mirror: !getHandSettings().mirror }); this.scene.restart(); }, 300, 58, 14);
    addArtButton(this, 535, 1080, `PREVIEW  ${settings.preview ? 'ON' : 'OFF'}`, () => { updateHandSettings({ preview: !getHandSettings().preview }); this.scene.restart(); }, 300, 58, 14);
    addArtButton(this, VIEW.width / 2, 1170, `INFERENCE  ${settings.targetFps} FPS`, () => { const current = getHandSettings().targetFps; updateHandSettings({ targetFps: current === 15 ? 20 : current === 20 ? 30 : 15 }); this.scene.restart(); }, 380, 58, 14);
    addArtButton(this, VIEW.width / 2, 1240, 'WATCH 18 SEC HAND GUIDE', () => {
      window.location.assign('/dl/paopao-handtracking-double-tap-guide-v3.mp4');
    }, 430, 48, 14);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => getHandTracker().suspend());
    sharpenSceneText(this);
  }

  update(): void {
    const sample = getHandTracker().peekSample();
    if (!sample || !this.metrics) return;
    const diagnostics = getHandTracker().getDiagnostics();
    this.metrics.setText(
      `PINCH ${sample.pinch.toFixed(3)}  •  3D ${sample.pinch3d.toFixed(3)}  •  DEPTH ${Math.round(sample.depth * 100)}%\n`
      + `TIP ${sample.pointingAngle.toFixed(0)}°  •  PALM ${sample.handRoll.toFixed(0)}°  •  ${sample.direction.toUpperCase()}\n`
      + `TRACK ${sample.trackingFps.toFixed(1)} FPS  •  ${sample.inferenceMs.toFixed(1)} MS  •  ${sample.lightingMode.toUpperCase()}  •  RECOVERY ${diagnostics.recoveries}`,
    );
  }

  private async startCamera(): Promise<void> {
    updateGazeSettings({ mode: 'hand' });
    this.status?.setText('LOADING ON-DEVICE HAND MODEL…');
    const ok = await getHandTracker().enable('hand');
    if (!this.scene.isActive()) return;
    this.status?.setText(ok ? 'CAMERA READY  •  HOLD HAND IN FRAME' : `CAMERA ERROR  •  ${getHandTracker().getLastFailure().replace(/-/g, ' ').toUpperCase()}`).setColor(ok ? '#7ff1d0' : '#ff8d8d');
  }

  private async changeCamera(): Promise<void> {
    const cameras = await getHandTracker().cameras();
    if (!cameras.length) { this.status?.setText('NO CAMERA DEVICES FOUND'); return; }
    const current = getHandSettings().deviceId; const index = Math.max(0, cameras.findIndex((camera) => camera.deviceId === current)); const next = cameras[(index + 1) % cameras.length];
    updateHandSettings({ deviceId: next.deviceId }); getHandTracker().suspend(); await this.startCamera(); this.status?.setText(`CAMERA  •  ${next.label || `DEVICE ${index + 1}`}`);
  }

  private async capture(kind: 'release' | 'pinch'): Promise<void> {
    if (this.captureBusy) return;
    this.captureBusy = true;
    this.status?.setText(`HOLD ${kind.toUpperCase()} STEADY  •  MEASURING 9 FRAMES…`).setColor('#ffe7a6');
    const values: number[] = [];
    const scales: number[] = [];
    const tipDepths: number[] = [];
    const tipDistances3d: number[] = [];
    const depthSources: Array<'world' | 'image'> = [];
    let lastTimestamp = Number.NEGATIVE_INFINITY;
    const deadline = performance.now() + 1_000;
    while (this.scene.isActive() && values.length < 9 && performance.now() < deadline) {
      const sample = getHandTracker().peekSample(220);
      if (sample && sample.timestampMs > lastTimestamp) {
        lastTimestamp = sample.timestampMs;
        values.push(sample.rawPinch);
        scales.push(sample.palmScale);
        tipDepths.push(sample.pinchDepth);
        tipDistances3d.push(sample.pinch3d);
        depthSources.push(sample.depthSource);
      }
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }
    this.captureBusy = false;
    if (!this.scene.isActive()) return;
    if (values.length < 6) {
      this.status?.setText('HAND NOT STABLE — KEEP THE WHOLE HAND IN FRAME').setColor('#ffc879');
      return;
    }
    const median = (items: number[]): number => {
      const sorted = [...items].sort((a, b) => a - b);
      return sorted[Math.floor(sorted.length / 2)];
    };
    const distance = median(values);
    const distanceMad = median(values.map((value) => Math.abs(value - distance)));
    const scale = median(scales);
    const tipDepth = median(tipDepths);
    const tipDistance3d = median(tipDistances3d);
    const scaleSpread = Math.max(...scales.map((value) => Math.abs(value - scale))) / Math.max(0.001, scale);
    if (distanceMad > 0.055 || scaleSpread > 0.18) {
      this.status?.setText('HAND MOVED TOO MUCH — HOLD STILL AND CAPTURE AGAIN').setColor('#ffc879');
      return;
    }
    const usesWorldDepth = depthSources.filter((source) => source === 'world').length >= Math.ceil(values.length * 0.75);
    const maxContactDepth = usesWorldDepth ? 0.35 : 0.52;
    const maxContact3d = usesWorldDepth ? Math.max(0.55, Math.min(0.62, distance + 0.16)) : 0.72;
    if (kind === 'pinch' && (tipDepth > maxContactDepth || tipDistance3d > maxContact3d)) {
      this.status?.setText('TIPS OVERLAP IN CAMERA BUT DO NOT TOUCH — ALIGN THEM IN DEPTH').setColor('#ffc879');
      return;
    }
    if (kind === 'release') {
      this.releaseDistance = distance;
      this.releaseNoise = distanceMad;
    } else {
      this.pinchDistance = distance;
      this.pinchNoise = distanceMad;
    }
    SFX.click();
    this.status?.setText(`${kind.toUpperCase()} LOCKED  •  MEDIAN ${distance.toFixed(3)}  •  ${values.length} FRAMES`).setColor('#7ff1d0');
  }

  private saveCalibration(): void {
    if (this.releaseDistance == null || this.pinchDistance == null) { this.status?.setText('CAPTURE BOTH RELEASE AND PINCH SAMPLES FIRST').setColor('#ffc879'); return; }
    const requiredGap = minimumContactCalibrationGap(this.releaseNoise, this.pinchNoise);
    if (this.releaseDistance <= this.pinchDistance || this.releaseDistance - this.pinchDistance < requiredGap) {
      this.status?.setText('RELEASE AND PINCH TOO SIMILAR — CAPTURE BOTH AGAIN').setColor('#ffc879');
      return;
    }
    const settings = calibrateHand(this.releaseDistance, this.pinchDistance, this.releaseNoise, this.pinchNoise);
    if (!settings) { this.status?.setText('RELEASE GAP TOO NOISY — CAPTURE BOTH AGAIN').setColor('#ffc879'); return; }
    this.status?.setText('CONTACT CALIBRATION SAVED TO THIS DEVICE').setColor('#7ff1d0');
    fitText(this.metrics?.setText(`TOUCH ${settings.pinchOn.toFixed(3)}  •  RELEASE ${settings.pinchOff.toFixed(3)}\nTWO FRESH FRAMES PREVENT ACCIDENTAL SHOTS`) as Phaser.GameObjects.Text, 560);
  }
}

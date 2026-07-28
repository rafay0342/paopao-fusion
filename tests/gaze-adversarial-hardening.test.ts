import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  DoubleBlinkControl,
  GazeAimController,
  GazeDwellControl,
  type GazeFeatureVector,
} from '../src/game/gazecontrol';
import {
  GAZE_CALIBRATION_ALGORITHM_REVISION,
  createGazeCalibrationIdentity,
  type GazeCalibrationProfile,
} from '../src/game/gazesettings';

const readText = (path: string): string => readFileSync(path, 'utf8');

const between = (source: string, startNeedle: string, endNeedle: string): string => {
  const start = source.indexOf(startNeedle);
  const end = source.indexOf(endNeedle, start + startNeedle.length);
  expect(start, `missing ${startNeedle}`).toBeGreaterThanOrEqual(0);
  expect(end, `missing ${endNeedle}`).toBeGreaterThan(start);
  return source.slice(start, end);
};

const identity = createGazeCalibrationIdentity({
  cameraId: 'resolved-live-camera',
  mirror: true,
  viewportWidth: 1_280,
  viewportHeight: 720,
});

const directProfile = (): GazeCalibrationProfile => ({
  algorithmRevision: GAZE_CALIBRATION_ALGORITHM_REVISION,
  revision: 4,
  createdAtMs: 1_000,
  identity,
  featureMean: Array(8).fill(0),
  featureScale: Array(8).fill(1),
  xCoefficients: [0, 1, 0, 0, 0, 0, 0, 0, 0],
  yCoefficients: [0, 0, 1, 0, 0, 0, 0, 0, 0],
  quality: {
    rmse: 0.02,
    rmseX: 0.02,
    rmseY: 0.02,
    coverage: 0.64,
    sampleCount: 36,
    pointCount: 9,
  },
});

const blinkFrame = (
  timestampMs: number,
  leftBlink: number,
  rightBlink: number,
  stableForAction = true,
) => ({
  timestampMs,
  leftBlink,
  rightBlink,
  usableForAction: true,
  stableForAction,
});

describe('adversarial gaze control behavior', () => {
  it('engages authority on the first accepted closure and keeps it through completion', () => {
    const blink = new DoubleBlinkControl();
    expect(blink.update(blinkFrame(1_000, 0.1, 0.1))).toBe('none');
    expect(blink.update(blinkFrame(1_100, 0.1, 0.1))).toBe('none');
    expect(blink.isSequenceEngaged()).toBe(false);

    expect(blink.update(blinkFrame(1_150, 0.9, 0.9, false))).toBe('none');
    expect(blink.isSequenceEngaged()).toBe(true);
    expect(blink.update(blinkFrame(1_220, 0.1, 0.1))).toBe('none');
    expect(blink.isSequenceEngaged()).toBe(true);
    expect(blink.update(blinkFrame(1_300, 0.9, 0.9, false))).toBe('none');
    expect(blink.isSequenceEngaged()).toBe(true);
    expect(blink.update(blinkFrame(1_370, 0.1, 0.1))).toBe('action');
    expect(blink.isSequenceEngaged()).toBe(false);
  });

  it('cancels a fully open unstable saccade between blink closures', () => {
    const blink = new DoubleBlinkControl();
    blink.update(blinkFrame(1_000, 0.1, 0.1));
    blink.update(blinkFrame(1_100, 0.1, 0.1));
    blink.update(blinkFrame(1_150, 0.9, 0.9, false));
    expect(blink.isSequenceEngaged()).toBe(true);
    blink.update(blinkFrame(1_220, 0.1, 0.1, false));
    expect(blink.isSequenceEngaged()).toBe(false);
    blink.update(blinkFrame(1_300, 0.9, 0.9, false));
    expect(blink.update(blinkFrame(1_370, 0.1, 0.1))).toBe('none');
  });

  it('never engages a unilateral wink or a closure without a fresh stable lock', () => {
    const wink = new DoubleBlinkControl();
    wink.update(blinkFrame(2_000, 0.1, 0.1));
    wink.update(blinkFrame(2_100, 0.1, 0.1));
    expect(wink.update(blinkFrame(2_150, 0.92, 0.08, false))).toBe('none');
    expect(wink.isSequenceEngaged()).toBe(false);

    const noLock = new DoubleBlinkControl();
    expect(noLock.update(blinkFrame(3_000, 0.9, 0.9, false))).toBe('none');
    expect(noLock.isSequenceEngaged()).toBe(false);
  });

  it('accepts the freshness boundary but rejects stale, future and duplicate gaze frames', () => {
    const observation = {
      timestampMs: 5_000,
      features: [0.45, 0.55, 0, 0, 0, 0, 0, 0] as GazeFeatureVector,
      confidence: 0.9,
      usableForAction: true,
    };

    expect(new GazeAimController().update(observation, directProfile(), 5_180)).not.toBeNull();
    expect(new GazeAimController().update(observation, directProfile(), 5_181)).toBeNull();
    expect(new GazeAimController().update(observation, directProfile(), 4_987)).toBeNull();

    const duplicate = new GazeAimController();
    expect(duplicate.update(observation, directProfile(), 5_020)).not.toBeNull();
    expect(duplicate.update(observation, directProfile(), 5_021)).toBeNull();
  });

  it('keeps a fired dwell consumed across uncertainty until a deliberate target departure', () => {
    const dwell = new GazeDwellControl(650);
    const frame = (
      timestampMs: number,
      targetId: string | null,
      usableForAction = true,
      stableForAction = true,
    ) => ({ timestampMs, targetId, usableForAction, stableForAction });

    for (const timestampMs of [1_000, 1_130, 1_260, 1_390, 1_520]) {
      expect(dwell.update(frame(timestampMs, 'orb-7')).action).toBe(false);
    }
    expect(dwell.update(frame(1_650, 'orb-7'))).toMatchObject({
      targetId: 'orb-7',
      progress: 1,
      action: true,
    });

    expect(dwell.update(frame(1_780, null, false, false))).toMatchObject({
      targetId: 'orb-7',
      progress: 1,
      action: false,
    });
    expect(dwell.update(frame(2_200, 'orb-7'))).toMatchObject({
      targetId: 'orb-7',
      progress: 1,
      action: false,
    });
    expect(dwell.update(frame(2_300, 'orb-7', true, false))).toMatchObject({
      targetId: 'orb-7',
      progress: 1,
      action: false,
    });
    expect(dwell.update(frame(2_400, null))).toEqual({
      targetId: null,
      progress: 0,
      action: false,
    });
    expect(dwell.update(frame(2_500, 'orb-7'))).toMatchObject({
      progress: 0,
      action: false,
    });
  });
});

describe('worker blink feature hold invariants', () => {
  const worker = readText('src/game/handtracking.worker.ts');
  const compactGaze = between(
    worker,
    'function compactGazeResult(',
    'workerScope.onmessage = async',
  );

  it('holds features only for a bilateral closure backed by a fresh open-eye sample', () => {
    expect(compactGaze).toMatch(
      /hasBlinkSignals\s*&&\s*leftBlink\s*>=\s*0\.44\s*&&\s*rightBlink\s*>=\s*0\.44/,
    );
    expect(compactGaze).toContain('const held = lastOpenGaze;');
    expect(compactGaze).toContain(
      'timestampMs - held.timestampMs > GAZE_BLINK_FEATURE_HOLD_MS',
    );
    expect(compactGaze).toContain('if (!held ||');
    expect(compactGaze).toContain('return null;');
    expect(compactGaze).toMatch(
      /leftBlink\s*<=\s*0\.32\s*&&\s*rightBlink\s*<=\s*0\.32\s*&&\s*compact\.confidence\s*>=\s*0\.62/,
    );
  });

  it('invalidates the hold when face translation, scale or roll changes', () => {
    expect(compactGaze).toContain(
      'Math.hypot(faceCenterX - held.features[4], faceCenterY - held.features[5]) <= 0.04',
    );
    expect(compactGaze).toContain(
      'Math.abs(faceScale - held.features[6]) <= Math.max(0.018, held.features[6] * 0.16)',
    );
    expect(compactGaze).toContain(
      'Math.abs(faceRoll - held.features[7]) <= 0.08',
    );
    expect(compactGaze).toMatch(
      /if\s*\(!held\s*\|\|[\s\S]*\|\|\s*!headStill\)\s*return null;/,
    );
  });
});

const sceneCases = [
  {
    name: 'bubble shooter',
    source: readText('src/scenes/GameScene.ts'),
    pollEnd: 'private pollHybridHand(): void',
    hybridEnd: '/** Interpolate every Phaser frame',
    stableAuthority: 'gazeStableAim',
    blinkAuthority: 'gazeBlinkAim',
    stableLocal: 'stableAim',
    aimLocal: 'point',
    startEnd: 'private fallbackTutorialToPointerInput',
  },
  {
    name: 'match-3',
    source: readText('src/scenes/Match3Scene.ts'),
    pollEnd: 'private activateGazeCell(',
    hybridStart: 'private pollGazeHand(): void',
    hybridEnd: 'private advanceGazeCursor(',
    stableAuthority: 'gazeStableCell',
    blinkAuthority: 'gazeBlinkCell',
    stableLocal: 'stableCell',
    aimLocal: 'aim',
    startEnd: 'private suspendHandTracking',
  },
  {
    name: 'endless',
    source: readText('src/scenes/EndlessScene.ts'),
    pollEnd: 'private pollHybridHand(): void',
    hybridEnd: 'private advanceGazeAim(): void',
    stableAuthority: 'gazeStableLane',
    blinkAuthority: 'gazeBlinkLane',
    stableLocal: 'stableLane',
    aimLocal: 'aim',
    startEnd: 'private async toggleHand',
  },
] as const;

describe('scene gaze authority hardening', () => {
  it.each(sceneCases)(
    '$name freezes the first-closure authority instead of following later gaze',
    ({ source, pollEnd, stableAuthority, blinkAuthority, stableLocal }) => {
      const poll = between(source, 'private pollGaze(): void', pollEnd);
      const engage = poll.indexOf('this.gazeBlinkControl.isSequenceEngaged()');
      const freeze = poll.indexOf(`if (!this.${blinkAuthority} && ${stableLocal})`);
      expect(engage).toBeGreaterThanOrEqual(0);
      expect(freeze).toBeGreaterThan(engage);
      expect(poll).toContain(`? this.${blinkAuthority}`);
      expect(poll).toContain(`: this.${stableAuthority}`);
      expect(poll).not.toContain(`this.${blinkAuthority} = this.${stableAuthority}`);
    },
  );

  it.each(sceneCases)(
    '$name requires fresh stable open-eye evidence before updating authority',
    ({ source, pollEnd, stableAuthority, aimLocal }) => {
      const poll = between(source, 'private pollGaze(): void', pollEnd);
      expect(poll).toContain(`${aimLocal}.usableForAction`);
      expect(poll).toContain(`${aimLocal}.stableForAction`);
      expect(poll).toContain('now - observation.timestampMs <= 180');
      expect(poll).toContain(
        'observation.leftBlink <= 0.32 && observation.rightBlink <= 0.32',
      );
      expect(poll).toContain(`this.${stableAuthority} =`);
      expect(poll).toContain(`now - this.${stableAuthority}.timestampMs <= 260`);
    },
  );

  it.each(sceneCases)(
    '$name binds calibration to the resolved live camera at startup and while playing',
    ({ source, pollEnd, startEnd }) => {
      const start = between(
        source,
        'private async startHandTracking',
        startEnd,
      );
      expect(start).toContain(
        'const resolvedCameraId = tracker.getActiveCameraDeviceId();',
      );
      expect(start).toContain(
        'currentGazeCalibrationIdentity(resolvedCameraId, handSettings.mirror)',
      );
      expect(start).toMatch(
        /if\s*\(!resolvedCameraId\s*\|\|\s*!gazeCalibrationMatches\([^,]+,\s*activeIdentity\)\)/,
      );
      expect(start).toContain('tracker.disable();');

      const poll = between(source, 'private pollGaze(): void', pollEnd);
      expect(poll).toContain(
        'const activeCameraId = getHandTracker().getActiveCameraDeviceId();',
      );
      expect(poll).toContain(
        'currentGazeCalibrationIdentity(activeCameraId, handSettings.mirror)',
      );
      expect(poll).toMatch(
        /if\s*\(!activeCameraId\s*\|\|\s*!gazeCalibrationMatches\(profile,\s*identity\)\)/,
      );
      expect(poll).toContain('getHandTracker().disable();');
    },
  );

  it('stable-gates hybrid aim/lane sources in shooter and endless', () => {
    const shooter = sceneCases[0];
    const shooterHybrid = between(
      shooter.source,
      'private pollHybridHand(): void',
      shooter.hybridEnd,
    );
    expect(shooterHybrid).toContain(
      'this.gazeStableAim && now - this.gazeStableAim.timestampMs <= 260',
    );
    expect(shooterHybrid).toContain(
      'this.handLockedAim = freshGaze ? { x: freshGaze.x, y: freshGaze.y } : null;',
    );
    expect(shooterHybrid).toContain('const aim = this.handLockedAim;');

    const endless = sceneCases[2];
    const endlessHybrid = between(
      endless.source,
      'private pollHybridHand(): void',
      endless.hybridEnd,
    );
    expect(endlessHybrid).toContain(
      'this.gazeStableLane\n        && now - this.gazeStableLane.timestampMs <= 260',
    );
    expect(endlessHybrid).toContain('this.handLockedLane = stableLane;');
    expect(endlessHybrid).toContain('const lane = this.handLockedLane;');
  });

  it('does not consume a new shooter or endless dwell target while a shot is flying', () => {
    for (const scene of [sceneCases[0], sceneCases[2]]) {
      const poll = between(scene.source, 'private pollGaze(): void', scene.pollEnd);
      expect(poll).toContain('usableForAction: stableTarget && bothEyesOpen && !this.flying');
    }
  });

  it('requires stable open-eye evidence before an outside-grid dwell departure rearms', () => {
    const match3Poll = between(
      sceneCases[1].source,
      'private pollGaze(): void',
      sceneCases[1].pollEnd,
    );
    const noCell = between(match3Poll, 'if (!cell) {', 'if (stableTarget && bothEyesOpen)');
    expect(noCell).toContain('usableForAction: stableTarget && bothEyesOpen');

    const endlessPoll = between(
      sceneCases[2].source,
      'private pollGaze(): void',
      sceneCases[2].pollEnd,
    );
    const outside = between(endlessPoll, 'if (!insidePlayfield) {', 'if (stableTarget && bothEyesOpen)');
    expect(outside).toContain('usableForAction: stableTarget && bothEyesOpen');
  });

  it('stable-gates both Match-3 hybrid source and adjacent release candidate', () => {
    const match3 = sceneCases[1];
    const poll = between(match3.source, 'private pollGaze(): void', match3.pollEnd);
    const stableOpenBlock = between(
      poll,
      'if (stableTarget && bothEyesOpen) {',
      "if (this.visionMode === 'gaze-hand')",
    );
    expect(stableOpenBlock).toContain(
      'this.gazePinchCandidate = areMatch3Neighbors(this.gazePinchSource, cell)',
    );
    expect(stableOpenBlock).toContain('timestampMs: observation.timestampMs');

    const hybrid = between(
      match3.source,
      match3.hybridStart,
      match3.hybridEnd,
    );
    expect(hybrid).toContain(
      'this.gazeStableCell\n        && now - this.gazeStableCell.timestampMs <= 260',
    );
    expect(hybrid).toContain(
      'now - this.gazePinchCandidate.timestampMs <= 260',
    );
    expect(hybrid).toContain(
      'source && candidate && areMatch3Neighbors(source, candidate)',
    );
  });

  it('calibration captures the camera identity resolved by the running stream', () => {
    const setup = readText('src/scenes/GazeSetupScene.ts');
    const startCamera = between(
      setup,
      'private async startCamera(): Promise<boolean>',
      'private stopCamera(): void',
    );
    expect(startCamera).toContain(
      'const resolvedDeviceId = getHandTracker().getActiveCameraDeviceId();',
    );
    expect(startCamera).toContain("if (mode !== 'hand' && !resolvedDeviceId)");
    expect(startCamera).toContain('updateHandSettings({ deviceId: resolvedDeviceId });');

    const startCalibration = between(
      setup,
      'private async startCalibration(): Promise<void>',
      'private beginCalibrationPoint(): void',
    );
    expect(startCalibration.indexOf('const ready = await this.startCamera();'))
      .toBeLessThan(startCalibration.indexOf('const hand = getHandSettings();'));
    expect(startCalibration).toContain(
      'this.calibrationIdentity = currentGazeCalibrationIdentity(hand.deviceId, hand.mirror);',
    );
  });
});

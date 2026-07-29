import { describe, expect, it } from 'vitest';
import {
  DoubleBlinkControl,
  GazeAimController,
  GazeDwellControl,
  applyGazeCalibration,
  fitGazeCalibration,
  type GazeCalibrationObservation,
  type GazeFeatureVector,
} from '../src/game/gazecontrol';
import {
  GAZE_CALIBRATION_ALGORITHM_REVISION,
  createGazeCalibrationIdentity,
  type GazeCalibrationProfile,
} from '../src/game/gazesettings';

const identity = createGazeCalibrationIdentity({
  cameraId: 'front-camera',
  mirror: true,
  viewportWidth: 1_280,
  viewportHeight: 720,
});

const featuresFor = (x: number, y: number, noise = 0): GazeFeatureVector => [
  -0.24 + 0.46 * x + 0.03 * y + noise,
  -0.16 + 0.02 * x + 0.34 * y - noise,
  -0.23 + 0.45 * x + 0.025 * y - noise * 0.5,
  -0.15 + 0.018 * x + 0.33 * y + noise * 0.5,
  0.43 + 0.08 * x + noise * 0.2,
  0.44 + 0.08 * y - noise * 0.2,
  0.24 + 0.025 * y,
  -0.06 + 0.1 * x - 0.03 * y,
  0.34 + 0.04 * y - 0.02 * x,
  -0.025 + 0.05 * x - 0.03 * y,
];

const calibrationSamples = (): GazeCalibrationObservation[] => {
  const samples: GazeCalibrationObservation[] = [];
  for (const y of [0.1, 0.5, 0.9]) {
    for (const x of [0.1, 0.5, 0.9]) {
      [
        -0.006, -0.005, -0.004, -0.003, -0.002, -0.001, -0.0005,
        0, 0.0005, 0.001, 0.002, 0.003, 0.004, 0.005, 0.006,
      ].forEach((noise) => {
        samples.push({
          targetX: x,
          targetY: y,
          features: featuresFor(x, y, noise),
          confidence: 0.92,
          registration: {
            leftOpenness: 0.22 + noise * 0.1,
            rightOpenness: 0.21 - noise * 0.1,
            faceScale: 0.24 + 0.025 * y,
            headYaw: -0.06 + 0.1 * x - 0.03 * y,
            headPitch: 0.34 + 0.04 * y - 0.02 * x,
            headRoll: -0.025 + 0.05 * x - 0.03 * y,
          },
        });
      });
      // One extreme capture per target must not drag the fit.
      samples.push({
        targetX: x,
        targetY: y,
        features: featuresFor(x, y, 0.18),
        confidence: 0.7,
        registration: {
          leftOpenness: 0.22,
          rightOpenness: 0.21,
          faceScale: 0.24,
          headYaw: 0,
          headPitch: 0.35,
          headRoll: 0,
        },
      });
    }
  }
  return samples;
};

const directProfile = (): GazeCalibrationProfile => ({
  algorithmRevision: GAZE_CALIBRATION_ALGORITHM_REVISION,
  revision: 0,
  createdAtMs: 0,
  identity,
  featureMean: Array(10).fill(0),
  featureScale: Array(10).fill(1),
  xCoefficients: [0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  yCoefficients: [0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0],
  quality: {
    rmse: 0.02,
    rmseX: 0.02,
    rmseY: 0.02,
    p95Error: 0.04,
    maxPointError: 0.035,
    coverage: 0.64,
    sampleCount: 135,
    pointCount: 9,
  },
  registration: {
    leftOpenness: 0.22,
    rightOpenness: 0.21,
    faceScale: 0.24,
    headYaw: 0,
    headPitch: 0.35,
    headRoll: 0,
  },
});

describe('robust gaze calibration', () => {
  it('fits a full nine-point affine map and resists per-point outliers', () => {
    const profile = fitGazeCalibration(calibrationSamples(), identity);
    expect(profile).not.toBeNull();
    const point = applyGazeCalibration(profile!, featuresFor(0.72, 0.31));
    expect(point?.x).toBeCloseTo(0.72, 1);
    expect(point?.y).toBeCloseTo(0.31, 1);
    expect(profile!.quality.pointCount).toBe(9);
    expect(profile!.quality.coverage).toBeCloseTo(0.64, 6);
    expect(profile!.quality.rmse).toBeLessThan(0.08);
    expect(profile!.quality.p95Error).toBeLessThan(0.14);
    expect(profile!.quality.maxPointError).toBeLessThan(0.11);
    expect(profile!.registration).toMatchObject({
      leftOpenness: expect.any(Number),
      rightOpenness: expect.any(Number),
      faceScale: expect.any(Number),
    });
  });

  it('rejects incomplete, narrow and high-error captures', () => {
    expect(fitGazeCalibration(calibrationSamples().slice(0, 26), identity)).toBeNull();
    const narrow = calibrationSamples().map((sample) => ({
      ...sample,
      targetX: 0.4 + sample.targetX * 0.2,
      targetY: 0.4 + sample.targetY * 0.2,
    }));
    expect(fitGazeCalibration(narrow, identity)).toBeNull();

    const contradictory = calibrationSamples().map((sample, index) => ({
      ...sample,
      features: featuresFor((index * 7) % 10 / 10, (index * 3) % 10 / 10),
    }));
    expect(fitGazeCalibration(contradictory, identity)).toBeNull();
    expect(fitGazeCalibration(
      calibrationSamples().map(({ registration: _registration, ...sample }) => sample),
      identity,
    )).toBeNull();
  });

  it('fails closed on extrapolated or malformed features', () => {
    expect(applyGazeCalibration(directProfile(), [0.5, 0.4, 0, 0, 0, 0, 0, 0, 0, 0])).toEqual({
      x: 0.5,
      y: 0.4,
    });
    expect(applyGazeCalibration(
      directProfile(),
      [3, 3, 0, 0, 0, 0, 0, 0, 0, 0],
    )).toBeNull();
    expect(applyGazeCalibration(
      directProfile(),
      [Number.NaN, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    )).toBeNull();
  });
});

describe('gaze aim safety', () => {
  it('smooths fresh confident samples and requires stable frames for action', () => {
    const aim = new GazeAimController();
    const frame = (timestampMs: number, x: number, y: number) => aim.update({
      timestampMs,
      features: [x, y, 0, 0, 0, 0, 0, 0, 0, 0],
      confidence: 0.9,
      usableForAction: true,
    }, directProfile(), timestampMs + 20);

    expect(frame(1_000, 0.4, 0.4)?.stableForAction).toBe(false);
    expect(frame(1_033, 0.402, 0.401)?.stableForAction).toBe(false);
    expect(frame(1_075, 0.401, 0.402)?.stableForAction).toBe(true);
    const saccade = frame(1_108, 0.8, 0.2);
    expect(saccade?.saccade).toBe(true);
    expect(saccade?.stableForAction).toBe(false);
    expect(saccade?.direction).toBe('right');
  });

  it('applies bounded sensitivity around calibrated screen centre', () => {
    const observation = {
      timestampMs: 1_000,
      features: [0.7, 0.3, 0, 0, 0, 0, 0, 0, 0, 0] as GazeFeatureVector,
      confidence: 0.9,
      usableForAction: true,
    };
    const normal = new GazeAimController().update(observation, directProfile(), 1_010, {
      sensitivity: 1,
      responsiveness: 'fast',
    });
    const amplified = new GazeAimController().update(observation, directProfile(), 1_010, {
      sensitivity: 1.35,
      responsiveness: 'fast',
    });
    expect(amplified!.x).toBeGreaterThan(normal!.x);
    expect(amplified!.y).toBeLessThan(normal!.y);
  });

  it('rejects stale, duplicated, low-confidence and unusable action frames', () => {
    const aim = new GazeAimController();
    const base = {
      timestampMs: 1_000,
      features: [0.5, 0.5, 0, 0, 0, 0, 0, 0, 0, 0] as GazeFeatureVector,
      confidence: 0.9,
      usableForAction: true,
    };
    expect(aim.update(base, directProfile(), 1_181)).toBeNull();
    expect(aim.update(base, directProfile(), 1_020)).not.toBeNull();
    expect(aim.update(base, directProfile(), 1_021)).toBeNull();
    expect(aim.update({ ...base, timestampMs: 1_050, confidence: 0.4 }, directProfile(), 1_060)).toBeNull();
    expect(aim.update({ ...base, timestampMs: 1_100, usableForAction: false }, directProfile(), 1_110))
      .toMatchObject({ usableForAction: false, stableForAction: false });
  });
});

describe('deliberate gaze activation', () => {
  const blinkFrame = (
    timestampMs: number,
    closed: boolean,
    patch: Partial<Parameters<DoubleBlinkControl['update']>[0]> = {},
  ) => ({
    timestampMs,
    leftBlink: closed ? 0.9 : 0.1,
    rightBlink: closed ? 0.9 : 0.1,
    usableForAction: true,
    stableForAction: true,
    ...patch,
  });

  it('fires only after two complete bilateral short blinks', () => {
    const blink = new DoubleBlinkControl();
    expect(blink.update(blinkFrame(1_000, false))).toBe('none');
    expect(blink.update(blinkFrame(1_100, false))).toBe('none');
    expect(blink.update(blinkFrame(1_150, true))).toBe('none');
    expect(blink.update(blinkFrame(1_220, false))).toBe('none');
    expect(blink.update(blinkFrame(1_300, true))).toBe('none');
    expect(blink.update(blinkFrame(1_370, false))).toBe('action');
  });

  it.each([24, 30])('detects deliberate double blinks across %i FPS phase offsets', (fps) => {
    const interval = 1_000 / fps;
    for (const phase of [0, interval * 0.25, interval * 0.5, interval * 0.75]) {
      const blink = new DoubleBlinkControl();
      let actions = 0;
      for (let elapsed = phase; elapsed <= 650; elapsed += interval) {
        const closed = (elapsed >= 150 && elapsed < 245)
          || (elapsed >= 345 && elapsed < 440);
        const result = blink.update(blinkFrame(
          10_000 + elapsed,
          closed,
          { stableForAction: !closed },
        ));
        if (result === 'action') actions++;
      }
      expect(actions, `phase ${phase.toFixed(1)}ms at ${fps} FPS`).toBe(1);
    }
  });

  it('keeps a recent stable aim locked through bilateral eyelid geometry disturbance', () => {
    const blink = new DoubleBlinkControl();
    expect(blink.update(blinkFrame(1_000, false))).toBe('none');
    expect(blink.update(blinkFrame(1_100, false))).toBe('none');
    expect(blink.update(blinkFrame(1_150, true, { stableForAction: false }))).toBe('none');
    expect(blink.update(blinkFrame(1_220, false))).toBe('none');
    expect(blink.update(blinkFrame(1_300, true, { stableForAction: false }))).toBe('none');
    expect(blink.update(blinkFrame(1_370, false))).toBe('action');
  });

  it('cancels when fully open gaze is unstable between the two blinks', () => {
    const blink = new DoubleBlinkControl();
    blink.update(blinkFrame(1_000, false));
    blink.update(blinkFrame(1_100, false));
    blink.update(blinkFrame(1_150, true, { stableForAction: false }));
    expect(blink.update(blinkFrame(1_220, false, { stableForAction: false }))).toBe('none');
    expect(blink.isSequenceEngaged()).toBe(false);
    blink.update(blinkFrame(1_300, true, { stableForAction: false }));
    expect(blink.update(blinkFrame(1_370, false))).toBe('none');
  });

  it('does not tolerate unstable blink frames without a recent stable open-eye lock', () => {
    const noLock = new DoubleBlinkControl();
    expect(noLock.update(blinkFrame(1_000, true, { stableForAction: false }))).toBe('none');
    expect(noLock.update(blinkFrame(1_070, false, { stableForAction: false }))).toBe('none');
    expect(noLock.update(blinkFrame(1_150, true, { stableForAction: false }))).toBe('none');
    expect(noLock.update(blinkFrame(1_220, false, { stableForAction: false }))).toBe('none');

    const expiredLock = new DoubleBlinkControl();
    expiredLock.update(blinkFrame(2_000, false));
    expiredLock.update(blinkFrame(2_100, false));
    expiredLock.update(blinkFrame(2_250, false, { leftBlink: 0.5, rightBlink: 0.5 }));
    expiredLock.update(blinkFrame(2_400, false, { leftBlink: 0.5, rightBlink: 0.5 }));
    expiredLock.update(blinkFrame(2_550, false, { leftBlink: 0.5, rightBlink: 0.5 }));
    expiredLock.update(blinkFrame(2_700, false, { leftBlink: 0.5, rightBlink: 0.5 }));
    expect(expiredLock.update(blinkFrame(2_830, true, { stableForAction: false }))).toBe('none');
  });

  it('never fires for a single blink, long closure, stale loss or saccade gate', () => {
    const single = new DoubleBlinkControl();
    single.update(blinkFrame(1_000, false));
    single.update(blinkFrame(1_100, false));
    single.update(blinkFrame(1_150, true));
    single.update(blinkFrame(1_220, false));
    expect(single.update(blinkFrame(1_700, false))).toBe('none');

    const long = new DoubleBlinkControl();
    long.update(blinkFrame(2_000, false));
    long.update(blinkFrame(2_100, false));
    long.update(blinkFrame(2_150, true));
    expect(long.update(blinkFrame(2_410, true))).toBe('none');
    expect(long.update(blinkFrame(2_480, false))).toBe('none');

    const unstable = new DoubleBlinkControl();
    unstable.update(blinkFrame(3_000, false));
    unstable.update(blinkFrame(3_100, false));
    unstable.update(blinkFrame(3_150, true, { stableForAction: false }));
    expect(unstable.update(blinkFrame(3_220, false, {
      usableForAction: false,
      stableForAction: false,
    }))).toBe('none');
    expect(unstable.update(blinkFrame(3_300, true, { stableForAction: false }))).toBe('none');
    expect(unstable.update(blinkFrame(3_370, false, { stableForAction: false }))).toBe('none');
  });

  it('dwell activates once, then requires target departure or change', () => {
    const dwell = new GazeDwellControl(700);
    const frame = (timestampMs: number, targetId: string | null, stableForAction = true) => ({
      timestampMs,
      targetId,
      usableForAction: true,
      stableForAction,
    });
    expect(dwell.update(frame(1_000, 'cell-1'))).toMatchObject({ progress: 0, action: false });
    dwell.update(frame(1_150, 'cell-1'));
    dwell.update(frame(1_300, 'cell-1'));
    expect(dwell.update(frame(1_350, 'cell-1')).progress).toBeCloseTo(0.5, 4);
    dwell.update(frame(1_500, 'cell-1'));
    dwell.update(frame(1_650, 'cell-1'));
    expect(dwell.update(frame(1_700, 'cell-1'))).toMatchObject({ progress: 1, action: true });
    expect(dwell.update(frame(1_750, 'cell-1'))).toMatchObject({ progress: 1, action: false });
    expect(dwell.update(frame(1_800, 'cell-2'))).toMatchObject({ progress: 0, action: false });
    expect(dwell.update(frame(1_850, 'cell-2', false))).toMatchObject({ progress: 0, action: false });
  });

  it('preserves a consumed dwell target across busy, uncertain and delayed frames', () => {
    const dwell = new GazeDwellControl(650);
    const frame = (
      timestampMs: number,
      targetId: string | null,
      usableForAction = true,
      stableForAction = true,
    ) => ({ timestampMs, targetId, usableForAction, stableForAction });

    expect(dwell.update(frame(1_000, 'lane-4'))).toMatchObject({ action: false });
    dwell.update(frame(1_150, 'lane-4'));
    dwell.update(frame(1_300, 'lane-4'));
    dwell.update(frame(1_450, 'lane-4'));
    dwell.update(frame(1_600, 'lane-4'));
    expect(dwell.update(frame(1_650, 'lane-4'))).toMatchObject({ action: true });
    expect(dwell.update(frame(1_720, null, false, false))).toMatchObject({
      targetId: 'lane-4',
      progress: 1,
      action: false,
    });
    expect(dwell.update(frame(2_100, 'lane-4'))).toMatchObject({
      targetId: 'lane-4',
      progress: 1,
      action: false,
    });
    expect(dwell.update(frame(2_170, 'lane-4', true, false))).toMatchObject({
      targetId: 'lane-4',
      progress: 1,
      action: false,
    });
    expect(dwell.update(frame(2_240, 'lane-4'))).toMatchObject({
      targetId: 'lane-4',
      progress: 1,
      action: false,
    });

    expect(dwell.update(frame(2_310, null))).toMatchObject({
      targetId: null,
      progress: 0,
      action: false,
    });
    expect(dwell.update(frame(2_380, 'lane-4'))).toMatchObject({ progress: 0, action: false });
  });

  it('pauses unfinished dwell across a brief uncertain frame instead of restarting', () => {
    const dwell = new GazeDwellControl(700);
    const frame = (
      timestampMs: number,
      usableForAction = true,
      stableForAction = true,
    ) => ({
      timestampMs,
      targetId: 'orb-4',
      usableForAction,
      stableForAction,
    });
    dwell.update(frame(1_000));
    dwell.update(frame(1_140));
    const before = dwell.update(frame(1_280));
    expect(before.progress).toBeCloseTo(0.4, 3);
    expect(dwell.update(frame(1_360, false, false)).progress).toBeCloseTo(before.progress, 3);
    const resumed = dwell.update(frame(1_440));
    expect(resumed.progress).toBeGreaterThanOrEqual(before.progress);
    expect(resumed.progress).toBeLessThan(0.55);
  });
});

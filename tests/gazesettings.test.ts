import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  GAZE_CALIBRATION_ALGORITHM_REVISION,
  GAZE_CALIBRATION_PROFILE_REVISION_FLOOR,
  clearGazeCalibration,
  createGazeCalibrationIdentity,
  gazeCalibrationMatches,
  getGazeSettings,
  saveGazeCalibration,
  updateGazeSettings,
  type GazeCalibrationProfile,
} from '../src/game/gazesettings';

const values = new Map<string, string>();

const profile = (): GazeCalibrationProfile => ({
  algorithmRevision: GAZE_CALIBRATION_ALGORITHM_REVISION,
  revision: 0,
  createdAtMs: 10,
  identity: createGazeCalibrationIdentity({
    cameraId: 'front-camera',
    mirror: true,
    viewportWidth: 1_280,
    viewportHeight: 720,
  }),
  featureMean: [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.25, 0],
  featureScale: [0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 0.1, 0.1],
  xCoefficients: [0.5, 0.2, 0, 0.2, 0, 0.1, 0, 0, 0],
  yCoefficients: [0.5, 0, 0.2, 0, 0.2, 0, 0.1, 0, 0],
  quality: {
    rmse: 0.04,
    rmseX: 0.035,
    rmseY: 0.045,
    coverage: 0.64,
    sampleCount: 45,
    pointCount: 9,
  },
});

beforeEach(() => {
  values.clear();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    },
  });
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { innerWidth: 1_280, innerHeight: 720, dispatchEvent: vi.fn() },
  });
});

describe('device-local gaze settings', () => {
  it('starts camera control off and bounds corrupt user settings', () => {
    expect(getGazeSettings()).toMatchObject({
      mode: 'off',
      activation: 'double-blink',
      dwellMs: 900,
      calibration: null,
    });

    expect(updateGazeSettings({
      mode: 'gaze-hand',
      activation: 'dwell',
      dwellMs: 50,
      showCursor: false,
    })).toMatchObject({
      mode: 'gaze-hand',
      activation: 'dwell',
      dwellMs: 650,
      showCursor: false,
    });

    const key = [...values.keys()][0];
    values.set(key, JSON.stringify({ mode: 'camera-secret', dwellMs: 99_000 }));
    expect(getGazeSettings()).toMatchObject({ mode: 'off', dwellMs: 2_000 });
  });

  it('assigns monotonic revisions and strips non-profile raw capture data', () => {
    vi.spyOn(Date, 'now').mockReturnValue(2_000);
    const unsafe = {
      ...profile(),
      rawSamples: [{ features: [1, 2, 3], image: 'camera-frame' }],
    } as GazeCalibrationProfile & { rawSamples: unknown };
    const first = saveGazeCalibration(unsafe).calibration;
    const second = saveGazeCalibration(profile()).calibration;

    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(first!.revision).toBeGreaterThanOrEqual(GAZE_CALIBRATION_PROFILE_REVISION_FLOOR);
    expect(second!.revision).toBe(first!.revision + 1);
    const persisted = [...values.values()].join('');
    expect(persisted).not.toContain('rawSamples');
    expect(persisted).not.toContain('camera-frame');
    vi.restoreAllMocks();
  });

  it('never accepts unsigned calibration through a general settings patch', () => {
    expect(updateGazeSettings({ calibration: profile() }).calibration).toBeNull();
    expect(saveGazeCalibration(profile()).calibration).not.toBeNull();
    expect(clearGazeCalibration().calibration).toBeNull();
  });

  it('invalidates calibration for another camera, mirror path or orientation', () => {
    const saved = saveGazeCalibration(profile()).calibration;
    expect(gazeCalibrationMatches(saved, profile().identity)).toBe(true);
    expect(gazeCalibrationMatches(saved, {
      ...profile().identity,
      cameraId: 'rear-camera',
    })).toBe(false);
    expect(gazeCalibrationMatches(saved, {
      ...profile().identity,
      mirror: false,
    })).toBe(false);
    expect(gazeCalibrationMatches(saved, createGazeCalibrationIdentity({
      cameraId: 'front-camera',
      mirror: true,
      viewportWidth: 720,
      viewportHeight: 1_280,
    }))).toBe(false);
  });

  it('rejects malformed and unbounded persisted affine profiles', () => {
    const saved = saveGazeCalibration(profile());
    const corrupt = {
      ...saved,
      calibration: {
        ...saved.calibration,
        xCoefficients: [0, 99, 0, 0, 0, 0, 0, 0, 0],
      },
    };
    values.set([...values.keys()][0], JSON.stringify(corrupt));
    expect(getGazeSettings().calibration).toBeNull();
  });

  it('keeps a blocked-storage calibration session-only and reports that it was not persisted', () => {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: () => null,
        setItem: () => { throw new Error('storage blocked'); },
      },
    });

    expect(() => saveGazeCalibration(profile())).toThrow(/active for this session/i);
    expect(getGazeSettings().calibration).not.toBeNull();
  });
});

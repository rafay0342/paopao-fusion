export type CameraControlMode = 'off' | 'hand' | 'gaze' | 'gaze-hand';
export type GazeActivationMode = 'double-blink' | 'dwell';
export type GazeResponsiveness = 'fast' | 'balanced' | 'steady';
export type GazeViewportOrientation = 'landscape' | 'portrait' | 'square';

export interface GazeCalibrationIdentity {
  cameraId: string;
  mirror: boolean;
  viewportWidth: number;
  viewportHeight: number;
  orientation: GazeViewportOrientation;
}

export interface GazeCalibrationQuality {
  /** Root-mean-square error in normalized viewport coordinates. */
  rmse: number;
  rmseX: number;
  rmseY: number;
  /** Held-out 95th-percentile and worst target-median errors. */
  p95Error: number;
  maxPointError: number;
  /** Fraction of the normalized viewport covered by the calibration targets. */
  coverage: number;
  sampleCount: number;
  pointCount: number;
}

export interface GazeEyeRegistration {
  /** Numeric open-eye geometry only; never an image or identity template. */
  leftOpenness: number;
  rightOpenness: number;
  faceScale: number;
  headYaw: number;
  headPitch: number;
  headRoll: number;
}

/**
 * Device-local affine calibration. Features are standardized before the two
 * affine axes are evaluated; no camera frame, landmark or raw sample is kept.
 */
export interface GazeCalibrationProfile {
  algorithmRevision: number;
  revision: number;
  createdAtMs: number;
  identity: GazeCalibrationIdentity;
  featureMean: number[];
  featureScale: number[];
  /** Intercept followed by one coefficient for each standardized feature. */
  xCoefficients: number[];
  /** Intercept followed by one coefficient for each standardized feature. */
  yCoefficients: number[];
  quality: GazeCalibrationQuality;
  registration: GazeEyeRegistration;
}

export interface GazeSettings {
  mode: CameraControlMode;
  activation: GazeActivationMode;
  dwellMs: number;
  showCursor: boolean;
  sensitivity: number;
  responsiveness: GazeResponsiveness;
  calibration: GazeCalibrationProfile | null;
}

export const GAZE_CALIBRATION_ALGORITHM_REVISION = 2;
export const GAZE_CALIBRATION_FEATURE_COUNT = 10;
const GAZE_CALIBRATION_REVISION_STRIDE = 1_000_000_000_000_000;
export const GAZE_CALIBRATION_PROFILE_REVISION_FLOOR = (
  GAZE_CALIBRATION_ALGORITHM_REVISION * GAZE_CALIBRATION_REVISION_STRIDE
);

const STORAGE_KEY = 'paopao-fusion-gaze-settings-v1';
const MIN_VIEWPORT_EDGE = 240;
const MAX_VIEWPORT_EDGE = 8_192;
const MAX_ABS_FEATURE_MEAN = 4;
const MAX_FEATURE_SCALE = 4;
const MIN_FEATURE_SCALE = 0.000_1;
const MAX_ABS_AFFINE_COEFFICIENT = 4;

const defaults: GazeSettings = {
  // Camera input always starts opt-in. Merely visiting a scene cannot activate
  // an old camera permission or begin processing face landmarks.
  mode: 'off',
  activation: 'double-blink',
  dwellMs: 900,
  showCursor: true,
  sensitivity: 1,
  responsiveness: 'balanced',
  calibration: null,
};

let sessionSettings: GazeSettings | null = null;
let sessionFallbackActive = false;

const clamp = (value: number, minimum: number, maximum: number): number => (
  Math.min(maximum, Math.max(minimum, value))
);

const finiteNumber = (value: unknown): number | null => {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const safeInteger = (value: unknown, minimum: number, maximum: number): number | null => {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= minimum && number <= maximum ? number : null;
};

export function gazeViewportOrientation(
  width: number,
  height: number,
): GazeViewportOrientation {
  const ratio = width / Math.max(1, height);
  if (ratio > 1.08) return 'landscape';
  if (ratio < 0.92) return 'portrait';
  return 'square';
}

export function createGazeCalibrationIdentity(input: {
  cameraId: string;
  mirror: boolean;
  viewportWidth: number;
  viewportHeight: number;
  orientation?: GazeViewportOrientation;
}): GazeCalibrationIdentity {
  const viewportWidth = clamp(
    Math.round(finiteNumber(input.viewportWidth) ?? MIN_VIEWPORT_EDGE),
    MIN_VIEWPORT_EDGE,
    MAX_VIEWPORT_EDGE,
  );
  const viewportHeight = clamp(
    Math.round(finiteNumber(input.viewportHeight) ?? MIN_VIEWPORT_EDGE),
    MIN_VIEWPORT_EDGE,
    MAX_VIEWPORT_EDGE,
  );
  const derivedOrientation = gazeViewportOrientation(viewportWidth, viewportHeight);
  return {
    cameraId: String(input.cameraId ?? '').slice(0, 256),
    mirror: input.mirror === true,
    viewportWidth,
    viewportHeight,
    // Orientation is derived instead of trusting corrupt persisted metadata.
    orientation: input.orientation === derivedOrientation ? input.orientation : derivedOrientation,
  };
}

/** Runtime identity helper shared by scenes and the calibration flow. */
export function currentGazeCalibrationIdentity(
  deviceId: string,
  mirror: boolean,
  viewportWidth = typeof window === 'undefined' ? 1_280 : window.innerWidth,
  viewportHeight = typeof window === 'undefined' ? 720 : window.innerHeight,
): GazeCalibrationIdentity {
  return createGazeCalibrationIdentity({
    cameraId: deviceId,
    mirror,
    viewportWidth,
    viewportHeight,
  });
}

const safeCalibrationRevision = (value: unknown): number => {
  const revision = Number(value);
  return Number.isSafeInteger(revision)
    && revision >= GAZE_CALIBRATION_PROFILE_REVISION_FLOOR
    ? revision
    : 0;
};

const nextCalibrationRevision = (previous: number): number => (
  Math.max(
    GAZE_CALIBRATION_PROFILE_REVISION_FLOOR + Date.now(),
    safeCalibrationRevision(previous) + 1,
  )
);

const safeVector = (
  value: unknown,
  count: number,
  minimum: number,
  maximum: number,
): number[] | null => {
  if (!Array.isArray(value) || value.length !== count) return null;
  const result = value.map(finiteNumber);
  if (result.some((item) => item === null || item < minimum || item > maximum)) return null;
  return result as number[];
};

const sanitizeIdentity = (value: unknown): GazeCalibrationIdentity | null => {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<GazeCalibrationIdentity>;
  const viewportWidth = safeInteger(candidate.viewportWidth, MIN_VIEWPORT_EDGE, MAX_VIEWPORT_EDGE);
  const viewportHeight = safeInteger(candidate.viewportHeight, MIN_VIEWPORT_EDGE, MAX_VIEWPORT_EDGE);
  if (viewportWidth === null || viewportHeight === null || typeof candidate.cameraId !== 'string') return null;
  const identity = createGazeCalibrationIdentity({
    cameraId: candidate.cameraId,
    mirror: candidate.mirror === true,
    viewportWidth,
    viewportHeight,
    orientation: candidate.orientation,
  });
  if (identity.orientation !== candidate.orientation || candidate.cameraId.length > 256) return null;
  return identity;
};

/**
 * Validates persisted calibration as hostile input. A corrupt coefficient can
 * otherwise turn one uncertain face frame into an edge click.
 */
export function sanitizeGazeCalibrationProfile(
  value: unknown,
  allowUnsignedRevision = false,
): GazeCalibrationProfile | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<GazeCalibrationProfile>;
  if (candidate.algorithmRevision !== GAZE_CALIBRATION_ALGORITHM_REVISION) return null;
  const revision = safeCalibrationRevision(candidate.revision);
  if (!allowUnsignedRevision && revision === 0) return null;
  const createdAtMs = safeInteger(candidate.createdAtMs, 0, Number.MAX_SAFE_INTEGER);
  const identity = sanitizeIdentity(candidate.identity);
  const featureMean = safeVector(
    candidate.featureMean,
    GAZE_CALIBRATION_FEATURE_COUNT,
    -MAX_ABS_FEATURE_MEAN,
    MAX_ABS_FEATURE_MEAN,
  );
  const featureScale = safeVector(
    candidate.featureScale,
    GAZE_CALIBRATION_FEATURE_COUNT,
    MIN_FEATURE_SCALE,
    MAX_FEATURE_SCALE,
  );
  const xCoefficients = safeVector(
    candidate.xCoefficients,
    GAZE_CALIBRATION_FEATURE_COUNT + 1,
    -MAX_ABS_AFFINE_COEFFICIENT,
    MAX_ABS_AFFINE_COEFFICIENT,
  );
  const yCoefficients = safeVector(
    candidate.yCoefficients,
    GAZE_CALIBRATION_FEATURE_COUNT + 1,
    -MAX_ABS_AFFINE_COEFFICIENT,
    MAX_ABS_AFFINE_COEFFICIENT,
  );
  if (
    createdAtMs === null
    || !identity
    || !featureMean
    || !featureScale
    || !xCoefficients
    || !yCoefficients
    || !candidate.quality
    || typeof candidate.quality !== 'object'
  ) return null;

  const qualityCandidate = candidate.quality as Partial<GazeCalibrationQuality>;
  const rmse = finiteNumber(qualityCandidate.rmse);
  const rmseX = finiteNumber(qualityCandidate.rmseX);
  const rmseY = finiteNumber(qualityCandidate.rmseY);
  const p95Error = finiteNumber(qualityCandidate.p95Error);
  const maxPointError = finiteNumber(qualityCandidate.maxPointError);
  const coverage = finiteNumber(qualityCandidate.coverage);
  const sampleCount = safeInteger(qualityCandidate.sampleCount, 27, 10_000);
  const pointCount = safeInteger(qualityCandidate.pointCount, 9, 100);
  if (
    rmse === null || rmse < 0 || rmse > 1
    || rmseX === null || rmseX < 0 || rmseX > 1
    || rmseY === null || rmseY < 0 || rmseY > 1
    || p95Error === null || p95Error < 0 || p95Error > 1
    || maxPointError === null || maxPointError < 0 || maxPointError > 1
    || coverage === null || coverage < 0 || coverage > 1
    || sampleCount === null
    || pointCount === null
  ) return null;

  const registrationCandidate = candidate.registration as Partial<GazeEyeRegistration> | undefined;
  const leftOpenness = finiteNumber(registrationCandidate?.leftOpenness);
  const rightOpenness = finiteNumber(registrationCandidate?.rightOpenness);
  const faceScale = finiteNumber(registrationCandidate?.faceScale);
  const headYaw = finiteNumber(registrationCandidate?.headYaw);
  const headPitch = finiteNumber(registrationCandidate?.headPitch);
  const headRoll = finiteNumber(registrationCandidate?.headRoll);
  if (
    leftOpenness === null || leftOpenness < 0.025 || leftOpenness > 0.8
    || rightOpenness === null || rightOpenness < 0.025 || rightOpenness > 0.8
    || faceScale === null || faceScale < 0.04 || faceScale > 1
    || headYaw === null || Math.abs(headYaw) > 1
    || headPitch === null || headPitch < -1 || headPitch > 1.5
    || headRoll === null || Math.abs(headRoll) > 1
  ) return null;

  return {
    algorithmRevision: GAZE_CALIBRATION_ALGORITHM_REVISION,
    revision: allowUnsignedRevision ? revision : Math.max(revision, GAZE_CALIBRATION_PROFILE_REVISION_FLOOR),
    createdAtMs,
    identity,
    featureMean,
    featureScale,
    xCoefficients,
    yCoefficients,
    quality: {
      rmse,
      rmseX,
      rmseY,
      p95Error,
      maxPointError,
      coverage,
      sampleCount,
      pointCount,
    },
    registration: {
      leftOpenness,
      rightOpenness,
      faceScale,
      headYaw,
      headPitch,
      headRoll,
    },
  };
}

const safeMode = (value: unknown): CameraControlMode => (
  value === 'off' || value === 'hand' || value === 'gaze' || value === 'gaze-hand'
    ? value
    : defaults.mode
);

const safeActivation = (value: unknown): GazeActivationMode => (
  value === 'double-blink' || value === 'dwell' ? value : defaults.activation
);

const safeResponsiveness = (value: unknown): GazeResponsiveness => (
  value === 'fast' || value === 'balanced' || value === 'steady'
    ? value
    : defaults.responsiveness
);

const sanitizeSettings = (value: unknown): GazeSettings => {
  const saved = value && typeof value === 'object' ? value as Partial<GazeSettings> : {};
  return {
    mode: safeMode(saved.mode),
    activation: safeActivation(saved.activation),
    dwellMs: clamp(Math.round(finiteNumber(saved.dwellMs) ?? defaults.dwellMs), 650, 2_000),
    showCursor: saved.showCursor !== false,
    sensitivity: clamp(finiteNumber(saved.sensitivity) ?? defaults.sensitivity, 0.75, 1.35),
    responsiveness: safeResponsiveness(saved.responsiveness),
    calibration: sanitizeGazeCalibrationProfile(saved.calibration),
  };
};

export function getGazeSettings(): GazeSettings {
  try {
    if (typeof localStorage === 'undefined') {
      sessionFallbackActive = true;
      return sessionSettings ?? { ...defaults };
    }
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const settings = sanitizeSettings(JSON.parse(raw));
      sessionSettings = settings;
      sessionFallbackActive = false;
      return settings;
    }
    if (sessionFallbackActive && sessionSettings) return sessionSettings;
    sessionSettings = null;
    return { ...defaults };
  } catch {
    sessionFallbackActive = true;
    return sessionSettings ?? { ...defaults };
  }
}

const publish = (settings: GazeSettings): boolean => {
  sessionSettings = settings;
  let persisted = false;
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
      persisted = true;
    }
  } catch {
    // Keep the normalized profile useful for this tab, while callers that
    // promise durable calibration can report the storage failure honestly.
  }
  sessionFallbackActive = !persisted;
  if (typeof window !== 'undefined' && typeof CustomEvent === 'function') {
    window.dispatchEvent(new CustomEvent('paopao:gaze-settings', { detail: settings }));
  }
  return persisted;
};

export function updateGazeSettings(patch: Partial<GazeSettings>): GazeSettings {
  const current = getGazeSettings();
  // Calibration can only be created through saveGazeCalibration. This keeps a
  // settings toggle from smuggling arbitrary affine input into gameplay.
  const calibration = patch.calibration === undefined
    ? current.calibration
    : sanitizeGazeCalibrationProfile(patch.calibration);
  const next = sanitizeSettings({ ...current, ...patch, calibration });
  publish(next);
  return next;
}

export function saveGazeCalibration(profile: GazeCalibrationProfile): GazeSettings {
  const candidate = sanitizeGazeCalibrationProfile(profile, true);
  if (!candidate) return getGazeSettings();
  const current = getGazeSettings();
  const calibration: GazeCalibrationProfile = {
    ...candidate,
    revision: nextCalibrationRevision(current.calibration?.revision ?? 0),
    createdAtMs: Date.now(),
  };
  const next = sanitizeSettings({ ...current, calibration });
  if (!publish(next)) {
    throw new Error('Gaze calibration is active for this session but could not be stored.');
  }
  return next;
}

export function clearGazeCalibration(): GazeSettings {
  const next = { ...getGazeSettings(), calibration: null };
  publish(next);
  return next;
}

/**
 * Exact camera/mirror/orientation matching plus a tolerant aspect check.
 * Resizing browser chrome should not force recalibration, while rotating the
 * device or changing the optical path must fail closed.
 */
export function gazeCalibrationMatches(
  profile: GazeCalibrationProfile | null,
  identity: GazeCalibrationIdentity,
): boolean {
  if (!profile) return false;
  const calibrated = profile.identity;
  if (
    calibrated.cameraId !== identity.cameraId
    || calibrated.mirror !== identity.mirror
    || calibrated.orientation !== identity.orientation
  ) return false;
  const calibratedRatio = calibrated.viewportWidth / calibrated.viewportHeight;
  const currentRatio = identity.viewportWidth / identity.viewportHeight;
  return Math.abs(Math.log(calibratedRatio / currentRatio)) <= 0.12;
}

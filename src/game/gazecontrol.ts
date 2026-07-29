import {
  GAZE_CALIBRATION_ALGORITHM_REVISION,
  GAZE_CALIBRATION_FEATURE_COUNT,
  gazeCalibrationMatches,
  type GazeCalibrationIdentity,
  type GazeCalibrationProfile,
  type GazeEyeRegistration,
  type GazeResponsiveness,
} from './gazesettings';
import type { GazeFeatureVector } from './gazefeatures';

export const GAZE_FEATURE_COUNT = GAZE_CALIBRATION_FEATURE_COUNT;
export const GAZE_ACTION_MAX_AGE_MS = 180;
export const GAZE_MIN_ACTION_CONFIDENCE = 0.68;
export type { GazeFeatureVector } from './gazefeatures';

export interface GazePoint {
  x: number;
  y: number;
}

export interface GazeCalibrationObservation {
  targetX: number;
  targetY: number;
  features: GazeFeatureVector;
  confidence?: number;
  registration?: GazeEyeRegistration;
}

export interface GazeTrackingObservation {
  timestampMs: number;
  features: GazeFeatureVector;
  confidence: number;
  usableForAction: boolean;
}

export interface GazeAimSample extends GazePoint {
  rawX: number;
  rawY: number;
  confidence: number;
  timestampMs: number;
  usableForAction: boolean;
  stableForAction: boolean;
  saccade: boolean;
  direction: 'left' | 'right' | 'up' | 'down' | 'steady';
}

export interface GazeAimTuning {
  sensitivity?: number;
  responsiveness?: GazeResponsiveness;
}

const clamp = (value: number, minimum: number, maximum: number): number => (
  Math.min(maximum, Math.max(minimum, value))
);
const clamp01 = (value: number): number => clamp(value, 0, 1);
const median = (values: readonly number[]): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
};

const validFeatureVector = (features: readonly number[]): features is GazeFeatureVector => (
  features.length === GAZE_FEATURE_COUNT
  && features.every((value) => Number.isFinite(value) && Math.abs(value) <= 4)
);

const solveLinearSystem = (matrix: number[][], vector: number[]): number[] | null => {
  const size = vector.length;
  const augmented = matrix.map((row, index) => [...row, vector[index]]);
  for (let column = 0; column < size; column++) {
    let pivot = column;
    for (let row = column + 1; row < size; row++) {
      if (Math.abs(augmented[row][column]) > Math.abs(augmented[pivot][column])) pivot = row;
    }
    if (Math.abs(augmented[pivot][column]) < 1e-9) return null;
    [augmented[column], augmented[pivot]] = [augmented[pivot], augmented[column]];
    const divisor = augmented[column][column];
    for (let index = column; index <= size; index++) augmented[column][index] /= divisor;
    for (let row = 0; row < size; row++) {
      if (row === column) continue;
      const factor = augmented[row][column];
      if (Math.abs(factor) < 1e-12) continue;
      for (let index = column; index <= size; index++) {
        augmented[row][index] -= factor * augmented[column][index];
      }
    }
  }
  const result = augmented.map((row) => row[size]);
  return result.every(Number.isFinite) ? result : null;
};

const fitAxis = (
  design: readonly number[][],
  targets: readonly number[],
  weights: readonly number[],
  ridge = 0.025,
): number[] | null => {
  const dimensions = design[0]?.length ?? 0;
  if (dimensions === 0 || design.length !== targets.length || design.length !== weights.length) return null;
  const matrix = Array.from({ length: dimensions }, () => Array(dimensions).fill(0));
  const vector = Array(dimensions).fill(0);
  for (let row = 0; row < design.length; row++) {
    const weight = weights[row];
    for (let first = 0; first < dimensions; first++) {
      vector[first] += weight * design[row][first] * targets[row];
      for (let second = 0; second < dimensions; second++) {
        matrix[first][second] += weight * design[row][first] * design[row][second];
      }
    }
  }
  // Keep the intercept essentially unregularized while bounding correlations
  // between iris, face position and head-pose features.
  for (let index = 1; index < dimensions; index++) matrix[index][index] += ridge;
  matrix[0][0] += 1e-8;
  return solveLinearSystem(matrix, vector);
};

const predictAxis = (coefficients: readonly number[], row: readonly number[]): number => (
  coefficients.reduce((sum, coefficient, index) => sum + coefficient * row[index], 0)
);

/**
 * Fits a robust ridge-affine calibration from a full nine-point capture.
 * Returns null instead of persisting a narrow, noisy or ill-conditioned map.
 */
export function fitGazeCalibration(
  observations: readonly GazeCalibrationObservation[],
  identity: GazeCalibrationIdentity,
): GazeCalibrationProfile | null {
  const samples = observations.filter((sample) => (
    Number.isFinite(sample.targetX)
    && sample.targetX >= 0
    && sample.targetX <= 1
    && Number.isFinite(sample.targetY)
    && sample.targetY >= 0
    && sample.targetY <= 1
    && validFeatureVector(sample.features)
    && (sample.confidence === undefined
      || (Number.isFinite(sample.confidence) && sample.confidence >= 0.55 && sample.confidence <= 1))
  ));
  if (samples.length < 108) return null;

  const pointGroups = new Map<string, GazeCalibrationObservation[]>();
  for (const sample of samples) {
    const key = `${sample.targetX.toFixed(3)}:${sample.targetY.toFixed(3)}`;
    const group = pointGroups.get(key) ?? [];
    group.push(sample);
    pointGroups.set(key, group);
  }
  const completeGroups = [...pointGroups.values()].filter((group) => group.length >= 12);
  if (completeGroups.length < 9) return null;

  const used = completeGroups.flatMap((group) => {
    const centre = Array.from(
      { length: GAZE_FEATURE_COUNT },
      (_, index) => median(group.map((sample) => sample.features[index])),
    );
    const deviations = Array.from(
      { length: GAZE_FEATURE_COUNT },
      (_, index) => Math.max(
        0.002,
        median(group.map((sample) => Math.abs(sample.features[index] - centre[index]))) * 1.4826,
      ),
    );
    const inliers = group.filter((sample) => {
      const normalizedDistance = sample.features.reduce(
        (sum, value, index) => sum + Math.min(16, ((value - centre[index]) / deviations[index]) ** 2),
        0,
      ) / GAZE_FEATURE_COUNT;
      return normalizedDistance <= 7;
    });
    // Do not let one badly captured target disappear silently.
    return inliers.length >= 9 ? inliers : [];
  });
  if (used.length < 81) return null;

  const uniqueUsedPoints = new Set(used.map((sample) => `${sample.targetX.toFixed(3)}:${sample.targetY.toFixed(3)}`));
  if (uniqueUsedPoints.size < 9) return null;
  const targetXs = used.map((sample) => sample.targetX);
  const targetYs = used.map((sample) => sample.targetY);
  const xSpan = Math.max(...targetXs) - Math.min(...targetXs);
  const ySpan = Math.max(...targetYs) - Math.min(...targetYs);
  const coverage = xSpan * ySpan;
  if (
    Math.min(...targetXs) > 0.2
    || Math.max(...targetXs) < 0.8
    || Math.min(...targetYs) > 0.2
    || Math.max(...targetYs) < 0.8
    || coverage < 0.42
  ) return null;

  // Reserve a deterministic quarter of every target for validation. The old
  // profile reported training error only, so an overfit map could look good
  // while selecting the wrong neighbouring orb in real play.
  const training: GazeCalibrationObservation[] = [];
  const validation: GazeCalibrationObservation[] = [];
  for (const group of completeGroups) {
    const accepted = used.filter((sample) => (
      sample.targetX === group[0].targetX && sample.targetY === group[0].targetY
    ));
    accepted.forEach((sample, index) => {
      if (index % 4 === 3) validation.push(sample);
      else training.push(sample);
    });
  }
  if (training.length < 72 || validation.length < 18) return null;

  const featureMean = Array.from(
    { length: GAZE_FEATURE_COUNT },
    (_, index) => training.reduce((sum, sample) => sum + sample.features[index], 0) / training.length,
  );
  const featureScale = Array.from({ length: GAZE_FEATURE_COUNT }, (_, index) => {
    const variance = training.reduce(
      (sum, sample) => sum + (sample.features[index] - featureMean[index]) ** 2,
      0,
    ) / training.length;
    // Tiny scales turn natural runtime drift into huge extrapolation. A
    // calibration without meaningful feature spread is intentionally rejected.
    return clamp(Math.sqrt(variance), 0.002, 4);
  });
  const design = training.map((sample) => [
    1,
    ...sample.features.map((value, index) => (value - featureMean[index]) / featureScale[index]),
  ]);
  const trainingXs = training.map((sample) => sample.targetX);
  const trainingYs = training.map((sample) => sample.targetY);
  let weights = training.map((sample) => clamp(sample.confidence ?? 1, 0.55, 1));
  let xCoefficients: number[] | null = null;
  let yCoefficients: number[] | null = null;
  for (let iteration = 0; iteration < 4; iteration++) {
    xCoefficients = fitAxis(design, trainingXs, weights);
    yCoefficients = fitAxis(design, trainingYs, weights);
    if (!xCoefficients || !yCoefficients) return null;
    const residuals = design.map((row, index) => Math.hypot(
      predictAxis(xCoefficients!, row) - trainingXs[index],
      predictAxis(yCoefficients!, row) - trainingYs[index],
    ));
    const residualMedian = median(residuals);
    const residualMad = median(residuals.map((value) => Math.abs(value - residualMedian))) * 1.4826;
    const huberLimit = Math.max(0.025, residualMedian + 2.5 * Math.max(0.002, residualMad));
    weights = residuals.map((residual, index) => (
      clamp(training[index].confidence ?? 1, 0.55, 1)
      * Math.min(1, huberLimit / Math.max(huberLimit, residual))
    ));
  }
  if (!xCoefficients || !yCoefficients) return null;
  if (
    [...xCoefficients, ...yCoefficients].some(
      (coefficient) => !Number.isFinite(coefficient) || Math.abs(coefficient) > 4,
    )
  ) return null;

  const validationRows = validation.map((sample) => [
    1,
    ...sample.features.map((value, index) => (value - featureMean[index]) / featureScale[index]),
  ]);
  const squaredX = validationRows.map(
    (row, index) => (predictAxis(xCoefficients!, row) - validation[index].targetX) ** 2,
  );
  const squaredY = validationRows.map(
    (row, index) => (predictAxis(yCoefficients!, row) - validation[index].targetY) ** 2,
  );
  const rmseX = Math.sqrt(squaredX.reduce((sum, value) => sum + value, 0) / squaredX.length);
  const rmseY = Math.sqrt(squaredY.reduce((sum, value) => sum + value, 0) / squaredY.length);
  const rmse = Math.sqrt((rmseX ** 2 + rmseY ** 2) / 2);
  const errors = validationRows.map((row, index) => Math.hypot(
    predictAxis(xCoefficients!, row) - validation[index].targetX,
    predictAxis(yCoefficients!, row) - validation[index].targetY,
  )).sort((first, second) => first - second);
  const p95Error = errors[Math.min(errors.length - 1, Math.floor(errors.length * 0.95))];
  const pointErrors = [...new Set(validation.map(
    (sample) => `${sample.targetX.toFixed(3)}:${sample.targetY.toFixed(3)}`,
  ))].map((key) => median(validationRows.flatMap((row, index) => {
    const sample = validation[index];
    return `${sample.targetX.toFixed(3)}:${sample.targetY.toFixed(3)}` === key
      ? [Math.hypot(
        predictAxis(xCoefficients!, row) - sample.targetX,
        predictAxis(yCoefficients!, row) - sample.targetY,
      )]
      : [];
  })));
  const maxPointError = Math.max(...pointErrors);
  if (
    rmse > 0.085
    || rmseX > 0.1
    || rmseY > 0.1
    || p95Error > 0.14
    || maxPointError > 0.11
  ) return null;

  const registrations = used
    .map((sample) => sample.registration)
    .filter((value): value is GazeEyeRegistration => Boolean(value));
  if (registrations.length < 54) return null;
  const registration: GazeEyeRegistration = {
    leftOpenness: median(registrations.map((value) => value.leftOpenness)),
    rightOpenness: median(registrations.map((value) => value.rightOpenness)),
    faceScale: median(registrations.map((value) => value.faceScale)),
    headYaw: median(registrations.map((value) => value.headYaw)),
    headPitch: median(registrations.map((value) => value.headPitch)),
    headRoll: median(registrations.map((value) => value.headRoll)),
  };
  if (
    registration.leftOpenness < 0.025
    || registration.rightOpenness < 0.025
    || registration.faceScale < 0.04
  ) return null;

  return {
    algorithmRevision: GAZE_CALIBRATION_ALGORITHM_REVISION,
    revision: 0,
    createdAtMs: Date.now(),
    identity: { ...identity },
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
      sampleCount: used.length,
      pointCount: uniqueUsedPoints.size,
    },
    registration,
  };
}

export function applyGazeCalibration(
  profile: GazeCalibrationProfile,
  features: GazeFeatureVector,
): GazePoint | null;
export function applyGazeCalibration(
  observation: { features: GazeFeatureVector },
  profile: GazeCalibrationProfile | null,
  identity?: GazeCalibrationIdentity,
): GazePoint | null;
export function applyGazeCalibration(
  first: GazeCalibrationProfile | { features: GazeFeatureVector },
  second: GazeFeatureVector | GazeCalibrationProfile | null,
  identity?: GazeCalibrationIdentity,
): GazePoint | null {
  const observationStyle = 'features' in first && !('xCoefficients' in first);
  const profile = (observationStyle ? second : first) as GazeCalibrationProfile | null;
  const features = (observationStyle ? first.features : second) as GazeFeatureVector;
  if (!profile || (identity && !gazeCalibrationMatches(profile, identity))) return null;
  if (
    profile.algorithmRevision !== GAZE_CALIBRATION_ALGORITHM_REVISION
    || !validFeatureVector(features)
    || profile.featureMean.length !== GAZE_FEATURE_COUNT
    || profile.featureScale.length !== GAZE_FEATURE_COUNT
    || profile.xCoefficients.length !== GAZE_FEATURE_COUNT + 1
    || profile.yCoefficients.length !== GAZE_FEATURE_COUNT + 1
  ) return null;
  const standardized = features.map((value, index) => {
    const mean = profile.featureMean[index];
    const scale = profile.featureScale[index];
    return Number.isFinite(mean) && Number.isFinite(scale) && scale >= 0.000_1
      ? (value - mean) / scale
      : Number.NaN;
  });
  if (!standardized.every(Number.isFinite)) return null;
  // Calibration defines the safe operating envelope. Do not clamp a face pose
  // far outside that envelope into a plausible-looking edge action.
  if (standardized.some((value) => Math.abs(value) > 6.5)) return null;
  const row = [1, ...standardized];
  const x = predictAxis(profile.xCoefficients, row);
  const y = predictAxis(profile.yCoefficients, row);
  // A slightly out-of-bounds prediction is normal at screen edges; a wildly
  // extrapolated one means the current face/camera does not match calibration.
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < -0.2 || x > 1.2 || y < -0.2 || y > 1.2) return null;
  return { x: clamp01(x), y: clamp01(y) };
}

class AdaptiveAxisFilter {
  private value: number | null = null;

  filter(next: number, dtMs: number, motion: number, baseResponseMs: number): number {
    if (this.value === null) {
      this.value = next;
      return next;
    }
    const responseMs = baseResponseMs
      - (baseResponseMs - 16) * clamp(motion / 0.13, 0, 1);
    const alpha = 1 - Math.exp(-clamp(dtMs, 4, 120) / responseMs);
    this.value += (next - this.value) * clamp(alpha, 0.08, 0.82);
    return this.value;
  }

  reset(): void {
    this.value = null;
  }
}

/** Adaptive gaze smoothing: stable fixation is damped, large movements catch up. */
export class GazeAimFilter {
  private readonly x = new AdaptiveAxisFilter();
  private readonly y = new AdaptiveAxisFilter();
  private previous: GazePoint | null = null;
  private previousAtMs = 0;

  filter(point: GazePoint, timestampMs: number, _confidence?: number): GazePoint {
    return this.filterTuned(point, timestampMs, 'balanced');
  }

  filterTuned(
    point: GazePoint,
    timestampMs: number,
    responsiveness: GazeResponsiveness,
  ): GazePoint {
    if (!Number.isFinite(timestampMs)) return { x: clamp01(point.x), y: clamp01(point.y) };
    const bounded = { x: clamp01(point.x), y: clamp01(point.y) };
    const dtMs = this.previous ? clamp(timestampMs - this.previousAtMs, 4, 120) : 16;
    const motion = this.previous ? Math.hypot(bounded.x - this.previous.x, bounded.y - this.previous.y) : 0;
    this.previous = bounded;
    this.previousAtMs = timestampMs;
    const responseMs = responsiveness === 'fast'
      ? 28
      : responsiveness === 'steady'
        ? 68
        : 44;
    return {
      x: clamp01(this.x.filter(bounded.x, dtMs, motion, responseMs)),
      y: clamp01(this.y.filter(bounded.y, dtMs, motion, responseMs)),
    };
  }

  reset(): void {
    this.x.reset();
    this.y.reset();
    this.previous = null;
    this.previousAtMs = 0;
  }
}

/** Small functional helper for setup previews and non-gameplay consumers. */
export function mapAndSmoothGaze(
  profile: GazeCalibrationProfile,
  features: GazeFeatureVector,
  timestampMs: number,
  filter: GazeAimFilter,
): GazePoint | null {
  const mapped = applyGazeCalibration(profile, features);
  return mapped ? filter.filter(mapped, timestampMs) : null;
}

/**
 * Adds confidence, freshness and saccade gates around calibrated gaze mapping.
 * Consumers may draw every returned point, but only `stableForAction` may
 * advance a blink or dwell action.
 */
export class GazeAimController {
  private readonly filter = new GazeAimFilter();
  private lastRaw: GazePoint | null = null;
  private lastTimestampMs = Number.NEGATIVE_INFINITY;
  private stableSinceMs = Number.NEGATIVE_INFINITY;
  private stableSamples = 0;

  update(
    observation: GazeTrackingObservation,
    profile: GazeCalibrationProfile,
    receivedAtMs: number,
    tuning: GazeAimTuning = {},
  ): GazeAimSample | null {
    const ageMs = receivedAtMs - observation.timestampMs;
    if (
      !Number.isFinite(receivedAtMs)
      || !Number.isFinite(observation.timestampMs)
      || observation.timestampMs <= this.lastTimestampMs
      || ageMs < -12
      || ageMs > GAZE_ACTION_MAX_AGE_MS
      || !Number.isFinite(observation.confidence)
      || observation.confidence < GAZE_MIN_ACTION_CONFIDENCE
    ) {
      this.reset();
      return null;
    }
    const mapped = applyGazeCalibration(profile, observation.features);
    if (!mapped) {
      this.reset();
      return null;
    }
    const sensitivity = clamp(tuning.sensitivity ?? 1, 0.75, 1.35);
    const raw = {
      x: clamp01(0.5 + (mapped.x - 0.5) * sensitivity),
      y: clamp01(0.5 + (mapped.y - 0.5) * sensitivity),
    };
    const dtSeconds = Number.isFinite(this.lastTimestampMs)
      ? clamp((observation.timestampMs - this.lastTimestampMs) / 1_000, 1 / 120, 0.18)
      : 1 / 30;
    const displacement = this.lastRaw ? Math.hypot(raw.x - this.lastRaw.x, raw.y - this.lastRaw.y) : 0;
    const deltaX = this.lastRaw ? raw.x - this.lastRaw.x : 0;
    const deltaY = this.lastRaw ? raw.y - this.lastRaw.y : 0;
    const speed = displacement / dtSeconds;
    const saccade = Boolean(this.lastRaw && displacement >= 0.055 && speed >= 1.5);
    if (saccade || !observation.usableForAction || displacement > 0.04 || speed > 1.35) {
      this.stableSinceMs = Number.NEGATIVE_INFINITY;
      this.stableSamples = 0;
    } else {
      if (!Number.isFinite(this.stableSinceMs)) this.stableSinceMs = observation.timestampMs;
      this.stableSamples = Math.min(120, this.stableSamples + 1);
    }
    const stableForAction = observation.usableForAction
      && !saccade
      && this.stableSamples >= 2
      && observation.timestampMs - this.stableSinceMs >= 72;

    const point = this.filter.filterTuned(
      raw,
      observation.timestampMs,
      tuning.responsiveness ?? 'balanced',
    );
    const direction = speed < 0.22
      ? 'steady'
      : Math.abs(deltaX) >= Math.abs(deltaY)
        ? deltaX < 0 ? 'left' : 'right'
        : deltaY < 0 ? 'up' : 'down';
    this.lastRaw = raw;
    this.lastTimestampMs = observation.timestampMs;
    return {
      ...point,
      rawX: raw.x,
      rawY: raw.y,
      confidence: observation.confidence,
      timestampMs: observation.timestampMs,
      usableForAction: observation.usableForAction && !saccade,
      stableForAction,
      saccade,
      direction,
    };
  }

  reset(): void {
    this.filter.reset();
    this.lastRaw = null;
    this.lastTimestampMs = Number.NEGATIVE_INFINITY;
    this.stableSinceMs = Number.NEGATIVE_INFINITY;
    this.stableSamples = 0;
  }
}

export interface DoubleBlinkFrame {
  timestampMs: number;
  leftBlink: number;
  rightBlink: number;
  usableForAction: boolean;
  stableForAction: boolean;
}

export type GazeActivationResult = 'none' | 'action';
type BlinkPhase = 'seeking-open' | 'armed' | 'first-closed' | 'between' | 'second-closed';
const BLINK_LOCK_MAX_AGE_MS = 720;
const BLINK_BILATERAL_TOLERANCE = 0.22;

/**
 * Deliberate bilateral double blink recognizer. It requires a stable open
 * baseline, two complete short closures and a real open interval between them.
 */
export class DoubleBlinkControl {
  private phase: BlinkPhase = 'seeking-open';
  private phaseAtMs = 0;
  private openSinceMs = 0;
  private stableAimAtMs = Number.NEGATIVE_INFINITY;
  private lastTimestampMs = Number.NEGATIVE_INFINITY;

  update(frame: DoubleBlinkFrame): GazeActivationResult {
    const timestampMs = frame.timestampMs;
    const gapMs = timestampMs - this.lastTimestampMs;
    if (
      !Number.isFinite(timestampMs)
      || !Number.isFinite(frame.leftBlink)
      || !Number.isFinite(frame.rightBlink)
      || timestampMs <= this.lastTimestampMs
      || (Number.isFinite(this.lastTimestampMs) && gapMs > 180)
      || !frame.usableForAction
    ) {
      this.reset();
      if (Number.isFinite(timestampMs)) this.lastTimestampMs = timestampMs;
      return 'none';
    }
    const bothClosed = frame.leftBlink >= 0.68 && frame.rightBlink >= 0.68;
    const bothOpen = frame.leftBlink <= 0.32 && frame.rightBlink <= 0.32;
    const asymmetric = (
      (frame.leftBlink >= 0.68 && frame.rightBlink <= 0.45)
      || (frame.rightBlink >= 0.68 && frame.leftBlink <= 0.45)
    );
    const bilateral = Math.abs(frame.leftBlink - frame.rightBlink) <= BLINK_BILATERAL_TOLERANCE;
    const sequenceStarted = this.phase === 'first-closed'
      || this.phase === 'between'
      || this.phase === 'second-closed';
    const startingFirstClosure = this.phase === 'armed' && bothClosed;
    const closureGeometryUncertain = !bothOpen
      && frame.leftBlink >= 0.44
      && frame.rightBlink >= 0.44;
    const stableLockFresh = Number.isFinite(this.stableAimAtMs)
      && timestampMs - this.stableAimAtMs <= BLINK_LOCK_MAX_AGE_MS;

    // Closing eyelids necessarily perturbs iris/lid geometry. Once a stable
    // open-eye aim is armed, tolerate that short bilateral transition while
    // keeping the already measured target authoritative. Unstable open gaze,
    // unilateral winks and any sequence without a recent lock still fail closed.
    if (!frame.stableForAction
      && (!stableLockFresh
        || !bilateral
        || !closureGeometryUncertain
        || (!sequenceStarted && !startingFirstClosure))) {
      this.reset();
      this.lastTimestampMs = timestampMs;
      return 'none';
    }
    if (frame.stableForAction && bothOpen) this.stableAimAtMs = timestampMs;
    this.lastTimestampMs = timestampMs;
    if (asymmetric) {
      this.cancelSequence(timestampMs, bothOpen && frame.stableForAction);
      return 'none';
    }

    switch (this.phase) {
      case 'seeking-open':
        if (bothOpen) {
          if (this.openSinceMs === 0) this.openSinceMs = timestampMs;
          if (timestampMs - this.openSinceMs >= 70) {
            this.phase = 'armed';
            this.phaseAtMs = timestampMs;
          }
        } else {
          this.openSinceMs = 0;
        }
        break;
      case 'armed':
        if (bothClosed) {
          this.phase = 'first-closed';
          this.phaseAtMs = timestampMs;
        }
        break;
      case 'first-closed': {
        const closedMs = timestampMs - this.phaseAtMs;
        if (closedMs > 240) this.cancelSequence(timestampMs, bothOpen && frame.stableForAction);
        else if (bothOpen) {
          if (closedMs < 45) this.cancelSequence(timestampMs, frame.stableForAction);
          else {
            this.phase = 'between';
            this.phaseAtMs = timestampMs;
          }
        }
        break;
      }
      case 'between': {
        const openGapMs = timestampMs - this.phaseAtMs;
        if (openGapMs > 430) this.cancelSequence(timestampMs, bothOpen && frame.stableForAction);
        else if (bothClosed) {
          if (openGapMs < 65) this.cancelSequence(timestampMs, false);
          else {
            this.phase = 'second-closed';
            this.phaseAtMs = timestampMs;
          }
        }
        break;
      }
      case 'second-closed': {
        const closedMs = timestampMs - this.phaseAtMs;
        if (closedMs > 240) this.cancelSequence(timestampMs, bothOpen && frame.stableForAction);
        else if (bothOpen) {
          if (closedMs < 45) {
            this.cancelSequence(timestampMs, frame.stableForAction);
          } else {
            this.phase = 'seeking-open';
            this.openSinceMs = 0;
            this.phaseAtMs = timestampMs;
            this.stableAimAtMs = Number.NEGATIVE_INFINITY;
            return 'action';
          }
        }
        break;
      }
    }
    return 'none';
  }

  /**
   * True only after the first accepted closure and until the sequence either
   * completes or fails. Scenes use this edge to freeze the authoritative
   * target, so a between-blink saccade can never redirect an action.
   */
  isSequenceEngaged(): boolean {
    return this.phase === 'first-closed'
      || this.phase === 'between'
      || this.phase === 'second-closed';
  }

  private cancelSequence(timestampMs: number, stableOpen: boolean): void {
    this.phase = 'seeking-open';
    this.phaseAtMs = timestampMs;
    this.openSinceMs = stableOpen ? timestampMs : 0;
    this.stableAimAtMs = stableOpen ? timestampMs : Number.NEGATIVE_INFINITY;
  }

  reset(): void {
    this.phase = 'seeking-open';
    this.phaseAtMs = 0;
    this.openSinceMs = 0;
    this.stableAimAtMs = Number.NEGATIVE_INFINITY;
    this.lastTimestampMs = Number.NEGATIVE_INFINITY;
  }
}

export interface GazeDwellFrame {
  timestampMs: number;
  targetId: string | null;
  usableForAction: boolean;
  stableForAction: boolean;
}

export interface GazeDwellResult {
  targetId: string | null;
  progress: number;
  action: boolean;
}

/** Deliberate dwell with a one-action latch until the target changes or leaves. */
export class GazeDwellControl {
  private targetId: string | null = null;
  private enteredAtMs = 0;
  private lastTimestampMs = Number.NEGATIVE_INFINITY;
  private latched = false;
  private uncertaintySinceMs = 0;
  private pausedAtMs = 0;
  private lastProgress = 0;

  constructor(private readonly dwellMs = 900) {}

  update(frame: GazeDwellFrame): GazeDwellResult {
    const timestampMs = frame.timestampMs;
    const invalidTimestamp = !Number.isFinite(timestampMs)
      || timestampMs <= this.lastTimestampMs
      || (Number.isFinite(this.lastTimestampMs) && timestampMs - this.lastTimestampMs > 180);
    if (invalidTimestamp || !frame.usableForAction || !frame.stableForAction || !frame.targetId) {
      // Once a dwell has fired, temporary scene busy time, tracking uncertainty
      // or a recognition gap must not silently re-arm the same target. Preserve
      // only the consumed-target latch; incomplete dwell progress still resets.
      if (this.latched && this.targetId) {
        if (!invalidTimestamp
          && frame.usableForAction
          && frame.stableForAction
          && frame.targetId === null) {
          this.reset();
          this.lastTimestampMs = timestampMs;
          return { targetId: null, progress: 0, action: false };
        }
        if (Number.isFinite(timestampMs)) this.lastTimestampMs = timestampMs;
        return { targetId: this.targetId, progress: 1, action: false };
      }
      const uncertain = !invalidTimestamp
        && Boolean(this.targetId)
        && (!frame.usableForAction || !frame.stableForAction);
      if (uncertain) {
        if (this.uncertaintySinceMs === 0) {
          this.uncertaintySinceMs = timestampMs;
          this.pausedAtMs = timestampMs;
        }
        this.lastTimestampMs = timestampMs;
        if (timestampMs - this.uncertaintySinceMs <= 220) {
          return {
            targetId: this.targetId,
            progress: this.lastProgress,
            action: false,
          };
        }
      }
      this.reset();
      if (Number.isFinite(timestampMs)) this.lastTimestampMs = timestampMs;
      return { targetId: frame.targetId, progress: 0, action: false };
    }
    this.lastTimestampMs = timestampMs;
    if (this.uncertaintySinceMs > 0) {
      if (frame.targetId !== this.targetId) {
        this.reset();
        this.lastTimestampMs = timestampMs;
      } else {
        this.enteredAtMs += Math.max(0, timestampMs - this.pausedAtMs);
        this.uncertaintySinceMs = 0;
        this.pausedAtMs = 0;
      }
    }
    if (frame.targetId !== this.targetId) {
      this.targetId = frame.targetId;
      this.enteredAtMs = timestampMs;
      this.latched = false;
      this.lastProgress = 0;
      return { targetId: frame.targetId, progress: 0, action: false };
    }
    const duration = clamp(this.dwellMs, 650, 2_000);
    const progress = clamp01((timestampMs - this.enteredAtMs) / duration);
    this.lastProgress = progress;
    if (progress >= 1 && !this.latched) {
      this.latched = true;
      return { targetId: frame.targetId, progress: 1, action: true };
    }
    return { targetId: frame.targetId, progress, action: false };
  }

  reset(): void {
    this.targetId = null;
    this.enteredAtMs = 0;
    this.lastTimestampMs = Number.NEGATIVE_INFINITY;
    this.latched = false;
    this.uncertaintySinceMs = 0;
    this.pausedAtMs = 0;
    this.lastProgress = 0;
  }
}

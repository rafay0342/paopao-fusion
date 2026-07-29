export type GazeFeatureVector = readonly [
  leftIrisX: number,
  leftIrisY: number,
  rightIrisX: number,
  rightIrisY: number,
  faceCenterX: number,
  faceCenterY: number,
  faceScale: number,
  headYaw: number,
  headPitch: number,
  headRoll: number,
];

export type GazeQualityReason =
  | 'ready'
  | 'blink'
  | 'eyes-not-found'
  | 'face-too-far'
  | 'face-off-center'
  | 'head-angle'
  | 'head-moving'
  | 'eyes-closed'
  | 'iris-uncertain'
  | 'binocular-mismatch'
  | 'poor-lighting';

export interface GazeLandmark {
  x: number;
  y: number;
  z?: number;
}

export interface GazeMarkerPoint {
  x: number;
  y: number;
}

export interface GazeEyeMarkers {
  iris: GazeMarkerPoint;
  irisRadius: number;
  imageLeft: GazeMarkerPoint;
  imageRight: GazeMarkerPoint;
  upper: GazeMarkerPoint;
  lower: GazeMarkerPoint;
}

export interface GazeDebugPacket {
  left: GazeEyeMarkers;
  right: GazeEyeMarkers;
  leftOpenness: number;
  rightOpenness: number;
  headYaw: number;
  headPitch: number;
  headRoll: number;
  headMotion: number;
  binocularAgreement: number;
  qualityReason: GazeQualityReason;
}

/** Sanitized, numeric-only calibration data that may cross into the worker. */
export interface GazeRuntimeRegistration {
  revision: number;
  leftOpenness: number;
  rightOpenness: number;
  faceScale: number;
  headYaw: number;
  headPitch: number;
  headRoll: number;
}

export interface GazeGeometry {
  features: GazeFeatureVector;
  leftOpenness: number;
  rightOpenness: number;
  headYaw: number;
  headPitch: number;
  headRoll: number;
  faceScale: number;
  faceCenterX: number;
  faceCenterY: number;
  binocularAgreement: number;
  ringQuality: number;
  baseConfidence: number;
  markers: Pick<GazeDebugPacket, 'left' | 'right'>;
}

interface Point2D {
  x: number;
  y: number;
}

interface EyeGeometry {
  x: number;
  y: number;
  width: number;
  openness: number;
  ringResidual: number;
  valid: boolean;
  markers: GazeEyeMarkers;
}

const clamp = (value: number, minimum: number, maximum: number): number => (
  Math.min(maximum, Math.max(minimum, value))
);
const clamp01 = (value: number): number => clamp(value, 0, 1);

const finitePoint = (point: GazeLandmark | Point2D | undefined): point is GazeLandmark => (
  Boolean(point) && Number.isFinite(point?.x) && Number.isFinite(point?.y)
);

const averagePoint = (
  landmarks: readonly GazeLandmark[],
  indices: readonly number[],
): Point2D | null => {
  const points = indices.map((index) => landmarks[index]);
  if (!points.every(finitePoint)) return null;
  return {
    x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
    y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
  };
};

const distance = (first: Point2D, second: Point2D): number => (
  Math.hypot(first.x - second.x, first.y - second.y)
);

const safeFrameAspect = (value: number): number => (
  Number.isFinite(value) ? clamp(value, 0.5, 3) : 1
);

/**
 * MediaPipe normalizes X by frame width and Y by frame height. Convert Y to
 * normalized-width units before angles/distances are measured so a 16:9
 * camera cannot turn a circular iris into a mathematically stretched one.
 */
const metricPoint = (point: Point2D, frameAspect: number): Point2D => ({
  x: point.x,
  y: point.y / frameAspect,
});

/**
 * Uses all five MediaPipe iris points and a roll-invariant eye basis. Both
 * eyes are expressed image-left to image-right, avoiding the opposite-axis
 * bug that made one eye vote against the other.
 */
const measureEye = (
  landmarks: readonly GazeLandmark[],
  irisIndices: readonly number[],
  imageLeftIndex: number,
  imageRightIndex: number,
  upperIndices: readonly number[],
  lowerIndices: readonly number[],
  frameAspect: number,
): EyeGeometry | null => {
  const officialIris = landmarks[irisIndices[0]];
  const ring = irisIndices.slice(1).map((index) => landmarks[index]);
  const imageLeft = landmarks[imageLeftIndex];
  const imageRight = landmarks[imageRightIndex];
  const upper = averagePoint(landmarks, upperIndices);
  const lower = averagePoint(landmarks, lowerIndices);
  if (
    !finitePoint(officialIris)
    || !ring.every(finitePoint)
    || !finitePoint(imageLeft)
    || !finitePoint(imageRight)
    || !upper
    || !lower
  ) return null;

  const ringCentre = {
    x: ring.reduce((sum, point) => sum + point.x, 0) / ring.length,
    y: ring.reduce((sum, point) => sum + point.y, 0) / ring.length,
  };
  // The official centre is model-estimated while the ring centroid rejects a
  // single unstable rim point. Their blend is less noisy than either alone.
  const iris = {
    x: officialIris.x * 0.65 + ringCentre.x * 0.35,
    y: officialIris.y * 0.65 + ringCentre.y * 0.35,
  };
  const metricIris = metricPoint(iris, frameAspect);
  const metricRing = ring.map((point) => metricPoint(point, frameAspect));
  const metricImageLeft = metricPoint(imageLeft, frameAspect);
  const metricImageRight = metricPoint(imageRight, frameAspect);
  const metricUpper = metricPoint(upper, frameAspect);
  const metricLower = metricPoint(lower, frameAspect);
  const axisX = metricImageRight.x - metricImageLeft.x;
  const axisY = metricImageRight.y - metricImageLeft.y;
  const width = Math.hypot(axisX, axisY);
  if (width < 0.018) return null;
  const horizontal = { x: axisX / width, y: axisY / width };

  const lidAxis = {
    x: metricLower.x - metricUpper.x,
    y: metricLower.y - metricUpper.y,
  };
  const alongHorizontal = lidAxis.x * horizontal.x + lidAxis.y * horizontal.y;
  const verticalRaw = {
    x: lidAxis.x - alongHorizontal * horizontal.x,
    y: lidAxis.y - alongHorizontal * horizontal.y,
  };
  const verticalLength = Math.hypot(verticalRaw.x, verticalRaw.y);
  if (verticalLength < width * 0.025) return null;
  const vertical = { x: verticalRaw.x / verticalLength, y: verticalRaw.y / verticalLength };
  const centre = {
    x: (metricImageLeft.x + metricImageRight.x) / 2,
    y: (metricImageLeft.y + metricImageRight.y) / 2,
  };

  const ringRadii = metricRing.map((point) => distance(point, metricIris));
  const radius = ringRadii.reduce((sum, value) => sum + value, 0) / ringRadii.length;
  const markerRadius = ring
    .map((point) => distance(point, iris))
    .reduce((sum, value) => sum + value, 0) / ring.length;
  const ringResidual = radius > 0
    ? Math.sqrt(
      ringRadii.reduce((sum, value) => sum + (value - radius) ** 2, 0) / ringRadii.length,
    ) / radius
    : 1;
  const x = (
    (metricIris.x - centre.x) * horizontal.x
    + (metricIris.y - centre.y) * horizontal.y
  ) / width;
  const y = (
    (metricIris.x - centre.x) * vertical.x
    + (metricIris.y - centre.y) * vertical.y
  ) / width;
  const openness = Math.abs(
    (metricLower.x - metricUpper.x) * vertical.x
    + (metricLower.y - metricUpper.y) * vertical.y,
  ) / width;
  const irisRadius = radius / width;
  const valid = Number.isFinite(x)
    && Number.isFinite(y)
    && Number.isFinite(openness)
    && x >= -0.85
    && x <= 0.85
    && y >= -0.65
    && y <= 0.65
    && irisRadius >= 0.025
    && irisRadius <= 0.28
    && ringResidual <= 0.65;

  return {
    x,
    y,
    width,
    openness,
    ringResidual,
    valid,
    markers: {
      iris,
      irisRadius: markerRadius,
      imageLeft: { x: imageLeft.x, y: imageLeft.y },
      imageRight: { x: imageRight.x, y: imageRight.y },
      upper,
      lower,
    },
  };
};

/**
 * Compacts the 478-point FaceLandmarker result into a deterministic,
 * privacy-bounded gaze observation. No full face mesh or camera frame leaves
 * the worker.
 */
export function extractGazeGeometry(
  landmarks: readonly GazeLandmark[],
  rawFrameAspect = 1,
): GazeGeometry | null {
  if (landmarks.length < 478) return null;
  const frameAspect = safeFrameAspect(rawFrameAspect);

  // Subject-left eye is on image-right: 362 -> 263. Subject-right is on
  // image-left: 33 -> 133. This makes physical image-X motion share one sign.
  const left = measureEye(
    landmarks,
    [473, 474, 475, 476, 477],
    362,
    263,
    [385, 386, 387],
    [373, 374, 380],
    frameAspect,
  );
  const right = measureEye(
    landmarks,
    [468, 469, 470, 471, 472],
    33,
    133,
    [158, 159, 160],
    [144, 145, 153],
    frameAspect,
  );
  const leftOuter = landmarks[263];
  const rightOuter = landmarks[33];
  const nose = landmarks[1];
  if (!left?.valid || !right?.valid || !finitePoint(leftOuter) || !finitePoint(rightOuter) || !finitePoint(nose)) {
    return null;
  }

  const metricLeftOuter = metricPoint(leftOuter, frameAspect);
  const metricRightOuter = metricPoint(rightOuter, frameAspect);
  const metricNose = metricPoint(nose, frameAspect);
  const eyeAxisX = metricLeftOuter.x - metricRightOuter.x;
  const eyeAxisY = metricLeftOuter.y - metricRightOuter.y;
  const faceScale = Math.hypot(eyeAxisX, eyeAxisY);
  if (faceScale < 0.001) return null;
  const faceHorizontal = { x: eyeAxisX / faceScale, y: eyeAxisY / faceScale };
  let faceVertical = { x: -faceHorizontal.y, y: faceHorizontal.x };
  if (faceVertical.y < 0) faceVertical = { x: -faceVertical.x, y: -faceVertical.y };
  const faceCenterX = (leftOuter.x + rightOuter.x) / 2;
  const faceCenterY = (leftOuter.y + rightOuter.y) / 2;
  const metricFaceCenter = {
    x: (metricLeftOuter.x + metricRightOuter.x) / 2,
    y: (metricLeftOuter.y + metricRightOuter.y) / 2,
  };
  const noseOffset = {
    x: metricNose.x - metricFaceCenter.x,
    y: metricNose.y - metricFaceCenter.y,
  };
  const noseYaw = (
    noseOffset.x * faceHorizontal.x + noseOffset.y * faceHorizontal.y
  ) / faceScale;
  const widthAsymmetry = Math.log(clamp(left.width / right.width, 0.35, 2.85));
  const headYaw = clamp(noseYaw * 1.8 + widthAsymmetry * 0.3, -1, 1);
  const headPitch = clamp(
    (noseOffset.x * faceVertical.x + noseOffset.y * faceVertical.y) / faceScale,
    -1,
    1.5,
  );
  const headRoll = Math.atan2(eyeAxisY, eyeAxisX) / Math.PI;

  const disparityX = Math.abs(left.x - right.x);
  const disparityY = Math.abs(left.y - right.y);
  const binocularAgreement = clamp01(Math.exp(-(disparityX * 1.5 + disparityY * 3.2)));
  const ringQuality = clamp01(1 - Math.max(left.ringResidual, right.ringResidual) / 0.55);
  const distanceQuality = clamp01((faceScale - 0.085) / 0.095);
  const eyeWidthQuality = clamp01((Math.min(left.width, right.width) - 0.02) / 0.035);
  const opennessQuality = clamp01((Math.min(left.openness, right.openness) - 0.045) / 0.1);
  const baseConfidence = clamp01(
    distanceQuality
    * eyeWidthQuality
    * (0.55 + ringQuality * 0.45)
    * (0.58 + binocularAgreement * 0.42)
    * (0.45 + opennessQuality * 0.55),
  );

  return {
    features: [
      left.x,
      left.y,
      right.x,
      right.y,
      faceCenterX,
      faceCenterY,
      faceScale,
      headYaw,
      headPitch,
      headRoll,
    ],
    leftOpenness: left.openness,
    rightOpenness: right.openness,
    headYaw,
    headPitch,
    headRoll,
    faceScale,
    faceCenterX,
    faceCenterY,
    binocularAgreement,
    ringQuality,
    baseConfidence,
    markers: { left: left.markers, right: right.markers },
  };
}

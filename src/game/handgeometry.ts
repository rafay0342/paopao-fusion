/**
 * Pure, coordinate-system-aware hand geometry helpers.
 *
 * MediaPipe image landmarks use independently normalised x/y axes. Multiplying
 * x by the image aspect ratio puts both axes in image-height units, preventing
 * camera aspect ratio from changing pinch and palm measurements.
 */

export interface HandLandmark3D {
  x: number;
  y: number;
  z?: number;
}

export type HandLandmarks = readonly HandLandmark3D[];

export interface HandPoint3D {
  x: number;
  y: number;
  z: number;
}

export interface HandGeometryOptions {
  /** Camera frame width / height. Defaults to the tracker's 4:3 input. */
  aspectRatio?: number;
  /** Optional metric MediaPipe world landmarks. Invalid data falls back safely. */
  worldLandmarks?: HandLandmarks | null;
}

export interface HandGeometry {
  palmScale: number;
  palmCenter: HandPoint3D;
  rawPinch: number;
  pinchDepth: number;
  pinch3d: number;
  indexAngleDeg: number;
  palmRollDeg: number;
  nearDepth: number;
  depthSource: 'world' | 'image';
}

export const DEFAULT_HAND_ASPECT_RATIO = 4 / 3;
export const MIN_HAND_SCALE = 1e-6;

const PALM_INDICES = [0, 5, 9, 13, 17] as const;

const finite = (value: number | undefined): number => Number.isFinite(value) ? (value as number) : 0;

const pointAt = (landmarks: HandLandmarks, index: number): HandPoint3D => {
  const point = landmarks[index];
  return {
    x: finite(point?.x),
    y: finite(point?.y),
    z: finite(point?.z),
  };
};

const safeAspect = (aspectRatio: number): number => (
  Number.isFinite(aspectRatio) && aspectRatio > 0 ? aspectRatio : DEFAULT_HAND_ASPECT_RATIO
);

const distance2d = (a: HandPoint3D, b: HandPoint3D, aspectRatio: number): number => {
  const dx = (a.x - b.x) * safeAspect(aspectRatio);
  const dy = a.y - b.y;
  return Math.hypot(dx, dy);
};

const distance3d = (a: HandPoint3D, b: HandPoint3D): number => (
  Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
);

const imageDistance3d = (a: HandPoint3D, b: HandPoint3D, aspectRatio: number): number => {
  const aspect = safeAspect(aspectRatio);
  return Math.hypot((a.x - b.x) * aspect, a.y - b.y, (a.z - b.z) * aspect);
};

const combinedPalmScale = (acrossPalm: number, alongPalm: number): number => {
  const scale = Math.hypot(acrossPalm, alongPalm) / Math.SQRT2;
  return Number.isFinite(scale) ? Math.max(MIN_HAND_SCALE, scale) : MIN_HAND_SCALE;
};

/** Stable palm size from MCP 5-17 and wrist-to-MCP 0-9 only. */
export function palmScale(landmarks: HandLandmarks, aspectRatio = DEFAULT_HAND_ASPECT_RATIO): number {
  const acrossPalm = distance2d(pointAt(landmarks, 5), pointAt(landmarks, 17), aspectRatio);
  const alongPalm = distance2d(pointAt(landmarks, 0), pointAt(landmarks, 9), aspectRatio);
  return combinedPalmScale(acrossPalm, alongPalm);
}

/** Thumb-tip to index-tip 2D distance, normalised by the stable palm size. */
export function rawPinchRatio(landmarks: HandLandmarks, aspectRatio = DEFAULT_HAND_ASPECT_RATIO): number {
  return distance2d(pointAt(landmarks, 4), pointAt(landmarks, 8), aspectRatio)
    / palmScale(landmarks, aspectRatio);
}

/** Viewer-facing palm centre from wrist and the four MCP joints. */
export function palmCenter(landmarks: HandLandmarks): HandPoint3D {
  const sum = PALM_INDICES.reduce<HandPoint3D>((result, index) => {
    const point = pointAt(landmarks, index);
    result.x += point.x;
    result.y += point.y;
    result.z += point.z;
    return result;
  }, { x: 0, y: 0, z: 0 });
  return {
    x: sum.x / PALM_INDICES.length,
    y: sum.y / PALM_INDICES.length,
    z: sum.z / PALM_INDICES.length,
  };
}

function reliableWorldPalmScale(worldLandmarks: HandLandmarks | null | undefined): number | null {
  if (!worldLandmarks || worldLandmarks.length < 18) return null;
  const required = [0, 4, 5, 8, 9, 17];
  if (required.some((index) => {
    const point = worldLandmarks[index];
    return !point || !Number.isFinite(point.x) || !Number.isFinite(point.y) || !Number.isFinite(point.z);
  })) return null;

  const acrossPalm = distance3d(pointAt(worldLandmarks, 5), pointAt(worldLandmarks, 17));
  const alongPalm = distance3d(pointAt(worldLandmarks, 0), pointAt(worldLandmarks, 9));
  const scale = combinedPalmScale(acrossPalm, alongPalm);
  return scale > MIN_HAND_SCALE ? scale : null;
}

/**
 * Thumb/index z separation divided by palm size. Metric world landmarks are
 * preferred because image-landmark z is only a relative depth estimate.
 */
export function normalizedPinchDepth(
  landmarks: HandLandmarks,
  worldLandmarks?: HandLandmarks | null,
  aspectRatio = DEFAULT_HAND_ASPECT_RATIO,
): number {
  const worldScale = reliableWorldPalmScale(worldLandmarks);
  if (worldScale && worldLandmarks) {
    return Math.abs(pointAt(worldLandmarks, 4).z - pointAt(worldLandmarks, 8).z) / worldScale;
  }
  const aspect = safeAspect(aspectRatio);
  return Math.abs(pointAt(landmarks, 4).z - pointAt(landmarks, 8).z) * aspect
    / palmScale(landmarks, aspect);
}

/** Full thumb/index 3D separation divided by palm size, suitable as a pinch veto. */
export function pinch3dRatio(
  landmarks: HandLandmarks,
  worldLandmarks?: HandLandmarks | null,
  aspectRatio = DEFAULT_HAND_ASPECT_RATIO,
): number {
  const worldScale = reliableWorldPalmScale(worldLandmarks);
  if (worldScale && worldLandmarks) {
    return distance3d(pointAt(worldLandmarks, 4), pointAt(worldLandmarks, 8)) / worldScale;
  }
  return imageDistance3d(pointAt(landmarks, 4), pointAt(landmarks, 8), aspectRatio)
    / palmScale(landmarks, aspectRatio);
}

/** Index MCP-to-tip direction: 0 right, +90 up, -90 down. */
export function indexAngleDeg(landmarks: HandLandmarks, aspectRatio = DEFAULT_HAND_ASPECT_RATIO): number {
  const base = pointAt(landmarks, 5);
  const tip = pointAt(landmarks, 8);
  const dx = (tip.x - base.x) * safeAspect(aspectRatio);
  const dy = base.y - tip.y;
  return dx === 0 && dy === 0 ? 0 : Math.atan2(dy, dx) * 180 / Math.PI;
}

/** Palm-axis roll in the orientation-independent range [-90, 90). */
export function palmRollDeg(landmarks: HandLandmarks, aspectRatio = DEFAULT_HAND_ASPECT_RATIO): number {
  const indexMcp = pointAt(landmarks, 5);
  const pinkyMcp = pointAt(landmarks, 17);
  const dx = (pinkyMcp.x - indexMcp.x) * safeAspect(aspectRatio);
  const dy = indexMcp.y - pinkyMcp.y;
  if (dx === 0 && dy === 0) return 0;
  let angle = Math.atan2(dy, dx) * 180 / Math.PI;
  while (angle >= 90) angle -= 180;
  while (angle < -90) angle += 180;
  return angle;
}

/** Smooth 0..1 proximity estimate from apparent palm size (far to near). */
export function nearDepthFromPalmScale(scale: number, farScale = 0.055, nearScale = 0.36): number {
  const safeScale = finite(scale);
  const range = Math.max(MIN_HAND_SCALE, finite(nearScale) - finite(farScale));
  const linear = Math.min(1, Math.max(0, (safeScale - finite(farScale)) / range));
  return linear * linear * (3 - 2 * linear);
}

export function computeHandGeometry(
  landmarks: HandLandmarks,
  options: HandGeometryOptions = {},
): HandGeometry {
  const aspectRatio = safeAspect(options.aspectRatio ?? DEFAULT_HAND_ASPECT_RATIO);
  const scale = palmScale(landmarks, aspectRatio);
  const worldScale = reliableWorldPalmScale(options.worldLandmarks);
  return {
    palmScale: scale,
    palmCenter: palmCenter(landmarks),
    rawPinch: rawPinchRatio(landmarks, aspectRatio),
    pinchDepth: normalizedPinchDepth(landmarks, options.worldLandmarks, aspectRatio),
    pinch3d: pinch3dRatio(landmarks, options.worldLandmarks, aspectRatio),
    indexAngleDeg: indexAngleDeg(landmarks, aspectRatio),
    palmRollDeg: palmRollDeg(landmarks, aspectRatio),
    nearDepth: nearDepthFromPalmScale(scale),
    depthSource: worldScale ? 'world' : 'image',
  };
}

/** Semantic alias used by the realtime tracking pipeline. */
export const measureHandGeometry = computeHandGeometry;

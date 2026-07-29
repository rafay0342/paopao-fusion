import { describe, expect, it } from 'vitest';
import {
  extractGazeGeometry,
  type GazeLandmark,
} from '../src/game/gazefeatures';

interface SyntheticFaceOptions {
  gazeX?: number;
  gazeY?: number;
  lidOpening?: number;
  rollDeg?: number;
  yaw?: number;
  pitch?: number;
  distanceScale?: number;
}

const RIGHT_EYE = {
  iris: [468, 469, 470, 471, 472] as const,
  imageLeft: 33,
  imageRight: 133,
  upper: [158, 159, 160] as const,
  lower: [144, 145, 153] as const,
};

const LEFT_EYE = {
  iris: [473, 474, 475, 476, 477] as const,
  imageLeft: 362,
  imageRight: 263,
  upper: [385, 386, 387] as const,
  lower: [373, 374, 380] as const,
};

const makeFace = ({
  gazeX = 0,
  gazeY = 0,
  lidOpening = 0.024,
  rollDeg = 0,
  yaw = 0,
  pitch = 0,
  distanceScale = 1,
}: SyntheticFaceOptions = {}): GazeLandmark[] => {
  const landmarks = Array.from(
    { length: 478 },
    (): GazeLandmark => ({ x: 0.5, y: 0.4, z: 0 }),
  );
  const populated = new Set<number>();
  const set = (index: number, x: number, y: number): void => {
    landmarks[index] = { x, y, z: 0 };
    populated.add(index);
  };

  const eyeWidth = 0.07;
  const irisRadius = 0.006;
  const addEye = (
    eye: typeof RIGHT_EYE | typeof LEFT_EYE,
    centreX: number,
  ): void => {
    set(eye.imageLeft, centreX - eyeWidth / 2, 0.4);
    set(eye.imageRight, centreX + eyeWidth / 2, 0.4);
    for (const index of eye.upper) set(index, centreX, 0.4 - lidOpening / 2);
    for (const index of eye.lower) set(index, centreX, 0.4 + lidOpening / 2);

    const irisX = centreX + gazeX * eyeWidth;
    const irisY = 0.4 + gazeY * eyeWidth;
    set(eye.iris[0], irisX, irisY);
    const ringOffsets = [
      [irisRadius, 0],
      [0, irisRadius],
      [-irisRadius, 0],
      [0, -irisRadius],
    ] as const;
    ringOffsets.forEach(([x, y], index) => {
      set(eye.iris[index + 1], irisX + x, irisY + y);
    });
  };

  addEye(RIGHT_EYE, 0.42);
  addEye(LEFT_EYE, 0.58);

  const outerEyeDistance = landmarks[263].x - landmarks[33].x;
  set(
    1,
    0.5 + yaw * outerEyeDistance * 0.16,
    0.5 + pitch * outerEyeDistance * 0.16,
  );

  const pivot = { x: 0.5, y: 0.4 };
  const roll = rollDeg * Math.PI / 180;
  for (const index of populated) {
    const point = landmarks[index];
    const scaledX = (point.x - pivot.x) * distanceScale;
    const scaledY = (point.y - pivot.y) * distanceScale;
    landmarks[index] = {
      x: pivot.x + scaledX * Math.cos(roll) - scaledY * Math.sin(roll),
      y: pivot.y + scaledX * Math.sin(roll) + scaledY * Math.cos(roll),
      z: 0,
    };
  }
  return landmarks;
};

const geometry = (options?: SyntheticFaceOptions) => {
  const result = extractGazeGeometry(makeFace(options));
  expect(result).not.toBeNull();
  return result!;
};

const encodeFrameAspect = (
  landmarks: readonly GazeLandmark[],
  aspect: number,
): GazeLandmark[] => landmarks.map((point) => ({
  ...point,
  y: 0.4 + (point.y - 0.4) * aspect,
}));

describe('gaze landmark geometry', () => {
  it('gives both eyes the same horizontal sign for centre, left and right gaze', () => {
    const centre = geometry();
    const left = geometry({ gazeX: -0.22 });
    const right = geometry({ gazeX: 0.22 });

    expect(Math.abs(centre.features[0])).toBeLessThan(1e-8);
    expect(Math.abs(centre.features[2])).toBeLessThan(1e-8);
    expect(left.features[0]).toBeLessThan(0);
    expect(left.features[2]).toBeLessThan(0);
    expect(right.features[0]).toBeGreaterThan(0);
    expect(right.features[2]).toBeGreaterThan(0);
    expect(right.features[0] - left.features[0]).toBeCloseTo(
      right.features[2] - left.features[2],
      10,
    );
  });

  it('tracks up and down with a lid-opening-independent vertical denominator', () => {
    const up = geometry({ gazeY: -0.18 });
    const down = geometry({ gazeY: 0.18 });
    expect(up.features[1]).toBeLessThan(0);
    expect(up.features[3]).toBeLessThan(0);
    expect(down.features[1]).toBeGreaterThan(0);
    expect(down.features[3]).toBeGreaterThan(0);

    const narrowLids = geometry({ gazeY: 0.08, lidOpening: 0.01 });
    const openLids = geometry({ gazeY: 0.08, lidOpening: 0.034 });
    expect(narrowLids.features[1]).toBeCloseTo(openLids.features[1], 10);
    expect(narrowLids.features[3]).toBeCloseTo(openLids.features[3], 10);
    expect(narrowLids.leftOpenness).toBeLessThan(openLids.leftOpenness);
    expect(narrowLids.rightOpenness).toBeLessThan(openLids.rightOpenness);
  });

  it('reports roll, yaw, pitch and distance changes without corrupting gaze signs', () => {
    const baseline = geometry({ gazeX: 0.16 });
    const rolled = geometry({ gazeX: 0.16, rollDeg: 24 });
    const yawLeft = geometry({ yaw: -0.75 });
    const yawRight = geometry({ yaw: 0.75 });
    const pitchUp = geometry({ pitch: -0.65 });
    const pitchDown = geometry({ pitch: 0.65 });
    const far = geometry({ distanceScale: 0.5 });
    const near = geometry({ distanceScale: 1.25 });

    expect(rolled.headRoll).toBeCloseTo(24 / 180, 6);
    expect(rolled.features[0]).toBeCloseTo(baseline.features[0], 8);
    expect(rolled.features[2]).toBeCloseTo(baseline.features[2], 8);
    expect(yawLeft.headYaw).toBeLessThan(0);
    expect(yawRight.headYaw).toBeGreaterThan(0);
    expect(pitchUp.headPitch).toBeLessThan(pitchDown.headPitch);
    expect(far.faceScale).toBeLessThan(near.faceScale);
  });

  it('keeps eye, roll and head-pose geometry invariant across camera aspect ratios', () => {
    const options = {
      gazeX: 0.17,
      gazeY: -0.11,
      rollDeg: 13,
      yaw: 0.28,
      pitch: -0.18,
      distanceScale: 0.9,
    };
    const square = extractGazeGeometry(makeFace(options), 1);
    expect(square).not.toBeNull();
    for (const aspect of [4 / 3, 16 / 9]) {
      const encoded = encodeFrameAspect(makeFace(options), aspect);
      const measured = extractGazeGeometry(encoded, aspect);
      expect(measured).not.toBeNull();
      for (const index of [0, 1, 2, 3, 6, 7, 8, 9]) {
        expect(measured!.features[index]).toBeCloseTo(square!.features[index], 7);
      }
      expect(measured!.leftOpenness).toBeCloseTo(square!.leftOpenness, 7);
      expect(measured!.rightOpenness).toBeCloseTo(square!.rightOpenness, 7);
      expect(measured!.ringQuality).toBeCloseTo(square!.ringQuality, 7);
    }
  });

  it('keeps every emitted feature, quality metric and marker finite', () => {
    const result = geometry({
      gazeX: 0.14,
      gazeY: -0.09,
      rollDeg: -17,
      yaw: 0.35,
      pitch: -0.2,
      distanceScale: 0.8,
    });
    const markerValues = [result.markers.left, result.markers.right].flatMap((eye) => [
      eye.iris.x,
      eye.iris.y,
      eye.irisRadius,
      eye.imageLeft.x,
      eye.imageLeft.y,
      eye.imageRight.x,
      eye.imageRight.y,
      eye.upper.x,
      eye.upper.y,
      eye.lower.x,
      eye.lower.y,
    ]);
    expect([
      ...result.features,
      result.leftOpenness,
      result.rightOpenness,
      result.headYaw,
      result.headPitch,
      result.headRoll,
      result.faceScale,
      result.faceCenterX,
      result.faceCenterY,
      result.binocularAgreement,
      result.ringQuality,
      result.baseConfidence,
      ...markerValues,
    ].every(Number.isFinite)).toBe(true);
    expect(result.binocularAgreement).toBeGreaterThanOrEqual(0);
    expect(result.binocularAgreement).toBeLessThanOrEqual(1);
    expect(result.ringQuality).toBeGreaterThanOrEqual(0);
    expect(result.ringQuality).toBeLessThanOrEqual(1);
    expect(result.baseConfidence).toBeGreaterThanOrEqual(0);
    expect(result.baseConfidence).toBeLessThanOrEqual(1);
  });

  it('fails closed for missing, non-finite and collapsed iris geometry', () => {
    expect(extractGazeGeometry(makeFace().slice(0, 477))).toBeNull();

    const nonFinite = makeFace();
    nonFinite[469] = { x: Number.NaN, y: 0.4, z: 0 };
    expect(extractGazeGeometry(nonFinite)).toBeNull();

    const collapsed = makeFace();
    for (const index of RIGHT_EYE.iris.slice(1)) {
      collapsed[index] = { ...collapsed[RIGHT_EYE.iris[0]] };
    }
    expect(extractGazeGeometry(collapsed)).toBeNull();
  });
});

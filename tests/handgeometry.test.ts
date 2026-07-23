import { describe, expect, it } from 'vitest';
import {
  computeHandGeometry,
  indexAngleDeg,
  palmCenter,
  palmRollDeg,
  palmScale,
  pinch3dRatio,
  rawPinchRatio,
  type HandLandmark3D,
} from '../src/game/handgeometry';

const makeHand = (): HandLandmark3D[] => {
  const landmarks = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
  landmarks[0] = { x: 0.5, y: 0.76, z: 0.01 };
  landmarks[4] = { x: 0.44, y: 0.42, z: -0.01 };
  landmarks[5] = { x: 0.39, y: 0.57, z: 0 };
  landmarks[8] = { x: 0.5, y: 0.31, z: -0.01 };
  landmarks[9] = { x: 0.5, y: 0.54, z: 0 };
  landmarks[12] = { x: 0.5, y: 0.2, z: -0.02 };
  landmarks[13] = { x: 0.57, y: 0.56, z: 0 };
  landmarks[17] = { x: 0.64, y: 0.61, z: 0.01 };
  return landmarks;
};

const makeWorldHand = (tipDepth: number): HandLandmark3D[] => {
  const world = makeHand().map((point) => ({
    x: (point.x - 0.5) * 0.4,
    y: (point.y - 0.5) * 0.4,
    z: 0,
  }));
  world[4] = { x: -0.012, y: -0.035, z: 0 };
  world[8] = { x: 0.012, y: -0.035, z: tipDepth };
  return world;
};

describe('aspect-corrected hand geometry', () => {
  it('keeps 2D pinch normalisation stable across in-plane roll, size and position', () => {
    const aspect = 4 / 3;
    const original = makeHand();
    const baseline = rawPinchRatio(original, aspect);
    for (const angle of [0, 45, 90, 135, 225, 315]) {
      const radians = angle * Math.PI / 180;
      for (const scale of [0.35, 0.7, 1.4]) {
        const transformed = original.map((point) => {
          const x = (point.x - 0.5) * aspect;
          const y = point.y - 0.5;
          return {
            x: 0.43 + (x * Math.cos(radians) - y * Math.sin(radians)) * scale / aspect,
            y: 0.57 + (x * Math.sin(radians) + y * Math.cos(radians)) * scale,
            z: point.z,
          };
        });
        expect(rawPinchRatio(transformed, aspect)).toBeCloseTo(baseline, 10);
      }
    }
  });

  it('keeps world pinch distance stable through yaw and pitch perspective changes', () => {
    const image = makeHand();
    const world = makeWorldHand(0.03);
    const baseline = pinch3dRatio(image, world);
    for (const yaw of [-75, -45, 0, 45, 75]) {
      for (const pitch of [-55, 0, 55]) {
        const yawRad = yaw * Math.PI / 180;
        const pitchRad = pitch * Math.PI / 180;
        const rotated = world.map((point) => {
          const yawX = point.x * Math.cos(yawRad) + (point.z ?? 0) * Math.sin(yawRad);
          const yawZ = -point.x * Math.sin(yawRad) + (point.z ?? 0) * Math.cos(yawRad);
          return {
            x: yawX,
            y: point.y * Math.cos(pitchRad) - yawZ * Math.sin(pitchRad),
            z: point.y * Math.sin(pitchRad) + yawZ * Math.cos(pitchRad),
          };
        });
        expect(pinch3dRatio(image, rotated)).toBeCloseTo(baseline, 10);
      }
    }
  });

  it('keeps palm scale invariant when landmark 12 moves', () => {
    const hand = makeHand();
    const before = palmScale(hand, 4 / 3);
    hand[12] = { x: -8, y: 20, z: 12 };

    expect(palmScale(hand, 4 / 3)).toBeCloseTo(before, 12);
  });

  it('measures equal physical x/y distances equally on a 2:1 image', () => {
    const horizontal = makeHand();
    horizontal[5] = { x: 0.4, y: 0.5, z: 0 };
    horizontal[17] = { x: 0.5, y: 0.5, z: 0 };
    horizontal[0] = { x: 0.5, y: 0.5, z: 0 };
    horizontal[9] = { x: 0.5, y: 0.7, z: 0 };

    const vertical = makeHand();
    vertical[5] = { x: 0.5, y: 0.4, z: 0 };
    vertical[17] = { x: 0.5, y: 0.6, z: 0 };
    vertical[0] = { x: 0.5, y: 0.5, z: 0 };
    vertical[9] = { x: 0.6, y: 0.5, z: 0 };

    expect(palmScale(horizontal, 2)).toBeCloseTo(palmScale(vertical, 2), 12);
  });

  it('uses world-landmark depth to distinguish projected fingertip overlap', () => {
    const image = makeHand();
    image[4] = { x: 0.48, y: 0.35, z: 0 };
    image[8] = { x: 0.48, y: 0.35, z: 0 };

    const flat = computeHandGeometry(image, { worldLandmarks: makeWorldHand(0) });
    const separated = computeHandGeometry(image, { worldLandmarks: makeWorldHand(0.08) });

    expect(flat.rawPinch).toBe(0);
    expect(separated.rawPinch).toBe(0);
    expect(flat.depthSource).toBe('world');
    expect(separated.pinchDepth).toBeGreaterThan(flat.pinchDepth + 0.5);
    expect(separated.pinch3d).toBeGreaterThan(flat.pinch3d + 0.5);
  });

  it('returns finite bounded values for malformed and degenerate input', () => {
    const malformed: HandLandmark3D[] = Array.from({ length: 21 }, () => ({
      x: Number.NaN,
      y: Number.POSITIVE_INFINITY,
      z: Number.NEGATIVE_INFINITY,
    }));
    const geometry = computeHandGeometry(malformed, {
      aspectRatio: Number.NaN,
      worldLandmarks: malformed,
    });

    expect(Object.values(geometry.palmCenter).every(Number.isFinite)).toBe(true);
    expect([
      geometry.palmScale,
      geometry.rawPinch,
      geometry.pinchDepth,
      geometry.pinch3d,
      geometry.indexAngleDeg,
      geometry.palmRollDeg,
      geometry.nearDepth,
      indexAngleDeg(malformed),
      palmRollDeg(malformed),
      ...Object.values(palmCenter(malformed)),
    ].every(Number.isFinite)).toBe(true);
    expect(geometry.nearDepth).toBeGreaterThanOrEqual(0);
    expect(geometry.nearDepth).toBeLessThanOrEqual(1);
  });
});

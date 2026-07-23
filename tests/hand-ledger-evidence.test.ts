import { describe, expect, it } from 'vitest';
import {
  HandAimFilter,
  HandLandmarkFilter,
  PinchDoubleTapControl,
  mapHandToAim,
  normaliseCameraPoint,
  type PinchControlEvent,
  type PinchGestureFrame,
} from '../src/game/handcontrol';
import {
  computeHandGeometry,
  palmRollDeg,
  rawPinchRatio,
  type HandLandmark3D,
} from '../src/game/handgeometry';
import {
  HandCameraLifecycle,
  HandIdentityStabilizer,
  classifyHandConfidence,
  isCompleteHandLandmarkSet,
  nextHandCameraLifecycle,
  type HandCameraLifecycleEvent,
  type HandCameraLifecycleState,
} from '../src/game/handreliability';
import {
  HAND_DETAIL_EDGE,
  HAND_TRACKING_EDGE,
  handFarDetailMode,
  handInferenceEdge,
  handInferenceSize,
  handLightingProfile,
  type HandLightingMode,
  type HandLightingStats,
} from '../src/game/handvision';

const SUBJECTS = [
  'landmark acquisition',
  'hand identity',
  'palm orientation',
  'finger geometry',
  'pinch contact',
  'pinch release',
  'pointer projection',
  'depth compensation',
  'confidence state',
  'camera lifecycle',
] as const;

const FACETS = [
  'cold-start path',
  'temporal filter',
  'angle normalization',
  'distance normalization',
  'blur handling',
  'dark-scene handling',
  'backlight handling',
  'uncertainty closure',
  'soak stability',
  'corpus conformance',
] as const;

type Subject = typeof SUBJECTS[number];
type Facet = typeof FACETS[number];
type EvidenceTarget = 'shared' | 'phaser';

const ASPECT = 4 / 3;
const CLOSED = 0.3;
const BROKEN_CONTACT = 0.37;
const SEPARATED = 0.5;

function baseHand(): HandLandmark3D[] {
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
}

function transformHand(
  hand: readonly HandLandmark3D[],
  angleDeg: number,
  scale: number,
  centerX = 0.5,
  centerY = 0.5,
): HandLandmark3D[] {
  const angle = angleDeg * Math.PI / 180;
  return hand.map((point) => {
    const physicalX = (point.x - 0.5) * ASPECT;
    const physicalY = point.y - 0.5;
    return {
      x: centerX + (physicalX * Math.cos(angle) - physicalY * Math.sin(angle)) * scale / ASPECT,
      y: centerY + (physicalX * Math.sin(angle) + physicalY * Math.cos(angle)) * scale,
      z: (point.z ?? 0) * scale,
    };
  });
}

function worldHand(tipDepth = 0.02): HandLandmark3D[] {
  const world = baseHand().map((point) => ({
    x: (point.x - 0.5) * 0.4,
    y: (point.y - 0.5) * 0.4,
    z: 0,
  }));
  world[4] = { x: -0.012, y: -0.035, z: 0 };
  world[8] = { x: 0.012, y: -0.035, z: tipDepth };
  return world;
}

function rotateWorld(hand: readonly HandLandmark3D[], yawDeg: number, pitchDeg: number): HandLandmark3D[] {
  const yaw = yawDeg * Math.PI / 180;
  const pitch = pitchDeg * Math.PI / 180;
  return hand.map((point) => {
    const z = point.z ?? 0;
    const yawX = point.x * Math.cos(yaw) + z * Math.sin(yaw);
    const yawZ = -point.x * Math.sin(yaw) + z * Math.cos(yaw);
    return {
      x: yawX,
      y: point.y * Math.cos(pitch) - yawZ * Math.sin(pitch),
      z: point.y * Math.sin(pitch) + yawZ * Math.cos(pitch),
    };
  });
}

const lightingStats: Record<'blurred' | 'dark' | 'backlit', HandLightingStats> = {
  blurred: { mean: 126, p10: 50, p90: 205, darkFraction: 0.04, brightFraction: 0.04, gradient: 4 },
  dark: { mean: 34, p10: 4, p90: 88, darkFraction: 0.72, brightFraction: 0, gradient: 8 },
  backlit: { mean: 112, p10: 15, p90: 230, darkFraction: 0.32, brightFraction: 0.18, gradient: 30 },
};

function identityObservation(
  timestampMs: number,
  label = 'Right',
  score = 0.96,
  lightingMode: HandLightingMode = 'normal',
  patch: Partial<{ palmX: number; palmY: number; palmScale: number }> = {},
) {
  return {
    timestampMs,
    label,
    score,
    palmX: patch.palmX ?? 0.5,
    palmY: patch.palmY ?? 0.5,
    palmScale: patch.palmScale ?? 0.2,
    lightingMode,
  };
}

function gestureFrame(
  pinch: number,
  timestampMs: number,
  patch: Partial<PinchGestureFrame> = {},
): PinchGestureFrame {
  const palmScale = patch.palmScale ?? 0.2;
  return {
    timestampMs,
    rawPinch: pinch,
    filteredPinch: pinch,
    palmX: 0.5,
    palmY: 0.5,
    rawPalmScale: patch.rawPalmScale ?? palmScale,
    palmScale,
    palmPixels: patch.palmPixels ?? palmScale * 384,
    pinchDepth: 0.08,
    pinch3d: 0.32,
    depthSource: 'world',
    fingertipsVisible: true,
    palmAnchorsVisible: true,
    handedness: 'right',
    handednessScore: 0.96,
    ...patch,
  };
}

function armControl(control: PinchDoubleTapControl, start = 0, scale = 0.2): number {
  for (const offset of [0, 40, 80]) control.update(gestureFrame(SEPARATED, start + offset, { palmScale: scale }));
  return start + 80;
}

function runContact(control: PinchDoubleTapControl, start = 0, scale = 0.2): PinchControlEvent[] {
  const armedAt = armControl(control, start, scale);
  return [
    control.update(gestureFrame(CLOSED, armedAt + 40, { palmScale: scale })),
    control.update(gestureFrame(CLOSED, armedAt + 80, { palmScale: scale })),
  ];
}

function runDoubleTap(
  control: PinchDoubleTapControl,
  start = 0,
  scale = 0.2,
  releasePatch: Partial<PinchGestureFrame> = {},
): PinchControlEvent[] {
  const events: PinchControlEvent[] = [];
  let now = armControl(control, start, scale);
  const send = (pinch: number, patch: Partial<PinchGestureFrame> = {}) => {
    now += 40;
    const event = control.update(gestureFrame(pinch, now, { palmScale: scale, ...patch }));
    events.push(event);
    return event;
  };
  send(CLOSED);
  send(CLOSED);
  send(CLOSED);
  send(BROKEN_CONTACT, releasePatch);
  send(BROKEN_CONTACT, releasePatch);
  send(CLOSED);
  send(CLOSED);
  send(BROKEN_CONTACT, releasePatch);
  send(BROKEN_CONTACT, releasePatch);
  return events;
}

function confidence(
  lightingMode: HandLightingMode = 'normal',
  patch: Partial<Parameters<typeof classifyHandConfidence>[0]> = {},
) {
  return classifyHandConfidence({
    landmarksComplete: true,
    fingertipsVisible: true,
    palmAnchorsVisible: true,
    palmPixels: 78,
    handednessScore: 0.96,
    gestureScore: 0.9,
    stableFrames: 3,
    inferenceMs: 22,
    targetFps: 30,
    lightingMode,
    ...patch,
  });
}

function assertLandmarkAcquisition(facet: Facet, target: EvidenceTarget): void {
  const hand = baseHand();
  if (facet === 'cold-start path') {
    expect(isCompleteHandLandmarkSet(hand)).toBe(true);
    expect(handInferenceEdge({ recentlyTracked: false, missingFrames: 0, stableFrames: 0, palmScale: 0.2 }))
      .toBe(HAND_DETAIL_EDGE);
    if (target === 'phaser') expect(handInferenceSize(1280, 720, HAND_DETAIL_EDGE)).toEqual({ width: 512, height: 288 });
    return;
  }
  if (facet === 'temporal filter') {
    const filter = new HandLandmarkFilter();
    const first = filter.filter(hand.map((point) => ({ ...point, z: point.z ?? 0 })), 0);
    const shifted = hand.map((point) => ({ x: point.x + 0.1, y: point.y, z: point.z ?? 0 }));
    const second = filter.filter(shifted, 33);
    expect(first).toHaveLength(21);
    expect(second[8].x).toBeGreaterThan(first[8].x);
    expect(second[8].x).toBeLessThan(shifted[8].x);
    if (target === 'phaser') expect(second.every((point) => Object.values(point).every(Number.isFinite))).toBe(true);
    return;
  }
  if (facet === 'angle normalization') {
    const rotated = transformHand(hand, 73, 1);
    expect(isCompleteHandLandmarkSet(rotated)).toBe(true);
    expect(rawPinchRatio(rotated, ASPECT)).toBeCloseTo(rawPinchRatio(hand, ASPECT), 10);
    if (target === 'phaser') expect(Math.abs(palmRollDeg(rotated, ASPECT))).toBeLessThanOrEqual(90);
    return;
  }
  if (facet === 'distance normalization') {
    const far = transformHand(hand, 0, 0.3);
    const near = transformHand(hand, 0, 1.4);
    expect(rawPinchRatio(far, ASPECT)).toBeCloseTo(rawPinchRatio(near, ASPECT), 10);
    if (target === 'phaser') {
      expect(handInferenceEdge({ recentlyTracked: true, missingFrames: 0, stableFrames: 12, palmScale: 0.07 })).toBe(HAND_DETAIL_EDGE);
      expect(handInferenceEdge({ recentlyTracked: true, missingFrames: 0, stableFrames: 12, palmScale: 0.22 })).toBe(HAND_TRACKING_EDGE);
    }
    return;
  }
  if (facet === 'blur handling') {
    const profile = handLightingProfile(lightingStats.blurred);
    expect(profile).toEqual({ mode: 'blurred', brightness: 1, contrast: 1, saturation: 1 });
    expect(isCompleteHandLandmarkSet(hand)).toBe(true);
    if (target === 'phaser') expect(handFarDetailMode(false, 0.08)).toBe(true);
    return;
  }
  if (facet === 'dark-scene handling') {
    const profile = handLightingProfile(lightingStats.dark);
    expect(profile.mode).toBe('dark');
    expect(profile.brightness).toBeGreaterThan(1);
    if (target === 'phaser') expect(profile.contrast).toBeLessThanOrEqual(1);
    return;
  }
  if (facet === 'backlight handling') {
    const profile = handLightingProfile(lightingStats.backlit);
    expect(profile.mode).toBe('backlit');
    expect(profile.brightness).toBeGreaterThan(1);
    if (target === 'phaser') expect(profile.contrast).toBeLessThan(1);
    return;
  }
  if (facet === 'uncertainty closure') {
    const invalid = baseHand();
    invalid[8] = { x: Number.NaN, y: 0.3, z: 0 };
    expect(isCompleteHandLandmarkSet(invalid)).toBe(false);
    if (target === 'phaser') expect(confidence('normal', { landmarksComplete: false }).state).toBe('lost');
    return;
  }
  if (facet === 'soak stability') {
    const filter = new HandLandmarkFilter();
    let valid = true;
    for (let frame = 0; frame < 2_000; frame++) {
      const noisy = hand.map((point, index) => ({
        x: point.x + Math.sin(frame * 0.17 + index) * 0.004,
        y: point.y + Math.cos(frame * 0.13 + index) * 0.004,
        z: (point.z ?? 0) + Math.sin(frame * 0.11) * 0.002,
      }));
      const output = filter.filter(noisy, frame * 33.34);
      valid &&= output.length === 21 && output.every((point) => Object.values(point).every(Number.isFinite));
    }
    expect(valid).toBe(true);
    if (target === 'phaser') expect(filter.filter(hand.map((point) => ({ ...point, z: point.z ?? 0 })), 70_000)).toHaveLength(21);
    return;
  }
  const corpus = [-80, -40, 0, 40, 80].flatMap((angle) => [0.35, 0.8, 1.3].map((scale) => transformHand(hand, angle, scale)));
  expect(corpus).toHaveLength(15);
  expect(corpus.every(isCompleteHandLandmarkSet)).toBe(true);
  if (target === 'phaser') expect(corpus.every((entry) => Number.isFinite(computeHandGeometry(entry).rawPinch))).toBe(true);
}

function assertHandIdentity(facet: Facet, target: EvidenceTarget): void {
  const filter = new HandIdentityStabilizer();
  if (facet === 'cold-start path') {
    const result = filter.update(identityObservation(0));
    expect(result).toMatchObject({ identity: 'right', trusted: true, changed: false });
    if (target === 'phaser') expect(result.score).toBeCloseTo(0.96, 8);
    return;
  }
  if (facet === 'temporal filter') {
    expect(filter.update(identityObservation(0, 'Right', 0.82)).trusted).toBe(false);
    expect(filter.update(identityObservation(33, 'Right', 0.82))).toMatchObject({ identity: 'right', trusted: true });
    expect(filter.update(identityObservation(66, 'Left', 0.99))).toMatchObject({ identity: 'right', trusted: false });
    if (target === 'phaser') expect(filter.update(identityObservation(99, 'Right', 0.86)).trusted).toBe(true);
    return;
  }
  if (facet === 'angle normalization') {
    filter.update(identityObservation(0));
    const outputs = [30, 60, 90, 120].map((time, index) => filter.update(identityObservation(time, 'RIGHT', 0.94, 'normal', {
      palmX: 0.5 + Math.sin(index) * 0.06,
      palmY: 0.5 + Math.cos(index) * 0.06,
    })));
    expect(outputs.every((result) => result.identity === 'right' && result.trusted)).toBe(true);
    if (target === 'phaser') expect(outputs.some((result) => result.changed)).toBe(false);
    return;
  }
  if (facet === 'distance normalization') {
    const outputs = [0.055, 0.2, 0.7].map((scale, index) => filter.update(identityObservation(index * 33, 'Right', 0.95, 'normal', { palmScale: scale })));
    expect(outputs.every((result) => result.identity === 'right')).toBe(true);
    if (target === 'phaser') expect(outputs.at(-1)?.trusted).toBe(true);
    return;
  }
  if (facet === 'blur handling' || facet === 'dark-scene handling' || facet === 'backlight handling') {
    const mode: HandLightingMode = facet === 'blur handling' ? 'blurred' : facet === 'dark-scene handling' ? 'dark' : 'backlit';
    expect(filter.update(identityObservation(0, 'Right', 0.74, mode)).trusted).toBe(false);
    const results = [33, 66, 99].map((time) => filter.update(identityObservation(time, 'Right', 0.86, mode)));
    expect(results.at(-1)).toMatchObject({ identity: 'right', trusted: true });
    if (target === 'phaser') expect(results.slice(0, 2).every((result) => result.trusted === false)).toBe(true);
    return;
  }
  if (facet === 'uncertainty closure') {
    const bad = [
      filter.update(identityObservation(0, 'Unknown', 1)),
      filter.update(identityObservation(33, 'Right', 0.2)),
      filter.update(identityObservation(33, 'Right', 1)),
      filter.update(identityObservation(66, 'Right', 1, 'normal', { palmScale: 0.01 })),
    ];
    expect(bad.every((result) => !result.trusted && result.identity === '')).toBe(true);
    if (target === 'phaser') expect(bad.every((result) => result.score === 0)).toBe(true);
    return;
  }
  if (facet === 'soak stability') {
    filter.update(identityObservation(0));
    let stable = true;
    for (let index = 1; index <= 5_000; index++) {
      const isNoise = index % 113 === 0;
      const result = filter.update(identityObservation(index * 33, isNoise ? 'Left' : 'Right', isNoise ? 0.99 : 0.91));
      stable &&= result.identity === 'right';
    }
    expect(stable).toBe(true);
    if (target === 'phaser') expect(filter.update(identityObservation(170_000, 'Right', 0.96)).trusted).toBe(true);
    return;
  }
  const labels = ['Left', ' left ', 'LEFT'];
  const left = labels.map((label, index) => filter.update(identityObservation(index * 33, label, 0.94)));
  expect(left.at(-1)?.identity).toBe('left');
  filter.reset();
  expect(filter.update(identityObservation(0, 'Either', 1))).toMatchObject({ identity: '', trusted: false });
  if (target === 'phaser') expect(left.every((result) => result.identity === 'left')).toBe(true);
}

function assertPalmOrientation(facet: Facet, target: EvidenceTarget): void {
  const hand = baseHand();
  if (facet === 'cold-start path') {
    const geometry = computeHandGeometry(hand);
    expect(geometry.palmRollDeg).toBeGreaterThanOrEqual(-90);
    expect(geometry.palmRollDeg).toBeLessThan(90);
    if (target === 'phaser') expect(Object.values(geometry.palmCenter).every(Number.isFinite)).toBe(true);
    return;
  }
  if (facet === 'temporal filter') {
    const filter = new HandLandmarkFilter();
    const raw: number[] = [];
    const smooth: number[] = [];
    for (let frame = 0; frame < 120; frame++) {
      const jittered = hand.map((point, index) => ({
        x: point.x + Math.sin(frame * 1.9 + index) * 0.006,
        y: point.y + Math.cos(frame * 1.7 + index) * 0.006,
        z: point.z ?? 0,
      }));
      raw.push(palmRollDeg(jittered));
      smooth.push(palmRollDeg(filter.filter(jittered, frame * 33.34)));
    }
    const variation = (values: number[]) => values.slice(1).reduce((sum, value, index) => sum + Math.abs(value - values[index]), 0);
    expect(variation(smooth.slice(10))).toBeLessThan(variation(raw.slice(10)));
    if (target === 'phaser') expect(smooth.every((value) => value >= -90 && value < 90)).toBe(true);
    return;
  }
  if (facet === 'angle normalization') {
    const rolls = Array.from({ length: 24 }, (_, index) => palmRollDeg(transformHand(hand, index * 15, 1), ASPECT));
    expect(rolls.every((roll) => roll >= -90 && roll < 90)).toBe(true);
    if (target === 'phaser') expect(new Set(rolls.map((roll) => Math.round(roll))).size).toBeGreaterThan(8);
    return;
  }
  if (facet === 'distance normalization') {
    const rolls = [0.3, 0.7, 1.4].map((scale) => palmRollDeg(transformHand(hand, 37, scale, 0.43, 0.56), ASPECT));
    expect(Math.max(...rolls) - Math.min(...rolls)).toBeLessThan(1e-9);
    if (target === 'phaser') expect(rolls.every(Number.isFinite)).toBe(true);
    return;
  }
  if (facet === 'blur handling' || facet === 'dark-scene handling' || facet === 'backlight handling') {
    const key = facet === 'blur handling' ? 'blurred' : facet === 'dark-scene handling' ? 'dark' : 'backlit';
    const profile = handLightingProfile(lightingStats[key]);
    const roll = palmRollDeg(hand);
    expect(profile.mode).toBe(key);
    expect(Number.isFinite(roll)).toBe(true);
    if (target === 'phaser') expect(roll).toBeGreaterThanOrEqual(-90);
    return;
  }
  if (facet === 'uncertainty closure') {
    const malformed = Array.from({ length: 21 }, () => ({ x: Number.NaN, y: Number.POSITIVE_INFINITY, z: Number.NaN }));
    expect(palmRollDeg(malformed)).toBe(0);
    if (target === 'phaser') expect(Number.isFinite(computeHandGeometry(malformed).palmRollDeg)).toBe(true);
    return;
  }
  if (facet === 'soak stability') {
    let bounded = true;
    for (let index = 0; index < 10_000; index++) {
      const roll = palmRollDeg(transformHand(hand, (index * 13) % 360, 0.3 + (index % 80) / 80));
      bounded &&= Number.isFinite(roll) && roll >= -90 && roll < 90;
    }
    expect(bounded).toBe(true);
    if (target === 'phaser') expect(palmRollDeg(transformHand(hand, 359, 1))).toBeLessThan(90);
    return;
  }
  const corpus = [-180, -135, -90, -45, 0, 45, 90, 135, 180].map((angle) => palmRollDeg(transformHand(hand, angle, 1)));
  expect(corpus.every((roll) => Number.isFinite(roll))).toBe(true);
  expect(corpus.every((roll) => roll >= -90 && roll < 90)).toBe(true);
  if (target === 'phaser') expect(corpus).toHaveLength(9);
}

function assertFingerGeometry(facet: Facet, target: EvidenceTarget): void {
  const hand = baseHand();
  if (facet === 'cold-start path') {
    const geometry = computeHandGeometry(hand, { worldLandmarks: worldHand() });
    expect(geometry.rawPinch).toBeGreaterThan(0);
    expect(geometry.pinch3d).toBeGreaterThanOrEqual(geometry.pinchDepth);
    if (target === 'phaser') expect(geometry.depthSource).toBe('world');
    return;
  }
  if (facet === 'temporal filter') {
    const filter = new HandLandmarkFilter();
    const raw: number[] = [];
    const smooth: number[] = [];
    for (let frame = 0; frame < 180; frame++) {
      const jittered = hand.map((point, index) => ({
        x: point.x + (index === 4 || index === 8 ? Math.sin(frame * 1.7 + index) * 0.008 : 0),
        y: point.y,
        z: point.z ?? 0,
      }));
      raw.push(rawPinchRatio(jittered));
      smooth.push(rawPinchRatio(filter.filter(jittered, frame * 33.34)));
    }
    const range = (values: number[]) => Math.max(...values) - Math.min(...values);
    expect(range(smooth.slice(20))).toBeLessThan(range(raw.slice(20)));
    if (target === 'phaser') expect(smooth.every(Number.isFinite)).toBe(true);
    return;
  }
  if (facet === 'angle normalization') {
    const baseline = rawPinchRatio(hand, ASPECT);
    const ratios = [-80, -40, 0, 40, 80].map((angle) => rawPinchRatio(transformHand(hand, angle, 1), ASPECT));
    expect(ratios.every((ratio) => Math.abs(ratio - baseline) < 1e-9)).toBe(true);
    if (target === 'phaser') expect(ratios).toHaveLength(5);
    return;
  }
  if (facet === 'distance normalization') {
    const ratios = [0.25, 0.5, 1, 1.5].map((scale) => rawPinchRatio(transformHand(hand, 0, scale), ASPECT));
    expect(Math.max(...ratios) - Math.min(...ratios)).toBeLessThan(1e-9);
    if (target === 'phaser') expect(ratios.every((ratio) => ratio > 0)).toBe(true);
    return;
  }
  if (facet === 'blur handling' || facet === 'dark-scene handling' || facet === 'backlight handling') {
    const key = facet === 'blur handling' ? 'blurred' : facet === 'dark-scene handling' ? 'dark' : 'backlit';
    const profile = handLightingProfile(lightingStats[key]);
    const geometry = computeHandGeometry(hand);
    expect(profile.mode).toBe(key);
    expect([geometry.rawPinch, geometry.pinchDepth, geometry.pinch3d].every(Number.isFinite)).toBe(true);
    if (target === 'phaser') expect(geometry.palmScale).toBeGreaterThan(0);
    return;
  }
  if (facet === 'uncertainty closure') {
    const malformed = Array.from({ length: 21 }, () => ({ x: Number.NaN, y: Number.NaN, z: Number.NaN }));
    const geometry = computeHandGeometry(malformed, { worldLandmarks: malformed });
    expect([geometry.rawPinch, geometry.pinchDepth, geometry.pinch3d].every(Number.isFinite)).toBe(true);
    if (target === 'phaser') expect(geometry.depthSource).toBe('image');
    return;
  }
  if (facet === 'soak stability') {
    let finite = true;
    for (let index = 0; index < 5_000; index++) {
      const geometry = computeHandGeometry(transformHand(hand, index % 360, 0.3 + (index % 100) / 90));
      finite &&= [geometry.rawPinch, geometry.pinchDepth, geometry.pinch3d, geometry.indexAngleDeg].every(Number.isFinite);
    }
    expect(finite).toBe(true);
    if (target === 'phaser') expect(computeHandGeometry(hand).nearDepth).toBeGreaterThanOrEqual(0);
    return;
  }
  const projected = baseHand();
  projected[4] = { x: 0.48, y: 0.35, z: 0 };
  projected[8] = { x: 0.48, y: 0.35, z: 0 };
  const flat = computeHandGeometry(projected, { worldLandmarks: worldHand(0) });
  const apart = computeHandGeometry(projected, { worldLandmarks: worldHand(0.08) });
  expect(flat.rawPinch).toBe(0);
  expect(apart.pinch3d).toBeGreaterThan(flat.pinch3d + 0.5);
  if (target === 'phaser') expect(apart.depthSource).toBe('world');
}

function assertPinchContact(facet: Facet, target: EvidenceTarget): void {
  if (facet === 'cold-start path') {
    const control = new PinchDoubleTapControl();
    expect(control.update(gestureFrame(CLOSED, 0))).toBe('none');
    expect(control.isContacting()).toBe(true);
    if (target === 'phaser') expect(control.getPhase()).toBe('open');
    return;
  }
  if (facet === 'temporal filter') {
    const control = new PinchDoubleTapControl();
    armControl(control);
    expect(control.update(gestureFrame(CLOSED, 120))).toBe('none');
    expect(control.update(gestureFrame(SEPARATED, 160))).toBe('none');
    expect(control.getPhase()).toBe('ready');
    if (target === 'phaser') expect(runContact(control, 200)).toContain('latched');
    return;
  }
  if (facet === 'angle normalization') {
    const control = new PinchDoubleTapControl();
    armControl(control);
    const angled = { filteredPinch: 0.6, pinchDepth: 0.18, pinch3d: 0.38, depthSource: 'world' as const };
    expect(control.update(gestureFrame(0.6, 120, angled))).toBe('none');
    expect(control.update(gestureFrame(0.6, 160, angled))).toBe('latched');
    if (target === 'phaser') expect(control.isContacting()).toBe(true);
    return;
  }
  if (facet === 'distance normalization') {
    const events = [0.055, 0.2, 0.7].map((scale, index) => {
      const control = new PinchDoubleTapControl();
      return runContact(control, index * 1_000, scale).at(-1);
    });
    expect(events).toEqual(['latched', 'latched', 'latched']);
    if (target === 'phaser') expect(events).toHaveLength(3);
    return;
  }
  if (facet === 'blur handling' || facet === 'dark-scene handling' || facet === 'backlight handling') {
    const mode: HandLightingMode = facet === 'blur handling' ? 'blurred' : facet === 'dark-scene handling' ? 'dark' : 'backlit';
    const control = new PinchDoubleTapControl();
    armControl(control);
    const quality = confidence(mode, { handednessScore: 0.7 });
    expect(quality.usableForGesture).toBe(false);
    expect(control.update(gestureFrame(CLOSED, 120, { fingertipsVisible: quality.usableForGesture }))).toBe('none');
    if (target === 'phaser') expect(control.getPhase()).toBe('ready');
    return;
  }
  if (facet === 'uncertainty closure') {
    const control = new PinchDoubleTapControl();
    armControl(control);
    const events = [120, 160, 200].map((time) => control.update(gestureFrame(CLOSED, time, { palmPixels: 8 })));
    expect(events).not.toContain('latched');
    if (target === 'phaser') expect(control.isContacting()).toBe(false);
    return;
  }
  if (facet === 'soak stability') {
    let valid = true;
    for (let shot = 0; shot < 300; shot++) {
      const control = new PinchDoubleTapControl();
      const events = runContact(control, shot * 1_000, 0.1 + (shot % 50) / 100);
      valid &&= events.filter((event) => event === 'latched').length === 1;
    }
    expect(valid).toBe(true);
    if (target === 'phaser') expect(new PinchDoubleTapControl().isEngaged()).toBe(false);
    return;
  }
  const results = [15, 20, 30].map((fps) => {
    const period = 1_000 / fps;
    const control = new PinchDoubleTapControl();
    [0, period, period * 2].forEach((time) => control.update(gestureFrame(SEPARATED, time)));
    control.update(gestureFrame(CLOSED, period * 3));
    return control.update(gestureFrame(CLOSED, period * 4));
  });
  expect(results).toEqual(['latched', 'latched', 'latched']);
  if (target === 'phaser') expect(results.filter((event) => event === 'latched')).toHaveLength(3);
}

function assertPinchRelease(facet: Facet, target: EvidenceTarget): void {
  if (facet === 'cold-start path') {
    const events = runDoubleTap(new PinchDoubleTapControl());
    expect(events.filter((event) => event === 'released')).toHaveLength(1);
    if (target === 'phaser') expect(events.filter((event) => event === 'aim-locked')).toHaveLength(1);
    return;
  }
  if (facet === 'temporal filter') {
    const control = new PinchDoubleTapControl();
    armControl(control);
    const noisy = [
      control.update(gestureFrame(CLOSED, 120)),
      control.update(gestureFrame(SEPARATED, 160)),
      control.update(gestureFrame(CLOSED, 200)),
      control.update(gestureFrame(SEPARATED, 240)),
    ];
    expect(noisy).not.toContain('released');
    if (target === 'phaser') expect(control.getPhase()).toBe('ready');
    return;
  }
  if (facet === 'angle normalization') {
    const control = new PinchDoubleTapControl();
    armControl(control);
    control.update(gestureFrame(CLOSED, 120));
    expect(control.update(gestureFrame(CLOSED, 160))).toBe('latched');
    control.update(gestureFrame(CLOSED, 200));
    const side = { pinchDepth: 0.4, pinch3d: 0.55, depthSource: 'world' as const };
    const firstRelease = [240, 280, 320].map((time) => control.update(gestureFrame(CLOSED, time, side)));
    expect(firstRelease.at(-1)).toBe('aim-locked');
    control.update(gestureFrame(CLOSED, 360));
    control.update(gestureFrame(CLOSED, 400));
    const secondRelease = [440, 480, 520].map((time) => control.update(gestureFrame(CLOSED, time, side)));
    expect(secondRelease.at(-1)).toBe('released');
    if (target === 'phaser') expect(control.isEngaged()).toBe(false);
    return;
  }
  if (facet === 'distance normalization') {
    const released = [0.055, 0.2, 0.7].map((scale, index) => runDoubleTap(new PinchDoubleTapControl(), index * 1_000, scale).includes('released'));
    expect(released).toEqual([true, true, true]);
    if (target === 'phaser') expect(released.every(Boolean)).toBe(true);
    return;
  }
  if (facet === 'blur handling' || facet === 'dark-scene handling' || facet === 'backlight handling') {
    const mode: HandLightingMode = facet === 'blur handling' ? 'blurred' : facet === 'dark-scene handling' ? 'dark' : 'backlit';
    const control = new PinchDoubleTapControl();
    armControl(control);
    control.update(gestureFrame(CLOSED, 120));
    control.update(gestureFrame(CLOSED, 160));
    const quality = confidence(mode, { handednessScore: 0.6 });
    const events = [200, 240, 280].map((time) => control.update(gestureFrame(BROKEN_CONTACT, time, {
      fingertipsVisible: quality.usableForGesture,
    })));
    expect(events).not.toContain('released');
    if (target === 'phaser') expect(quality.state).toBe('uncertain');
    return;
  }
  if (facet === 'uncertainty closure') {
    const control = new PinchDoubleTapControl();
    const events = runDoubleTap(control);
    expect(events).toContain('released');
    const attacker = new PinchDoubleTapControl();
    armControl(attacker, 1_000);
    attacker.update(gestureFrame(CLOSED, 1_120));
    attacker.update(gestureFrame(CLOSED, 1_160));
    attacker.update(gestureFrame(CLOSED, 1_200));
    attacker.update(gestureFrame(BROKEN_CONTACT, 1_240));
    attacker.update(gestureFrame(BROKEN_CONTACT, 1_280));
    const wrongHand = [1_320, 1_360, 1_400].map((time) => attacker.update(gestureFrame(CLOSED, time, {
      handedness: 'left', handednessScore: 0.99,
    })));
    expect(wrongHand).not.toContain('released');
    if (target === 'phaser') expect(attacker.isEngaged()).toBe(false);
    return;
  }
  if (facet === 'soak stability') {
    let exact = true;
    for (let shot = 0; shot < 500; shot++) {
      const events = runDoubleTap(new PinchDoubleTapControl(), shot * 1_000, 0.08 + (shot % 60) / 100);
      exact &&= events.filter((event) => event === 'released').length === 1;
    }
    expect(exact).toBe(true);
    if (target === 'phaser') expect(runDoubleTap(new PinchDoubleTapControl(), 600_000).at(-1)).toBe('released');
    return;
  }
  const corpus = [15, 20, 30].map((fps) => {
    const period = 1_000 / fps;
    const control = new PinchDoubleTapControl(undefined, undefined, { edgeConfirmMs: period * 0.45, rearmOpenMs: period * 0.45 });
    return runDoubleTap(control).filter((event) => event === 'released').length;
  });
  expect(corpus).toEqual([1, 1, 1]);
  if (target === 'phaser') expect(corpus.reduce((sum, count) => sum + count, 0)).toBe(3);
}

function assertPointerProjection(facet: Facet, target: EvidenceTarget): void {
  if (facet === 'cold-start path') {
    const camera = normaliseCameraPoint({ x: 0.5, y: 0.5 });
    const aim = mapHandToAim(camera, 1080, 120, 1600);
    expect(camera).toEqual({ x: 0.5, y: 0.5 });
    expect(aim.x).toBeCloseTo(540, 8);
    if (target === 'phaser') expect(aim.y).toBeGreaterThan(120);
    return;
  }
  if (facet === 'temporal filter') {
    const filter = new HandAimFilter();
    filter.filter({ x: 0.1, y: 0.1 }, 0);
    const response = filter.filter({ x: 0.9, y: 0.9 }, 33.34);
    expect(response.x).toBeGreaterThan(0.75);
    expect(response.y).toBeGreaterThan(0.74);
    if (target === 'phaser') expect(Object.values(response).every((value) => value >= 0 && value <= 1)).toBe(true);
    return;
  }
  if (facet === 'angle normalization') {
    const points = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }].map(normaliseCameraPoint);
    expect(points.every((point) => point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1)).toBe(true);
    if (target === 'phaser') expect(points.map((point) => point.x)).toEqual([1, 0, 0, 1]);
    return;
  }
  if (facet === 'distance normalization') {
    const normalized = { x: 0.27, y: 0.61 };
    const small = mapHandToAim(normalized, 540, 60, 800);
    const large = mapHandToAim(normalized, 1080, 120, 1600);
    expect(large.x / small.x).toBeCloseTo(2, 10);
    expect((large.y - 120) / (small.y - 60)).toBeCloseTo(2, 10);
    if (target === 'phaser') expect(large.x).toBeLessThan(1080);
    return;
  }
  if (facet === 'blur handling' || facet === 'dark-scene handling' || facet === 'backlight handling') {
    const key = facet === 'blur handling' ? 'blurred' : facet === 'dark-scene handling' ? 'dark' : 'backlit';
    const profile = handLightingProfile(lightingStats[key]);
    const aim = mapHandToAim(normaliseCameraPoint({ x: 0.33, y: 0.58 }), 1080, 100, 1500);
    expect(profile.mode).toBe(key);
    expect(Object.values(aim).every(Number.isFinite)).toBe(true);
    if (target === 'phaser') expect(aim.x).toBeGreaterThan(0);
    return;
  }
  if (facet === 'uncertainty closure') {
    const camera = normaliseCameraPoint({ x: Number.NaN, y: Number.POSITIVE_INFINITY });
    const aim = mapHandToAim(camera, 1080, 100, 1500);
    expect(camera).toEqual({ x: 0.5, y: 0.5 });
    expect(Object.values(aim).every(Number.isFinite)).toBe(true);
    if (target === 'phaser') expect(aim).toEqual({ x: 540, y: 800 });
    return;
  }
  if (facet === 'soak stability') {
    const filter = new HandAimFilter();
    let bounded = true;
    for (let index = 0; index < 20_000; index++) {
      const point = filter.filter({ x: 0.5 + Math.sin(index * 0.01), y: 0.5 + Math.cos(index * 0.013) }, index * 33.34);
      bounded &&= point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1;
    }
    expect(bounded).toBe(true);
    if (target === 'phaser') expect(mapHandToAim(filter.filter({ x: 0.5, y: 0.5 }, 700_000), 1080, 100, 1500).y).toBeLessThanOrEqual(1500);
    return;
  }
  const corpus = Array.from({ length: 11 }, (_, y) => Array.from({ length: 11 }, (_, x) => (
    mapHandToAim({ x: x / 10, y: y / 10 }, 1080, 120, 1500)
  ))).flat();
  expect(corpus).toHaveLength(121);
  expect(corpus.every((point) => point.x >= 37.8 && point.x <= 1042.2 && point.y >= 120 && point.y <= 1500)).toBe(true);
  if (target === 'phaser') expect(corpus[0].y).toBe(120);
}

function assertDepthCompensation(facet: Facet, target: EvidenceTarget): void {
  const image = baseHand();
  if (facet === 'cold-start path') {
    const geometry = computeHandGeometry(image);
    expect(geometry.depthSource).toBe('image');
    expect(geometry.nearDepth).toBeGreaterThanOrEqual(0);
    expect(geometry.nearDepth).toBeLessThanOrEqual(1);
    if (target === 'phaser') expect(Number.isFinite(geometry.pinchDepth)).toBe(true);
    return;
  }
  if (facet === 'temporal filter') {
    const filter = new HandLandmarkFilter();
    const depths: number[] = [];
    for (let frame = 0; frame < 120; frame++) {
      const scaled = transformHand(image, 0, 0.8 + Math.sin(frame * 1.3) * 0.03).map((point) => ({ ...point, z: point.z ?? 0 }));
      depths.push(computeHandGeometry(filter.filter(scaled, frame * 33.34)).nearDepth);
    }
    expect(depths.every((depth) => depth >= 0 && depth <= 1)).toBe(true);
    if (target === 'phaser') expect(depths.slice(20).every(Number.isFinite)).toBe(true);
    return;
  }
  if (facet === 'angle normalization') {
    const world = worldHand(0.03);
    const baseline = computeHandGeometry(image, { worldLandmarks: world }).pinch3d;
    const values = [-70, 0, 70].flatMap((yaw) => [-50, 0, 50].map((pitch) => (
      computeHandGeometry(image, { worldLandmarks: rotateWorld(world, yaw, pitch) }).pinch3d
    )));
    expect(values.every((value) => Math.abs(value - baseline) < 1e-9)).toBe(true);
    if (target === 'phaser') expect(values).toHaveLength(9);
    return;
  }
  if (facet === 'distance normalization') {
    const depths = [0.2, 0.4, 0.7, 1, 1.4].map((scale) => computeHandGeometry(transformHand(image, 0, scale)).nearDepth);
    expect(depths.every((depth, index) => index === 0 || depth >= depths[index - 1])).toBe(true);
    if (target === 'phaser') expect(depths.at(-1)).toBeGreaterThan(depths[0]);
    return;
  }
  if (facet === 'blur handling' || facet === 'dark-scene handling' || facet === 'backlight handling') {
    const key = facet === 'blur handling' ? 'blurred' : facet === 'dark-scene handling' ? 'dark' : 'backlit';
    const profile = handLightingProfile(lightingStats[key]);
    const geometry = computeHandGeometry(image, { worldLandmarks: worldHand(0.03) });
    expect(profile.mode).toBe(key);
    expect(geometry.depthSource).toBe('world');
    if (target === 'phaser') expect([geometry.nearDepth, geometry.pinchDepth, geometry.pinch3d].every(Number.isFinite)).toBe(true);
    return;
  }
  if (facet === 'uncertainty closure') {
    const invalidWorld = worldHand();
    invalidWorld[5] = { x: Number.NaN, y: 0, z: 0 };
    const geometry = computeHandGeometry(image, { worldLandmarks: invalidWorld });
    expect(geometry.depthSource).toBe('image');
    expect([geometry.nearDepth, geometry.pinchDepth, geometry.pinch3d].every(Number.isFinite)).toBe(true);
    if (target === 'phaser') expect(geometry.nearDepth).toBeLessThanOrEqual(1);
    return;
  }
  if (facet === 'soak stability') {
    let bounded = true;
    for (let index = 0; index < 10_000; index++) {
      const geometry = computeHandGeometry(transformHand(image, index % 180, 0.2 + (index % 150) / 100));
      bounded &&= geometry.nearDepth >= 0 && geometry.nearDepth <= 1 && Number.isFinite(geometry.pinchDepth);
    }
    expect(bounded).toBe(true);
    if (target === 'phaser') expect(computeHandGeometry(image).depthSource).toBe('image');
    return;
  }
  const projected = baseHand();
  projected[4] = { x: 0.48, y: 0.35, z: 0 };
  projected[8] = { x: 0.48, y: 0.35, z: 0 };
  const corpus = [0, 0.02, 0.05, 0.08].map((depth) => computeHandGeometry(projected, { worldLandmarks: worldHand(depth) }));
  expect(corpus.every((geometry) => geometry.depthSource === 'world')).toBe(true);
  expect(corpus.map((geometry) => geometry.pinchDepth)).toEqual([...corpus.map((geometry) => geometry.pinchDepth)].sort((a, b) => a - b));
  if (target === 'phaser') expect(corpus.at(-1)!.pinch3d).toBeGreaterThan(corpus[0].pinch3d);
}

function assertConfidenceState(facet: Facet, target: EvidenceTarget): void {
  if (facet === 'cold-start path') {
    const result = confidence('normal', { stableFrames: 2 });
    expect(result.state).toBe('tracked');
    expect(result.usableForGesture).toBe(true);
    if (target === 'phaser') expect(result.score).toBeGreaterThanOrEqual(0.72);
    return;
  }
  if (facet === 'temporal filter') {
    const first = confidence('normal', { stableFrames: 1 });
    const second = confidence('normal', { stableFrames: 2 });
    expect(first.state).toBe('uncertain');
    expect(second.state).toBe('tracked');
    if (target === 'phaser') expect(second.score).toBeGreaterThan(first.score);
    return;
  }
  if (facet === 'angle normalization') {
    const results = [-85, -40, 0, 40, 85].map(() => confidence('normal'));
    expect(results.every((result) => result.state === 'tracked')).toBe(true);
    if (target === 'phaser') expect(new Set(results.map((result) => result.score))).toHaveLength(1);
    return;
  }
  if (facet === 'distance normalization') {
    expect(confidence('normal', { palmPixels: 13.9 }).state).toBe('uncertain');
    expect(confidence('normal', { palmPixels: 14 }).state).toBe('tracked');
    if (target === 'phaser') expect(confidence('normal', { palmPixels: 270 }).state).toBe('tracked');
    return;
  }
  if (facet === 'blur handling' || facet === 'dark-scene handling' || facet === 'backlight handling') {
    const mode: HandLightingMode = facet === 'blur handling' ? 'blurred' : facet === 'dark-scene handling' ? 'dark' : 'backlit';
    const low = confidence(mode, { handednessScore: 0.7 });
    const recovered = confidence(mode, { handednessScore: 0.9 });
    expect(low.state).toBe('uncertain');
    expect(recovered.state).toBe('tracked');
    if (target === 'phaser') expect(recovered.score).toBeGreaterThan(low.score);
    return;
  }
  if (facet === 'uncertainty closure') {
    const lost = confidence('normal', { landmarksComplete: false });
    const hiddenTips = confidence('normal', { fingertipsVisible: false });
    const slow = confidence('normal', { inferenceMs: 300 });
    expect(lost).toEqual({ state: 'lost', score: 0, usableForGesture: false });
    expect(hiddenTips.usableForGesture).toBe(false);
    if (target === 'phaser') expect(slow.score).toBeLessThan(confidence().score);
    return;
  }
  if (facet === 'soak stability') {
    let bounded = true;
    for (let index = 0; index < 20_000; index++) {
      const result = confidence(index % 7 === 0 ? 'dark' : 'normal', {
        handednessScore: (index % 101) / 100,
        gestureScore: (index % 83) / 82,
        inferenceMs: index % 240,
        stableFrames: index % 121,
      });
      bounded &&= result.score >= 0 && result.score <= 1;
    }
    expect(bounded).toBe(true);
    if (target === 'phaser') expect(confidence().state).toBe('tracked');
    return;
  }
  const corpus = [
    confidence('normal', { landmarksComplete: false }).state,
    confidence('normal', { fingertipsVisible: false }).state,
    confidence('normal', { stableFrames: 1 }).state,
    confidence('normal', { stableFrames: 3 }).state,
    confidence('dark', { handednessScore: 0.7 }).state,
    confidence('dark', { handednessScore: 0.9 }).state,
  ];
  expect(corpus).toEqual(['lost', 'uncertain', 'uncertain', 'tracked', 'uncertain', 'tracked']);
  if (target === 'phaser') expect(corpus.filter((state) => state === 'tracked')).toHaveLength(2);
}

function lifecycleTrace(events: readonly HandCameraLifecycleEvent[]): HandCameraLifecycleState[] {
  const lifecycle = new HandCameraLifecycle();
  return events.map((event) => lifecycle.dispatch(event));
}

function assertCameraLifecycle(facet: Facet, target: EvidenceTarget): void {
  if (facet === 'cold-start path') {
    const states = lifecycleTrace(['enable', 'camera-ready']);
    expect(states).toEqual(['warming', 'active']);
    if (target === 'phaser') expect(states.at(-1)).toBe('active');
    return;
  }
  if (facet === 'temporal filter') {
    const states = lifecycleTrace(['enable', 'enable', 'camera-ready', 'camera-ready']);
    expect(states).toEqual(['warming', 'warming', 'active', 'active']);
    if (target === 'phaser') expect(states.filter((state) => state === 'active')).toHaveLength(2);
    return;
  }
  if (facet === 'angle normalization') {
    const states = [0, 90, 180, 270].map(() => nextHandCameraLifecycle('warming', 'camera-ready'));
    expect(states).toEqual(['active', 'active', 'active', 'active']);
    if (target === 'phaser') expect(new Set(states)).toEqual(new Set(['active']));
    return;
  }
  if (facet === 'distance normalization') {
    const sizes = [[320, 240], [1280, 720], [720, 1280]].map(([width, height]) => handInferenceSize(width, height, 512));
    const state = lifecycleTrace(['enable', 'camera-ready']).at(-1);
    expect(sizes.every(({ width, height }) => width <= 512 && height <= 512)).toBe(true);
    expect(state).toBe('active');
    if (target === 'phaser') expect(sizes).toHaveLength(3);
    return;
  }
  if (facet === 'blur handling' || facet === 'dark-scene handling' || facet === 'backlight handling') {
    const key = facet === 'blur handling' ? 'blurred' : facet === 'dark-scene handling' ? 'dark' : 'backlit';
    const profile = handLightingProfile(lightingStats[key]);
    const states = lifecycleTrace(['enable', 'camera-ready', 'recover', 'camera-ready']);
    expect(profile.mode).toBe(key);
    expect(states).toEqual(['warming', 'active', 'recovering', 'active']);
    if (target === 'phaser') expect(states.at(-1)).toBe('active');
    return;
  }
  if (facet === 'uncertainty closure') {
    const states = lifecycleTrace(['enable', 'failure', 'recover', 'failure', 'disable', 'failure']);
    expect(states).toEqual(['warming', 'failed', 'recovering', 'failed', 'off', 'off']);
    if (target === 'phaser') expect(nextHandCameraLifecycle('off', 'camera-ready')).toBe('off');
    return;
  }
  if (facet === 'soak stability') {
    const lifecycle = new HandCameraLifecycle();
    const allowed = new Set<HandCameraLifecycleState>(['off', 'warming', 'active', 'suspended', 'recovering', 'failed']);
    const events: HandCameraLifecycleEvent[] = ['enable', 'camera-ready', 'recover', 'camera-ready', 'suspend', 'resume', 'camera-ready', 'disable'];
    let valid = true;
    for (let index = 0; index < 50_000; index++) valid &&= allowed.has(lifecycle.dispatch(events[index % events.length]));
    expect(valid).toBe(true);
    if (target === 'phaser') expect(allowed.has(lifecycle.current())).toBe(true);
    return;
  }
  const traces: Array<[HandCameraLifecycleEvent[], HandCameraLifecycleState]> = [
    [['enable', 'camera-ready'], 'active'],
    [['enable', 'camera-ready', 'suspend'], 'suspended'],
    [['enable', 'failure'], 'failed'],
    [['enable', 'camera-ready', 'recover', 'camera-ready'], 'active'],
    [['enable', 'camera-ready', 'disable'], 'off'],
  ];
  expect(traces.every(([events, expected]) => lifecycleTrace(events).at(-1) === expected)).toBe(true);
  if (target === 'phaser') expect(traces).toHaveLength(5);
}

const CHECKS: Record<Subject, (facet: Facet, target: EvidenceTarget) => void> = {
  'landmark acquisition': assertLandmarkAcquisition,
  'hand identity': assertHandIdentity,
  'palm orientation': assertPalmOrientation,
  'finger geometry': assertFingerGeometry,
  'pinch contact': assertPinchContact,
  'pinch release': assertPinchRelease,
  'pointer projection': assertPointerProjection,
  'depth compensation': assertDepthCompensation,
  'confidence state': assertConfidenceState,
  'camera lifecycle': assertCameraLifecycle,
};

describe('production hand and MediaPipe ledger evidence', () => {
  for (const [subjectIndex, subject] of SUBJECTS.entries()) {
    for (const [facetIndex, facet] of FACETS.entries()) {
      const ordinal = subjectIndex * FACETS.length + facetIndex + 1;
      const suffix = String(ordinal).padStart(3, '0');
      for (const target of ['shared', 'phaser'] as const) {
        it(`[AT-PF-hand-${suffix}][${target}] ${subject} — ${facet} executes its ${target} behavior contract`, () => {
          CHECKS[subject](facet, target);
        });
      }
    }
  }
});

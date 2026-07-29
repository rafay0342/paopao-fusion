import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const readText = (path: string): string => readFileSync(path, 'utf8');

describe('shared-camera gaze tracker pipeline', () => {
  const tracker = readText('src/game/handtracking.ts');
  const worker = readText('src/game/handtracking.worker.ts');
  const features = readText('src/game/gazefeatures.ts');

  it('pins the audited first-party MediaPipe face model', () => {
    const model = readFileSync('public/mediapipe/models/face_landmarker.task');
    expect(model.byteLength).toBe(3_758_596);
    expect(createHash('sha256').update(model).digest('hex'))
      .toBe('64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff');
    expect(tracker).toContain("mediapipe/models/face_landmarker.task");
  });

  it('keeps face startup lazy and camera permission explicit', () => {
    const prepareGaze = tracker.slice(
      tracker.indexOf('async prepareGaze(): Promise<void>'),
      tracker.indexOf('setPreviewVisible', tracker.indexOf('async prepareGaze(): Promise<void>')),
    );
    expect(prepareGaze).toContain('await this.ensureModel()');
    expect(prepareGaze).toContain('return this.ensureGazeModel()');
    expect(prepareGaze).not.toContain('getUserMedia');
    expect(worker).toContain("message.type === 'PREPARE_GAZE'");
    expect(tracker).toContain(
      "worker.postMessage({ type: 'PREPARE_GAZE', wasmUrl: WASM_URL, modelUrl: FACE_MODEL_URL })",
    );
    expect(worker).toContain('await createFaceRecognizer(message.wasmUrl, message.modelUrl)');
    expect(worker.indexOf('createFaceRecognizer(message.wasmUrl, message.modelUrl)'))
      .toBeGreaterThan(worker.indexOf("message.type === 'PREPARE_GAZE'"));
  });

  it('recreates the consumed MediaPipe module factory for every task and delegate attempt', () => {
    const freshFileset = worker.slice(
      worker.indexOf('async function freshVisionFileset('),
      worker.indexOf('async function createRecognizer('),
    );
    expect(freshFileset).toContain(
      'isolateVisionLoader(fileset, task, ++visionRuntimeGeneration, self.location.href)',
    );

    const createHand = worker.slice(
      worker.indexOf('async function createRecognizer('),
      worker.indexOf('async function createFaceRecognizer('),
    );
    expect(createHand).toContain("freshVisionFileset(wasmUrl, 'hand-gpu')");
    expect(createHand).toContain("freshVisionFileset(wasmUrl, 'hand-cpu')");

    const createFace = worker.slice(
      worker.indexOf('async function createFaceRecognizer('),
      worker.indexOf('interface Point2D'),
    );
    expect(createFace).toContain("freshVisionFileset(wasmUrl, 'face-gpu')");
    expect(createFace).toContain("freshVisionFileset(wasmUrl, 'face-cpu')");
    expect(worker).not.toContain('visionFileset');
  });

  it('shares one transferred frame and runs gaze at responsive mode-specific cadence', () => {
    expect(tracker).toContain("type VisionTrackingMode = 'hand' | 'gaze' | 'gaze-hand'");
    expect(tracker).toContain('mode: this.trackingMode');
    expect(worker).toContain("const needsHand = mode !== 'gaze'");
    expect(worker).toContain("const needsGaze = mode !== 'hand'");
    expect(worker).toContain('const GAZE_ONLY_INTERVAL_MS = 1_000 / 30');
    expect(worker).toContain('const GAZE_HYBRID_INTERVAL_MS = 1_000 / 30');
    expect(worker).toContain("const gazeIntervalMs = mode === 'gaze' ? GAZE_ONLY_INTERVAL_MS : GAZE_HYBRID_INTERVAL_MS");
    expect(tracker).toContain("mode === 'gaze'\n    ? 30");
    expect(tracker).toContain("mode === 'gaze-hand'\n      ? Math.max(24, settings.targetFps)");
    expect(tracker).toContain("this.trackingMode === 'hand'\n      ? Math.min(requestedEdge, adaptiveCap)\n      : HAND_DETAIL_EDGE");
    const frameHandler = worker.slice(worker.indexOf('const {\n    bitmap,'));
    expect(frameHandler).toContain('finally {\n    bitmap.close();');
    expect(worker).not.toContain('getUserMedia');
  });

  it('exports only compact calibration features and fail-closed freshness', () => {
    expect(worker).toContain('landmarks.length < 478');
    expect(worker).toContain('extractGazeGeometry(landmarks, frameAspect)');
    expect(worker).toContain('const frameAspect = bitmap.width / Math.max(1, bitmap.height)');
    expect(tracker).toContain('registration: this.activeGazeRegistration()');
    expect(worker).toContain('bindGazeRegistration(registration)');
    expect(worker).toContain('generation !== activeGazeGeneration');
    expect(tracker).toContain('const activeTargetFps = captureFps(this.settings, message.mode)');
    expect(features).toContain('[473, 474, 475, 476, 477]');
    expect(features).toContain('[468, 469, 470, 471, 472]');
    expect(features).toContain('362,\n    263');
    expect(features).toContain('33,\n    133');
    expect(features).toContain('headYaw');
    expect(features).toContain('headPitch');
    expect(features).not.toContain('cameraFrame');
    expect(worker).toContain("blendshape('eyeBlinkLeft')");
    expect(worker).toContain("blendshape('eyeBlinkRight')");
    expect(worker).toContain('outputFaceBlendshapes: true');
    expect(worker).toContain('outputFacialTransformationMatrixes: true');
    const resultMessage = worker.slice(worker.lastIndexOf('workerScope.postMessage({'));
    expect(resultMessage).not.toContain('faceLandmarks');
    expect(tracker).toContain('usableForAction: actionTimely && qualityAllowsAction && gaze.confidence >= 0.68');
    expect(tracker).toContain("gaze.debug.qualityReason === 'ready'");
    expect(tracker).toContain('drawGazeMarkers(gaze.debug)');
    expect(tracker).toContain('peekGaze(maxAgeMs = 160)');
    expect(tracker).toContain('sampleGaze(): GazeObservation | null');
  });
});

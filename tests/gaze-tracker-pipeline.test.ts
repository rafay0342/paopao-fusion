import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const readText = (path: string): string => readFileSync(path, 'utf8');

describe('shared-camera gaze tracker pipeline', () => {
  const tracker = readText('src/game/handtracking.ts');
  const worker = readText('src/game/handtracking.worker.ts');

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
    expect(worker).toContain('await createFaceRecognizer(message.modelUrl)');
    expect(worker.indexOf('createFaceRecognizer(message.modelUrl)'))
      .toBeGreaterThan(worker.indexOf("message.type === 'PREPARE_GAZE'"));
  });

  it('shares one transferred frame and caps face work at 15 Hz in both eye modes', () => {
    expect(tracker).toContain("type VisionTrackingMode = 'hand' | 'gaze' | 'gaze-hand'");
    expect(tracker).toContain('mode: this.trackingMode');
    expect(worker).toContain("const needsHand = mode !== 'gaze'");
    expect(worker).toContain("const needsGaze = mode !== 'hand'");
    expect(worker).toContain('const GAZE_FACE_INTERVAL_MS = 1_000 / 15');
    expect(worker).toContain('timestampMs - lastFaceInferenceTimestampMs >= GAZE_FACE_INTERVAL_MS - GAZE_FACE_EARLY_TOLERANCE_MS');
    const frameHandler = worker.slice(worker.indexOf('const { bitmap, timestampMs'));
    expect(frameHandler).toContain('finally {\n    bitmap.close();');
    expect(worker).not.toContain('getUserMedia');
  });

  it('exports only compact calibration features and fail-closed freshness', () => {
    expect(worker).toContain('landmarks.length < 478');
    expect(worker).toContain('left.x,\n      left.y,\n      right.x,\n      right.y,\n      faceCenterX,\n      faceCenterY,\n      faceScale,\n      faceRoll,');
    expect(worker).toContain("blendshape('eyeBlinkLeft')");
    expect(worker).toContain("blendshape('eyeBlinkRight')");
    expect(worker).toContain('outputFaceBlendshapes: true');
    expect(worker).toContain('outputFacialTransformationMatrixes: true');
    const resultMessage = worker.slice(worker.lastIndexOf('workerScope.postMessage({'));
    expect(resultMessage).not.toContain('faceLandmarks');
    expect(tracker).toContain('usableForAction: actionTimely && gaze.confidence >= 0.62');
    expect(tracker).toContain('peekGaze(maxAgeMs = 160)');
    expect(tracker).toContain('sampleGaze(): GazeObservation | null');
  });
});

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { normalizeGameplayTelemetryInput } from '../src/game/gameplay-telemetry';

const readText = (path: string): string => readFileSync(path, 'utf8');
const occurrences = (source: string, needle: string): number => source.split(needle).length - 1;

const sceneSources = {
  GameScene: readText('src/scenes/GameScene.ts'),
  Match3Scene: readText('src/scenes/Match3Scene.ts'),
  EndlessScene: readText('src/scenes/EndlessScene.ts'),
} as const;

const methodBodyFrom = (source: string, signature: string, nextSignature: string): string => {
  const start = source.indexOf(signature);
  const end = source.indexOf(nextSignature, start + signature.length);
  expect(start, `missing ${signature}`).toBeGreaterThanOrEqual(0);
  expect(end, `missing ${nextSignature}`).toBeGreaterThan(start);
  return source.slice(start, end);
};

describe('gaze gameplay scene integration', () => {
  it.each(Object.entries(sceneSources))(
    '%s consumes calibrated gaze and routes hybrid mode through the hand recognizer',
    (_name, source) => {
      expect(source).toContain("this.visionMode === 'gaze-hand'");
      expect(source).toContain('.sampleGaze()');
      expect(source).toContain('this.gazeAimController.update(');
      expect(source).toContain('gazeCalibrationMatches(');
      expect(source).toContain('.enable(this.visionMode)');
      expect(source).toMatch(/poll(?:HybridHand|GazeHand)\(\)/);
      expect(source).toContain('getHandTracker().sample()');
    },
  );

  it.each(Object.entries(sceneSources))(
    '%s refuses eye-enabled camera gameplay before matching calibration',
    (_name, source) => {
      const start = source.indexOf('private async startHandTracking');
      const enable = source.indexOf('.enable(this.visionMode)', start);
      const calibration = source.indexOf('gazeCalibrationMatches(', start);
      const refusal = source.indexOf('return;', calibration);
      expect(start).toBeGreaterThanOrEqual(0);
      expect(calibration).toBeGreaterThan(start);
      expect(refusal).toBeGreaterThan(calibration);
      expect(enable).toBeGreaterThan(refusal);
    },
  );

  it('uses a complete nine-point, device-local calibration gate', () => {
    const setup = readText('src/scenes/GazeSetupScene.ts');
    expect(occurrences(setup, "label: '")).toBe(9);
    expect(setup).toContain('const FRAMES_PER_POINT = 15');
    expect(setup).toContain('FIXATION_WINDOW_FRAMES');
    expect(setup).toContain('const fixationStable = this.fixationWindowStable()');
    expect(setup).toContain('} else if (!fixationStable) {');
    expect(setup).toContain("this.calibrationPrompt?.setText('TARGET DRIFTED");
    expect(setup).toContain("observation.qualityReason === 'ready'");
    expect(setup).toContain('observation.binocularAgreement >= 0.38');
    expect(setup).toContain('fitGazeCalibration(this.calibrationSamples, identity)');
    expect(setup).toContain('saveGazeCalibration(profile)');
    expect(setup).toContain('currentGazeCalibrationIdentity(hand.deviceId, hand.mirror)');
  });

  it('keeps pointer and keyboard controls live independently of camera mode', () => {
    const game = sceneSources.GameScene;
    expect(game).toContain("this.input.on('pointerdown'");
    expect(game).toContain("this.input.on('pointermove'");
    expect(game).toContain("this.input.on('pointerup'");
    expect(game).toContain("event.code === 'Space'");
    expect(game).toContain('fallbackTutorialToPointerInput()');

    const match3 = sceneSources.Match3Scene;
    expect(match3).toContain("this.input.on('pointerdown', this.handlePointerDown, this)");
    expect(match3).toContain("this.input.on('pointerup', this.handlePointerUp, this)");
    expect(match3).toContain("this.input.keyboard?.on('keydown', this.handleKeyboard, this)");

    const endless = sceneSources.EndlessScene;
    expect(endless).toContain("this.input.on('pointerdown'");
    expect(endless).toContain("this.input.on('pointerup'");
    expect(endless).toContain("keyboard?.on('keydown-SPACE', fire)");

    const settings = readText('src/game/gazesettings.ts');
    expect(settings).toContain("mode: 'off'");
    for (const source of Object.values(sceneSources)) {
      const firstPointerBinding = source.indexOf("this.input.on('pointer");
      const trackerActivation = source.indexOf('.isWanted()', firstPointerBinding);
      expect(firstPointerBinding).toBeGreaterThanOrEqual(0);
      expect(trackerActivation).toBeGreaterThan(firstPointerBinding);
    }
  });

  it('uses semantic target hysteresis instead of raw eye-coordinate bins', () => {
    expect(sceneSources.GameScene).toContain('const aimAngle = Math.atan2(');
    expect(sceneSources.GameScene).toContain('`aim-${Math.round(aimAngle / (Math.PI / 30))}`');
    expect(sceneSources.GameScene).not.toContain('Math.round(point.x * 14)');
    expect(sceneSources.Match3Scene).toContain('private gazeCellAtPoint(');
    expect(sceneSources.Match3Scene).toContain('const retention = CELL_SIZE * 0.7');
    expect(sceneSources.EndlessScene).toContain('private gazeLaneAtX(');
    expect(sceneSources.EndlessScene).toContain('const margin = Math.abs(nextPoint.x - currentPoint.x) * 0.18');
  });
});

describe('gaze camera lifecycle and privacy boundaries', () => {
  const tracker = readText('src/game/handtracking.ts');
  const worker = readText('src/game/handtracking.worker.ts');
  const setup = readText('src/scenes/GazeSetupScene.ts');

  it('uses one camera/video/frame pipeline for hand, gaze and hybrid inference', () => {
    expect(occurrences(tracker, "document.createElement('video')")).toBe(1);
    expect(occurrences(tracker, 'createImageBitmap(this.video')).toBe(1);
    expect(worker).toContain("const needsHand = mode !== 'gaze'");
    expect(worker).toContain("const needsGaze = mode !== 'hand'");
    expect(worker).toContain('recognizer.detectForVideo(prepared.source, timestampMs)');
    expect(worker).toContain('faceRecognizer.detectForVideo(enhanced ? prepared.source : bitmap, timestampMs)');
    expect(worker).toContain('bitmap.close()');
    expect(worker).not.toContain('getUserMedia');
    expect(setup).not.toContain('getUserMedia');
    for (const source of Object.values(sceneSources)) expect(source).not.toContain('getUserMedia');
  });

  it('requires explicit start, exposes stop, and makes local-only processing visible', () => {
    expect(setup).toContain("'START CAMERA'");
    expect(setup).toContain("'STOP CAMERA'");
    expect(setup).toContain('const ok = await getHandTracker().enable(mode)');
    expect(setup).toContain('getHandTracker().disable()');
    expect(setup).toContain('START IS ALWAYS EXPLICIT');
    expect(setup).toContain('NO VIDEO UPLOAD');
    expect(setup).toContain('no video is uploaded');
    const createMethod = methodBodyFrom(setup, 'create(): void {', 'update(): void {');
    expect(createMethod).not.toMatch(/\.enable\(/);
  });

  it('suspends the shared tracker on every scene shutdown and clears gaze action state', () => {
    for (const source of [...Object.values(sceneSources), setup]) {
      expect(source).toContain('Phaser.Scenes.Events.SHUTDOWN');
      expect(source).toContain('getHandTracker().suspend()');
    }
    for (const source of Object.values(sceneSources)) {
      const contextHandler = methodBodyFrom(
        source,
        'handleRenderContextBoundary',
        'constructor()',
      );
      expect(contextHandler).toContain('this.gazeAimController.reset()');
      expect(contextHandler).toContain('this.gazeBlinkControl.reset()');
      expect(contextHandler).toContain('this.gazeDwellControl.reset()');
    }
  });

  it('restores the exact active vision mode after a render-context boundary', () => {
    const main = readText('src/main.ts');
    const suspend = methodBodyFrom(main, 'onSuspend: () => {', 'onResume: () => {');
    const resume = methodBodyFrom(main, 'onResume: () => {', 'onFallback: forceCanvasFallback');
    expect(suspend).toContain('tracker.getActiveMode()');
    expect(resume).toMatch(/getHandTracker\(\)\.enable\([A-Za-z][A-Za-z0-9]*\)/);
    expect(main).toContain('resetActiveSceneInput(game)');
    expect(main).toContain("phase: 'lost'");
    expect(main).toContain("phase: 'restored'");
  });

  it('never admits eye coordinates, features, landmarks or blink scores to product telemetry', () => {
    expect(normalizeGameplayTelemetryInput({
      type: 'level-start',
      inputMode: 'gaze',
      outcome: 'started',
    })).toEqual({
      type: 'level-start',
      inputMode: 'gaze',
      outcome: 'started',
    });
    expect(normalizeGameplayTelemetryInput({
      type: 'level-start',
      inputMode: 'gaze-hand',
      outcome: 'started',
    })).not.toBeNull();

    for (const leaked of [
      { x: 0.2, y: 0.8 },
      { features: [0.1, 0.2] },
      { faceLandmarks: [{ x: 0.1, y: 0.2 }] },
      { leftBlink: 0.8, rightBlink: 0.8 },
      { cameraFrame: 'data:image/jpeg;base64,secret' },
    ]) {
      expect(normalizeGameplayTelemetryInput({
        type: 'level-start',
        inputMode: 'gaze',
        ...leaked,
      })).toBeNull();
    }

    const telemetry = readText('src/game/gameplay-telemetry.ts');
    expect(telemetry).toContain('Free-form strings, coordinates, camera data, landmarks and PII cannot enter');
    const server = readText('server/platform.mjs');
    const allowlist = methodBodyFrom(
      server,
      'const rejectUnknownTelemetryFields',
      'const telemetrySchema',
    );
    expect(allowlist).not.toMatch(/\b(faceLandmarks|features|leftBlink|rightBlink|cameraFrame)\b/);
    expect(server).toContain('additionalProperties: false');
    expect(setup).not.toMatch(/\b(fetch|XMLHttpRequest|WebSocket|sendBeacon|trackGameplayEvent)\b/);
  });
});

describe('gaze runtime artifact provenance', () => {
  it('binds the checked-in face model to its documented upstream object and hash', () => {
    const model = readFileSync('public/mediapipe/models/face_landmarker.task');
    const hash = createHash('sha256').update(model).digest('hex');
    const provenance = readText('docs/production/face-landmarker-provenance.md');
    expect(model.byteLength).toBe(3_758_596);
    expect(hash).toBe('64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff');
    expect(provenance).toContain('https://storage.googleapis.com/mediapipe-models/face_landmarker/');
    expect(provenance).toContain(`SHA-256: \`${hash}\``);
    expect(provenance).toContain('Bytes: `3,758,596`');
    expect(provenance).toContain('Camera frames and');
    expect(provenance).toContain('the full face mesh remain on-device');
    expect(provenance).toContain('None are uploaded or used');
  });
});

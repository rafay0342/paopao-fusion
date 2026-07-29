import {
  FaceLandmarker,
  FilesetResolver,
  HandLandmarker,
  type FaceLandmarkerResult,
  type HandLandmarkerResult,
} from '@mediapipe/tasks-vision';
import {
  HandEnhancementBudget,
  handLightingProfile,
  type HandLightingMode,
  type HandLightingProfile,
  type HandLightingStats,
} from './handvision';
import {
  extractGazeGeometry,
  type GazeDebugPacket,
  type GazeFeatureVector,
  type GazeQualityReason,
  type GazeRuntimeRegistration,
} from './gazefeatures';
import { isolateVisionLoader, type VisionTaskAttempt } from './visionruntime';

interface InitMessage {
  type: 'INIT';
  wasmUrl: string;
  modelUrl: string;
}

interface FrameMessage {
  type: 'FRAME';
  bitmap: ImageBitmap;
  timestampMs: number;
  generation: number;
  frameId: number;
  mode: VisionTrackingMode;
  registration: GazeRuntimeRegistration | null;
}

interface PrepareGazeMessage {
  type: 'PREPARE_GAZE';
  wasmUrl: string;
  modelUrl: string;
}

interface CleanupMessage {
  type: 'CLEANUP';
}

type IncomingMessage = InitMessage | FrameMessage | PrepareGazeMessage | CleanupMessage;

type VisionTrackingMode = 'hand' | 'gaze' | 'gaze-hand';

interface CompactGazeObservation {
  features: GazeFeatureVector;
  confidence: number;
  leftBlink: number;
  rightBlink: number;
  debug: GazeDebugPacket;
}

const workerScope = self as unknown as {
  onmessage: ((event: MessageEvent<IncomingMessage>) => void) | null;
  postMessage: (message: unknown) => void;
};

let recognizer: HandLandmarker | null = null;
let faceRecognizer: FaceLandmarker | null = null;
let visionRuntimeGeneration = 0;
let lastFaceInferenceTimestampMs = Number.NEGATIVE_INFINITY;
let lastOpenGaze: {
  features: GazeFeatureVector;
  confidence: number;
  timestampMs: number;
  debug: GazeDebugPacket;
} | null = null;
const GAZE_FACE_EARLY_TOLERANCE_MS = 3;
const GAZE_BLINK_FEATURE_HOLD_MS = 320;
const GAZE_ONLY_INTERVAL_MS = 1_000 / 30;
const GAZE_HYBRID_INTERVAL_MS = 1_000 / 30;
let leftOpenBaseline = 0;
let rightOpenBaseline = 0;
let activeGazeGeneration = -1;
let activeGazeRegistration: GazeRuntimeRegistration | null = null;
let previousGazePose: {
  timestampMs: number;
  centerX: number;
  centerY: number;
  scale: number;
  yaw: number;
  pitch: number;
  roll: number;
} | null = null;
const PROBE_WIDTH = 32;
const PROBE_HEIGHT = 24;
const PROBE_INTERVAL_MS = 180;
const OPTIONAL_PIPELINE_COOLDOWN_MS = 4_000;
let probeCanvas: OffscreenCanvas | null = null;
let inferenceCanvas: OffscreenCanvas | null = null;
let lastProbeAt = Number.NEGATIVE_INFINITY;
let activeLighting: HandLightingProfile = handLightingProfile({
  mean: 128, p10: 64, p90: 192, darkFraction: 0, brightFraction: 0, gradient: 32,
});
let pendingLightingMode: HandLightingMode = 'normal';
let pendingLightingProbes = 0;
let lightingChangedAt = Number.NEGATIVE_INFINITY;
let enhancementDisabledUntil = 0;
let probeDisabledUntil = 0;
let canvasInputSupported: boolean | null = null;
let filterPipelineSupported: boolean | null = null;
const enhancementBudget = new HandEnhancementBudget();

function resetGazeSession(): void {
  lastFaceInferenceTimestampMs = Number.NEGATIVE_INFINITY;
  lastOpenGaze = null;
  leftOpenBaseline = 0;
  rightOpenBaseline = 0;
  activeGazeGeneration = -1;
  activeGazeRegistration = null;
  previousGazePose = null;
}

function resetLighting(): void {
  probeCanvas = null;
  inferenceCanvas = null;
  lastProbeAt = Number.NEGATIVE_INFINITY;
  activeLighting = handLightingProfile({
    mean: 128, p10: 64, p90: 192, darkFraction: 0, brightFraction: 0, gradient: 32,
  });
  pendingLightingMode = 'normal';
  pendingLightingProbes = 0;
  lightingChangedAt = Number.NEGATIVE_INFINITY;
  enhancementDisabledUntil = 0;
  probeDisabledUntil = 0;
  canvasInputSupported = null;
  filterPipelineSupported = null;
  enhancementBudget.reset();
  resetGazeSession();
}

function analyseLighting(bitmap: ImageBitmap): HandLightingStats | null {
  if (typeof OffscreenCanvas === 'undefined') return null;
  probeCanvas ??= new OffscreenCanvas(PROBE_WIDTH, PROBE_HEIGHT);
  const context = probeCanvas.getContext('2d', { willReadFrequently: true });
  if (!context) return null;
  context.filter = 'none';
  context.drawImage(bitmap, 0, 0, PROBE_WIDTH, PROBE_HEIGHT);
  const pixels = context.getImageData(0, 0, PROBE_WIDTH, PROBE_HEIGHT).data;
  const histogram = new Uint16Array(256);
  const luma = new Uint8Array(PROBE_WIDTH * PROBE_HEIGHT);
  let sum = 0;
  let dark = 0;
  let bright = 0;
  let gradient = 0;
  for (let pixel = 0, index = 0; pixel < pixels.length; pixel += 4, index++) {
    const value = Math.round(pixels[pixel] * 0.2126 + pixels[pixel + 1] * 0.7152 + pixels[pixel + 2] * 0.0722);
    luma[index] = value;
    histogram[value]++;
    sum += value;
    if (value <= 38) dark++;
    if (value >= 218) bright++;
    const x = index % PROBE_WIDTH;
    const y = Math.floor(index / PROBE_WIDTH);
    if (x > 0) gradient += Math.abs(value - luma[index - 1]);
    if (y > 0) gradient += Math.abs(value - luma[index - PROBE_WIDTH]);
  }
  const count = luma.length;
  const percentile = (fraction: number): number => {
    const target = count * fraction;
    let accumulated = 0;
    for (let value = 0; value < histogram.length; value++) {
      accumulated += histogram[value];
      if (accumulated >= target) return value;
    }
    return 255;
  };
  return {
    mean: sum / count,
    p10: percentile(0.1),
    p90: percentile(0.9),
    darkFraction: dark / count,
    brightFraction: bright / count,
    gradient: gradient / Math.max(1, count * 2 - PROBE_WIDTH - PROBE_HEIGHT),
  };
}

function updateLighting(bitmap: ImageBitmap, now: number): void {
  if (now < probeDisabledUntil) return;
  if (now - lastProbeAt < PROBE_INTERVAL_MS) return;
  lastProbeAt = now;
  let stats: HandLightingStats | null = null;
  try {
    stats = analyseLighting(bitmap);
  } catch {
    // Lighting analysis is optional. A context loss, unsupported readback or
    // browser quirk must never take down baseline ImageBitmap recognition.
    probeDisabledUntil = now + OPTIONAL_PIPELINE_COOLDOWN_MS;
    enhancementDisabledUntil = Math.max(enhancementDisabledUntil, probeDisabledUntil);
    return;
  }
  if (!stats) return;
  const next = handLightingProfile(stats);
  if (next.mode === activeLighting.mode) {
    activeLighting = next;
    pendingLightingMode = next.mode;
    pendingLightingProbes = 0;
    return;
  }
  if (next.mode === pendingLightingMode) pendingLightingProbes++;
  else {
    pendingLightingMode = next.mode;
    pendingLightingProbes = 1;
  }
  const severe = (next.mode === 'dark' && stats.mean < 38)
    || (next.mode === 'bright' && stats.mean > 230);
  const required = next.mode === 'normal' ? 3 : 2;
  if ((pendingLightingProbes >= required || severe) && now - lightingChangedAt >= 500) {
    activeLighting = next;
    lightingChangedAt = now;
    pendingLightingProbes = 0;
  }
}

interface PreparedInferenceSource {
  source: ImageBitmap | OffscreenCanvas;
  enhanced: boolean;
}

function inferenceSource(bitmap: ImageBitmap, now: number): PreparedInferenceSource {
  try {
    updateLighting(bitmap, now);
  } catch {
    // Defensive boundary: future probe changes must remain fail-open too.
    probeDisabledUntil = now + OPTIONAL_PIPELINE_COOLDOWN_MS;
    enhancementDisabledUntil = Math.max(enhancementDisabledUntil, probeDisabledUntil);
    return { source: bitmap, enhanced: false };
  }
  if (activeLighting.mode === 'normal'
    || activeLighting.mode === 'blurred'
    || now < enhancementDisabledUntil
    || !enhancementBudget.hasBaseline()
    || canvasInputSupported !== true
    || filterPipelineSupported === false
    || typeof OffscreenCanvas === 'undefined') {
    return { source: bitmap, enhanced: false };
  }

  try {
    if (!inferenceCanvas || inferenceCanvas.width !== bitmap.width || inferenceCanvas.height !== bitmap.height) {
      inferenceCanvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    }
    const context = inferenceCanvas.getContext('2d');
    if (!context || !('filter' in context)) {
      filterPipelineSupported = false;
      return { source: bitmap, enhanced: false };
    }
    const filter = `brightness(${activeLighting.brightness}) contrast(${activeLighting.contrast}) saturate(${activeLighting.saturation})`;
    context.filter = filter;
    if (context.filter === 'none') {
      filterPipelineSupported = false;
      return { source: bitmap, enhanced: false };
    }
    context.drawImage(bitmap, 0, 0);
    context.filter = 'none';
    filterPipelineSupported = true;
    return { source: inferenceCanvas, enhanced: true };
  } catch {
    filterPipelineSupported = false;
    enhancementDisabledUntil = now + OPTIONAL_PIPELINE_COOLDOWN_MS;
    return { source: bitmap, enhanced: false };
  }
}

function primeRecognizer(): void {
  if (!recognizer || typeof OffscreenCanvas === 'undefined') {
    canvasInputSupported = false;
    return;
  }
  try {
    const canvas = new OffscreenCanvas(64, 64);
    const context = canvas.getContext('2d');
    if (context) {
      context.fillStyle = '#808080';
      context.fillRect(0, 0, canvas.width, canvas.height);
    }
    // The first call initializes graph kernels and the selected delegate. Run
    // it on a tiny neutral frame during background startup so the first real
    // camera frame only pays ordinary inference cost.
    recognizer.detectForVideo(canvas, 0);
    canvasInputSupported = true;
  } catch (error) {
    // Warm-up is an optimization. The initialized recognizer is still valid
    // and the first real camera frame can retry on implementations that reject
    // OffscreenCanvas as a direct input.
    canvasInputSupported = false;
    console.warn('Hand landmarker warm-up skipped; lighting canvas disabled.', error);
  }
}

/**
 * MediaPipe clears its global ModuleFactory after every task is created.
 * Module workers load the Emscripten bootstrap through dynamic import(), whose
 * module cache otherwise prevents that factory from being recreated for a
 * second task (or a GPU-to-CPU retry). Give every creation attempt a distinct
 * loader-module URL while keeping the large WASM binary URL stable/cacheable.
 */
async function freshVisionFileset(
  wasmUrl: string,
  task: VisionTaskAttempt,
): Promise<Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>> {
  const fileset = await FilesetResolver.forVisionTasks(wasmUrl, true);
  return isolateVisionLoader(fileset, task, ++visionRuntimeGeneration, self.location.href);
}

async function createRecognizer(wasmUrl: string, modelUrl: string): Promise<void> {
  const [gpuVision, modelResponse] = await Promise.all([
    freshVisionFileset(wasmUrl, 'hand-gpu'),
    fetch(modelUrl),
  ]);
  if (!modelResponse.ok) throw new Error(`Hand model HTTP ${modelResponse.status}`);
  const model = new Uint8Array(await modelResponse.arrayBuffer());

  const options = (delegate: 'CPU' | 'GPU') => ({
    baseOptions: { modelAssetBuffer: model, delegate },
    runningMode: 'VIDEO' as const,
    numHands: 1,
    minHandDetectionConfidence: 0.35,
    minHandPresenceConfidence: 0.35,
    minTrackingConfidence: 0.4,
  });

  // GPU first removes the CPU bottleneck that causes visibly stepped controls
  // on laptops and phones. The worker owns its context; CPU remains the broad
  // compatibility fallback when a worker GPU delegate is unavailable.
  try {
    recognizer = await HandLandmarker.createFromOptions(gpuVision, options('GPU'));
  } catch (gpuError) {
    console.warn('Hand GPU delegate unavailable; trying CPU.', gpuError);
    const cpuVision = await freshVisionFileset(wasmUrl, 'hand-cpu');
    recognizer = await HandLandmarker.createFromOptions(cpuVision, options('CPU'));
  }
  primeRecognizer();
}

async function createFaceRecognizer(wasmUrl: string, modelUrl: string): Promise<void> {
  if (faceRecognizer) return;
  const [gpuVision, modelResponse] = await Promise.all([
    freshVisionFileset(wasmUrl, 'face-gpu'),
    fetch(modelUrl),
  ]);
  if (!modelResponse.ok) throw new Error(`Face model HTTP ${modelResponse.status}`);
  const model = new Uint8Array(await modelResponse.arrayBuffer());
  const options = (delegate: 'CPU' | 'GPU') => ({
    baseOptions: { modelAssetBuffer: model, delegate },
    runningMode: 'VIDEO' as const,
    numFaces: 1,
    minFaceDetectionConfidence: 0.5,
    minFacePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
    outputFaceBlendshapes: true,
    outputFacialTransformationMatrixes: true,
  });
  try {
    faceRecognizer = await FaceLandmarker.createFromOptions(gpuVision, options('GPU'));
  } catch (gpuError) {
    console.warn('Face GPU delegate unavailable; trying CPU.', gpuError);
    const cpuVision = await freshVisionFileset(wasmUrl, 'face-cpu');
    faceRecognizer = await FaceLandmarker.createFromOptions(cpuVision, options('CPU'));
  }
  if (typeof OffscreenCanvas !== 'undefined') {
    try {
      const canvas = new OffscreenCanvas(64, 64);
      const context = canvas.getContext('2d');
      if (context) {
        context.fillStyle = '#808080';
        context.fillRect(0, 0, canvas.width, canvas.height);
      }
      // Load face graph kernels while the setup screen is warming the model,
      // before the player's first calibration target appears.
      faceRecognizer.detectForVideo(canvas, 0);
    } catch (error) {
      console.warn('Face landmarker warm-up skipped.', error);
    }
  }
  lastFaceInferenceTimestampMs = Number.NEGATIVE_INFINITY;
}

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

const personalizedBlink = (
  rawBlink: number,
  openness: number,
  side: 'left' | 'right',
): number => {
  let baseline = side === 'left' ? leftOpenBaseline : rightOpenBaseline;
  const registered = side === 'left'
    ? activeGazeRegistration?.leftOpenness
    : activeGazeRegistration?.rightOpenness;
  if (baseline === 0) baseline = registered ?? openness;
  if (rawBlink <= 0.28 && openness >= baseline * 0.72) {
    // Follow natural open-eye geometry slowly, but never let an active squint
    // redefine "open" in one frame.
    baseline = Math.max(baseline * 0.997, baseline * 0.97 + openness * 0.03);
  }
  if (side === 'left') leftOpenBaseline = baseline;
  else rightOpenBaseline = baseline;
  const geometricClosure = baseline > 0.03
    ? clamp01((baseline - openness) / Math.max(0.025, baseline * 0.58))
    : 0;
  return clamp01(Math.max(rawBlink, geometricClosure * 0.9));
};

const bindGazeRegistration = (candidate: GazeRuntimeRegistration | null): void => {
  const valid = candidate
    && Number.isSafeInteger(candidate.revision)
    && candidate.revision > 0
    && Number.isFinite(candidate.leftOpenness)
    && candidate.leftOpenness >= 0.025
    && candidate.leftOpenness <= 0.8
    && Number.isFinite(candidate.rightOpenness)
    && candidate.rightOpenness >= 0.025
    && candidate.rightOpenness <= 0.8
    && Number.isFinite(candidate.faceScale)
    && candidate.faceScale >= 0.04
    && candidate.faceScale <= 1
    && Number.isFinite(candidate.headYaw)
    && Math.abs(candidate.headYaw) <= 1
    && Number.isFinite(candidate.headPitch)
    && candidate.headPitch >= -1
    && candidate.headPitch <= 1.5
    && Number.isFinite(candidate.headRoll)
    && Math.abs(candidate.headRoll) <= 1;
  const next = valid ? candidate : null;
  if (next?.revision === activeGazeRegistration?.revision) return;
  activeGazeRegistration = next;
  leftOpenBaseline = next?.leftOpenness ?? 0;
  rightOpenBaseline = next?.rightOpenness ?? 0;
  lastOpenGaze = null;
  previousGazePose = null;
};

const gazeHeadMotion = (
  geometry: NonNullable<ReturnType<typeof extractGazeGeometry>>,
  timestampMs: number,
): number => {
  const previous = previousGazePose;
  previousGazePose = {
    timestampMs,
    centerX: geometry.faceCenterX,
    centerY: geometry.faceCenterY,
    scale: geometry.faceScale,
    yaw: geometry.headYaw,
    pitch: geometry.headPitch,
    roll: geometry.headRoll,
  };
  if (!previous || timestampMs <= previous.timestampMs) return 0;
  const dtSeconds = Math.min(0.18, Math.max(1 / 120, (timestampMs - previous.timestampMs) / 1_000));
  const translationSpeed = Math.hypot(
    geometry.faceCenterX - previous.centerX,
    geometry.faceCenterY - previous.centerY,
  ) / dtSeconds;
  const scaleSpeed = Math.abs(geometry.faceScale - previous.scale) / dtSeconds;
  const poseSpeed = (
    Math.abs(geometry.headYaw - previous.yaw)
    + Math.abs(geometry.headPitch - previous.pitch)
    + Math.abs(geometry.headRoll - previous.roll)
  ) / dtSeconds;
  return clamp01(translationSpeed / 0.45 + scaleSpeed / 0.32 + poseSpeed / 2.8);
};

const gazeQualityReason = (
  geometry: NonNullable<ReturnType<typeof extractGazeGeometry>>,
  headMotion: number,
  lightingMode: HandLightingMode,
): GazeQualityReason => {
  const registration = activeGazeRegistration;
  const minimumFaceScale = registration
    ? Math.max(0.07, registration.faceScale * 0.52)
    : 0.105;
  if (geometry.faceScale < minimumFaceScale) return 'face-too-far';
  if (
    geometry.faceCenterX < 0.07
    || geometry.faceCenterX > 0.93
    || geometry.faceCenterY < 0.05
    || geometry.faceCenterY > 0.78
  ) return 'face-off-center';
  const headOutsideRegistration = registration
    ? Math.abs(geometry.headYaw - registration.headYaw) > 0.5
      || Math.abs(geometry.headPitch - registration.headPitch) > 0.52
      || Math.abs(geometry.headRoll - registration.headRoll) > 0.24
    : Math.abs(geometry.headYaw) > 0.58
      || geometry.headPitch < 0.05
      || geometry.headPitch > 0.78
      || Math.abs(geometry.headRoll) > 0.28;
  if (headOutsideRegistration) return 'head-angle';
  if (headMotion > 0.88) return 'head-moving';
  const minimumLeftOpenness = registration
    ? Math.max(0.025, registration.leftOpenness * 0.32)
    : 0.055;
  const minimumRightOpenness = registration
    ? Math.max(0.025, registration.rightOpenness * 0.32)
    : 0.055;
  if (
    geometry.leftOpenness < minimumLeftOpenness
    || geometry.rightOpenness < minimumRightOpenness
  ) return 'eyes-closed';
  if (geometry.ringQuality < 0.35) return 'iris-uncertain';
  if (geometry.binocularAgreement < 0.34) return 'binocular-mismatch';
  if (lightingMode === 'blurred' || lightingMode === 'low-contrast') return 'poor-lighting';
  return 'ready';
};

/**
 * Reduce MediaPipe's 478-point face output to robust V2 eye geometry. Only two
 * eye contours, iris dots and numeric quality diagnostics cross the worker
 * boundary; full face landmarks and camera pixels never do.
 */
function compactGazeResult(
  result: FaceLandmarkerResult,
  timestampMs: number,
  lightingMode: HandLightingMode,
  frameAspect: number,
): CompactGazeObservation | null {
  const landmarks = result.faceLandmarks?.[0];
  if (!landmarks || landmarks.length < 478) return null;

  const categories = result.faceBlendshapes?.[0]?.categories ?? [];
  const blendshape = (name: string): number => {
    const category = categories.find((candidate) => candidate.categoryName === name);
    return clamp01(category?.score ?? 0);
  };
  const rawLeftBlink = blendshape('eyeBlinkLeft');
  const rawRightBlink = blendshape('eyeBlinkRight');
  const hasBlinkSignals = categories.some((candidate) => candidate.categoryName === 'eyeBlinkLeft')
    && categories.some((candidate) => candidate.categoryName === 'eyeBlinkRight');
  if (!hasBlinkSignals) return null;
  const geometry = extractGazeGeometry(landmarks, frameAspect);
  if (!geometry) return null;
  const leftBlink = personalizedBlink(rawLeftBlink, geometry.leftOpenness, 'left');
  const rightBlink = personalizedBlink(rawRightBlink, geometry.rightOpenness, 'right');
  const headMotion = gazeHeadMotion(geometry, timestampMs);
  const qualityReason = gazeQualityReason(geometry, headMotion, lightingMode);
  const debug: GazeDebugPacket = {
    ...geometry.markers,
    leftOpenness: geometry.leftOpenness,
    rightOpenness: geometry.rightOpenness,
    headYaw: geometry.headYaw,
    headPitch: geometry.headPitch,
    headRoll: geometry.headRoll,
    headMotion,
    binocularAgreement: geometry.binocularAgreement,
    qualityReason,
  };

  // Eyelid closure makes iris-to-lid ratios mathematically unstable. During a
  // short, bilateral blink only, hold the last verified open-eye features.
  // Head movement, asymmetric closure, an old lock, or missing blendshapes all
  // fail closed instead of manufacturing a target.
  const bilateralClosure = hasBlinkSignals && leftBlink >= 0.44 && rightBlink >= 0.44;
  if (bilateralClosure) {
    const held = lastOpenGaze;
    const headStill = held
      && Math.hypot(geometry.faceCenterX - held.features[4], geometry.faceCenterY - held.features[5]) <= 0.035
      && Math.abs(geometry.faceScale - held.features[6]) <= Math.max(0.015, held.features[6] * 0.12)
      && Math.abs(geometry.headYaw - held.features[7]) <= 0.1
      && Math.abs(geometry.headPitch - held.features[8]) <= 0.1
      && Math.abs(geometry.headRoll - held.features[9]) <= 0.06
      && headMotion <= 0.9;
    if (!held || timestampMs - held.timestampMs > GAZE_BLINK_FEATURE_HOLD_MS || !headStill) return null;
    return {
      features: [...held.features] as GazeFeatureVector,
      confidence: held.confidence,
      leftBlink,
      rightBlink,
      debug: { ...held.debug, headMotion, qualityReason: 'blink' },
    };
  }

  let confidence = geometry.baseConfidence;
  if (qualityReason !== 'ready') confidence *= qualityReason === 'head-moving' ? 0.72 : 0.52;
  if (lightingMode === 'dark' || lightingMode === 'bright' || lightingMode === 'backlit') confidence *= 0.82;

  const compact: CompactGazeObservation = {
    features: geometry.features,
    confidence: clamp01(confidence),
    leftBlink,
    rightBlink,
    debug,
  };
  if (
    leftBlink <= 0.32
    && rightBlink <= 0.32
    && qualityReason === 'ready'
    && compact.confidence >= 0.68
  ) {
    lastOpenGaze = {
      features: [...compact.features] as GazeFeatureVector,
      confidence: compact.confidence,
      timestampMs,
      debug,
    };
  }
  return compact;
}

workerScope.onmessage = async (event): Promise<void> => {
  const message = event.data;
  if (message.type === 'INIT') {
    try {
      recognizer?.close();
      faceRecognizer?.close();
      recognizer = null;
      faceRecognizer = null;
      resetLighting();
      await createRecognizer(message.wasmUrl, message.modelUrl);
      workerScope.postMessage({ type: 'READY' });
    } catch (error) {
      workerScope.postMessage({ type: 'INIT_ERROR', error: error instanceof Error ? error.message : String(error) });
    }
    return;
  }

  if (message.type === 'PREPARE_GAZE') {
    try {
      await createFaceRecognizer(message.wasmUrl, message.modelUrl);
      workerScope.postMessage({ type: 'GAZE_READY' });
    } catch (error) {
      faceRecognizer?.close();
      faceRecognizer = null;
      workerScope.postMessage({
        type: 'GAZE_INIT_ERROR',
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return;
  }

  if (message.type === 'CLEANUP') {
    recognizer?.close();
    faceRecognizer?.close();
    recognizer = null;
    faceRecognizer = null;
    resetLighting();
    return;
  }

  const {
    bitmap,
    timestampMs,
    generation,
    frameId,
    mode,
    registration,
  } = message;
  const needsHand = mode !== 'gaze';
  const needsGaze = mode !== 'hand';
  if (needsGaze && generation !== activeGazeGeneration) {
    resetGazeSession();
    activeGazeGeneration = generation;
  }
  if (needsGaze) bindGazeRegistration(registration);
  if ((needsHand && !recognizer) || (needsGaze && !faceRecognizer)) {
    bitmap.close();
    workerScope.postMessage({
      type: 'FRAME_ERROR',
      generation,
      frameId,
      error: needsGaze && !faceRecognizer ? 'Face landmarker is not ready' : 'Hand landmarker is not ready',
    });
    return;
  }

  const startedAt = performance.now();
  try {
    const frameAspect = bitmap.width / Math.max(1, bitmap.height);
    const prepared = inferenceSource(bitmap, startedAt);
    let enhanced = prepared.enhanced;
    let enhancedFallback = false;
    let result: HandLandmarkerResult | null = null;
    let gaze: CompactGazeObservation | null = null;
    let gazeEvaluated = false;

    if (needsHand && recognizer) {
      try {
        result = recognizer.detectForVideo(prepared.source, timestampMs);
      } catch (error) {
        if (!prepared.enhanced) throw error;
        // Some browsers expose OffscreenCanvas and its filters but MediaPipe's
        // selected delegate cannot consume that canvas. Permanently retain the
        // known-good ImageBitmap path for this recognizer instance.
        canvasInputSupported = false;
        enhanced = false;
        enhancedFallback = true;
        result = recognizer.detectForVideo(bitmap, timestampMs);
      }
    }

    const gazeIntervalMs = mode === 'gaze' ? GAZE_ONLY_INTERVAL_MS : GAZE_HYBRID_INTERVAL_MS;
    if (needsGaze && faceRecognizer
      && timestampMs - lastFaceInferenceTimestampMs >= gazeIntervalMs - GAZE_FACE_EARLY_TOLERANCE_MS) {
      gazeEvaluated = true;
      lastFaceInferenceTimestampMs = timestampMs;
      let faceResult: FaceLandmarkerResult;
      try {
        faceResult = faceRecognizer.detectForVideo(enhanced ? prepared.source : bitmap, timestampMs);
      } catch (error) {
        if (!enhanced) throw error;
        // The face graph can reject a filtered OffscreenCanvas independently
        // from the hand graph. Retain the common ImageBitmap fallback.
        canvasInputSupported = false;
        enhanced = false;
        enhancedFallback = true;
        faceResult = faceRecognizer.detectForVideo(bitmap, timestampMs);
      }
      gaze = compactGazeResult(faceResult, timestampMs, activeLighting.mode, frameAspect);
    }

    const totalFrameMs = performance.now() - startedAt;
    if (!enhancedFallback && enhancementBudget.observe(totalFrameMs, enhanced)) {
      enhancementDisabledUntil = performance.now() + OPTIONAL_PIPELINE_COOLDOWN_MS;
      enhancementBudget.clearEnhancedWindow();
    }
    const landmarks = result
      ? result.landmarks?.[0]?.map((point) => ({ x: point.x, y: point.y, z: point.z })) ?? null
      : null;
    const worldLandmarks = result
      ? result.worldLandmarks?.[0]?.map((point) => ({ x: point.x, y: point.y, z: point.z })) ?? null
      : null;
    const handedness = result ? result.handedness?.[0]?.[0] : undefined;
    workerScope.postMessage({
      type: 'RESULT',
      generation,
      frameId,
      timestampMs,
      mode,
      inferenceMs: totalFrameMs,
      landmarks,
      worldLandmarks,
      gesture: 'None',
      gestureScore: 0,
      handedness: handedness?.categoryName ?? handedness?.displayName ?? '',
      handednessScore: handedness?.score ?? 0,
      lightingMode: activeLighting.mode,
      enhanced,
      gaze,
      gazeEvaluated,
    });
  } catch (error) {
    workerScope.postMessage({ type: 'FRAME_ERROR', generation, frameId, error: error instanceof Error ? error.message : String(error) });
  } finally {
    bitmap.close();
  }
};

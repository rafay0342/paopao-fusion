import { FilesetResolver, GestureRecognizer, type GestureRecognizerResult } from '@mediapipe/tasks-vision';
import {
  HandEnhancementBudget,
  handLightingProfile,
  type HandLightingMode,
  type HandLightingProfile,
  type HandLightingStats,
} from './handvision';

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
}

interface CleanupMessage {
  type: 'CLEANUP';
}

type IncomingMessage = InitMessage | FrameMessage | CleanupMessage;

const workerScope = self as unknown as {
  onmessage: ((event: MessageEvent<IncomingMessage>) => void) | null;
  postMessage: (message: unknown) => void;
};

let recognizer: GestureRecognizer | null = null;
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
    recognizer.recognizeForVideo(canvas, 0);
    canvasInputSupported = true;
  } catch (error) {
    // Warm-up is an optimization. The initialized recognizer is still valid
    // and the first real camera frame can retry on implementations that reject
    // OffscreenCanvas as a direct input.
    canvasInputSupported = false;
    console.warn('Gesture recognizer warm-up skipped; lighting canvas disabled.', error);
  }
}

async function createRecognizer(wasmUrl: string, modelUrl: string): Promise<void> {
  const [vision, modelResponse] = await Promise.all([
    FilesetResolver.forVisionTasks(wasmUrl, true),
    fetch(modelUrl),
  ]);
  if (!modelResponse.ok) throw new Error(`Gesture model HTTP ${modelResponse.status}`);
  const model = new Uint8Array(await modelResponse.arrayBuffer());

  const options = (delegate: 'CPU' | 'GPU') => ({
    baseOptions: { modelAssetBuffer: model, delegate },
    runningMode: 'VIDEO' as const,
    numHands: 1,
    minHandDetectionConfidence: 0.45,
    minHandPresenceConfidence: 0.4,
    minTrackingConfidence: 0.5,
    cannedGesturesClassifierOptions: {
      maxResults: 1,
      scoreThreshold: 0.4,
    },
  });

  // GPU first removes the CPU bottleneck that causes visibly stepped controls
  // on laptops and phones. The worker owns its context; CPU remains the broad
  // compatibility fallback when a worker GPU delegate is unavailable.
  try {
    recognizer = await GestureRecognizer.createFromOptions(vision, options('GPU'));
  } catch (gpuError) {
    console.warn('Gesture GPU delegate unavailable; trying CPU.', gpuError);
    recognizer = await GestureRecognizer.createFromOptions(vision, options('CPU'));
  }
  primeRecognizer();
}

workerScope.onmessage = async (event): Promise<void> => {
  const message = event.data;
  if (message.type === 'INIT') {
    try {
      recognizer?.close();
      recognizer = null;
      resetLighting();
      await createRecognizer(message.wasmUrl, message.modelUrl);
      workerScope.postMessage({ type: 'READY' });
    } catch (error) {
      workerScope.postMessage({ type: 'INIT_ERROR', error: error instanceof Error ? error.message : String(error) });
    }
    return;
  }

  if (message.type === 'CLEANUP') {
    recognizer?.close();
    recognizer = null;
    resetLighting();
    return;
  }

  const { bitmap, timestampMs, generation, frameId } = message;
  if (!recognizer) {
    bitmap.close();
    workerScope.postMessage({ type: 'FRAME_ERROR', generation, frameId, error: 'Gesture recognizer is not ready' });
    return;
  }

  const startedAt = performance.now();
  try {
    const prepared = inferenceSource(bitmap, startedAt);
    let result: GestureRecognizerResult;
    let enhanced = prepared.enhanced;
    let enhancedFallback = false;
    try {
      result = recognizer.recognizeForVideo(prepared.source, timestampMs);
    } catch (error) {
      if (!prepared.enhanced) throw error;
      // Some browsers expose OffscreenCanvas and its filters but MediaPipe's
      // selected delegate cannot consume that canvas. Permanently retain the
      // known-good ImageBitmap path for this recognizer instance.
      canvasInputSupported = false;
      enhanced = false;
      enhancedFallback = true;
      result = recognizer.recognizeForVideo(bitmap, timestampMs);
    }
    const totalFrameMs = performance.now() - startedAt;
    if (!enhancedFallback && enhancementBudget.observe(totalFrameMs, enhanced)) {
      enhancementDisabledUntil = performance.now() + OPTIONAL_PIPELINE_COOLDOWN_MS;
      enhancementBudget.clearEnhancedWindow();
    }
    const landmarks = result.landmarks?.[0]?.map((point) => ({ x: point.x, y: point.y, z: point.z })) ?? null;
    const worldLandmarks = result.worldLandmarks?.[0]?.map((point) => ({ x: point.x, y: point.y, z: point.z })) ?? null;
    const gesture = result.gestures?.[0]?.[0];
    const handedness = result.handedness?.[0]?.[0];
    workerScope.postMessage({
      type: 'RESULT',
      generation,
      frameId,
      timestampMs,
      inferenceMs: totalFrameMs,
      landmarks,
      worldLandmarks,
      gesture: gesture?.categoryName ?? 'None',
      gestureScore: gesture?.score ?? 0,
      handedness: handedness?.categoryName ?? handedness?.displayName ?? '',
      handednessScore: handedness?.score ?? 0,
      lightingMode: activeLighting.mode,
      enhanced,
    });
  } catch (error) {
    workerScope.postMessage({ type: 'FRAME_ERROR', generation, frameId, error: error instanceof Error ? error.message : String(error) });
  } finally {
    bitmap.close();
  }
};

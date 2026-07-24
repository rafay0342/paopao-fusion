import type { HandLandmarks } from './handgeometry';
import type { HandLightingMode } from './handvision';

export type StableHandIdentity = 'left' | 'right' | '';

export interface HandIdentityObservation {
  timestampMs: number;
  label: string;
  score: number;
  palmX: number;
  palmY: number;
  palmScale: number;
  lightingMode: HandLightingMode;
}

export interface HandIdentityResult {
  identity: StableHandIdentity;
  score: number;
  trusted: boolean;
  changed: boolean;
}

export type HandConfidenceState = 'lost' | 'uncertain' | 'tracked';

export interface HandConfidenceInput {
  landmarksComplete: boolean;
  fingertipsVisible: boolean;
  palmAnchorsVisible: boolean;
  palmPixels: number;
  handednessScore: number;
  gestureScore: number;
  stableFrames: number;
  inferenceMs: number;
  targetFps: 15 | 20 | 30;
  lightingMode: HandLightingMode;
  /** False when this result may update aim but is too old for a contact edge. */
  gestureTimely?: boolean;
}

export interface HandConfidenceResult {
  state: HandConfidenceState;
  score: number;
  usableForGesture: boolean;
}

export type HandWorkerResultFreshness =
  | 'fresh-action'
  | 'visual-only'
  | 'wrong-generation'
  | 'invalid-timestamp'
  | 'duplicate'
  | 'out-of-order'
  | 'future'
  | 'stale';

export interface HandWorkerResultFreshnessInput {
  generation: number;
  activeGeneration: number;
  captureTimestampMs: number;
  lastAcceptedCaptureTimestampMs: number;
  receivedTimestampMs: number;
  targetFps: 15 | 20 | 30;
  /** Worker-only time used to bound the newest in-flight result on slow CPUs. */
  inferenceMs?: number;
}

/** Ordinary fast-path budget before measured slow-device adaptation is needed. */
export const HAND_RESULT_MAX_FRAME_BUDGETS = 2;
/** No recognition older than this may advance contact or release state. */
export const HAND_RESULT_ACTION_MAX_AGE_MS = 180;
/** A newest single-in-flight slow result may still recover the visual cursor. */
export const HAND_RESULT_HARD_MAX_AGE_MS = 350;

export type HandCameraLifecycleState =
  | 'off'
  | 'warming'
  | 'active'
  | 'suspended'
  | 'recovering'
  | 'failed';

export type HandCameraLifecycleEvent =
  | 'enable'
  | 'camera-ready'
  | 'suspend'
  | 'resume'
  | 'recover'
  | 'failure'
  | 'disable';

const clamp01 = (value: number): number => Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));

const normalizeIdentity = (label: string): StableHandIdentity => {
  const normalized = label.trim().toLowerCase();
  return normalized === 'left' || normalized === 'right' ? normalized : '';
};

/**
 * The MediaPipe hand contract is exactly 21 finite image landmarks. Points may
 * legitimately leave the image during edge aiming, so visibility is evaluated
 * separately instead of rejecting a complete off-screen hand here.
 */
export function isCompleteHandLandmarkSet(landmarks: HandLandmarks | null | undefined): boolean {
  return landmarks?.length === 21 && landmarks.every((point) => (
    Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z)
  ));
}

/**
 * Stabilises MediaPipe's per-frame Left/Right label without allowing a stale
 * or low-confidence label to authorise a gesture. A >=.92 cold observation is
 * usable immediately; ordinary acquisition needs two fresh observations and a
 * live identity switch needs three (four when the palm has not moved).
 */
export class HandIdentityStabilizer {
  private stable: StableHandIdentity = '';
  private stableScore = 0;
  private candidate: StableHandIdentity = '';
  private candidateFrames = 0;
  private lastTimestampMs = Number.NEGATIVE_INFINITY;
  private lastTrustedAt = Number.NEGATIVE_INFINITY;
  private lastPalm: { x: number; y: number; scale: number } | null = null;

  update(observation: HandIdentityObservation): HandIdentityResult {
    const now = observation.timestampMs;
    if (!Number.isFinite(now) || now <= this.lastTimestampMs) {
      return { identity: this.stable, score: this.stableScore, trusted: false, changed: false };
    }
    this.lastTimestampMs = now;

    const identity = normalizeIdentity(observation.label);
    const degraded = observation.lightingMode !== 'normal';
    const threshold = degraded ? 0.78 : 0.68;
    const score = clamp01(observation.score);
    const geometryValid = [observation.palmX, observation.palmY, observation.palmScale].every(Number.isFinite)
      && observation.palmScale >= 0.035
      && observation.palmScale <= 0.75;
    if (!identity || score < threshold || !geometryValid) {
      this.candidate = '';
      this.candidateFrames = 0;
      const withinGrace = this.stable !== '' && now - this.lastTrustedAt <= 140;
      return {
        identity: withinGrace ? this.stable : '',
        score: withinGrace ? this.stableScore : 0,
        trusted: false,
        changed: false,
      };
    }

    if (identity === this.stable) {
      this.stableScore = score;
      this.lastTrustedAt = now;
      this.lastPalm = { x: observation.palmX, y: observation.palmY, scale: observation.palmScale };
      this.candidate = '';
      this.candidateFrames = 0;
      return { identity, score, trusted: true, changed: false };
    }

    if (identity === this.candidate) this.candidateFrames++;
    else {
      this.candidate = identity;
      this.candidateFrames = 1;
    }

    const palmDrift = this.lastPalm
      ? Math.hypot(observation.palmX - this.lastPalm.x, observation.palmY - this.lastPalm.y)
      : Number.POSITIVE_INFINITY;
    const scaleRatio = this.lastPalm
      ? observation.palmScale / Math.max(0.001, this.lastPalm.scale)
      : Number.POSITIVE_INFINITY;
    const samePalm = palmDrift <= 0.12 && scaleRatio >= 0.7 && scaleRatio <= 1.4;
    const requiredFrames = this.stable === ''
      ? (score >= 0.92 ? 1 : degraded ? 3 : 2)
      : samePalm ? 4 : 3;
    if (this.candidateFrames < requiredFrames) {
      return { identity: this.stable, score: this.stableScore, trusted: false, changed: false };
    }

    const changed = this.stable !== '' && this.stable !== identity;
    this.stable = identity;
    this.stableScore = score;
    this.lastTrustedAt = now;
    this.lastPalm = { x: observation.palmX, y: observation.palmY, scale: observation.palmScale };
    this.candidate = '';
    this.candidateFrames = 0;
    return { identity, score, trusted: true, changed };
  }

  reset(): void {
    this.stable = '';
    this.stableScore = 0;
    this.candidate = '';
    this.candidateFrames = 0;
    this.lastTimestampMs = Number.NEGATIVE_INFINITY;
    this.lastTrustedAt = Number.NEGATIVE_INFINITY;
    this.lastPalm = null;
  }
}

/**
 * Produces an explicit fail-closed state from geometry, visibility, model
 * confidence and the measured inference budget. The score is diagnostic; only
 * `usableForGesture` may authorise contact logic.
 */
export function classifyHandConfidence(input: HandConfidenceInput): HandConfidenceResult {
  if (!input.landmarksComplete) return { state: 'lost', score: 0, usableForGesture: false };

  const frameBudget = 1_000 / input.targetFps;
  // A usable far palm is commonly only 12–14px tall at the 320px low-power
  // tier. Geometry and temporal continuity authorise input; handedness stays
  // advisory because its label is least reliable at side angles and contact.
  const geometry = input.fingertipsVisible && input.palmAnchorsVisible && input.palmPixels >= 12 ? 1 : 0;
  const identity = clamp01(input.handednessScore);
  const temporal = clamp01(input.stableFrames / 3);
  const latency = clamp01(1 - Math.max(0, input.inferenceMs - frameBudget) / Math.max(1, frameBudget * 3));
  const lighting = input.lightingMode === 'normal'
    ? 1
    : input.lightingMode === 'blurred'
      ? 0.72
      : 0.82;
  const score = clamp01(
    geometry * 0.5
    + temporal * 0.28
    + latency * 0.1
    + lighting * 0.08
    + identity * 0.04,
  );
  const usableForGesture = geometry === 1
    && input.stableFrames >= 2
    && input.gestureTimely !== false
    && score >= 0.64;
  return {
    state: usableForGesture ? 'tracked' : 'uncertain',
    score,
    usableForGesture,
  };
}

/**
 * Validates a worker result against the capture clock before any landmark
 * filter, cursor or gesture state consumes it. Only one frame can be in flight,
 * so a measured inference allowance accepts the newest 70–120 ms CPU result
 * without permitting a stale queue. The timestamp watermark still protects
 * same-generation results delivered out of order.
 */
export function classifyHandWorkerResultFreshness(
  input: HandWorkerResultFreshnessInput,
): HandWorkerResultFreshness {
  if (input.generation !== input.activeGeneration) return 'wrong-generation';
  if (!Number.isFinite(input.captureTimestampMs)
    || !Number.isFinite(input.receivedTimestampMs)
    || Number.isNaN(input.lastAcceptedCaptureTimestampMs)) return 'invalid-timestamp';
  if (input.captureTimestampMs === input.lastAcceptedCaptureTimestampMs) return 'duplicate';
  if (input.captureTimestampMs < input.lastAcceptedCaptureTimestampMs) return 'out-of-order';

  const ageMs = input.receivedTimestampMs - input.captureTimestampMs;
  if (ageMs < 0) return 'future';
  const frameBudgetMs = 1_000 / input.targetFps;
  const fastPathAgeMs = frameBudgetMs * HAND_RESULT_MAX_FRAME_BUDGETS;
  const measuredAgeMs = Number.isFinite(input.inferenceMs) && input.inferenceMs! >= 0
    // Bitmap creation and worker transfer sit outside worker inference time.
    // Keep that real overhead bounded instead of dropping every valid result
    // on a slower CPU.
    ? input.inferenceMs! + Math.max(frameBudgetMs, 50)
    : fastPathAgeMs;
  const actionAgeMs = Math.min(
    HAND_RESULT_ACTION_MAX_AGE_MS,
    Math.max(fastPathAgeMs, measuredAgeMs),
  );
  if (ageMs <= actionAgeMs) return 'fresh-action';
  return ageMs <= HAND_RESULT_HARD_MAX_AGE_MS ? 'visual-only' : 'stale';
}

/** Pure transition contract shared by camera events, diagnostics and tests. */
export function nextHandCameraLifecycle(
  state: HandCameraLifecycleState,
  event: HandCameraLifecycleEvent,
): HandCameraLifecycleState {
  if (event === 'disable') return 'off';
  if (event === 'enable') return state === 'active' ? 'active' : 'warming';
  if (event === 'camera-ready') return state === 'off' ? 'off' : 'active';
  if (event === 'suspend') return state === 'off' ? 'off' : 'suspended';
  if (event === 'resume') return state === 'suspended' ? 'recovering' : state;
  if (event === 'recover') return state === 'off' || state === 'suspended' ? state : 'recovering';
  if (event === 'failure') return state === 'off' ? 'off' : 'failed';
  return state;
}

export class HandCameraLifecycle {
  private state: HandCameraLifecycleState = 'off';

  dispatch(event: HandCameraLifecycleEvent): HandCameraLifecycleState {
    this.state = nextHandCameraLifecycle(this.state, event);
    return this.state;
  }

  current(): HandCameraLifecycleState {
    return this.state;
  }
}

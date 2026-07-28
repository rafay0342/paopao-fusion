/**
 * Low-latency camera controls. MediaPipe runs inside a Web Worker so its
 * synchronous inference never blocks Phaser's render/update thread.
 */

import { HandAimFilter, HandLandmarkFilter, OneEuroFilter, normaliseCameraPoint } from './handcontrol';
import { hostedAssetUrl } from './hostedAsset';
import { getHandSettings, type HandSettings } from './handsettings';
import { measureHandGeometry } from './handgeometry';
import {
  HandCameraLifecycle,
  HandIdentityStabilizer,
  classifyHandConfidence,
  classifyHandWorkerResultFreshness,
  isCompleteHandLandmarkSet,
  type HandCameraLifecycleState,
  type HandConfidenceState,
} from './handreliability';
import {
  HAND_DETAIL_EDGE,
  HAND_DETAIL_FALLBACK_EDGE,
  HAND_FAR_PALM_SCALE,
  HandInferenceGovernor,
  handFarDetailMode,
  handInferenceEdge,
  handInferenceSize,
  type HandLightingMode,
} from './handvision';

const assetUrl = (path: string) => new URL(hostedAssetUrl(path), document.baseURI).toString();
const WASM_URL = assetUrl('mediapipe/wasm');
const MODEL_URL = assetUrl('mediapipe/models/hand_landmarker.task');

// Hand input is gameplay-critical and must not be throttled by visual quality.
// Players can still choose 15/20/30 FPS explicitly in Hand Control Lab.
const captureIntervalMs = (settings = getHandSettings()): number => 1000 / settings.targetFps;
const DROPOUT_GRACE_MS = 260;
const BITMAP_TIMEOUT_MS = 700;
const VIDEO_STALL_MS = 1_200;
const WORKER_INIT_TIMEOUT_MS = 25_000;
const CAPTURE_EARLY_TOLERANCE_MS = 8;
const CAMERA_PARK_GRACE_MS = 5_000;

const HAND_CONNECTIONS: ReadonlyArray<readonly [number, number]> = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20], [0, 17],
];

interface Landmark {
  x: number;
  y: number;
  z: number;
}

interface WorkerResultMessage {
  type: 'RESULT';
  generation: number;
  frameId: number;
  timestampMs: number;
  inferenceMs: number;
  landmarks: Landmark[] | null;
  worldLandmarks: Landmark[] | null;
  gesture: string;
  gestureScore: number;
  handedness: string;
  handednessScore: number;
  lightingMode: HandLightingMode;
  enhanced: boolean;
}

type WorkerMessage =
  | WorkerResultMessage
  | { type: 'READY' }
  | { type: 'INIT_ERROR'; error: string }
  | { type: 'FRAME_ERROR'; generation: number; frameId: number; error: string };

export type HandGesture =
  | 'pinch'
  | 'point'
  | 'open'
  | 'fist'
  | 'thumb-up'
  | 'thumb-down'
  | 'victory'
  | 'love'
  | 'other';

export type HandDirection = 'left' | 'right' | 'up' | 'down' | 'steady';

export interface HandSample {
  /** Capture clock shared with the worker; gesture timing must use this. */
  timestampMs: number;
  /** Normalised 0..1 after applying the active mirror preference. */
  x: number;
  y: number;
  /** Thumb/index distance divided by palm width; smaller means pinched. */
  pinch: number;
  rawPinch: number;
  filteredPinch: number;
  palmX: number;
  palmY: number;
  /** True when camera-space palm X is mirrored by the on-screen controls. */
  mirrorX: boolean;
  /** Unfiltered palm size for geometry validation. */
  rawPalmScale: number;
  palmScale: number;
  /** Conservative apparent palm size at the actual inference resolution. */
  palmPixels: number;
  /** Absolute thumb/index depth separation divided by palm width. */
  pinchDepth: number;
  /** Full thumb/index separation including depth, normalised by palm size. */
  pinch3d: number;
  /** Whether depth came from metric world landmarks or image-z fallback. */
  depthSource: 'world' | 'image';
  /** Index-finger direction and palm roll in camera-space degrees. */
  pointingAngle: number;
  handRoll: number;
  /** 0 is far/small in frame; 1 is near/large in frame. */
  depth: number;
  fingertipsVisible: boolean;
  palmAnchorsVisible: boolean;
  gesture: HandGesture;
  gestureScore: number;
  direction: HandDirection;
  handedness: string;
  handednessScore: number;
  inferenceMs: number;
  trackingFps: number;
  lightingMode: HandLightingMode;
  enhanced: boolean;
  /** Explicit fail-closed synthesis of visibility, confidence and latency. */
  confidenceState: HandConfidenceState;
  confidence: number;
  /** Only true when this capture may advance contact/release gameplay state. */
  usableForGesture: boolean;
  /** False for delayed results and until a fresh frame confirms a lighting transition. */
  gestureStable: boolean;
}

export interface HandTrackingDiagnostics {
  captureFps: number;
  inferenceMs: number;
  pipelineMs: number;
  droppedResults: number;
  missingFrames: number;
  recoveries: number;
  pendingMs: number;
  sourceWidth: number;
  sourceHeight: number;
  inferenceEdge: number;
  inferenceEdgeCap: number;
  inferenceWidth: number;
  inferenceHeight: number;
  lightingMode: HandLightingMode;
  lifecycleState: HandCameraLifecycleState;
}

type PendingPhase = 'none' | 'bitmap' | 'worker';
type VideoWithFrameCallback = HTMLVideoElement & {
  requestVideoFrameCallback?: (callback: (now: number, metadata: { mediaTime: number }) => void) => number;
  cancelVideoFrameCallback?: (id: number) => void;
};

type CameraControlCapabilities = MediaTrackCapabilities & {
  focusMode?: string[];
  exposureMode?: string[];
  whiteBalanceMode?: string[];
};

type CameraControlSet = MediaTrackConstraintSet & {
  focusMode?: string;
  exposureMode?: string;
  whiteBalanceMode?: string;
};

export type HandTrackingFailure =
  | 'none'
  | 'permission-denied'
  | 'no-camera'
  | 'camera-busy'
  | 'camera-constraints'
  | 'model-load-failed'
  | 'insecure-context'
  | 'unsupported'
  | 'unknown';

class HandTracker {
  private video: VideoWithFrameCallback;
  private overlay: HTMLCanvasElement;
  private overlayCtx: CanvasRenderingContext2D;
  private stream: MediaStream | null = null;
  private settings: HandSettings = getHandSettings();
  private wanted = false;
  private activeDesired = false;
  private resumeAfterVisibility = false;
  private pageLifecycleSuspended = false;
  private camReady = false;
  private cameraRequestId = 0;
  private enableRequestId = 0;
  private cameraStartPromise: Promise<void> | null = null;
  private cameraRecoveryPromise: Promise<void> | null = null;
  private cameraRetryAt = 0;
  private cameraRetryDelay = 500;
  private parkedCameraTimer: ReturnType<typeof setTimeout> | null = null;
  private mutedSince = 0;
  private lastFailure: HandTrackingFailure = 'none';

  private worker: Worker | null = null;
  private workerReady = false;
  private workerInitPromise: Promise<void> | null = null;
  private resolveWorkerInit: (() => void) | null = null;
  private rejectWorkerInit: ((error: Error) => void) | null = null;
  private workerInitTimer: ReturnType<typeof setTimeout> | null = null;
  private workerRecoveryPromise: Promise<void> | null = null;
  private workerRetryAt = 0;
  private workerRetryDelay = 500;
  private inferencePending = false;
  private pendingPhase: PendingPhase = 'none';
  private pendingSince = 0;
  private pendingFrameId = 0;
  private nextFrameId = 1;
  private lastInferenceMs = 0;
  private lastPipelineMs = 0;
  private droppedResults = 0;
  private frameErrors = 0;
  private nextCaptureAt = 0;
  private lastVideoTime = -1;
  private lastVideoProgressAt = 0;
  private videoFrameCallbackId: number | null = null;
  private lastTimestampMs = -1;
  private lastAcceptedCaptureTimestampMs = Number.NEGATIVE_INFINITY;
  private captureGeneration = 0;

  private latestSample: HandSample | null = null;
  private latestSampleAt = 0;
  private sampleSequence = 0;
  private consumedSequence = 0;
  private trackingFps = 0;
  private lastResultAt = 0;
  private lastValidResultAt = 0;
  private missingSince = 0;
  private missingFrames = 0;
  private lossFiltersReset = false;
  private recoveryCount = 0;
  private lastOverlayDrawAt = 0;
  private previewVisible = false;
  private directionPoint: { x: number; y: number } | null = null;
  private directionTime = 0;
  private directionVelocity = { x: 0, y: 0 };
  private directionCandidate: HandDirection = 'steady';
  private directionCandidateFrames = 0;
  private directionCandidateAt = 0;
  private stableDirection: HandDirection = 'steady';
  private readonly aimFilter = new HandAimFilter();
  private readonly landmarkFilter = new HandLandmarkFilter();
  private readonly pinchFilter = new OneEuroFilter(6, 1.5, 1.2);
  private readonly identityStabilizer = new HandIdentityStabilizer();
  private readonly cameraLifecycle = new HandCameraLifecycle();
  private readonly inferenceGovernor = new HandInferenceGovernor();
  private gestureCandidate: HandGesture = 'other';
  private gestureCandidateFrames = 0;
  private stableGesture: HandGesture = 'other';
  private stableGestureAt = 0;
  private stableHandFrames = 0;
  /** Valid landmark frames used only to end the temporary 512px detail boost. */
  private detailAcquisitionSamples = 0;
  private lastPalmScale = 0;
  private lightingMode: HandLightingMode = 'normal';
  private gestureLightingMode: HandLightingMode = 'normal';
  private lightingStableFrames = 1;
  private farDetailMode = true;
  private lastCaptureEdge = HAND_DETAIL_EDGE;
  private lastCaptureWidth = 0;
  private lastCaptureHeight = 0;

  constructor() {
    this.video = document.createElement('video');
    this.video.setAttribute('playsinline', '');
    this.video.autoplay = true;
    this.video.muted = true;
    this.video.disablePictureInPicture = true;
    Object.assign(this.video.style, {
      position: 'absolute', width: '168px', height: '126px', opacity: '0', display: 'none',
      pointerEvents: 'none', top: '8px', right: '16px', zIndex: '10', objectFit: 'cover',
      borderRadius: '16px', border: '2px solid rgba(70,224,200,0.85)',
      transform: 'scaleX(-1)', boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
    });

    this.overlay = document.createElement('canvas');
    this.overlay.width = 320;
    this.overlay.height = 240;
    Object.assign(this.overlay.style, {
      position: 'absolute', width: '168px', height: '126px', opacity: '0', display: 'none',
      pointerEvents: 'none', top: '8px', right: '16px', zIndex: '11', borderRadius: '16px',
      transform: 'scaleX(-1)',
    });
    const context = this.overlay.getContext('2d');
    if (!context) throw new Error('Canvas 2D is unavailable');
    this.overlayCtx = context;

    document.body.append(this.video, this.overlay);

    window.addEventListener('paopao:hand-settings', (event) => {
      const next = (event as CustomEvent<HandSettings>).detail;
      if (next) {
        const inferenceContractChanged = next.deviceId !== this.settings.deviceId
          || next.targetFps !== this.settings.targetFps;
        this.settings = next;
        if (inferenceContractChanged) this.inferenceGovernor.reset();
      }
    });
    document.addEventListener('visibilitychange', () => this.handleVisibilityChange());
    window.addEventListener('pagehide', () => this.handlePageHidden());
    window.addEventListener('pageshow', () => this.handlePageVisible());
  }

  isWanted(): boolean {
    return this.wanted;
  }

  getLastFailure(): HandTrackingFailure {
    return this.lastFailure;
  }

  /** Warm the worker/model without requesting camera permission. */
  prepare(): Promise<void> {
    return this.ensureModel();
  }

  setPreviewVisible(visible: boolean): void {
    this.previewVisible = visible;
    for (const element of [this.video, this.overlay]) {
      element.style.display = visible ? 'block' : 'none';
      element.style.opacity = visible ? '0.94' : '0';
    }
    if (!visible) this.overlayCtx.clearRect(0, 0, this.overlay.width, this.overlay.height);
  }

  getDiagnostics(): HandTrackingDiagnostics {
    const now = performance.now();
    return {
      captureFps: this.trackingFps,
      inferenceMs: this.lastInferenceMs,
      pipelineMs: this.lastPipelineMs,
      droppedResults: this.droppedResults,
      missingFrames: this.missingFrames,
      recoveries: this.recoveryCount,
      pendingMs: this.pendingPhase === 'none' ? 0 : Math.max(0, now - this.pendingSince),
      sourceWidth: this.video.videoWidth,
      sourceHeight: this.video.videoHeight,
      inferenceEdge: this.lastCaptureEdge,
      inferenceEdgeCap: this.inferenceGovernor.edgeCap(),
      inferenceWidth: this.lastCaptureWidth,
      inferenceHeight: this.lastCaptureHeight,
      lightingMode: this.lightingMode,
      lifecycleState: this.cameraLifecycle.current(),
    };
  }

  private ensureModel(): Promise<void> {
    if (this.workerReady) return Promise.resolve();
    if (this.workerInitPromise) return this.workerInitPromise;

    const worker = new Worker(new URL('./handtracking.worker.ts', import.meta.url), { type: 'module' });
    this.worker = worker;
    worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
      if (this.worker === worker) this.handleWorkerMessage(event.data);
    };
    worker.onerror = (event) => {
      if (this.worker !== worker) return;
      const error = new Error(event.message || 'Gesture worker failed');
      const runtimeFailure = this.workerReady;
      this.resetWorker(error);
      if (runtimeFailure) this.queueWorkerRecovery();
    };
    worker.onmessageerror = () => {
      if (this.worker !== worker) return;
      const runtimeFailure = this.workerReady;
      this.resetWorker(new Error('Gesture worker sent an unreadable message'));
      if (runtimeFailure) this.queueWorkerRecovery();
    };
    this.workerInitPromise = new Promise<void>((resolve, reject) => {
      this.resolveWorkerInit = resolve;
      this.rejectWorkerInit = reject;
    });
    this.workerInitTimer = setTimeout(() => {
      if (this.worker !== worker || this.workerReady) return;
      this.resetWorker(new Error('Gesture model initialization timed out'));
      if (this.wanted) this.queueWorkerRecovery();
    }, WORKER_INIT_TIMEOUT_MS);
    worker.postMessage({ type: 'INIT', wasmUrl: WASM_URL, modelUrl: MODEL_URL });
    return this.workerInitPromise;
  }

  private resetWorker(error = new Error('Gesture worker was reset')): void {
    const reject = this.rejectWorkerInit;
    if (this.workerInitTimer) clearTimeout(this.workerInitTimer);
    this.workerInitTimer = null;
    this.worker?.terminate();
    this.worker = null;
    this.workerReady = false;
    this.workerInitPromise = null;
    this.resolveWorkerInit = null;
    this.rejectWorkerInit = null;
    reject?.(error);
    this.captureGeneration++;
    this.clearPendingFrame();
    this.clearTrackingState();
  }

  private queueWorkerRecovery(): void {
    if (!this.wanted || this.workerRecoveryPromise || performance.now() < this.workerRetryAt) return;
    this.recoveryCount++;
    this.workerRecoveryPromise = this.ensureModel()
      .then(() => {
        this.frameErrors = 0;
        this.workerRetryAt = 0;
        this.workerRetryDelay = 500;
        if (this.wanted && this.camReady) {
          this.nextCaptureAt = performance.now();
          this.startVideoPump();
          this.scheduleFrame(this.nextCaptureAt);
        }
      })
      .catch((error) => {
        console.warn('Gesture worker recovery failed:', error);
        this.workerRetryAt = performance.now() + this.workerRetryDelay;
        this.workerRetryDelay = Math.min(4_000, this.workerRetryDelay * 2);
      })
      .finally(() => { this.workerRecoveryPromise = null; });
  }

  private handleWorkerMessage(message: WorkerMessage): void {
    if (message.type === 'READY') {
      if (this.workerInitTimer) clearTimeout(this.workerInitTimer);
      this.workerInitTimer = null;
      this.workerReady = true;
      this.resolveWorkerInit?.();
      this.resolveWorkerInit = null;
      this.rejectWorkerInit = null;
      return;
    }
    if (message.type === 'INIT_ERROR') {
      const error = new Error(message.error);
      this.resetWorker(error);
      return;
    }
    if (message.type === 'FRAME_ERROR') {
      if (message.generation !== this.captureGeneration || message.frameId !== this.pendingFrameId) return;
      console.warn('Gesture frame failed:', message.error);
      this.clearPendingFrame();
      this.frameErrors++;
      if (this.frameErrors >= 3) {
        const error = new Error(`Gesture worker failed ${this.frameErrors} consecutive frames`);
        this.resetWorker(error);
        this.queueWorkerRecovery();
      } else {
        this.scheduleFrame(performance.now());
      }
      return;
    }

    if (message.generation !== this.captureGeneration || message.frameId !== this.pendingFrameId) return;
    const receivedTimestampMs = performance.now();
    this.clearPendingFrame();
    if (!this.wanted || !this.camReady) return;
    this.frameErrors = 0;
    this.lastInferenceMs = message.inferenceMs;
    const pipelineMs = receivedTimestampMs - message.timestampMs;
    this.lastPipelineMs = pipelineMs;
    this.inferenceGovernor.observe(pipelineMs, this.settings.targetFps, receivedTimestampMs);
    const freshness = classifyHandWorkerResultFreshness({
      generation: message.generation,
      activeGeneration: this.captureGeneration,
      captureTimestampMs: message.timestampMs,
      lastAcceptedCaptureTimestampMs: this.lastAcceptedCaptureTimestampMs,
      receivedTimestampMs,
      targetFps: this.settings.targetFps,
      inferenceMs: message.inferenceMs,
    });
    if (freshness !== 'fresh-action' && freshness !== 'visual-only') {
      this.droppedResults++;
      this.scheduleFrame(receivedTimestampMs);
      return;
    }
    this.lastAcceptedCaptureTimestampMs = message.timestampMs;
    this.processResult(message, freshness === 'fresh-action');
    // Backpressure is already guaranteed by one frame in flight. Capture the
    // newest camera frame immediately instead of adding inference time again.
    this.scheduleFrame(receivedTimestampMs);
  }

  private startCamera(): Promise<void> {
    if (this.camReady && this.stream?.getVideoTracks().some((track) => track.readyState === 'live')) {
      return Promise.resolve();
    }
    if (this.cameraStartPromise) return this.cameraStartPromise;
    let tracked: Promise<void>;
    tracked = this.openCamera().finally(() => {
      if (this.cameraStartPromise === tracked) this.cameraStartPromise = null;
    });
    this.cameraStartPromise = tracked;
    return tracked;
  }

  private async openCamera(): Promise<void> {
    if (this.camReady && this.stream?.getVideoTracks().some((track) => track.readyState === 'live')) return;
    const requestId = ++this.cameraRequestId;
    this.stopCamera(false);
    const boundedVideo: MediaTrackConstraints = {
      width: { ideal: 640, max: 640 },
      height: { ideal: 480, max: 480 },
      aspectRatio: { ideal: 4 / 3 },
      frameRate: { ideal: 30, max: 30 },
      facingMode: { ideal: 'user' },
    };
    const basicVideo: MediaTrackConstraints = {
      width: { ideal: 640, max: 640 },
      height: { ideal: 480, max: 480 },
      frameRate: { ideal: 30, max: 30 },
      facingMode: { ideal: 'user' },
    };
    const isConstraintFallbackError = (error: unknown): boolean => {
      const name = error instanceof DOMException ? error.name : '';
      return ['OverconstrainedError', 'ConstraintNotSatisfiedError'].includes(name);
    };
    const requestDefaultCamera = async (): Promise<MediaStream> => {
      try {
        return await navigator.mediaDevices.getUserMedia({ audio: false, video: boundedVideo });
      } catch (error) {
        if (!isConstraintFallbackError(error)) throw error;
        // Older webcams and virtual-camera drivers sometimes reject HD maxima
        // even though their ordinary 640x480 stream is fully usable.
        return navigator.mediaDevices.getUserMedia({ audio: false, video: basicVideo });
      }
    };
    let candidate: MediaStream;
    try {
      candidate = this.settings.deviceId
        ? await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { ...boundedVideo, deviceId: { exact: this.settings.deviceId } },
        })
        : await requestDefaultCamera();
    } catch (error) {
      const name = error instanceof DOMException ? error.name : '';
      const canUseDefault = this.settings.deviceId
        && ['OverconstrainedError', 'ConstraintNotSatisfiedError', 'NotFoundError', 'DevicesNotFoundError'].includes(name);
      if (!canUseDefault) throw error;
      candidate = await requestDefaultCamera();
    }

    if (requestId !== this.cameraRequestId || !this.wanted || !this.activeDesired) {
      candidate.getTracks().forEach((track) => track.stop());
      throw new Error('Camera request was superseded');
    }

    this.stream = candidate;
    const track = candidate.getVideoTracks()[0];
    if (track) {
      void this.optimiseCameraTrack(track);
      track.onended = () => {
        if (this.stream === candidate && this.wanted && this.activeDesired) this.queueCameraRecovery('track ended');
      };
      track.onmute = () => {
        if (this.stream === candidate) this.mutedSince = performance.now();
      };
      track.onunmute = () => { this.mutedSince = 0; };
    }
    this.video.srcObject = candidate;
    try {
      await this.video.play();
    } catch (error) {
      if (this.stream === candidate) this.stopCamera(false);
      else candidate.getTracks().forEach((item) => item.stop());
      throw error;
    }
    if (requestId !== this.cameraRequestId || !this.wanted || !this.activeDesired) {
      if (this.stream === candidate) this.stopCamera(false);
      else candidate.getTracks().forEach((item) => item.stop());
      throw new Error('Camera request was superseded');
    }
    this.camReady = true;
    this.lastVideoProgressAt = performance.now();
    this.startVideoPump();
  }

  private async optimiseCameraTrack(track: MediaStreamTrack): Promise<void> {
    try {
      const capabilities = track.getCapabilities() as CameraControlCapabilities;
      const controls: CameraControlSet[] = [];
      if (capabilities.focusMode?.includes('continuous')) controls.push({ focusMode: 'continuous' });
      if (capabilities.exposureMode?.includes('continuous')) controls.push({ exposureMode: 'continuous' });
      if (capabilities.whiteBalanceMode?.includes('continuous')) controls.push({ whiteBalanceMode: 'continuous' });
      if (!controls.length) return;
      try {
        await track.applyConstraints({ advanced: [Object.assign({}, ...controls)] });
        return;
      } catch {
        // Some cameras advertise a control that they reject when combined.
      }
      for (const control of controls) {
        try {
          await track.applyConstraints({ advanced: [control] });
        } catch {
          // Each optional control fails independently; supported controls stay active.
        }
      }
    } catch {
      // Camera controls are hardware/browser optional; the bounded image path
      // below remains fully functional when a webcam rejects them.
    }
  }

  private stopCamera(invalidateRequest = true): void {
    if (this.parkedCameraTimer) clearTimeout(this.parkedCameraTimer);
    this.parkedCameraTimer = null;
    if (invalidateRequest) this.cameraRequestId++;
    this.stopVideoPump();
    this.stream?.getTracks().forEach((track) => {
      track.onended = null;
      track.onmute = null;
      track.onunmute = null;
      track.stop();
    });
    this.stream = null;
    this.video.pause();
    this.video.srcObject = null;
    this.camReady = false;
    this.mutedSince = 0;
    this.captureGeneration++;
    this.clearPendingFrame();
    this.lastVideoTime = -1;
    this.lastVideoProgressAt = 0;
    this.lastTimestampMs = -1;
    this.nextCaptureAt = 0;
    this.clearTrackingState();
  }

  private clearPendingFrame(): void {
    this.inferencePending = false;
    this.pendingPhase = 'none';
    this.pendingSince = 0;
    this.pendingFrameId = 0;
  }

  private clearTrackingState(): void {
    this.latestSample = null;
    this.latestSampleAt = 0;
    this.lastAcceptedCaptureTimestampMs = Number.NEGATIVE_INFINITY;
    this.consumedSequence = this.sampleSequence;
    this.trackingFps = 0;
    this.lastResultAt = 0;
    this.lastValidResultAt = 0;
    this.missingSince = 0;
    this.missingFrames = 0;
    this.lossFiltersReset = false;
    this.directionPoint = null;
    this.directionVelocity = { x: 0, y: 0 };
    this.directionCandidate = 'steady';
    this.directionCandidateFrames = 0;
    this.directionCandidateAt = 0;
    this.stableDirection = 'steady';
    this.aimFilter.reset();
    this.landmarkFilter.reset();
    this.pinchFilter.reset();
    this.identityStabilizer.reset();
    this.gestureCandidate = 'other';
    this.gestureCandidateFrames = 0;
    this.stableGesture = 'other';
    this.stableGestureAt = 0;
    this.stableHandFrames = 0;
    this.detailAcquisitionSamples = 0;
    this.lastPalmScale = 0;
    this.lightingMode = 'normal';
    this.gestureLightingMode = 'normal';
    this.lightingStableFrames = 1;
    this.farDetailMode = true;
    this.lastCaptureEdge = HAND_DETAIL_EDGE;
    this.lastCaptureWidth = 0;
    this.lastCaptureHeight = 0;
    this.lastPipelineMs = 0;
    this.droppedResults = 0;
    // Preserve the learned device tier across ordinary scene/camera
    // suspension. It is reset only when the camera device or target cadence
    // changes, so a long session never repeats the slow-device warm-up tax.
    this.overlayCtx.clearRect(0, 0, this.overlay.width, this.overlay.height);
  }

  private queueCameraRecovery(reason: string): void {
    if (!this.wanted
      || !this.activeDesired
      || this.pageLifecycleSuspended
      || document.visibilityState === 'hidden'
      || this.cameraRecoveryPromise
      || performance.now() < this.cameraRetryAt) return;
    this.recoveryCount++;
    this.cameraLifecycle.dispatch('recover');
    this.cameraRecoveryPromise = (async () => {
      console.warn(`Recovering hand camera: ${reason}`);
      this.stopCamera();
      if (!this.wanted || !this.activeDesired) return;
      await this.startCamera();
      this.cameraRetryAt = 0;
      this.cameraRetryDelay = 500;
      this.setPreviewVisible(this.settings.preview);
      this.nextCaptureAt = performance.now();
      this.cameraLifecycle.dispatch('camera-ready');
      this.scheduleFrame(this.nextCaptureAt);
    })()
      .catch((error) => {
        this.cameraLifecycle.dispatch('failure');
        this.lastFailure = this.classifyFailure(error, 'camera');
        this.cameraRetryAt = performance.now() + this.cameraRetryDelay;
        this.cameraRetryDelay = Math.min(4_000, this.cameraRetryDelay * 2);
        console.warn('Hand camera recovery failed:', error);
      })
      .finally(() => { this.cameraRecoveryPromise = null; });
  }

  private handlePageHidden(): void {
    this.pageLifecycleSuspended = true;
    if (!this.wanted || !this.activeDesired || !this.camReady) return;
    this.resumeAfterVisibility = true;
    this.stopCamera();
    this.cameraLifecycle.dispatch('suspend');
  }

  private handlePageVisible(): void {
    this.pageLifecycleSuspended = false;
    if (!this.resumeAfterVisibility || !this.wanted || !this.activeDesired) return;
    this.resumeAfterVisibility = false;
    this.cameraLifecycle.dispatch('resume');
    this.queueCameraRecovery('page resumed');
  }

  private handleVisibilityChange(): void {
    if (document.visibilityState === 'hidden') this.handlePageHidden();
    else this.handlePageVisible();
  }

  private classifyFailure(error: unknown, stage: 'camera' | 'model'): HandTrackingFailure {
    if (!window.isSecureContext) return 'insecure-context';
    if (!navigator.mediaDevices?.getUserMedia || !window.createImageBitmap || !window.Worker) return 'unsupported';
    if (stage === 'model') return 'model-load-failed';
    const name = error instanceof DOMException ? error.name : '';
    if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError') return 'permission-denied';
    if (name === 'NotFoundError' || name === 'DevicesNotFoundError') return 'no-camera';
    if (name === 'NotReadableError' || name === 'TrackStartError' || name === 'AbortError') return 'camera-busy';
    if (name === 'OverconstrainedError' || name === 'ConstraintNotSatisfiedError') return 'camera-constraints';
    return 'unknown';
  }

  async enable(): Promise<boolean> {
    const requestId = ++this.enableRequestId;
    let stage: 'camera' | 'model' = 'camera';
    this.lastFailure = 'none';
    this.wanted = true;
    this.activeDesired = true;
    if (this.parkedCameraTimer) clearTimeout(this.parkedCameraTimer);
    this.parkedCameraTimer = null;
    this.resumeAfterVisibility = false;
    this.cameraLifecycle.dispatch('enable');
    try {
      if (!window.isSecureContext) throw new Error('Hand tracking needs HTTPS');
      if (!navigator.mediaDevices?.getUserMedia || !window.createImageBitmap || !window.Worker) {
        throw new Error('Required camera/worker API is unavailable');
      }
      // Model/WASM startup is the expensive cold path. Start it while the
      // browser is opening the camera or waiting for the permission click.
      const modelReady = this.ensureModel().then(
        (): Error | null => null,
        (error: unknown): Error | null => error instanceof Error ? error : new Error(String(error)),
      );
      await this.startCamera();
      if (requestId !== this.enableRequestId) throw new Error('Hand tracking activation was superseded');
      this.setPreviewVisible(this.settings.preview);
      stage = 'model';
      const modelError = await modelReady;
      if (modelError) throw modelError;
      if (requestId !== this.enableRequestId) throw new Error('Hand tracking activation was superseded');
      this.nextCaptureAt = performance.now();
      this.startVideoPump();
      this.scheduleFrame(this.nextCaptureAt);
      this.cameraLifecycle.dispatch('camera-ready');
      return true;
    } catch (error) {
      if (requestId !== this.enableRequestId) return false;
      console.warn('Hand tracking unavailable:', error);
      this.lastFailure = this.classifyFailure(error, stage);
      this.wanted = false;
      this.activeDesired = false;
      this.resumeAfterVisibility = false;
      this.cameraLifecycle.dispatch('failure');
      this.setPreviewVisible(false);
      this.stopCamera();
      return false;
    }
  }

  disable(): void {
    this.enableRequestId++;
    this.wanted = false;
    this.activeDesired = false;
    this.resumeAfterVisibility = false;
    this.cameraLifecycle.dispatch('disable');
    this.setPreviewVisible(false);
    this.stopCamera();
  }

  /** Park the live camera briefly between scenes; keep worker/model warm. */
  suspend(): void {
    this.enableRequestId++;
    this.activeDesired = false;
    this.resumeAfterVisibility = false;
    this.cameraLifecycle.dispatch('suspend');
    this.setPreviewVisible(false);
    this.stopVideoPump();
    this.captureGeneration++;
    this.clearPendingFrame();
    this.nextCaptureAt = 0;
    this.lastVideoTime = -1;
    this.clearTrackingState();
    if (this.parkedCameraTimer) clearTimeout(this.parkedCameraTimer);
    this.parkedCameraTimer = setTimeout(() => {
      this.parkedCameraTimer = null;
      if (!this.activeDesired) this.stopCamera();
    }, CAMERA_PARK_GRACE_MS);
  }

  private startVideoPump(): void {
    if (this.videoFrameCallbackId !== null || !this.camReady || !this.wanted || !this.activeDesired) return;
    const request = this.video.requestVideoFrameCallback;
    if (!request) return;
    this.videoFrameCallbackId = request.call(this.video, (now, metadata) => {
      this.videoFrameCallbackId = null;
      if (!this.camReady || !this.wanted || !this.activeDesired) return;
      if (metadata.mediaTime !== this.lastVideoTime) this.lastVideoProgressAt = performance.now();
      this.runMaintenance(now);
      this.scheduleFrame(now, metadata.mediaTime);
      this.startVideoPump();
    });
  }

  private stopVideoPump(): void {
    if (this.videoFrameCallbackId !== null) this.video.cancelVideoFrameCallback?.(this.videoFrameCallbackId);
    this.videoFrameCallbackId = null;
  }

  private runMaintenance(now: number): void {
    if (this.pendingPhase === 'bitmap' && now - this.pendingSince >= BITMAP_TIMEOUT_MS) {
      this.queueCameraRecovery('frame copy timed out');
      return;
    }
    if (this.pendingPhase === 'worker') {
      const timeout = Math.min(4_000, Math.max(
        900,
        captureIntervalMs(this.settings) * 12,
        this.lastInferenceMs > 0 ? this.lastInferenceMs * 6 : 0,
      ));
      if (now - this.pendingSince >= timeout) {
        const error = new Error('Gesture inference timed out');
        this.resetWorker(error);
        this.queueWorkerRecovery();
        return;
      }
    }
    if (this.mutedSince > 0 && now - this.mutedSince >= 1_000) {
      this.queueCameraRecovery('camera stayed muted');
      return;
    }
    if (this.camReady
      && this.lastVideoProgressAt > 0
      && now - this.lastVideoProgressAt >= VIDEO_STALL_MS
      && document.visibilityState !== 'hidden') {
      this.queueCameraRecovery('video frames stopped');
      return;
    }
    if (this.wanted
      && this.activeDesired
      && !this.camReady
      && !this.cameraStartPromise
      && !this.cameraRecoveryPromise
      && now >= this.cameraRetryAt
      && document.visibilityState !== 'hidden') {
      this.queueCameraRecovery('camera stream unavailable');
      return;
    }
    if (this.wanted && !this.workerReady && !this.workerInitPromise) this.queueWorkerRecovery();
  }

  private scheduleFrame(now: number, mediaTime = this.video.currentTime): void {
    this.runMaintenance(now);
    if (!this.workerReady || !this.worker || this.inferencePending || now + CAPTURE_EARLY_TOLERANCE_MS < this.nextCaptureAt) return;
    if (!this.wanted || !this.activeDesired || !this.camReady || this.video.readyState < 2 || mediaTime === this.lastVideoTime) return;

    this.lastVideoTime = mediaTime;
    this.lastVideoProgressAt = performance.now();
    const interval = captureIntervalMs(this.settings);
    if (this.nextCaptureAt <= 0) this.nextCaptureAt = now;
    do this.nextCaptureAt += interval;
    while (this.nextCaptureAt <= now);

    this.inferencePending = true;
    this.pendingPhase = 'bitmap';
    this.pendingSince = now;
    const frameId = this.nextFrameId++;
    this.pendingFrameId = frameId;
    const timestampMs = Math.max(now, this.lastTimestampMs + 1);
    this.lastTimestampMs = timestampMs;
    const generation = this.captureGeneration;

    const sourceWidth = Math.max(1, this.video.videoWidth);
    const sourceHeight = Math.max(1, this.video.videoHeight);
    const recentlyTracked = this.lastValidResultAt > 0 && performance.now() - this.lastValidResultAt <= 500;
    const stableTracking = recentlyTracked && this.missingFrames === 0 && this.stableHandFrames >= 6;
    if (!stableTracking) this.farDetailMode = true;
    else this.farDetailMode = handFarDetailMode(this.farDetailMode, this.lastPalmScale);
    const requestedEdge = handInferenceEdge({
      recentlyTracked,
      missingFrames: this.missingFrames,
      stableFrames: this.stableHandFrames,
      palmScale: this.farDetailMode ? 0 : Math.max(HAND_FAR_PALM_SCALE, this.lastPalmScale),
    });
    // Do not make a new player wait for the governor's eight-second recovery
    // before MediaPipe receives enough fingertip detail. The first three valid
    // hands use the full acquisition frame; far-hand recovery retains a 416px
    // floor, then ordinary stable tracking follows the learned device tier.
    const acquisitionOverride = this.detailAcquisitionSamples < 3;
    const adaptiveCap = acquisitionOverride
      ? HAND_DETAIL_EDGE
      : this.farDetailMode
        ? Math.max(HAND_DETAIL_FALLBACK_EDGE, this.inferenceGovernor.edgeCap())
        : this.inferenceGovernor.edgeCap();
    const inferenceEdge = Math.min(requestedEdge, adaptiveCap);
    const inferenceSize = handInferenceSize(sourceWidth, sourceHeight, inferenceEdge);
    const resizeWidth = inferenceSize.width;
    const resizeHeight = inferenceSize.height;
    const resizeQuality: ResizeQuality = 'medium';
    this.lastCaptureEdge = inferenceEdge;
    this.lastCaptureWidth = resizeWidth;
    this.lastCaptureHeight = resizeHeight;

    createImageBitmap(this.video, { resizeWidth, resizeHeight, resizeQuality })
      .then((bitmap) => {
        let transferred = false;
        try {
          if (!this.worker
            || !this.workerReady
            || !this.wanted
            || !this.activeDesired
            || !this.camReady
            || generation !== this.captureGeneration
            || frameId !== this.pendingFrameId) return;
          this.pendingPhase = 'worker';
          this.pendingSince = performance.now();
          this.worker.postMessage({ type: 'FRAME', bitmap, timestampMs, generation, frameId }, [bitmap]);
          transferred = true;
        } finally {
          if (!transferred) {
            bitmap.close();
            if (generation === this.captureGeneration && frameId === this.pendingFrameId) this.clearPendingFrame();
          }
        }
      })
      .catch((error) => {
        if (generation !== this.captureGeneration || frameId !== this.pendingFrameId) return;
        console.warn('Camera frame capture failed:', error);
        this.clearPendingFrame();
        this.nextCaptureAt = performance.now() + 80;
      });
  }

  private drawLandmarks(landmarks: Landmark[] | null): void {
    if (!this.previewVisible) return;
    const ctx = this.overlayCtx;
    const { width, height } = this.overlay;
    const now = performance.now();
    if (landmarks && now - this.lastOverlayDrawAt < 66) return;
    this.lastOverlayDrawAt = now;
    ctx.clearRect(0, 0, width, height);
    if (!landmarks) return;

    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(70,224,200,0.92)';
    for (const [from, to] of HAND_CONNECTIONS) {
      ctx.beginPath();
      ctx.moveTo(landmarks[from].x * width, landmarks[from].y * height);
      ctx.lineTo(landmarks[to].x * width, landmarks[to].y * height);
      ctx.stroke();
    }
    for (let index = 0; index < landmarks.length; index++) {
      const point = landmarks[index];
      ctx.beginPath();
      ctx.fillStyle = index === 8 ? '#ffffff' : index === 4 ? '#ffd24b' : '#46e0c8';
      ctx.arc(point.x * width, point.y * height, index === 8 || index === 4 ? 5 : 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private directionFor(x: number, y: number, now: number): HandDirection {
    if (!this.directionPoint) {
      this.directionPoint = { x, y };
      this.directionTime = now;
      return 'steady';
    }
    const previous = this.directionPoint;
    const elapsedMs = Math.min(120, Math.max(8, now - this.directionTime));
    const elapsed = elapsedMs / 1000;
    const rawVx = (x - previous.x) / elapsed;
    const rawVy = (y - previous.y) / elapsed;
    const velocityAlpha = 1 - Math.exp(-elapsedMs / 42);
    this.directionVelocity.x += (rawVx - this.directionVelocity.x) * velocityAlpha;
    this.directionVelocity.y += (rawVy - this.directionVelocity.y) * velocityAlpha;
    const { x: vx, y: vy } = this.directionVelocity;
    this.directionPoint = { x, y };
    this.directionTime = now;
    const speed = Math.hypot(vx, vy);
    const threshold = this.stableDirection === 'steady' ? 0.16 : 0.08;
    let next: HandDirection = speed < threshold ? 'steady' : this.stableDirection;
    if (speed >= threshold) {
      const absX = Math.abs(vx);
      const absY = Math.abs(vy);
      if (absX >= absY * 1.2) next = vx < 0 ? 'left' : 'right';
      else if (absY >= absX * 1.2) next = vy < 0 ? 'up' : 'down';
      else if (next === 'steady') next = absX > absY ? (vx < 0 ? 'left' : 'right') : (vy < 0 ? 'up' : 'down');
    }
    if (next === this.directionCandidate) this.directionCandidateFrames++;
    else {
      this.directionCandidate = next;
      this.directionCandidateFrames = 1;
      this.directionCandidateAt = now;
    }
    const confirmMs = next === 'steady' ? 55 : 25;
    if (speed >= 0.55 || (this.directionCandidateFrames >= 2 && now - this.directionCandidateAt >= confirmMs)) {
      this.stableDirection = next;
    }
    return this.stableDirection;
  }

  private gestureFor(modelGesture: string, score: number, pinch: number, now: number): { gesture: HandGesture; score: number } {
    if (pinch < this.settings.pinchOn + 0.02) {
      this.stableGesture = 'pinch';
      this.stableGestureAt = now;
      return { gesture: 'pinch', score: Math.min(1, Math.max(0, 1 - pinch)) };
    }
    const mapped: Record<string, HandGesture> = {
      Pointing_Up: 'point', Open_Palm: 'open', Closed_Fist: 'fist', Thumb_Up: 'thumb-up',
      Thumb_Down: 'thumb-down', Victory: 'victory', ILoveYou: 'love',
    };
    const next = mapped[modelGesture] ?? 'other';
    if (next === this.gestureCandidate) this.gestureCandidateFrames++;
    else {
      this.gestureCandidate = next;
      this.gestureCandidateFrames = 1;
    }
    if (score >= 0.4 && this.gestureCandidateFrames >= 2) {
      this.stableGesture = next;
      this.stableGestureAt = now;
    } else if (now - this.stableGestureAt > 220) {
      this.stableGesture = 'other';
    }
    return { gesture: this.stableGesture, score };
  }

  private processResult(result: WorkerResultMessage, gestureTimely: boolean): void {
    const now = performance.now();
    if (this.lastResultAt > 0) {
      const instantFps = 1000 / Math.max(1, now - this.lastResultAt);
      this.trackingFps = this.trackingFps === 0 ? instantFps : this.trackingFps * 0.82 + instantFps * 0.18;
    }
    this.lastResultAt = now;
    // Diagnostics must reflect the actual frame even when lighting prevents
    // MediaPipe from returning a usable hand.
    this.lightingMode = result.lightingMode;
    if (result.lightingMode !== this.gestureLightingMode) {
      this.gestureLightingMode = result.lightingMode;
      this.lightingStableFrames = 0;
    }

    const lm = result.landmarks;
    const validLandmarks = isCompleteHandLandmarkSet(lm);
    if (!lm || !validLandmarks) {
      if (this.missingSince === 0) this.missingSince = now;
      this.missingFrames++;
      this.stableHandFrames = 0;
      if (!this.lossFiltersReset && now - this.missingSince >= DROPOUT_GRACE_MS) {
        this.lossFiltersReset = true;
        this.latestSample = null;
        this.latestSampleAt = 0;
        this.directionPoint = null;
        this.directionVelocity = { x: 0, y: 0 };
        this.aimFilter.reset();
        this.landmarkFilter.reset();
        this.pinchFilter.reset();
        this.identityStabilizer.reset();
        this.drawLandmarks(null);
      }
      return;
    }

    this.missingSince = 0;
    this.missingFrames = 0;
    this.lossFiltersReset = false;
    this.lastValidResultAt = now;
    this.detailAcquisitionSamples = Math.min(3, this.detailAcquisitionSamples + 1);
    if (gestureTimely) {
      this.lightingStableFrames = Math.min(1, this.lightingStableFrames + 1);
    } else {
      // A delayed frame may draw the cursor, but it cannot pre-qualify the
      // next fresh frame for a contact/release edge.
      this.lightingStableFrames = 0;
      this.stableHandFrames = 0;
    }
    const smoothLm = this.landmarkFilter.filter(lm, result.timestampMs);
    this.drawLandmarks(smoothLm);

    const aspectRatio = Math.max(0.1, this.video.videoWidth / Math.max(1, this.video.videoHeight));
    const rawGeometry = measureHandGeometry(lm, {
      aspectRatio,
      worldLandmarks: result.worldLandmarks,
    });
    const smoothGeometry = measureHandGeometry(smoothLm, {
      aspectRatio,
      worldLandmarks: result.worldLandmarks,
    });
    this.lastPalmScale = smoothGeometry.palmScale;
    if (gestureTimely) this.stableHandFrames = Math.min(120, this.stableHandFrames + 1);
    const rawPinch = rawGeometry.rawPinch;
    const settings = this.settings;
    const smoothPinch = this.pinchFilter.filter(rawPinch, result.timestampMs);
    // Strong threshold crossings should react on the current frame; smoothing
    // remains active inside the hysteresis band to reject ordinary shimmer.
    const pinch = rawPinch <= settings.pinchOn
      ? Math.min(rawPinch, smoothPinch)
      : rawPinch >= settings.pinchOff
        ? Math.max(rawPinch, smoothPinch)
        : smoothPinch;
    const thumb = lm[4];
    const index = lm[8];
    // The exact index tip is the interaction point. Direction and palm angle
    // are measured separately, so the cursor is never shifted backward along
    // the finger by DIP/PIP weighting.
    const cameraPoint = normaliseCameraPoint({
      x: index.x,
      y: index.y,
    });
    const filtered = this.aimFilter.filter(cameraPoint, result.timestampMs);
    const sensitive = {
      x: Math.min(1, Math.max(0, 0.5 + (filtered.x - 0.5) * settings.sensitivity)),
      y: Math.min(1, Math.max(0, 0.5 + (filtered.y - 0.5) * settings.sensitivity)),
    };
    const filteredPoint = { x: settings.mirror ? sensitive.x : 1 - sensitive.x, y: sensitive.y };
    const classified = this.gestureFor(result.gesture, result.gestureScore, pinch, now);
    const fingertipsVisible = [thumb, index].every((point) => (
      point.x >= -0.04 && point.x <= 1.04 && point.y >= -0.04 && point.y <= 1.04
    ));
    const palmAnchorsVisible = [0, 5, 9, 17].filter((landmarkIndex) => {
      const point = lm[landmarkIndex];
      return point.x >= -0.04 && point.x <= 1.04 && point.y >= -0.04 && point.y <= 1.04;
    }).length >= 3;
    const palmPixels = Math.min(rawGeometry.palmScale, smoothGeometry.palmScale)
      * Math.max(1, this.lastCaptureHeight);
    const identity = this.identityStabilizer.update({
      timestampMs: result.timestampMs,
      label: result.handedness,
      score: result.handednessScore,
      palmX: smoothGeometry.palmCenter.x,
      palmY: smoothGeometry.palmCenter.y,
      palmScale: smoothGeometry.palmScale,
      lightingMode: result.lightingMode,
    });
    const confidence = classifyHandConfidence({
      landmarksComplete: validLandmarks,
      fingertipsVisible,
      palmAnchorsVisible,
      palmPixels,
      handednessScore: identity.trusted ? identity.score : 0,
      gestureScore: classified.score,
      stableFrames: this.stableHandFrames,
      inferenceMs: result.inferenceMs,
      targetFps: settings.targetFps,
      lightingMode: result.lightingMode,
      gestureTimely,
    });

    this.latestSample = {
      timestampMs: result.timestampMs,
      x: filteredPoint.x,
      y: filteredPoint.y,
      pinch,
      rawPinch,
      filteredPinch: smoothPinch,
      palmX: smoothGeometry.palmCenter.x,
      palmY: smoothGeometry.palmCenter.y,
      mirrorX: settings.mirror,
      rawPalmScale: rawGeometry.palmScale,
      palmScale: smoothGeometry.palmScale,
      palmPixels,
      pinchDepth: rawGeometry.pinchDepth,
      pinch3d: rawGeometry.pinch3d,
      depthSource: rawGeometry.depthSource,
      pointingAngle: smoothGeometry.indexAngleDeg,
      handRoll: smoothGeometry.palmRollDeg,
      depth: smoothGeometry.nearDepth,
      fingertipsVisible,
      palmAnchorsVisible,
      gesture: classified.gesture,
      gestureScore: classified.score,
      direction: this.directionFor(filteredPoint.x, filteredPoint.y, result.timestampMs),
      handedness: identity.identity,
      handednessScore: identity.trusted ? identity.score : 0,
      inferenceMs: result.inferenceMs,
      trackingFps: this.trackingFps,
      lightingMode: result.lightingMode,
      enhanced: result.enhanced,
      confidenceState: confidence.state,
      confidence: confidence.score,
      usableForGesture: confidence.usableForGesture,
      gestureStable: this.lightingStableFrames >= 1,
    };
    this.sampleSequence++;
    this.latestSampleAt = now;
  }

  /** Schedule one worker frame and return only newly completed recognition. */
  sample(): HandSample | null {
    const now = performance.now();
    this.runMaintenance(now);
    if (!this.wanted || !this.workerReady || !this.camReady) return null;
    this.startVideoPump();
    this.scheduleFrame(now);
    if (this.sampleSequence === this.consumedSequence) return null;
    this.consumedSequence = this.sampleSequence;
    return this.latestSample;
  }

  /** Return the latest still-fresh recognition without consuming it. */
  peekSample(maxAgeMs = 150): HandSample | null {
    const now = performance.now();
    this.runMaintenance(now);
    if (!this.wanted || !this.workerReady || !this.camReady) return null;
    this.startVideoPump();
    this.scheduleFrame(now);
    if (!this.latestSample || now - this.latestSampleAt > maxAgeMs) return null;
    return this.latestSample;
  }

  async cameras(): Promise<MediaDeviceInfo[]> {
    if (!navigator.mediaDevices?.enumerateDevices) return [];
    return (await navigator.mediaDevices.enumerateDevices()).filter((device) => device.kind === 'videoinput');
  }
}

let instance: HandTracker | null = null;
export function getHandTracker(): HandTracker {
  if (!instance) instance = new HandTracker();
  return instance;
}
export type { HandTracker };

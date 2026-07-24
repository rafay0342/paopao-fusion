import { notifyLocalSaveChanged } from './save-events';

export interface HandSettings {
  deviceId: string;
  mirror: boolean;
  dominantHand: 'left' | 'right' | 'either';
  sensitivity: number;
  preview: boolean;
  targetFps: 15 | 20 | 30;
  pinchOn: number;
  pinchOff: number;
  calibrated: boolean;
  calibrationRevision: number;
}

export const HAND_CALIBRATION_ALGORITHM_REVISION = 3;
const HAND_CALIBRATION_REVISION_STRIDE = 1_000_000_000_000_000;
export const HAND_CALIBRATION_PROFILE_REVISION_FLOOR = (
  HAND_CALIBRATION_ALGORITHM_REVISION * HAND_CALIBRATION_REVISION_STRIDE
);

// v14 removes the over-tight contact calibration shipped by v13. Preserve
// camera/UI preferences, but reset old gesture thresholds so a hard first
// pinch can never make ordinary later pinches impossible.
const KEY = 'paopao-fusion-hand-settings-v14';
const LEGACY_KEYS = ['paopao-fusion-hand-settings-v13', 'paopao-fusion-hand-settings-v12'] as const;
const MIN_CONTACT_HYSTERESIS = 0.03;
const MAX_CONTACT_HYSTERESIS = 0.1;
const defaults: HandSettings = {
  deviceId: '',
  mirror: true,
  dominantHand: 'either',
  sensitivity: 1,
  preview: false,
  targetFps: 30,
  pinchOn: 0.44,
  pinchOff: 0.5,
  calibrated: false,
  calibrationRevision: 0,
};

const safeCalibrationRevision = (value: unknown): number => {
  const revision = Number(value);
  return Number.isSafeInteger(revision)
    && revision >= HAND_CALIBRATION_PROFILE_REVISION_FLOOR
    ? revision
    : 0;
};

const nextCalibrationRevision = (previous: number): number => (
  Math.max(
    HAND_CALIBRATION_PROFILE_REVISION_FLOOR + Date.now(),
    safeCalibrationRevision(previous) + 1,
  )
);

function safePinchThresholds(pinchOn: unknown, pinchOff: unknown): Pick<HandSettings, 'pinchOn' | 'pinchOff'> {
  const onValue = Number(pinchOn);
  const offValue = Number(pinchOff);
  const safeOn = Math.min(0.58, Math.max(0.34, Number.isFinite(onValue) ? onValue : defaults.pinchOn));
  const requestedOff = Number.isFinite(offValue) ? offValue : defaults.pinchOff;
  const safeOff = Math.min(
    0.74,
    Math.max(
      safeOn + MIN_CONTACT_HYSTERESIS,
      Math.min(requestedOff, safeOn + MAX_CONTACT_HYSTERESIS),
    ),
  );
  return { pinchOn: safeOn, pinchOff: safeOff };
}

export function getHandSettings(): HandSettings {
  try {
    const current = localStorage.getItem(KEY);
    const legacy = current == null
      ? LEGACY_KEYS.map((key) => localStorage.getItem(key)).find((value) => value != null) ?? null
      : null;
    const saved = JSON.parse(current ?? legacy ?? '{}') as Partial<HandSettings>;
    const migrated = current == null && legacy != null;
    const thresholds = migrated
      ? { pinchOn: defaults.pinchOn, pinchOff: defaults.pinchOff }
      : safePinchThresholds(saved.pinchOn, saved.pinchOff);
    const calibrationRevision = migrated ? 0 : safeCalibrationRevision(saved.calibrationRevision);
    return {
      ...defaults, ...saved,
      sensitivity: Math.min(1.6, Math.max(0.6, Number(saved.sensitivity) || 1)),
      targetFps: [15, 20, 30].includes(Number(saved.targetFps)) ? Number(saved.targetFps) as 15 | 20 | 30 : 30,
      calibrated: saved.calibrated === true && calibrationRevision > 0,
      calibrationRevision,
      ...thresholds,
    };
  } catch { return { ...defaults }; }
}

export function updateHandSettings(patch: Partial<HandSettings>): HandSettings {
  const patched = { ...getHandSettings(), ...patch };
  let calibrationRevision = safeCalibrationRevision(patched.calibrationRevision);
  if (patch.calibrated === true && calibrationRevision === 0) {
    calibrationRevision = nextCalibrationRevision(0);
  } else if (patch.calibrated === false) {
    calibrationRevision = 0;
  }
  const next = {
    ...patched,
    ...safePinchThresholds(patched.pinchOn, patched.pinchOff),
    calibrated: patched.calibrated === true && calibrationRevision > 0,
    calibrationRevision,
  };
  try { localStorage.setItem(KEY, JSON.stringify(next)); }
  catch { /* the normalized return value and event still update the active UI */ }
  notifyLocalSaveChanged();
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('paopao:hand-settings', { detail: next }));
  return next;
}

const safeCalibrationNoise = (value: number): number => (
  Math.min(0.05, Math.max(0, Number(value) || 0))
);

/** Minimum measured touch-to-release range that can contain every safety margin. */
export function minimumContactCalibrationGap(
  separatedNoise = 0.008,
  pinchedNoise = 0.008,
): number {
  const contactNoise = safeCalibrationNoise(pinchedNoise);
  const releaseNoise = safeCalibrationNoise(separatedNoise);
  const entryMargin = Math.min(0.04, Math.max(0.02, contactNoise * 2.5));
  const releaseMargin = Math.min(0.07, Math.max(0.035, Math.max(contactNoise, releaseNoise) * 4));
  const releaseGuard = Math.max(0.005, releaseNoise * 2);
  return entryMargin + releaseMargin + releaseGuard;
}

export function calibrateHand(
  separatedDistance: number,
  pinchedDistance: number,
  separatedNoise = 0.008,
  pinchedNoise = 0.008,
): HandSettings | null {
  if (![separatedDistance, pinchedDistance, separatedNoise, pinchedNoise].every(Number.isFinite)) return null;
  const contact = Math.min(separatedDistance, pinchedDistance);
  const separated = Math.max(separatedDistance, pinchedDistance);
  const contactNoise = safeCalibrationNoise(pinchedNoise);
  const releaseNoise = safeCalibrationNoise(separatedNoise);
  const entryMargin = Math.min(0.04, Math.max(0.02, contactNoise * 2.5));
  const releaseMargin = Math.min(0.07, Math.max(0.035, Math.max(contactNoise, releaseNoise) * 4));
  if (separated - contact < minimumContactCalibrationGap(releaseNoise, contactNoise)) return null;
  // A camera-specific calibration may broaden contact, but must never narrow
  // it into a tiny "hard pinch only" target. Captures without enough space
  // above this safe floor are rejected and the production defaults remain.
  const pinchOn = Math.max(0.38, contact + entryMargin);
  const pinchOff = Math.min(
    pinchOn + releaseMargin,
    separated - Math.max(0.005, releaseNoise * 2),
  );
  const thresholds = safePinchThresholds(pinchOn, pinchOff);
  const releaseGuard = Math.max(0.005, releaseNoise * 2);
  // The settings sanitizer has an absolute lower bound. Reject unusually tiny
  // captures if that bound would move RELEASE beyond the captured gap.
  if (thresholds.pinchOff > separated - releaseGuard) return null;
  const current = getHandSettings();
  return updateHandSettings({
    ...thresholds,
    calibrated: true,
    calibrationRevision: nextCalibrationRevision(current.calibrationRevision),
  });
}

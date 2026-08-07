import type { BootstrapV3, LiveEventConfigV3, RunReceiptV3, RunSubmissionV3 } from './contracts';
import {
  ENDLESS_REPLAY_RULES,
  aimLaneForMilliDegrees,
  angleMilliDegreesForLane,
  buildEndlessTargetSequence,
  simulateEndlessReplay,
  validateEndlessShotTrace,
  type EndlessModifierV1,
  type EndlessShotV1,
} from '../../shared/runtime/endless-replay.mjs';

export {
  ENDLESS_REPLAY_RULES,
  aimLaneForMilliDegrees,
  angleMilliDegreesForLane,
  buildEndlessTargetSequence,
  simulateEndlessReplay,
  validateEndlessShotTrace,
};
export type { EndlessModifierV1, EndlessShotV1 };

export interface EndlessSessionV3 {
  contentVersion: string;
  seasonId: string;
  seed: number;
  level: number;
  maximumShots: number;
  pointsPerRewardTier: number;
  serverTimeOffsetMs: number;
  startsAt: string;
  endsAt: string;
  modifier: EndlessModifierV1;
  event?: LiveEventConfigV3;
}

export type EndlessSessionResolutionV3 =
  | { ok: true; session: EndlessSessionV3 }
  | { ok: false; error: string };

const signedIntegrityShape = (value: unknown): boolean => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const integrity = value as Record<string, unknown>;
  return integrity.algorithm === 'Ed25519'
    && typeof integrity.keyId === 'string' && integrity.keyId.length >= 8
    && typeof integrity.publicKey === 'string' && /^[A-Za-z0-9_-]{48,128}$/.test(integrity.publicKey)
    && typeof integrity.contentHash === 'string' && /^[a-f0-9]{64}$/.test(integrity.contentHash)
    && typeof integrity.signature === 'string' && /^[A-Za-z0-9_-]{80,128}$/.test(integrity.signature);
};

function canonicalizeIntegrityPayload(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalizeIntegrityPayload);
  if (!value || typeof value !== 'object') return value;
  const source = value as Record<string, unknown>;
  return Object.fromEntries(Object.keys(source).sort().map((key) => [key, canonicalizeIntegrityPayload(source[key])]));
}

function base64UrlBytes(value: string): ArrayBuffer {
  const padded = `${value.replace(/-/g, '+').replace(/_/g, '/')}${'='.repeat((4 - value.length % 4) % 4)}`;
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes.buffer;
}

function hex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Verify a detached public-key signature before any live configuration is consumed. */
export async function verifySignedPayloadV3(value: unknown): Promise<boolean> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const source = value as Record<string, unknown>;
  if (!signedIntegrityShape(source.integrity)) return false;
  const integrity = source.integrity as BootstrapV3['content']['integrity'];
  const payload = { ...source };
  delete payload.integrity;
  try {
    const encodedHash = new TextEncoder().encode(JSON.stringify(canonicalizeIntegrityPayload(payload)));
    const contentHash = hex(await crypto.subtle.digest('SHA-256', encodedHash));
    if (contentHash !== integrity.contentHash) return false;
    const key = await crypto.subtle.importKey(
      'spki',
      base64UrlBytes(integrity.publicKey),
      { name: 'Ed25519' },
      false,
      ['verify'],
    );
    return crypto.subtle.verify(
      { name: 'Ed25519' },
      key,
      base64UrlBytes(integrity.signature),
      new TextEncoder().encode(contentHash),
    );
  } catch { return false; }
}

const activeAt = (startsAt: string, endsAt: string, timestampMs: number): boolean => {
  const start = Date.parse(startsAt);
  const end = Date.parse(endsAt);
  return Number.isFinite(start) && Number.isFinite(end) && start <= timestampMs && timestampMs < end;
};

/**
 * Resolve only a signed, rules-compatible server bootstrap into playable data.
 * Public-key verification is performed by getBootstrapV3 before this resolver
 * sees the envelope. Shape checks are repeated here so bypassing that fetch
 * path still fails closed on unsigned configuration.
 */
export function resolveEndlessSessionV3(
  bootstrap: BootstrapV3,
  preferEvent: boolean,
  clientNowMs = Date.now(),
): EndlessSessionResolutionV3 {
  if (!bootstrap || bootstrap.apiVersion !== 3 || !Number.isFinite(Date.parse(bootstrap.serverTime))) {
    return { ok: false, error: 'bootstrap-invalid' };
  }
  if (bootstrap.account?.authenticated !== true) return { ok: false, error: 'authentication-required' };
  if (!signedIntegrityShape(bootstrap.content?.integrity) || !signedIntegrityShape(bootstrap.live?.integrity)) {
    return { ok: false, error: 'signed-config-required' };
  }
  if (bootstrap.content.clients?.classic?.status !== 'production'
    || !bootstrap.content.modes?.includes('endless')
    || bootstrap.live.features?.endless !== true) {
    return { ok: false, error: 'endless-unavailable' };
  }
  const endless = bootstrap.live.endless;
  if (!endless || endless.rulesVersion !== ENDLESS_REPLAY_RULES.rulesVersion
    || endless.replayVersion !== ENDLESS_REPLAY_RULES.replayVersion
    || endless.maximumShots !== ENDLESS_REPLAY_RULES.maximumShots
    || endless.aimMilliDegrees?.minimum !== ENDLESS_REPLAY_RULES.aimMinimumMilliDegrees
    || endless.aimMilliDegrees?.maximum !== ENDLESS_REPLAY_RULES.aimMaximumMilliDegrees
    || !Number.isSafeInteger(endless.seed) || endless.seed < 0 || endless.seed > 0x7fffffff
    || typeof endless.seasonId !== 'string' || !endless.seasonId
    || !activeAt(endless.startsAt, endless.endsAt, Date.parse(bootstrap.serverTime))) {
    return { ok: false, error: 'endless-rules-incompatible' };
  }
  const serverNowMs = Date.parse(bootstrap.serverTime);
  const activeEvents = bootstrap.live.events.filter((event) => event.kind === 'event-boss'
    && Number.isSafeInteger(event.seed) && event.seed >= 0 && event.seed <= 0x7fffffff
    && Number.isInteger(event.level) && event.level >= 0 && event.level < 42
    && typeof event.submissionToken === 'string' && event.submissionToken.length >= 32
    && ['mirror-orbs', 'short-fuse', 'precision-plus'].includes(event.modifier)
    && activeAt(event.startsAt, event.endsAt, serverNowMs));
  const event = preferEvent ? activeEvents[0] : undefined;
  if (preferEvent && (!event || bootstrap.live.features.liveEvents !== true)) {
    return { ok: false, error: 'live-event-unavailable' };
  }
  const modifier = event?.modifier as EndlessModifierV1 | undefined;
  return {
    ok: true,
    session: {
      contentVersion: bootstrap.content.contentVersion,
      seasonId: endless.seasonId,
      seed: event?.seed ?? endless.seed,
      level: event?.level ?? (endless.seed % 30),
      maximumShots: endless.maximumShots,
      pointsPerRewardTier: endless.pointsPerRewardTier,
      serverTimeOffsetMs: serverNowMs - clientNowMs,
      startsAt: event?.startsAt ?? endless.startsAt,
      endsAt: event?.endsAt ?? endless.endsAt,
      modifier: modifier ?? null,
      ...(event ? { event } : {}),
    },
  };
}

export interface EndlessHexCell {
  row: number;
  lane: number;
  x: number;
  y: number;
}

export interface EndlessHexGrid {
  columns: 11;
  rows: number;
  radius: number;
  horizontalSpacing: number;
  verticalSpacing: number;
  cells: EndlessHexCell[];
}

/** Mathematical eleven-lane presentation grid shared by scene and tests. */
export function createEndlessHexGrid(width: number, top: number, rows = 7): EndlessHexGrid {
  const safeWidth = Math.max(360, Number.isFinite(width) ? width : 720);
  const safeRows = Math.max(4, Math.min(10, Math.trunc(rows)));
  const margin = Math.max(30, safeWidth * 0.0625);
  const horizontalSpacing = (safeWidth - margin * 2) / 10.5;
  const radius = horizontalSpacing * 0.43;
  const verticalSpacing = horizontalSpacing * 0.86;
  const cells: EndlessHexCell[] = [];
  for (let row = 0; row < safeRows; row += 1) {
    const offset = row % 2 === 1 ? horizontalSpacing / 2 : 0;
    for (let lane = 0; lane < ENDLESS_REPLAY_RULES.laneCount; lane += 1) {
      cells.push({ row, lane, x: margin + offset + lane * horizontalSpacing, y: top + row * verticalSpacing });
    }
  }
  return { columns: 11, rows: safeRows, radius, horizontalSpacing, verticalSpacing, cells };
}

export function endlessLaneForBoardX(grid: EndlessHexGrid, x: number): number {
  const firstRow = grid.cells.filter(({ row }) => row === 0);
  return firstRow.reduce((best, cell) => (
    Math.abs(cell.x - x) < Math.abs(firstRow[best].x - x) ? cell.lane : best
  ), 0);
}

export type EndlessTraceRecordResult =
  | { ok: true; shot: EndlessShotV1 }
  | { ok: false; error: string; retryAfterMs?: number };

export type EndlessTraceSealResult =
  | { ok: true; durationMs: number; shotTrace: EndlessShotV1[] }
  | { ok: false; error: string; retryAfterMs?: number };

/** Monotonic timestamp recorder. Wall-clock values never enter a shot trace. */
export class EndlessTraceRecorder {
  private readonly trace: EndlessShotV1[] = [];
  private sealed = false;

  constructor(
    private readonly startedAtMs: number,
    private readonly maximumShots = ENDLESS_REPLAY_RULES.maximumShots,
  ) {
    if (!Number.isFinite(startedAtMs)) throw new Error('replay-start-invalid');
  }

  recordLane(lane: number, nowMs: number): EndlessTraceRecordResult {
    if (this.sealed) return { ok: false, error: 'replay-already-sealed' };
    if (this.trace.length >= this.maximumShots) return { ok: false, error: 'replay-shot-limit-exceeded' };
    if (!Number.isFinite(nowMs)) return { ok: false, error: 'replay-timestamp-invalid' };
    const atMs = Math.floor(nowMs - this.startedAtMs);
    const previousAtMs = this.trace[this.trace.length - 1]?.atMs ?? 0;
    const minimum = this.trace.length === 0
      ? ENDLESS_REPLAY_RULES.minimumFirstShotMs
      : ENDLESS_REPLAY_RULES.minimumShotIntervalMs;
    const interval = atMs - previousAtMs;
    if (interval < minimum) return { ok: false, error: 'replay-shot-too-soon', retryAfterMs: minimum - interval };
    if (interval > ENDLESS_REPLAY_RULES.maximumShotIntervalMs) return { ok: false, error: 'replay-shot-window-expired' };
    const shot = {
      sequence: this.trace.length,
      atMs,
      angleMilliDegrees: angleMilliDegreesForLane(lane),
    };
    this.trace.push(shot);
    return { ok: true, shot: { ...shot } };
  }

  snapshot(): EndlessShotV1[] {
    return this.trace.map((shot) => ({ ...shot }));
  }

  seal(nowMs: number): EndlessTraceSealResult {
    if (this.sealed) return { ok: false, error: 'replay-already-sealed' };
    if (!this.trace.length) return { ok: false, error: 'replay-empty' };
    const durationMs = Math.max(500, Math.floor(nowMs - this.startedAtMs));
    const lastAtMs = this.trace[this.trace.length - 1].atMs;
    const settlementMs = durationMs - lastAtMs;
    if (settlementMs < ENDLESS_REPLAY_RULES.minimumSettlementMs) {
      return {
        ok: false,
        error: 'replay-settlement-pending',
        retryAfterMs: ENDLESS_REPLAY_RULES.minimumSettlementMs - settlementMs,
      };
    }
    const validity = validateEndlessShotTrace(this.trace, durationMs);
    if (!validity.ok) return { ok: false, error: validity.error };
    this.sealed = true;
    return { ok: true, durationMs, shotTrace: this.snapshot() };
  }
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  const source = value as Record<string, unknown>;
  return Object.fromEntries(Object.keys(source).sort().map((key) => [key, canonicalize(source[key])]));
}

export function canonicalEndlessReplayPayload(run: RunSubmissionV3): Record<string, unknown> {
  if (run.mode !== 'endless' || !run.contentVersion || !run.seasonId
    || !Number.isInteger(run.seed) || !Number.isInteger(run.wave) || !run.shotTrace) {
    throw new Error('endless-replay-fields-required');
  }
  return {
    replayVersion: ENDLESS_REPLAY_RULES.replayVersion,
    rulesVersion: ENDLESS_REPLAY_RULES.rulesVersion,
    contentVersion: run.contentVersion,
    seasonId: run.seasonId,
    seed: run.seed,
    level: run.level,
    mode: run.mode,
    wave: run.wave,
    durationMs: run.durationMs,
    shotTrace: run.shotTrace,
    ...(run.eventId ? { eventId: run.eventId } : {}),
  };
}

export function canonicalEndlessReplayJson(run: RunSubmissionV3): string {
  return JSON.stringify(canonicalize(canonicalEndlessReplayPayload(run)));
}

async function sha256Hex(value: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error('web-crypto-unavailable');
  const digest = await subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export interface EndlessRunDraftV3 {
  runId: string;
  client: 'classic';
  level: number;
  durationMs: number;
  contentVersion: string;
  seasonId: string;
  seed: number;
  shotTrace: EndlessShotV1[];
  createdAt: string;
  event?: LiveEventConfigV3;
}

/**
 * Run the same authority used by Node, then bind its exact claims to SHA-256.
 * Callers cannot accidentally submit a render-derived score or rounded angle.
 */
export async function finalizeEndlessRunSubmission(draft: EndlessRunDraftV3): Promise<RunSubmissionV3> {
  const simulation = simulateEndlessReplay({
    seed: draft.seed,
    level: draft.level,
    durationMs: draft.durationMs,
    shotTrace: draft.shotTrace,
    modifier: draft.event?.modifier as EndlessModifierV1 | undefined,
    eventBoss: Boolean(draft.event),
  });
  if (!simulation.ok) throw new Error(simulation.error);
  const result = simulation.result;
  const submission: RunSubmissionV3 = {
    runId: draft.runId,
    client: draft.client,
    level: draft.level,
    mode: 'endless',
    score: result.score,
    durationMs: draft.durationMs,
    won: result.won,
    shots: result.shots,
    hits: result.hits,
    contentVersion: draft.contentVersion,
    seasonId: draft.seasonId,
    seed: draft.seed,
    wave: result.wave,
    replayVersion: ENDLESS_REPLAY_RULES.replayVersion,
    shotTrace: draft.shotTrace,
    ...(draft.event ? { eventId: draft.event.id, challengeToken: draft.event.submissionToken } : {}),
    createdAt: draft.createdAt,
  };
  submission.replayHash = await sha256Hex(canonicalEndlessReplayJson(submission));
  return submission;
}

export type SubmitRunV3 = (submission: RunSubmissionV3) => Promise<RunReceiptV3>;

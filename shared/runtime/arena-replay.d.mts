export interface ArenaShotV1 {
  seq: number;
  atMs: number;
  angleMilliDegrees: number;
}

export interface ArenaReplayResultV1 {
  replayVersion: 1;
  rulesVersion: 1;
  score: number;
  hits: number;
  shots: number;
  maxCombo: number;
  stateChecksum: string;
}

export const ARENA_REPLAY_RULES: Readonly<{
  replayVersion: 1;
  rulesVersion: 1;
  aimMinimumMilliDegrees: number;
  aimMaximumMilliDegrees: number;
  maximumShots: number;
  minimumFirstShotMs: number;
  minimumShotIntervalMs: number;
  maximumShotIntervalMs: number;
  maximumFutureLeadMs: number;
  maximumReconnectAgeMs: number;
}>;

export function validateArenaShotTrace(
  shotTrace: readonly ArenaShotV1[],
): { ok: true } | { ok: false; error: string; sequence?: number };

export function buildArenaTargetSequence(input: {
  seed: number;
  level: number;
  shotCount: number;
}): Array<{
  sequence: number;
  wave: number;
  lane: number;
  angleMilliDegrees: number;
  colorIndex: number;
  pressure: number;
  toleranceLanes: number;
  fuseMs: number | null;
}>;

export function simulateArenaReplay(input: {
  seed: number;
  level: number;
  shotTrace: readonly ArenaShotV1[];
}): {
  ok: true;
  result: ArenaReplayResultV1;
  outcomes: Array<Record<string, number | boolean>>;
} | { ok: false; error: string; sequence?: number };

export function appendArenaShot(input: {
  seed: number;
  level: number;
  shotTrace: readonly ArenaShotV1[];
  shot: ArenaShotV1;
}): {
  ok: true;
  result: ArenaReplayResultV1;
  outcomes: Array<Record<string, number | boolean>>;
  shotTrace: ArenaShotV1[];
} | { ok: false; error: string; sequence?: number };

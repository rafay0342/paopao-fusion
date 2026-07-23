export interface EndlessShotV1 {
  sequence: number;
  atMs: number;
  angleMilliDegrees: number;
}

export type EndlessModifierV1 = 'mirror-orbs' | 'short-fuse' | 'precision-plus' | null;

export interface EndlessReplayResultV1 {
  rulesVersion: 1;
  score: number;
  hits: number;
  shots: number;
  wave: number;
  won: boolean;
  maxCombo: number;
  seasonPoints: number;
  boss: { maxHp: number; hp: number } | null;
  stateChecksum: string;
}

export const ENDLESS_REPLAY_RULES: Readonly<{
  replayVersion: 1;
  rulesVersion: 1;
  aimMinimumMilliDegrees: number;
  aimMaximumMilliDegrees: number;
  laneCount: number;
  shotsPerWave: number;
  maximumShots: number;
  minimumFirstShotMs: number;
  minimumShotIntervalMs: number;
  maximumShotIntervalMs: number;
  minimumSettlementMs: number;
  maximumSettlementMs: number;
}>;

export function createMulberry32(seed: number): () => number;
export function aimLaneForMilliDegrees(angleMilliDegrees: number): number;
export function angleMilliDegreesForLane(lane: number): number;
export function buildEndlessTargetSequence(input: {
  seed: number;
  shotCount: number;
  modifier?: EndlessModifierV1;
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
export function validateEndlessShotTrace(
  shotTrace: readonly EndlessShotV1[],
  durationMs: number,
): { ok: true } | { ok: false; error: string; sequence?: number };
export function simulateEndlessReplay(input: {
  seed: number;
  level: number;
  durationMs: number;
  shotTrace: readonly EndlessShotV1[];
  modifier?: EndlessModifierV1;
  eventBoss?: boolean;
}): {
  ok: true;
  result: EndlessReplayResultV1;
  outcomes: Array<Record<string, number | boolean>>;
} | { ok: false; error: string; sequence?: number };
export function buildPerfectEndlessTrace(input: {
  seed: number;
  shotCount: number;
  modifier?: EndlessModifierV1;
  firstAtMs?: number;
  cadenceMs?: number;
}): EndlessShotV1[];

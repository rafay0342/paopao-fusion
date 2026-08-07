export interface ClassicAuthorityShot { sequence: number; atMs: number; angleMilliDegrees: number }
export interface ClassicAuthorityTarget { sequence: number; lane: number; angleMilliDegrees: number; toleranceLanes: number }
export const CLASSIC_AUTHORITY_RULES: Readonly<{
  rulesVersion: number; ticketTtlMs: number; maximumShots: number; minimumFirstShotMs: number;
  minimumShotIntervalMs: number; maximumShotIntervalMs: number; maximumFutureLeadMs: number;
  minimumServerReceiptIntervalMs: number; targetToleranceLanes: number;
}>;
export function classicAuthorityRequiredShots(level: number): number;
export function classicAuthorityMinimumDurationMs(level: number): number;
export function classicAuthorityTarget(input: { seed: number; level: number; sequence: number }):
  | { ok: true; target: ClassicAuthorityTarget }
  | { ok: false; error: string };
export function evaluateClassicAuthorityTrace(input: { seed: number; level: number; shotTrace: ClassicAuthorityShot[] }):
  | { ok: true; result: { rulesVersion: number; shots: number; proofHits: number; requiredShots: number; requiredProofHits: number; completed: boolean; outcomes: Array<{ sequence: number; lane: number; targetLane: number; hit: boolean }> } }
  | { ok: false; error: string; sequence?: number };

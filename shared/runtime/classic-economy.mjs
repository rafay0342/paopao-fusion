export const CLASSIC_FIRST_CLEAR_REWARD_SOURCE = 'classic-first-clear';
export const CLASSIC_FIRST_CLEAR_REWARD_CURRENCY = 'coins';
export const CLASSIC_CAMPAIGN_LEVEL_COUNT = 42;

function normalizedClassicLevel(level) {
  const numeric = Number(level);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(CLASSIC_CAMPAIGN_LEVEL_COUNT - 1, Math.trunc(numeric)));
}

/**
 * Canonical first-clear wallet reward shared by the Phaser map and server
 * settlement. This is an account-bound, verified, once-per-level reward.
 */
export function classicFirstClearReward(level) {
  return 120 + normalizedClassicLevel(level) * 8;
}

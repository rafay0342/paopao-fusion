export type WorldVisualState = 'corrupted' | 'restored';
export type WorldPresentationMode = 'bubble-shooter' | 'match3';

export interface WorldPresentationRequest {
  worldId: string;
  worldIndex: number;
  finalLevel: number;
  clearedLevels: readonly number[];
  mode: WorldPresentationMode;
  backgroundKey: string;
}

export interface WorldPresentation {
  worldId: string;
  worldIndex: number;
  state: WorldVisualState;
  intensity: number;
  accent: number;
  shadow: number;
  fog: number;
  ember: number;
  backgroundKey: string;
  atmosphereKey: string;
  label: string;
  guidance: string;
  motionSeed: number;
}

interface WorldPresentationProfile {
  accent: number;
  shadow: number;
  fog: number;
  ember: number;
  motionSeed: number;
}

/**
 * Presentation data only. These values never enter simulation, rewards,
 * saves, hand tracking or input timing.
 */
export const WORLD_PRESENTATION_PROFILES: Readonly<Record<string, WorldPresentationProfile>> = Object.freeze({
  crystal: Object.freeze({
    accent: 0x8b72d8,
    shadow: 0x160d35,
    fog: 0x304e79,
    ember: 0x7df3ff,
    motionSeed: 11,
  }),
  emerald: Object.freeze({
    accent: 0x5fba8e,
    shadow: 0x081f1b,
    fog: 0x153d39,
    ember: 0x8df2c0,
    motionSeed: 23,
  }),
  celestial: Object.freeze({
    accent: 0x718bdb,
    shadow: 0x101936,
    fog: 0x263b6a,
    ember: 0xa6e7ff,
    motionSeed: 37,
  }),
  ember: Object.freeze({
    accent: 0xc2515d,
    shadow: 0x2b0d17,
    fog: 0x3d1a2b,
    ember: 0xffa46f,
    motionSeed: 53,
  }),
  frost: Object.freeze({
    accent: 0x6c9bcf,
    shadow: 0x09182e,
    fog: 0x29496a,
    ember: 0xb8f3ff,
    motionSeed: 71,
  }),
  nexus: Object.freeze({
    accent: 0x8e6bd1,
    shadow: 0x090815,
    fog: 0x25204f,
    ember: 0x7eeaff,
    motionSeed: 97,
  }),
});

function safeIndex(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(5, Math.trunc(value))) : 0;
}

function isCleared(level: number, clearedLevels: readonly number[]): boolean {
  return Number.isInteger(level) && clearedLevels.some((candidate) => candidate === level);
}

export function resolveWorldPresentation(request: WorldPresentationRequest): WorldPresentation {
  const worldIndex = safeIndex(request.worldIndex);
  const profile = WORLD_PRESENTATION_PROFILES[request.worldId] ?? WORLD_PRESENTATION_PROFILES.crystal;
  const state: WorldVisualState = isCleared(request.finalLevel, request.clearedLevels)
    ? 'restored'
    : 'corrupted';
  const intensity = state === 'restored'
    ? 0.14
    : Math.min(0.84, 0.46 + worldIndex * 0.065);
  return Object.freeze({
    worldId: request.worldId,
    worldIndex,
    state,
    intensity,
    accent: profile.accent,
    shadow: profile.shadow,
    fog: profile.fog,
    ember: profile.ember,
    backgroundKey: request.backgroundKey,
    atmosphereKey: `${request.backgroundKey}_atmosphere`,
    label: state === 'restored' ? 'REALM RESTORED' : 'REALM NEEDS RESTORING',
    guidance: state === 'restored'
      ? 'REPLAY A STAGE OR CONTINUE TO THE NEXT REALM'
      : `CLEAR THE FINAL ${request.mode === 'match3' ? 'PUZZLE' : 'STAGE'} TO RESTORE THIS REALM`,
    motionSeed: profile.motionSeed,
  });
}

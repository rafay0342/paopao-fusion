declare const __PAOPAO_RELEASE_GATE__: 1 | 2 | 3 | 4 | 5;
declare const __PAOPAO_RELEASE_FEATURES__: {
  foundation: true;
  completeGameplay: boolean;
  cinematicPresentation: boolean;
  endlessLiveOperations: boolean;
  productionHardening: boolean;
};

export type PhaserReleaseGate = 1 | 2 | 3 | 4 | 5;

export const PHASER_RELEASE_GATE: PhaserReleaseGate = __PAOPAO_RELEASE_GATE__;
export const PHASER_RELEASE_FEATURES = Object.freeze({ ...__PAOPAO_RELEASE_FEATURES__ });

export function releaseGateAtLeast(gate: PhaserReleaseGate): boolean {
  return PHASER_RELEASE_GATE >= gate;
}


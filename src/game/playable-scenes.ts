export const ACTIVE_GAMEPLAY_SCENE_KEYS = Object.freeze([
  'Game',
  'Match3',
  'Endless',
  'MemoryConstellation',
] as const);

const ACTIVE_GAMEPLAY_SCENES: ReadonlySet<string> = new Set(ACTIVE_GAMEPLAY_SCENE_KEYS);

export function isActiveGameplayScene(sceneKey: string): boolean {
  return ACTIVE_GAMEPLAY_SCENES.has(sceneKey);
}

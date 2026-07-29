import Phaser from 'phaser';
import { VIEW } from '../config';
import type { RenderQuality } from './meta';

export interface RenderSurfaceEnvironment {
  devicePixelRatio: number;
  hardwareConcurrency: number;
  deviceMemoryGb: number | null;
  viewportPixels: number;
}

const finitePositive = (value: unknown, fallback: number): number => {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
};

export function normalizeRenderSurfaceEnvironment(
  value: Partial<RenderSurfaceEnvironment> = {},
): RenderSurfaceEnvironment {
  const memory = Number(value.deviceMemoryGb);
  return {
    devicePixelRatio: Math.min(4, finitePositive(value.devicePixelRatio, 1)),
    hardwareConcurrency: Math.min(64, Math.max(1, Math.trunc(finitePositive(value.hardwareConcurrency, 2)))),
    deviceMemoryGb: Number.isFinite(memory) && memory > 0 ? Math.min(64, memory) : null,
    viewportPixels: Math.min(100_000_000, Math.trunc(finitePositive(value.viewportPixels, 921_600))),
  };
}

/**
 * Select the immutable backing-surface scale used for this Phaser boot.
 *
 * Gameplay and MediaPipe coordinates stay on the 720x1280 logical plane.
 * Quality may downgrade scene effects live, but a sharper backing surface is
 * only selected on the next boot so no shot, cascade or gesture is disturbed.
 */
export function selectRenderSurfaceResolution(
  quality: RenderQuality,
  environment: Partial<RenderSurfaceEnvironment> = {},
): 1 | 1.25 | 1.5 {
  const env = normalizeRenderSurfaceEnvironment(environment);
  if (quality === 'performance') return 1;
  if (quality === 'balanced') {
    return env.devicePixelRatio >= 1.2 && env.hardwareConcurrency >= 4 ? 1.25 : 1;
  }
  const memoryPass = env.deviceMemoryGb === null || env.deviceMemoryGb >= 4;
  const pixelBudgetPass = env.viewportPixels <= 12_000_000;
  return env.devicePixelRatio >= 1.35
    && env.hardwareConcurrency >= 4
    && memoryPass
    && pixelBudgetPass
    ? 1.5
    : env.devicePixelRatio >= 1.15 && env.hardwareConcurrency >= 4
      ? 1.25
      : 1;
}

export function currentRenderSurfaceResolution(quality: RenderQuality): 1 | 1.25 | 1.5 {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return 1;
  const extendedNavigator = navigator as Navigator & { deviceMemory?: number };
  const viewportWidth = Math.max(window.innerWidth || 0, window.screen?.width || 0, 1);
  const viewportHeight = Math.max(window.innerHeight || 0, window.screen?.height || 0, 1);
  return selectRenderSurfaceResolution(quality, {
    devicePixelRatio: window.devicePixelRatio || 1,
    hardwareConcurrency: navigator.hardwareConcurrency || 2,
    deviceMemoryGb: extendedNavigator.deviceMemory ?? null,
    viewportPixels: viewportWidth * viewportHeight,
  });
}

/**
 * Phaser 3.90 has no supported `GameConfig.resolution` property. We therefore
 * allocate a larger renderer and zoom every scene camera back onto the shared
 * 720x1280 logical plane. Pointer world coordinates, deterministic boards and
 * MediaPipe mappings stay unchanged while WebGL receives a denser framebuffer.
 */
export function installLogicalRenderSurface(
  game: Phaser.Game,
  resolution: 1 | 1.25 | 1.5,
): void {
  const listeners: Array<{ scene: Phaser.Scene; apply: () => void }> = [];
  const applyTo = (scene: Phaser.Scene): void => {
    const camera = scene.cameras?.main;
    if (!camera) return;
    camera
      .setViewport(0, 0, VIEW.width * resolution, VIEW.height * resolution)
      .setZoom(resolution)
      .centerOn(VIEW.width / 2, VIEW.height / 2);
  };
  for (const scene of game.scene.scenes) {
    const apply = (): void => applyTo(scene);
    // CameraManager consumes START before this listener, so restarted cameras
    // are ready here. CREATE reapplies after user composition in case scene
    // code changed camera state. The immediate call is required for Boot,
    // whose preload UI is already LOADING when postBoot installs this hook.
    scene.events.on(Phaser.Scenes.Events.START, apply);
    scene.events.on(Phaser.Scenes.Events.CREATE, apply);
    listeners.push({ scene, apply });
    apply();
  }
  game.canvas.dataset.paopaoRenderSurface = String(resolution);
  game.events.once(Phaser.Core.Events.DESTROY, () => {
    listeners.forEach(({ scene, apply }) => {
      scene.events.off(Phaser.Scenes.Events.START, apply);
      scene.events.off(Phaser.Scenes.Events.CREATE, apply);
    });
  });
}

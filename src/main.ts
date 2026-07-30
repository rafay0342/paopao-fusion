import Phaser from 'phaser';
import { VIEW } from './config';
import { BootScene } from './scenes/BootScene';
import { MenuScene } from './scenes/MenuScene';
import { WorldMapScene } from './scenes/WorldMapScene';
import { GameScene } from './scenes/GameScene';
import { ModeSelectScene } from './scenes/ModeSelectScene';
import { StoreScene } from './scenes/StoreScene';
import { GalleryScene } from './scenes/GalleryScene';
import { ProductionArchiveScene } from './scenes/ProductionArchiveScene';
import { ProductionExperienceScene } from './scenes/ProductionExperienceScene';
import { ProductionSystemsScene } from './scenes/ProductionSystemsScene';
import { RewardsScene } from './scenes/RewardsScene';
import { ChallengesScene } from './scenes/ChallengesScene';
import { CompetitiveScene } from './scenes/CompetitiveScene';
import { EndlessScene } from './scenes/EndlessScene';
import { StoryScene } from './scenes/StoryScene';
import { ChronicleScene } from './scenes/ChronicleScene';
import { EndingScene } from './scenes/EndingScene';
import { AccountScene } from './scenes/AccountScene';
import { InventoryScene } from './scenes/InventoryScene';
import { IntroScene } from './scenes/IntroScene';
import { HandSetupScene } from './scenes/HandSetupScene';
import { GazeSetupScene } from './scenes/GazeSetupScene';
import { Match3MapScene } from './scenes/Match3MapScene';
import { Match3Scene } from './scenes/Match3Scene';
import { ArcadeHubScene } from './scenes/ArcadeHubScene';
import { MemoryConstellationScene } from './scenes/MemoryConstellationScene';
import { registerOfflineShell } from './game/offline';
import { installNavigation } from './game/navigation';
import { runtimePerformance } from './game/performance';
import { getHandTracker, type VisionTrackingMode } from './game/handtracking';
import { getPlatformAccount } from './game/platform';
import { initializeClassicPlayerSaveV4 } from './game/save-v4';
import { PHASER_RELEASE_FEATURES, PHASER_RELEASE_GATE } from './game/release-profile';
import { currentRenderSurfaceResolution, installLogicalRenderSurface } from './game/render-surface';
import { getMeta } from './game/meta';
import {
  CANVAS_FALLBACK_SESSION_KEY,
  RenderContextRecoveryController,
  applyRenderContextBudget,
  buildCanvasFallbackUrl,
  claimCanvasFallbackUrl,
  createRenderRecoveryOverlay,
  isCanvasFallbackRequested,
  type RenderContextReport,
} from './game/render-context';

const canvasFallbackRequested = isCanvasFallbackRequested(window.location.search);
const renderSurfaceResolution = canvasFallbackRequested
  ? 1
  : currentRenderSurfaceResolution(getMeta().quality);

const config: Phaser.Types.Core.GameConfig = {
  type: canvasFallbackRequested ? Phaser.CANVAS : Phaser.AUTO,
  parent: 'game',
  backgroundColor: '#211044',
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: VIEW.width * renderSurfaceResolution,
    height: VIEW.height * renderSurfaceResolution,
  },
  render: {
    antialias: true,
    antialiasGL: true,
    roundPixels: false,
    mipmapFilter: 'LINEAR_MIPMAP_LINEAR',
    powerPreference: 'high-performance',
  },
  fps: {
    target: 60,
    min: 30,
    limit: 0,
    smoothStep: true,
    deltaHistory: 120,
    panicMax: 120,
  },
  callbacks: {
    postBoot: (game) => installLogicalRenderSurface(game, renderSurfaceResolution),
  },
  scene: [
    BootScene,
    ...(PHASER_RELEASE_FEATURES.cinematicPresentation ? [IntroScene] : []),
    MenuScene,
    ModeSelectScene,
    StoryScene,
    AccountScene,
    GazeSetupScene,
    HandSetupScene,
    WorldMapScene,
    GameScene,
    ...(PHASER_RELEASE_FEATURES.completeGameplay ? [
      Match3MapScene,
      Match3Scene,
      ArcadeHubScene,
      MemoryConstellationScene,
      ChronicleScene,
      EndingScene,
      InventoryScene,
      StoreScene,
      RewardsScene,
      ChallengesScene,
      CompetitiveScene,
    ] : []),
    ...(PHASER_RELEASE_FEATURES.cinematicPresentation ? [GalleryScene] : []),
    ...(PHASER_RELEASE_FEATURES.endlessLiveOperations ? [EndlessScene] : []),
    ...(PHASER_RELEASE_FEATURES.productionHardening ? [
      ProductionArchiveScene,
      ProductionExperienceScene,
      ProductionSystemsScene,
    ] : []),
  ],
};

registerOfflineShell();

const FONT_STARTUP_BUDGET_MS = 1800;

async function waitForGameFonts(): Promise<boolean> {
  if (typeof document === 'undefined' || !document.fonts?.load) return false;

  let timeoutId = 0;
  const timeout = new Promise<false>((resolve) => {
    timeoutId = window.setTimeout(() => resolve(false), FONT_STARTUP_BUDGET_MS);
  });
  const requestedFonts = Promise.all([
    document.fonts.load('700 48px "PaoPao Display"', 'PAOPAO FUSION'),
    document.fonts.load('400 18px "Fusion Sans"', 'Restoring the realm gateway'),
    document.fonts.load('700 18px "Fusion Sans"', 'READY'),
  ]).then((faces) => faces.every((faceSet) => faceSet.length > 0), () => false);

  try {
    return await Promise.race([requestedFonts, timeout]);
  } finally {
    window.clearTimeout(timeoutId);
  }
}

type WebGLRendererProbe = Phaser.Renderer.WebGL.WebGLRenderer & {
  gl?: WebGLRenderingContext | WebGL2RenderingContext;
};

function rendererContextIsLost(game: Phaser.Game): boolean {
  if (game.renderer.type !== Phaser.WEBGL) return false;
  const renderer = game.renderer as WebGLRendererProbe;
  try {
    return renderer.contextLost === true || renderer.gl?.isContextLost() === true;
  } catch {
    // A throwing context probe is not healthy enough to report a passing frame.
    return true;
  }
}

function resetActiveSceneInput(game: Phaser.Game): void {
  for (const scene of game.scene.getScenes(true)) {
    scene.input?.resetPointers();
    scene.input?.keyboard?.resetKeys();
  }
}

function safeSessionStorage(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function installRenderContextRecovery(game: Phaser.Game): RenderContextRecoveryController {
  const renderer = game.renderer.type === Phaser.WEBGL ? 'webgl' : 'canvas';
  let loopWasRunning = false;
  let inputWasEnabled = false;
  let trackingModeToResume: VisionTrackingMode | null = null;
  let pausedVideos: Phaser.GameObjects.Video[] = [];

  const forceCanvasFallback = (): boolean => {
    const target = claimCanvasFallbackUrl(window.location.href, safeSessionStorage());
    if (!target) return false;
    window.location.replace(target);
    return true;
  };
  const manualCanvasFallback = (): void => {
    try {
      safeSessionStorage()?.setItem(CANVAS_FALLBACK_SESSION_KEY, String(Date.now()));
    } catch { /* the query parameter is still a complete loop guard */ }
    window.location.replace(buildCanvasFallbackUrl(window.location.href));
  };
  const overlay = createRenderRecoveryOverlay(document, manualCanvasFallback);
  const context = new RenderContextRecoveryController({
    renderer,
    onSuspend: () => {
      loopWasRunning = game.loop.running;
      inputWasEnabled = game.input.enabled;
      const tracker = getHandTracker();
      const handState = tracker.getDiagnostics().lifecycleState;
      // Model-only prewarm must never become an implicit camera request after
      // graphics recovery. Resume only a tracker the player had explicitly
      // enabled and that was actively starting, running, or recovering.
      trackingModeToResume = tracker.isWanted()
        && (handState === 'active' || handState === 'warming' || handState === 'recovering')
        ? tracker.getActiveMode()
        : null;
      pausedVideos = [];
      for (const scene of game.scene.getScenes(true)) {
        for (const child of scene.children.list) {
          if (child instanceof Phaser.GameObjects.Video && child.video && !child.video.paused) {
            child.pause();
            pausedVideos.push(child);
          }
        }
      }
      resetActiveSceneInput(game);
      game.input.enabled = false;
      window.dispatchEvent(new CustomEvent('paopao:render-context-boundary', { detail: { phase: 'lost' } }));
      tracker.suspend();
      game.loop.sleep();
    },
    onResume: () => {
      window.dispatchEvent(new CustomEvent('paopao:render-context-boundary', { detail: { phase: 'restored' } }));
      resetActiveSceneInput(game);
      game.input.enabled = inputWasEnabled;
      if (loopWasRunning) {
        game.loop.wake();
        game.loop.resetDelta();
      }
      for (const video of pausedVideos) {
        if (video.active && video.video && !video.video.ended) video.resume();
      }
      pausedVideos = [];
      if (trackingModeToResume) {
        void getHandTracker().enable(trackingModeToResume).catch((error: unknown) => {
          console.warn('Camera tracking did not resume after graphics recovery.', error);
        });
      }
      trackingModeToResume = null;
    },
    onFallback: forceCanvasFallback,
    onStatus: (report: RenderContextReport) => overlay.update(report),
  });

  if (renderer === 'webgl') {
    const webglRenderer = game.renderer as Phaser.Renderer.WebGL.WebGLRenderer;
    const handleRendererLost = (): void => context.rendererLost();
    const handleRendererRestored = (): void => context.rendererRestored();
    const handleCanvasLost = (event: Event): void => {
      event.preventDefault();
      context.canvasLost();
    };
    const handleCanvasRestored = (): void => context.canvasRestored();
    webglRenderer.on(Phaser.Renderer.Events.LOSE_WEBGL, handleRendererLost);
    webglRenderer.on(Phaser.Renderer.Events.RESTORE_WEBGL, handleRendererRestored);
    game.canvas.addEventListener('webglcontextlost', handleCanvasLost);
    game.canvas.addEventListener('webglcontextrestored', handleCanvasRestored);
    game.events.once(Phaser.Core.Events.DESTROY, () => {
      webglRenderer.off(Phaser.Renderer.Events.LOSE_WEBGL, handleRendererLost);
      webglRenderer.off(Phaser.Renderer.Events.RESTORE_WEBGL, handleRendererRestored);
      game.canvas.removeEventListener('webglcontextlost', handleCanvasLost);
      game.canvas.removeEventListener('webglcontextrestored', handleCanvasRestored);
      context.destroy();
      overlay.remove();
    });
  } else {
    game.events.once(Phaser.Core.Events.DESTROY, () => {
      context.destroy();
      overlay.remove();
    });
  }

  return context;
}

async function startGame(): Promise<void> {
  initializeClassicPlayerSaveV4();
  // Existing HttpOnly-cookie sessions resume in the background. Gameplay boot
  // never waits for the network, while an authenticated response performs the
  // revision-aware V4 GET/PUT merge before account UI refreshes.
  void getPlatformAccount(true);
  // Hand and gaze models are intentionally demand-loaded from their explicit
  // controls. A normal touch session should not spend mobile GPU, memory or
  // network budget on vision features the player never enabled.
  const fontsReady = await waitForGameFonts();
  document.documentElement.dataset.gameFonts = fontsReady ? 'ready' : 'fallback';
  document.documentElement.dataset.gameBuild = `level-100-r${PHASER_RELEASE_GATE}`;
  document.documentElement.dataset.releaseGate = String(PHASER_RELEASE_GATE);

  // eslint-disable-next-line no-new
  const game = new Phaser.Game(config);
  game.canvas.tabIndex = 0;
  game.canvas.setAttribute('role', 'application');
  game.canvas.setAttribute('aria-label', 'PaoPao Fusion interactive game canvas');
  installNavigation(game);
  const renderContext = installRenderContextRecovery(game);
  game.events.on(Phaser.Core.Events.POST_STEP, () => {
    runtimePerformance.sample(game);
    renderContext.observeContextLost(rendererContextIsLost(game));
  });

  // Read-only production diagnostics are intentionally available to soak and
  // support tooling. They contain counters only: no save, account or camera
  // frame data is exposed.
  if (PHASER_RELEASE_FEATURES.productionHardening) {
    Object.defineProperty(window, '__PAOPAO_PRODUCTION__', {
      configurable: false,
      enumerable: false,
      writable: false,
      value: Object.freeze({
        schemaVersion: 2,
        client: 'classic',
        releaseGate: PHASER_RELEASE_GATE,
        releaseFeatures: PHASER_RELEASE_FEATURES,
        report: () => {
          const context = renderContext.observeContextLost(rendererContextIsLost(game));
          const activeScenes = game.scene.getScenes(true);
          const canvasBounds = game.canvas.getBoundingClientRect();
          return {
            ...applyRenderContextBudget(runtimePerformance.report(), context),
            activeScenes: activeScenes.map((scene) => scene.scene.key),
            renderer: context.renderer,
            renderSurface: {
              scale: renderSurfaceResolution,
              backingWidth: game.canvas.width,
              backingHeight: game.canvas.height,
              cssWidth: canvasBounds.width,
              cssHeight: canvasBounds.height,
              cameras: activeScenes.map((scene) => {
                const camera = scene.cameras.main;
                return {
                  scene: scene.scene.key,
                  viewport: {
                    x: camera.x,
                    y: camera.y,
                    width: camera.width,
                    height: camera.height,
                  },
                  zoom: { x: camera.zoomX, y: camera.zoomY },
                  scroll: { x: camera.scrollX, y: camera.scrollY },
                  worldView: {
                    x: camera.worldView.x,
                    y: camera.worldView.y,
                    width: camera.worldView.width,
                    height: camera.worldView.height,
                  },
                };
              }),
            },
            context,
            contextStatus: context.status,
            contextLost: context.contextLost,
            contextLossCount: context.lossCount,
            contextRestoredCount: context.restoredCount,
            contextLastLossAt: context.lostAt,
            contextLastRestoredAt: context.lastRestoredAt,
          };
        },
      }),
    });
  }
}

void startGame().catch((error: unknown) => {
  console.error('PaoPao Fusion could not start.', error);
  window.dispatchEvent(new CustomEvent('paopao:startup-error'));
});

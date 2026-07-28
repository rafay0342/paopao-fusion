import Phaser from 'phaser';
import { VIEW } from '../config';
import { hostedAssetUrl } from '../game/hostedAsset';
import { stopMusic, unlockMusic } from '../game/music';
import { DISPLAY_FONT, TYPE, UI_FONT } from '../gfx/ui';
import { containVideoLayout } from '../gfx/videoLayout';

const VIDEO_ASSET_PATH = 'assets/cinematics/paopao-opening-final-light-1080.mp4';
const VIDEO_URL = hostedAssetUrl(VIDEO_ASSET_PATH);
const POSTER_TEXTURE = 'intro_poster';
const INTRO_WATCHDOG_MS = 60_000;
export const INTRO_SEEN_KEY = 'paopao:intro-seen:v13';

type IntroPlaybackState = 'loading' | 'buffering' | 'autoplay-locked' | 'playing' | 'offline' | 'error';

interface NetworkInformationLike {
  saveData?: boolean;
  effectiveType?: string;
}

interface IntroWindow extends Window {
  __PAOPAO_INTRO_1080_URL__?: string;
}

interface IntroImportMeta extends ImportMeta {
  env?: {
    VITE_INTRO_VIDEO_1080_URL?: string;
  };
}

const STATE_COPY: Record<IntroPlaybackState, readonly [string, string]> = {
  loading: ['AWAKENING THE AURORA CROWN…', 'PREPARING THE STORY ARCHIVE'],
  buffering: ['BUFFERING STORY ARCHIVE', 'HOLDING THE CURRENT FRAME'],
  'autoplay-locked': ['TAP TO PLAY THE CINEMATIC', 'A BROWSER GESTURE IS REQUIRED'],
  playing: ['', ''],
  offline: ['STORY ARCHIVE OFFLINE', 'ENTERING THE REALMS…'],
  error: ['CINEMATIC UNAVAILABLE', 'ENTERING THE REALMS…'],
};

function configuredHdSource(): string | undefined {
  const runtimeSource = typeof window === 'undefined'
    ? undefined
    : (window as IntroWindow).__PAOPAO_INTRO_1080_URL__;
  const buildSource = (import.meta as IntroImportMeta).env?.VITE_INTRO_VIDEO_1080_URL;
  const source = (runtimeSource ?? buildSource ?? '').trim();
  return source || undefined;
}

/**
 * The bundled source is the web-light 1080p render of the final 4K clean
 * stitch. A deployment may still provide an alternate 1080 URL, while every
 * remote attempt retains the bundled final render as its fallback.
 */
function introVideoSources(): string[] {
  const hdSource = configuredHdSource();
  if (!hdSource || typeof navigator === 'undefined' || typeof window === 'undefined') return [VIDEO_URL];

  const connection = (navigator as Navigator & { connection?: NetworkInformationLike }).connection;
  const constrained = navigator.onLine === false
    || connection?.saveData === true
    || /(?:^|-)2g$|3g$/.test(connection?.effectiveType ?? '');
  const displayBenefitsFromHd = (window.devicePixelRatio || 1) >= 1.5
    || Math.max(window.innerWidth, window.innerHeight) >= 1080;

  if (constrained || !displayBenefitsFromHd || hdSource === VIDEO_URL) return [VIDEO_URL];
  return [hdSource, VIDEO_URL];
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function cover(image: Phaser.GameObjects.Image, width: number, height: number): void {
  image.setScale(Math.max(width / image.width, height / image.height));
}

/** Autoplay-safe opening story, shown once automatically and replayable later. */
export class IntroScene extends Phaser.Scene {
  constructor() {
    super('Intro');
  }

  create(): void {
    const { width, height } = VIEW;
    const reducedMotion = prefersReducedMotion();
    const sources = introVideoSources();
    let sourceIndex = -1;
    let leaving = false;
    let terminalFailure = false;
    let handlingSourceFailure = false;
    let soundEnabled = false;
    let autoplayLocked = false;
    let firstFrameVisible = false;
    let playbackState: IntroPlaybackState | null = null;
    let boundMedia: HTMLVideoElement | null = null;
    stopMusic();

    this.cameras.main.setBackgroundColor(0x030513);

    // The poster is loaded by Boot, so this scene never opens on an empty
    // canvas. Existing world art and finally a solid field are safe fallbacks.
    let poster: Phaser.GameObjects.Image | Phaser.GameObjects.Rectangle;
    if (this.textures.exists(POSTER_TEXTURE)) {
      const image = this.add.image(width / 2, height / 2, POSTER_TEXTURE).setDepth(1);
      cover(image, width, height);
      poster = image;
    } else if (this.textures.exists('world_crystal')) {
      const image = this.add.image(width / 2, height / 2, 'world_crystal').setDepth(1);
      cover(image, width, height);
      poster = image;
    } else {
      poster = this.add.rectangle(width / 2, height / 2, width, height, 0x080b20, 1).setDepth(1);
    }

    const video = this.add.video(width / 2, height / 2).setDepth(3).setAlpha(0);

    // Static grading keeps controls readable across poster and video. There is
    // intentionally no sweeping highlight, shimmer or full-screen white flash.
    const grade = this.add.graphics().setDepth(5);
    grade.fillGradientStyle(0x030513, 0x030513, 0x030513, 0x030513, 0.18, 0.18, 0.03, 0.03);
    grade.fillRect(0, 0, width, height * 0.44);
    grade.fillGradientStyle(0x030513, 0x030513, 0x030513, 0x030513, 0, 0, 0.62, 0.62);
    grade.fillRect(0, height - 290, width, 290);

    const topShade = this.add.rectangle(width / 2, 48, width, 96, 0x030513, 0.64).setDepth(6);
    const chapter = this.add.text(28, 31, 'THE SHATTERED CROWN', {
      fontFamily: DISPLAY_FONT,
      fontSize: TYPE.caption,
      color: '#ffe7a6',
      fontStyle: 'bold',
      letterSpacing: 1.5,
    }).setDepth(7).setShadow(0, 2, '#000000', 5);

    const stateY = Math.round(height * 0.73);
    const statePlate = this.add.rectangle(width / 2, stateY, 470, 82, 0x070b1d, 0.9)
      .setStrokeStyle(1, 0xd9ad55, 0.7)
      .setDepth(7);
    const stateAccent = this.add.rectangle(width / 2, stateY - 39, 138, 2, 0xd9ad55, 0.9).setDepth(8);
    const stateTitle = this.add.text(width / 2, stateY - 9, STATE_COPY.loading[0], {
      fontFamily: UI_FONT,
      fontSize: TYPE.label,
      color: '#f4dfaa',
      fontStyle: 'bold',
      letterSpacing: 1,
      align: 'center',
    }).setOrigin(0.5).setDepth(8).setShadow(0, 2, '#000000', 5);
    const stateHint = this.add.text(width / 2, stateY + 20, STATE_COPY.loading[1], {
      fontFamily: UI_FONT,
      fontSize: TYPE.caption,
      color: '#aab8cf',
      fontStyle: 'bold',
      letterSpacing: 0.8,
      align: 'center',
    }).setOrigin(0.5).setDepth(8);
    const stateObjects: Array<Phaser.GameObjects.Rectangle | Phaser.GameObjects.Text> = [
      statePlate,
      stateAccent,
      stateTitle,
      stateHint,
    ];

    const setState = (next: IntroPlaybackState): void => {
      if (playbackState === next || leaving) return;
      playbackState = next;
      const [title, hint] = STATE_COPY[next];
      stateTitle.setText(title);
      stateHint.setText(hint);
      this.tweens.killTweensOf(stateObjects);

      if (next === 'playing') {
        if (reducedMotion) stateObjects.forEach((item) => item.setAlpha(0));
        else this.tweens.add({ targets: stateObjects, alpha: 0, duration: 180, ease: 'Quad.easeOut' });
        return;
      }

      if (reducedMotion) stateObjects.forEach((item) => item.setAlpha(1));
      else this.tweens.add({ targets: stateObjects, alpha: 1, duration: 160, ease: 'Quad.easeOut' });
    };

    const finish = (): void => {
      if (leaving) return;
      leaving = true;
      try {
        window.localStorage.setItem(INTRO_SEEN_KEY, '1');
      } catch { /* private storage modes still get a complete in-memory handoff */ }
      video.setMute(true);

      // Keep the final video frame (or poster) in place until the camera has
      // completed its handoff; stopping first is what creates a black gap.
      if (reducedMotion) {
        video.stop();
        this.scene.start('Menu');
        return;
      }
      this.cameras.main.fadeOut(240, 3, 5, 19);
      this.time.delayedCall(245, () => {
        video.stop();
        this.scene.start('Menu');
      });
    };

    const skipBg = this.add.rectangle(width - 77, 48, 126, 48, 0x080b20, 0.9)
      .setStrokeStyle(2, 0xd9ad55, 0.86)
      .setDepth(8)
      .setInteractive({ useHandCursor: true });
    const skipText = this.add.text(width - 77, 48, 'SKIP  ›', {
      fontFamily: UI_FONT,
      fontSize: TYPE.label,
      color: '#ffe7a6',
      fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(9);
    skipBg.on('pointerup', finish);
    skipText.setInteractive({ useHandCursor: true }).on('pointerup', finish);

    const soundBg = this.add.rectangle(width / 2, height - 58, 260, 48, 0x080b20, 0.88)
      .setStrokeStyle(2, 0x62f3ef, 0.72)
      .setDepth(8)
      .setInteractive({ useHandCursor: true });
    const soundText = this.add.text(width / 2, height - 58, '♪  TAP FOR SOUND', {
      fontFamily: UI_FONT,
      fontSize: TYPE.caption,
      color: '#a9ffff',
      fontStyle: 'bold',
      letterSpacing: 0.7,
    }).setOrigin(0.5).setDepth(9);

    const updateSoundLabel = (): void => {
      if (autoplayLocked) soundText.setText('▶  TAP TO PLAY WITH SOUND');
      else soundText.setText(soundEnabled ? '♪  SOUND ON  •  TAP TO MUTE' : '♪  TAP FOR SOUND');
      soundBg.setStrokeStyle(2, soundEnabled ? 0xffd77a : 0x62f3ef, 0.78);
    };

    const toggleSound = (): void => {
      if (leaving || terminalFailure) return;
      soundEnabled = !soundEnabled;
      video.setMute(!soundEnabled);
      if (video.video) video.video.defaultMuted = !soundEnabled;
      if (soundEnabled || autoplayLocked) {
        autoplayLocked = false;
        video.play(false);
      }
      if (soundEnabled) void unlockMusic();
      updateSoundLabel();
    };
    soundBg.on('pointerup', toggleSound);
    soundText.setInteractive({ useHandCursor: true }).on('pointerup', toggleSound);

    this.add.rectangle(width / 2, height - 16, width - 48, 3, 0x263451, 0.8).setDepth(8);
    const progressFill = this.add.rectangle(24, height - 16, width - 48, 3, 0x62f3ef, 0.92)
      .setOrigin(0, 0.5)
      .setScale(0, 1)
      .setDepth(9);

    const revealVideo = (): void => {
      if (firstFrameVisible || leaving || terminalFailure) return;
      firstFrameVisible = true;
      autoplayLocked = false;
      updateSoundLabel();
      setState('playing');
      if (reducedMotion) {
        video.setAlpha(1);
        poster.setAlpha(0);
      } else {
        this.tweens.add({ targets: video, alpha: 1, duration: 320, ease: 'Quad.easeOut' });
        this.tweens.add({ targets: poster, alpha: 0, duration: 520, ease: 'Quad.easeOut' });
      }
    };

    const showTerminalFailure = (): void => {
      if (leaving || terminalFailure) return;
      terminalFailure = true;
      autoplayLocked = false;
      soundBg.disableInteractive();
      soundText.disableInteractive();
      const offline = typeof navigator !== 'undefined' && navigator.onLine === false;

      this.tweens.killTweensOf([poster, video]);
      if (reducedMotion) {
        poster.setAlpha(1);
        video.setAlpha(0);
      } else {
        this.tweens.add({ targets: poster, alpha: 1, duration: 220, ease: 'Quad.easeOut' });
        this.tweens.add({ targets: video, alpha: 0, duration: 180, ease: 'Quad.easeOut' });
      }
      setState(offline ? 'offline' : 'error');
      soundText.setText(offline ? 'OFFLINE GUEST MODE' : 'CONTINUING WITHOUT VIDEO');
      this.time.delayedCall(reducedMotion ? 520 : 1_250, finish);
    };

    const handleWaiting = (): void => {
      if (firstFrameVisible && !autoplayLocked && !terminalFailure) setState('buffering');
    };
    const handleCanPlay = (): void => {
      if (firstFrameVisible && !autoplayLocked && !terminalFailure) setState('playing');
    };
    const unbindMedia = (): void => {
      if (!boundMedia) return;
      boundMedia.removeEventListener('waiting', handleWaiting);
      boundMedia.removeEventListener('stalled', handleWaiting);
      boundMedia.removeEventListener('playing', handleCanPlay);
      boundMedia.removeEventListener('canplay', handleCanPlay);
      boundMedia = null;
    };
    const bindMedia = (): void => {
      if (!video.video || boundMedia === video.video) return;
      unbindMedia();
      boundMedia = video.video;
      boundMedia.addEventListener('waiting', handleWaiting);
      boundMedia.addEventListener('stalled', handleWaiting);
      boundMedia.addEventListener('playing', handleCanPlay);
      boundMedia.addEventListener('canplay', handleCanPlay);
    };

    const loadNextSource = (): void => {
      if (leaving || terminalFailure) return;
      sourceIndex += 1;
      if (sourceIndex >= sources.length) {
        showTerminalFailure();
        return;
      }

      autoplayLocked = false;
      setState('loading');
      video.loadURL(sources[sourceIndex], true, 'anonymous').setMute(!soundEnabled);
      if (video.video) video.video.defaultMuted = !soundEnabled;
      bindMedia();
      video.play(false);
    };

    const handleSourceFailure = (): void => {
      if (leaving || terminalFailure || handlingSourceFailure) return;
      handlingSourceFailure = true;
      // If a higher-quality stream fails after it has shown frames, return to
      // key art before opening the bundled source. This keeps the retry itself
      // from flashing an empty video texture.
      firstFrameVisible = false;
      this.tweens.killTweensOf([poster, video]);
      poster.setAlpha(1);
      video.setAlpha(0);
      this.time.delayedCall(0, () => {
        handlingSourceFailure = false;
        loadNextSource();
      });
    };

    // Phaser's texture-ready event fires before it updates the Game Object
    // from its temporary 256x256 size to the native media dimensions. Scaling
    // there makes the following native-size update over-zoom the frame.
    // VIDEO_CREATED runs after setSizeToFrame, so one uniform contain scale
    // preserves the whole movie at every source aspect ratio.
    video.on(Phaser.GameObjects.Events.VIDEO_CREATED, (
      _gameVideo: Phaser.GameObjects.Video,
      sourceWidth: number,
      sourceHeight: number,
    ) => {
      const layout = containVideoLayout(sourceWidth, sourceHeight, width, height);
      video.setPosition(layout.x, layout.y);
      video.setScale(layout.scale);
    });
    video.on(Phaser.GameObjects.Events.VIDEO_PLAY, revealVideo);
    video.on(Phaser.GameObjects.Events.VIDEO_PLAYING, () => {
      // VIDEO_PLAY may not repeat when this object falls back from a failed
      // remote source to the bundled render, so reveal on active playback too.
      revealVideo();
      if (firstFrameVisible && !autoplayLocked) setState('playing');
    });
    video.on(Phaser.GameObjects.Events.VIDEO_LOCKED, () => {
      autoplayLocked = true;
      setState('autoplay-locked');
      updateSoundLabel();
    });
    video.once(Phaser.GameObjects.Events.VIDEO_COMPLETE, finish);
    video.on(Phaser.GameObjects.Events.VIDEO_ERROR, handleSourceFailure);
    video.on(Phaser.GameObjects.Events.VIDEO_UNSUPPORTED, handleSourceFailure);
    loadNextSource();

    const update = (): void => {
      if (leaving) return;
      const progress = Math.max(0, Math.min(1, video.getProgress()));
      progressFill.setScale(progress, 1);
      const titleReveal = Math.max(0, Math.min(1, (progress - 0.906) / 0.022));
      topShade.setAlpha(1 - titleReveal);
      chapter.setAlpha(1 - titleReveal);
    };
    this.events.on(Phaser.Scenes.Events.UPDATE, update);
    this.time.delayedCall(INTRO_WATCHDOG_MS, showTerminalFailure);

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.events.off(Phaser.Scenes.Events.UPDATE, update);
      unbindMedia();
      video.setMute(true);
      video.stop();
    });
  }
}

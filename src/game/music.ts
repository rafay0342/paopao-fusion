/**
 * PaoPao Fusion's global adaptive music player.
 *
 * The player owns a fixed two-channel pool so mood changes can crossfade without
 * leaking HTMLAudioElements. Playback is only attempted after a user gesture,
 * and every browser/storage/network failure degrades to silent gameplay.
 */

import { hostedAssetUrl } from './hostedAsset';

export type MusicMood = 'menu' | 'story' | 'game' | 'boss' | 'ending';

export interface MusicState {
  mood: MusicMood;
  muted: boolean;
  unlocked: boolean;
  playing: boolean;
}

const STORAGE_KEY = 'paopao.music.muted.v1';
const CROSSFADE_MS = 1_600;

const TRACKS: Record<MusicMood, { ogg: string; mp3: string; volume: number }> = {
  menu: {
    ogg: 'assets/audio/aurora-whispers-menu.ogg',
    mp3: 'assets/audio/aurora-whispers-menu.mp3',
    volume: 0.48,
  },
  story: {
    ogg: 'assets/audio/crown-memory-story.ogg',
    mp3: 'assets/audio/crown-memory-story.mp3',
    volume: 0.46,
  },
  game: {
    ogg: 'assets/audio/prism-pulse-game.ogg',
    mp3: 'assets/audio/prism-pulse-game.mp3',
    volume: 0.44,
  },
  boss: {
    ogg: 'assets/audio/nexus-awakens-boss.ogg',
    mp3: 'assets/audio/nexus-awakens-boss.mp3',
    volume: 0.50,
  },
  ending: {
    ogg: 'assets/audio/crown-restored-ending.ogg',
    mp3: 'assets/audio/crown-restored-ending.mp3',
    volume: 0.48,
  },
};

interface Channel {
  audio: HTMLAudioElement;
  mood: MusicMood | null;
}

let channels: [Channel, Channel] | null = null;
let activeChannel = 0;
let requestedMood: MusicMood = 'menu';
let started = false;
let unlocked = false;
let muted = readMutePreference();
let transitionId = 0;
let unlockListenersInstalled = false;
let visibilityListenerInstalled = false;

function readMutePreference(): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function saveMutePreference(): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, muted ? '1' : '0');
  } catch {
    // Private browsing and storage policies must never stop the game.
  }
}

function makeAssetUrl(path: string): string {
  const resolved = hostedAssetUrl(path);
  try {
    if (typeof document !== 'undefined') return new URL(resolved, document.baseURI).toString();
  } catch {
    // A relative path remains valid for ordinary same-origin hosting.
  }
  return resolved;
}

function createChannel(): Channel {
  const audio = new Audio();
  audio.preload = 'auto';
  audio.loop = true;
  audio.volume = 0;
  audio.muted = muted;
  return { audio, mood: null };
}

function ensureChannels(): [Channel, Channel] | null {
  if (channels) return channels;
  if (typeof Audio === 'undefined') return null;
  try {
    channels = [createChannel(), createChannel()];
    return channels;
  } catch {
    return null;
  }
}

function sourceFor(audio: HTMLAudioElement, mood: MusicMood): string {
  const track = TRACKS[mood];
  try {
    if (audio.canPlayType('audio/ogg; codecs="vorbis"')) return makeAssetUrl(track.ogg);
  } catch {
    // MP3 is the broad fallback below.
  }
  return makeAssetUrl(track.mp3);
}

function removeUnlockListeners(): void {
  if (!unlockListenersInstalled || typeof window === 'undefined') return;
  window.removeEventListener('pointerdown', gestureUnlock, true);
  window.removeEventListener('keydown', gestureUnlock, true);
  window.removeEventListener('touchend', gestureUnlock, true);
  unlockListenersInstalled = false;
}

function installUnlockListeners(): void {
  if (unlockListenersInstalled || typeof window === 'undefined') return;
  window.addEventListener('pointerdown', gestureUnlock, true);
  window.addEventListener('keydown', gestureUnlock, true);
  window.addEventListener('touchend', gestureUnlock, true);
  unlockListenersInstalled = true;
}

function gestureUnlock(): void {
  void unlockMusic();
}

function handleVisibilityChange(): void {
  if (typeof document === 'undefined') return;
  if (document.visibilityState === 'hidden') {
    ++transitionId;
    if (channels) {
      for (const channel of channels) {
        channel.audio.pause();
        channel.audio.volume = 0;
      }
    }
    return;
  }
  if (started && unlocked && !muted) void transitionTo(requestedMood);
}

function installVisibilityListener(): void {
  if (visibilityListenerInstalled || typeof document === 'undefined' || !document.addEventListener) return;
  document.addEventListener('visibilitychange', handleVisibilityChange);
  visibilityListenerInstalled = true;
}

function removeVisibilityListener(): void {
  if (!visibilityListenerInstalled || typeof document === 'undefined' || !document.removeEventListener) return;
  document.removeEventListener('visibilitychange', handleVisibilityChange);
  visibilityListenerInstalled = false;
}

function frame(callback: FrameRequestCallback): number {
  if (typeof requestAnimationFrame === 'function') return requestAnimationFrame(callback);
  return globalThis.setTimeout(() => callback(Date.now()), 16) as unknown as number;
}

function now(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

function fadeChannels(from: Channel | null, to: Channel, targetVolume: number): void {
  const id = ++transitionId;
  const startedAt = now();
  const fromVolume = from?.audio.volume ?? 0;

  const tick = (timestamp: number): void => {
    if (id !== transitionId) return;
    const elapsed = Math.max(0, timestamp - startedAt);
    const progress = Math.min(1, elapsed / CROSSFADE_MS);
    const angle = progress * Math.PI * 0.5;
    to.audio.volume = muted ? 0 : targetVolume * Math.sin(angle);
    if (from && from !== to) from.audio.volume = muted ? 0 : fromVolume * Math.cos(angle);

    if (progress < 1) {
      frame(tick);
      return;
    }

    to.audio.volume = muted ? 0 : targetVolume;
    if (from && from !== to) {
      from.audio.pause();
      from.audio.volume = 0;
    }
  };

  frame(tick);
}

async function transitionTo(mood: MusicMood): Promise<void> {
  if (!started || !unlocked || muted) return;
  const pool = ensureChannels();
  if (!pool) return;

  const current = pool[activeChannel];
  if (current.mood === mood && !current.audio.paused) {
    fadeChannels(null, current, TRACKS[mood].volume);
    return;
  }

  const nextIndex = current.mood === null && current.audio.paused ? activeChannel : 1 - activeChannel;
  const next = pool[nextIndex];
  try {
    next.audio.pause();
    next.audio.src = sourceFor(next.audio, mood);
    next.audio.currentTime = 0;
    next.audio.loop = true;
    next.audio.muted = false;
    next.audio.volume = 0;
    next.mood = mood;
    await next.audio.play();
    activeChannel = nextIndex;
    fadeChannels(current.mood === null ? null : current, next, TRACKS[mood].volume);
  } catch {
    // A browser can revoke autoplay permission or the device may be offline.
    unlocked = false;
    next.audio.pause();
    next.audio.volume = 0;
    installUnlockListeners();
  }
}

/** Queue and begin a music mood. If autoplay is locked, the first gesture unlocks it. */
export function startMusic(mood: MusicMood = 'menu'): MusicState {
  installVisibilityListener();
  requestedMood = mood;
  started = true;
  if (muted) return getMusicState();
  if (unlocked) void transitionTo(mood);
  else installUnlockListeners();
  return getMusicState();
}

/** Change music without restarting the global player or creating new channels. */
export function setMusicMood(mood: MusicMood): MusicState {
  requestedMood = mood;
  if (started && unlocked && !muted) void transitionTo(mood);
  return getMusicState();
}

/** Call from an explicit pointer/key handler when a scene has its own gesture flow. */
export async function unlockMusic(): Promise<MusicState> {
  unlocked = true;
  removeUnlockListeners();
  if (started && !muted) await transitionTo(requestedMood);
  return getMusicState();
}

/** Toggle the persisted music preference. Unmuting also counts as a user unlock. */
export function toggleMusic(): MusicState {
  muted = !muted;
  saveMutePreference();

  const pool = ensureChannels();
  if (pool) {
    for (const channel of pool) channel.audio.muted = muted;
  }

  if (muted) {
    ++transitionId;
    if (pool) {
      for (const channel of pool) {
        channel.audio.volume = 0;
        channel.audio.pause();
      }
    }
  } else {
    unlocked = true;
    removeUnlockListeners();
    if (started) void transitionTo(requestedMood);
  }
  return getMusicState();
}

export function getMusicState(): MusicState {
  const active = channels?.[activeChannel];
  return {
    mood: requestedMood,
    muted,
    unlocked,
    playing: Boolean(started && !muted && active && !active.audio.paused),
  };
}

/** Stops audio while retaining the user's mute preference. */
export function stopMusic(): MusicState {
  started = false;
  ++transitionId;
  removeUnlockListeners();
  if (channels) {
    for (const channel of channels) {
      channel.audio.pause();
      channel.audio.volume = 0;
    }
  }
  return getMusicState();
}

/** Test-only state reset; deliberately not used by game code. */
export function __resetMusicForTests(): void {
  stopMusic();
  removeVisibilityListener();
  channels = null;
  activeChannel = 0;
  requestedMood = 'menu';
  started = false;
  unlocked = false;
  muted = readMutePreference();
  transitionId = 0;
  unlockListenersInstalled = false;
  visibilityListenerInstalled = false;
}

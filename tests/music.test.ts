import { beforeEach, describe, expect, it, vi } from 'vitest';

class MemoryStorage {
  private values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

class MockAudio {
  static instances: MockAudio[] = [];
  src = '';
  preload = '';
  loop = false;
  volume = 1;
  muted = false;
  currentTime = 0;
  paused = true;
  shouldReject = false;

  constructor() { MockAudio.instances.push(this); }
  canPlayType(type: string): string { return type.includes('ogg') ? 'probably' : 'maybe'; }
  async play(): Promise<void> {
    if (this.shouldReject) throw new Error('autoplay denied');
    this.paused = false;
  }
  pause(): void { this.paused = true; }
}

type Handler = EventListenerOrEventListenerObject;
const listeners = new Map<string, Set<Handler>>();

function emit(type: string): void {
  for (const handler of listeners.get(type) ?? []) {
    if (typeof handler === 'function') handler(new Event(type));
    else handler.handleEvent(new Event(type));
  }
}

beforeEach(() => {
  vi.resetModules();
  MockAudio.instances = [];
  listeners.clear();
  Object.defineProperty(globalThis, 'localStorage', { value: new MemoryStorage(), configurable: true });
  Object.defineProperty(globalThis, 'document', {
    value: {
      baseURI: 'https://game.example/play/',
      visibilityState: 'visible',
      addEventListener(type: string, handler: Handler) {
        const group = listeners.get(type) ?? new Set<Handler>();
        group.add(handler);
        listeners.set(type, group);
      },
      removeEventListener(type: string, handler: Handler) { listeners.get(type)?.delete(handler); },
    },
    configurable: true,
  });
  Object.defineProperty(globalThis, 'window', {
    value: {
      addEventListener(type: string, handler: Handler) {
        const group = listeners.get(type) ?? new Set<Handler>();
        group.add(handler);
        listeners.set(type, group);
      },
      removeEventListener(type: string, handler: Handler) { listeners.get(type)?.delete(handler); },
    },
    configurable: true,
  });
  Object.defineProperty(globalThis, 'Audio', { value: MockAudio, configurable: true });
  Object.defineProperty(globalThis, 'requestAnimationFrame', {
    value: (callback: FrameRequestCallback) => {
      callback(performance.now() + 2_000);
      return 1;
    },
    configurable: true,
  });
});

describe('adaptive global music', () => {
  it('waits for a gesture, then starts the requested mood', async () => {
    const music = await import('../src/game/music');
    expect(music.startMusic('story')).toMatchObject({ mood: 'story', unlocked: false, playing: false });
    expect(MockAudio.instances).toHaveLength(0);

    emit('pointerdown');
    await Promise.resolve();
    await Promise.resolve();

    expect(MockAudio.instances).toHaveLength(2);
    expect(MockAudio.instances[0].src).toBe('https://game.example/play/assets/audio/crown-memory-story.ogg');
    expect(music.getMusicState()).toMatchObject({ mood: 'story', unlocked: true, playing: true });
  });

  it('crossfades moods through one reusable two-channel pool', async () => {
    const music = await import('../src/game/music');
    music.startMusic('menu');
    await music.unlockMusic();
    music.setMusicMood('game');
    await Promise.resolve();
    music.setMusicMood('boss');
    await Promise.resolve();

    expect(MockAudio.instances).toHaveLength(2);
    expect(MockAudio.instances.some((audio) => audio.src.endsWith('nexus-awakens-boss.ogg'))).toBe(true);
    expect(music.getMusicState().mood).toBe('boss');
  });

  it('persists mute and resumes the selected mood when unmuted', async () => {
    const music = await import('../src/game/music');
    music.startMusic('ending');
    await music.unlockMusic();
    expect(music.toggleMusic().muted).toBe(true);
    expect(localStorage.getItem('paopao.music.muted.v1')).toBe('1');
    expect(MockAudio.instances.every((audio) => audio.paused)).toBe(true);

    expect(music.toggleMusic()).toMatchObject({ mood: 'ending', muted: false, unlocked: true });
    await Promise.resolve();
    expect(MockAudio.instances.some((audio) => audio.src.endsWith('crown-restored-ending.ogg'))).toBe(true);
  });

  it('fails silently when browser audio is unavailable', async () => {
    Object.defineProperty(globalThis, 'Audio', { value: undefined, configurable: true });
    const music = await import('../src/game/music');
    expect(() => music.startMusic('menu')).not.toThrow();
    await expect(music.unlockMusic()).resolves.toMatchObject({ mood: 'menu', playing: false });
  });

  it('pauses in a hidden tab and resumes the requested mood when visible', async () => {
    const music = await import('../src/game/music');
    music.startMusic('game');
    await music.unlockMusic();
    expect(music.getMusicState().playing).toBe(true);

    Object.assign(document, { visibilityState: 'hidden' });
    emit('visibilitychange');
    expect(MockAudio.instances.every((audio) => audio.paused)).toBe(true);

    Object.assign(document, { visibilityState: 'visible' });
    emit('visibilitychange');
    await Promise.resolve();
    await Promise.resolve();
    expect(music.getMusicState().playing).toBe(true);
  });
});

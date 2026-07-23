/**
 * Procedural sound effects via the Web Audio API — no audio files required.
 * The AudioContext is created lazily and resumed on first use (a user gesture),
 * which satisfies browser autoplay rules.
 */

let ctx: AudioContext | null = null;
let muted = false;

function ac(): AudioContext | null {
  if (!ctx) {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (AC) ctx = new AC();
  }
  if (ctx && ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

function tone(freq: number, type: OscillatorType, start: number, dur: number, vol: number, end?: number): void {
  const c = ac();
  if (!c || muted) return;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, c.currentTime + start);
  if (end) o.frequency.exponentialRampToValueAtTime(end, c.currentTime + start + dur);
  g.gain.setValueAtTime(vol, c.currentTime + start);
  g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + start + dur);
  o.connect(g);
  g.connect(c.destination);
  o.start(c.currentTime + start);
  o.stop(c.currentTime + start + dur);
}

export const SFX = {
  shoot(): void {
    tone(150, 'sine', 0, 0.1, 0.28, 600);
  },
  /** Pop pitch rises with combo depth for a satisfying chain. */
  pop(combo = 0): void {
    const base = 523 * Math.pow(1.06, Math.min(combo, 8));
    [base, base * 1.26, base * 1.5].forEach((n, i) => tone(n, 'sine', i * 0.05, 0.28, 0.12));
  },
  drop(): void {
    tone(300, 'triangle', 0, 0.35, 0.1, 90);
  },
  win(): void {
    [523, 659, 784, 1046].forEach((n, i) => tone(n, 'sine', i * 0.09, 0.4, 0.14));
  },
  lose(): void {
    [440, 349, 262, 196].forEach((n, i) => tone(n, 'triangle', i * 0.14, 0.5, 0.16));
  },
  click(): void {
    tone(760, 'sine', 0, 0.05, 0.1);
  },
  toggleMute(): boolean {
    muted = !muted;
    return muted;
  },
  setMuted(value: boolean): boolean {
    muted = value;
    return muted;
  },
  isMuted(): boolean {
    return muted;
  },
};

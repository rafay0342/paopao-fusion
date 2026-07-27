type AudioContextConstructor = typeof AudioContext;

function audioContextConstructor(): AudioContextConstructor | null {
  return window.AudioContext
    ?? (window as typeof window & { webkitAudioContext?: AudioContextConstructor }).webkitAudioContext
    ?? null;
}

export class FightAudio {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;

  unlock(): void {
    if (!this.context) {
      const Constructor = audioContextConstructor();
      if (!Constructor) return;
      this.context = new Constructor();
      this.master = this.context.createGain();
      this.master.gain.value = 0.34;
      this.master.connect(this.context.destination);
    }
    if (this.context.state === 'suspended') {
      void this.context.resume();
    }
  }

  hit(weight: 'light' | 'heavy' | 'special'): void {
    const context = this.ready();
    if (!context || !this.master) return;
    const duration = weight === 'light' ? 0.09 : weight === 'heavy' ? 0.15 : 0.24;
    const buffer = context.createBuffer(1, Math.ceil(context.sampleRate * duration), context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let index = 0; index < data.length; index += 1) {
      const decay = Math.pow(1 - index / data.length, weight === 'special' ? 1.5 : 2.8);
      data[index] = (Math.random() * 2 - 1) * decay;
    }
    const noise = context.createBufferSource();
    noise.buffer = buffer;
    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(weight === 'light' ? 680 : 420, context.currentTime);
    const gain = context.createGain();
    gain.gain.setValueAtTime(weight === 'light' ? 0.24 : 0.43, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + duration);
    noise.connect(filter).connect(gain).connect(this.master);
    noise.start();
    this.tone(weight === 'special' ? 78 : 112, weight === 'light' ? 58 : 42, duration, 'sawtooth', 0.22);
  }

  blocked(): void {
    this.tone(620, 190, 0.11, 'square', 0.12);
    this.tone(980, 340, 0.06, 'sine', 0.08);
  }

  special(accent: 'cyan' | 'ember'): void {
    const start = accent === 'cyan' ? 170 : 105;
    const end = accent === 'cyan' ? 760 : 420;
    this.tone(start, end, 0.34, 'sawtooth', 0.16);
    window.setTimeout(() => this.tone(end * 0.7, end * 1.3, 0.16, 'sine', 0.11), 80);
  }

  roundCall(): void {
    this.tone(130, 260, 0.18, 'triangle', 0.13);
  }

  knockout(): void {
    this.tone(82, 38, 0.75, 'sawtooth', 0.2);
    window.setTimeout(() => this.tone(246, 62, 0.52, 'square', 0.1), 90);
  }

  destroy(): void {
    const context = this.context;
    this.context = null;
    this.master = null;
    if (context && context.state !== 'closed') void context.close();
  }

  private ready(): AudioContext | null {
    this.unlock();
    return this.context;
  }

  private tone(
    startFrequency: number,
    endFrequency: number,
    duration: number,
    type: OscillatorType,
    volume: number,
  ): void {
    const context = this.ready();
    if (!context || !this.master) return;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(Math.max(1, startFrequency), context.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(
      Math.max(1, endFrequency),
      context.currentTime + duration,
    );
    gain.gain.setValueAtTime(volume, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + duration);
    oscillator.connect(gain).connect(this.master);
    oscillator.start();
    oscillator.stop(context.currentTime + duration);
  }
}

#!/usr/bin/env python3
"""Render the original PaoPao Fusion adaptive score from synthesis primitives.

The composition uses generated oscillators, envelopes and seeded noise only.
It contains no samples, stock audio, borrowed melody or model-generated audio.
Requires Python 3.11+ with NumPy and ffmpeg on PATH.
"""

from __future__ import annotations

import argparse
import json
import math
import shutil
import subprocess
import tempfile
import wave
from dataclasses import dataclass
from pathlib import Path

import numpy as np


SAMPLE_RATE = 32_000
DELIVERY_SAMPLE_RATE = 48_000
RAW_SECONDS = 64.0
CROSSFADE_SECONDS = 4.0
OUTPUT_SECONDS = RAW_SECONDS - CROSSFADE_SECONDS
SEED = 7_207_2026


@dataclass(frozen=True)
class Mood:
    slug: str
    title: str
    chords: tuple[tuple[int, ...], ...]
    motif: tuple[int, ...]
    energy: float
    glass: float
    pulse: float
    warmth: float
    tension: float


MOODS = (
    Mood(
        'aurora-whispers-menu', 'Aurora Whispers',
        ((50, 57, 64, 65), (46, 53, 57, 64), (48, 55, 60, 64), (45, 52, 57, 62)),
        (74, 77, 81, 76, 72, 76, 79, 74), 0.52, 1.0, 0.12, 0.48, 0.20,
    ),
    Mood(
        'crown-memory-story', 'Crown Memory',
        ((50, 57, 64, 69), (48, 55, 60, 65), (46, 53, 58, 64), (45, 52, 57, 64)),
        (69, 72, 77, 76, 69, 74, 72, 65), 0.44, 0.72, 0.06, 0.56, 0.24,
    ),
    Mood(
        'prism-pulse-game', 'Prism Pulse',
        ((50, 57, 62, 65), (48, 55, 60, 64), (46, 53, 58, 62), (45, 52, 57, 60)),
        (74, 77, 81, 79, 76, 79, 84, 81), 0.66, 0.66, 0.62, 0.36, 0.34,
    ),
    Mood(
        'nexus-awakens-boss', 'Nexus Awakens',
        ((38, 45, 50, 51), (39, 46, 50, 55), (36, 43, 48, 54), (37, 44, 49, 53)),
        (62, 63, 69, 66, 62, 68, 65, 60), 0.83, 0.38, 0.90, 0.16, 0.92,
    ),
    Mood(
        'crown-restored-ending', 'Crown Restored',
        ((50, 57, 62, 66), (46, 53, 58, 62), (48, 55, 60, 64), (50, 57, 62, 69)),
        (74, 77, 81, 86, 84, 81, 77, 74), 0.55, 0.82, 0.16, 0.90, 0.08,
    ),
)


def midi(note: int) -> float:
    return 440.0 * (2.0 ** ((note - 69) / 12.0))


def envelope(length: int, attack: int, release: int, exponential: bool = False) -> np.ndarray:
    env = np.ones(length, dtype=np.float32)
    attack = max(1, min(attack, length))
    release = max(1, min(release, length))
    env[:attack] = np.linspace(0.0, 1.0, attack, endpoint=False, dtype=np.float32)
    if exponential:
        env *= np.exp(-np.linspace(0.0, 5.0, length, dtype=np.float32))
    else:
        env[-release:] *= np.linspace(1.0, 0.0, release, dtype=np.float32)
    return env


def pan_gains(pan: float) -> tuple[float, float]:
    angle = (max(-1.0, min(1.0, pan)) + 1.0) * math.pi / 4.0
    return math.cos(angle), math.sin(angle)


def add_voice(
    mix: np.ndarray,
    start: float,
    duration: float,
    frequency: float,
    amplitude: float,
    timbre: str,
    pan: float,
    phase: float = 0.0,
) -> None:
    first = max(0, int(start * SAMPLE_RATE))
    last = min(len(mix), first + int(duration * SAMPLE_RATE))
    length = last - first
    if length <= 1:
        return
    t = np.arange(length, dtype=np.float32) / SAMPLE_RATE
    base = 2.0 * np.pi * frequency * t + phase

    if timbre == 'glass':
        wave_data = np.sin(base) + 0.34 * np.sin(2.01 * base + 0.4) + 0.12 * np.sin(4.03 * base + 1.1)
        env = envelope(length, int(0.012 * SAMPLE_RATE), length, exponential=True)
    elif timbre == 'string':
        wave_data = np.sin(base) + 0.22 * np.sin(2.0 * base + 0.2) + 0.08 * np.sin(3.0 * base + 0.7)
        env = envelope(length, int(min(1.4, duration * 0.28) * SAMPLE_RATE), int(min(1.8, duration * 0.32) * SAMPLE_RATE))
    elif timbre == 'hollow':
        wave_data = np.sin(base) - 0.28 * np.sin(2.0 * base) + 0.11 * np.sin(5.0 * base)
        env = envelope(length, int(0.04 * SAMPLE_RATE), int(min(0.7, duration * 0.4) * SAMPLE_RATE))
    else:
        wave_data = np.sin(base) + 0.12 * np.sin(0.5 * base)
        env = envelope(length, int(0.12 * SAMPLE_RATE), int(min(0.8, duration * 0.3) * SAMPLE_RATE))

    left, right = pan_gains(pan)
    signal = (wave_data * env * amplitude).astype(np.float32)
    mix[first:last, 0] += signal * left
    mix[first:last, 1] += signal * right


def add_kick(mix: np.ndarray, start: float, amplitude: float) -> None:
    first = int(start * SAMPLE_RATE)
    length = min(int(0.42 * SAMPLE_RATE), len(mix) - first)
    if length <= 1:
        return
    t = np.arange(length, dtype=np.float32) / SAMPLE_RATE
    phase = 2.0 * np.pi * (46.0 * t + 46.0 * (1.0 - np.exp(-t * 18.0)) / 18.0)
    signal = np.sin(phase) * np.exp(-t * 11.0) * amplitude
    mix[first:first + length, 0] += signal
    mix[first:first + length, 1] += signal


def add_seeded_air(mix: np.ndarray, rng: np.random.Generator, amplitude: float) -> None:
    count = len(mix)
    noise = rng.standard_normal(count).astype(np.float32)
    cumulative = np.cumsum(np.pad(noise, (1, 0)), dtype=np.float64)

    def moving_average(window: int) -> np.ndarray:
        filtered = np.zeros(count, dtype=np.float32)
        filtered[window:] = (
            (cumulative[window + 1:] - cumulative[1:-window]) / window
        ).astype(np.float32)
        return filtered

    # A soft 250 Hz–3 kHz breath band supplies movement without the tiring
    # broadband hiss that raw white-noise ambience would introduce.
    breath = moving_average(10) - moving_average(120)
    t = np.arange(count, dtype=np.float32) / SAMPLE_RATE
    motion = 0.45 + 0.28 * np.sin(2.0 * np.pi * t / 13.0) + 0.18 * np.sin(2.0 * np.pi * t / 7.0 + 1.3)
    air = breath * motion * amplitude
    mix[:, 0] += air
    mix[:, 1] += np.roll(air, 347) * 0.92


def compose(mood: Mood, mood_index: int) -> np.ndarray:
    sample_count = int(RAW_SECONDS * SAMPLE_RATE)
    mix = np.zeros((sample_count, 2), dtype=np.float32)
    rng = np.random.default_rng(SEED + mood_index * 101)

    # Sixteen four-second bars: one shared harmonic identity, five orchestrations.
    for bar in range(16):
        chord = mood.chords[bar % len(mood.chords)]
        start = bar * 4.0
        for voice_index, note in enumerate(chord):
            spread = -0.62 + voice_index * (1.24 / max(1, len(chord) - 1))
            add_voice(
                mix, start - 0.28, 4.72, midi(note),
                (0.024 + voice_index * 0.002) * mood.energy,
                'string', spread, phase=voice_index * 0.73,
            )
        root = chord[0] - 12
        add_voice(mix, start, 4.15, midi(root), 0.054 * mood.energy, 'bass', -0.08)

        # A restrained original five-tone crown motif; rests keep the loop breathable.
        motif = mood.motif
        pattern = (0.42, 1.36, 2.18, 3.12)
        if bar % 2 == 0 or mood.pulse > 0.55:
            for step, offset in enumerate(pattern):
                note = motif[(bar * 2 + step) % len(motif)]
                pan = (-0.48, 0.30, -0.16, 0.52)[step]
                add_voice(mix, start + offset, 2.25, midi(note), 0.044 * mood.glass, 'glass', pan)

        if mood.pulse > 0.1:
            beats = range(4) if mood.pulse > 0.5 else (0, 2)
            for beat in beats:
                add_voice(
                    mix, start + beat + 0.02, 0.38, midi(root + 12),
                    0.025 * mood.pulse, 'hollow', -0.35 if beat % 2 == 0 else 0.35,
                )
            if mood.pulse > 0.55:
                add_kick(mix, start, 0.09 * mood.pulse)
                add_kick(mix, start + 2.0, 0.065 * mood.pulse)

        if mood.tension > 0.55:
            add_voice(mix, start + 1.5, 2.1, midi(chord[0] + 1), 0.020 * mood.tension, 'hollow', 0.1)

    # Long aurora overtones join bars into one atmosphere.
    for start in (0.0, 16.0, 32.0, 48.0):
        top = mood.chords[int(start / 16) % 4][-1] + 12
        add_voice(mix, start, 17.0, midi(top), 0.012 * mood.warmth, 'string', 0.58)
        add_voice(mix, start, 17.0, midi(top - 7), 0.010 * mood.energy, 'string', -0.58, phase=0.8)

    add_seeded_air(mix, rng, 0.0032 + mood.tension * 0.0018)

    # Equal-power four-second overlap: output starts at bar two and resolves
    # through bar sixteen into bar one, then loops back to bar two without a cut.
    overlap = int(CROSSFADE_SECONDS * SAMPLE_RATE)
    middle = mix[overlap:-overlap]
    tail = mix[-overlap:]
    head = mix[:overlap]
    curve = np.linspace(0.0, math.pi / 2.0, overlap, dtype=np.float32)
    joined = tail * np.cos(curve)[:, None] + head * np.sin(curve)[:, None]
    loop = np.concatenate((middle, joined), axis=0)

    peak = float(np.max(np.abs(loop)))
    if peak > 0:
        loop *= np.float32(0.72 / peak)
    return loop


def write_wav(path: Path, audio: np.ndarray) -> None:
    pcm = np.clip(audio * 32767.0, -32768, 32767).astype('<i2')
    with wave.open(str(path), 'wb') as wav:
        wav.setnchannels(2)
        wav.setsampwidth(2)
        wav.setframerate(SAMPLE_RATE)
        wav.writeframes(pcm.tobytes())


def encode(wav_path: Path, output_path: Path, codec: str, title: str) -> None:
    common = [
        'ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-i', str(wav_path),
        '-af', 'loudnorm=I=-20:TP=-1.5:LRA=7',
        '-ar', str(DELIVERY_SAMPLE_RATE),
        '-metadata', f'title={title}',
        '-metadata', 'album=PaoPao Fusion: The Shattered Crown',
        '-metadata', 'artist=RafayGen AI',
        '-metadata', 'comment=Original procedural score; no samples used',
    ]
    if codec == 'ogg':
        args = common + ['-c:a', 'libvorbis', '-q:a', '4', str(output_path)]
    else:
        args = common + ['-c:a', 'libmp3lame', '-b:a', '112k', '-id3v2_version', '3', str(output_path)]
    subprocess.run(args, check=True)


def probe(path: Path) -> dict[str, object]:
    result = subprocess.run(
        ['ffprobe', '-v', 'error', '-show_entries', 'format=duration,bit_rate', '-of', 'json', str(path)],
        check=True, capture_output=True, text=True,
    )
    data = json.loads(result.stdout)['format']
    return {'duration': round(float(data['duration']), 3), 'bitRate': int(data.get('bit_rate', 0))}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--output-dir', type=Path, default=Path(__file__).resolve().parents[1] / 'public/assets/audio')
    args = parser.parse_args()
    if not shutil.which('ffmpeg') or not shutil.which('ffprobe'):
        raise SystemExit('ffmpeg and ffprobe are required on PATH')
    args.output_dir.mkdir(parents=True, exist_ok=True)

    manifest: dict[str, object] = {
        'collection': 'Aurora Crown Adaptive Score',
        'composition': 'Original deterministic synthesis from first principles; no samples, stock audio, or borrowed melodies.',
        'seed': SEED,
        'synthesisSampleRate': SAMPLE_RATE,
        'deliverySampleRate': DELIVERY_SAMPLE_RATE,
        'loopCrossfadeSeconds': CROSSFADE_SECONDS,
        'targetLoudnessLufs': -20,
        'tracks': [],
    }
    with tempfile.TemporaryDirectory(prefix='paopao-music-') as temporary:
        scratch = Path(temporary)
        for index, mood in enumerate(MOODS):
            audio = compose(mood, index)
            wav_path = scratch / f'{mood.slug}.wav'
            write_wav(wav_path, audio)
            files: dict[str, object] = {}
            for codec in ('ogg', 'mp3'):
                output = args.output_dir / f'{mood.slug}.{codec}'
                encode(wav_path, output, codec, mood.title)
                files[codec] = {'file': output.name, **probe(output)}
            manifest['tracks'].append({'mood': mood.slug.rsplit('-', 1)[-1], 'title': mood.title, 'files': files})

    (args.output_dir / 'composition-source.json').write_text(
        json.dumps(manifest, indent=2) + '\n', encoding='utf-8'
    )
    print(json.dumps(manifest, indent=2))


if __name__ == '__main__':
    main()

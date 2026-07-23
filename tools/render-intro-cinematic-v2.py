#!/usr/bin/env python3
"""Render the continuous 30-second PaoPao Fusion opening cinematic.

The renderer is deterministic and source-local. Pillow composites every
frame directly into an ffmpeg stdin pipe, so no intermediate frame sequence is
written. The accompanying score is synthesized from first principles and uses
no samples or stock music.
"""

from __future__ import annotations

import argparse
from array import array
from functools import lru_cache
import json
import math
from pathlib import Path
import random
import shutil
import subprocess
import sys
import wave
import struct

try:
    from PIL import Image, ImageChops, ImageDraw, ImageEnhance, ImageFilter, ImageFont, ImageOps
except ImportError as exc:  # pragma: no cover - actionable CLI failure
    raise SystemExit(
        "Pillow is required. Install it with: py -m pip install pillow"
    ) from exc


ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "public" / "assets"
CINEMATICS = ASSETS / "cinematics"
LAYERS = CINEMATICS / "layers"
VIDEO_PATH = CINEMATICS / "paopao-opening-v2.mp4"
SCORE_PATH = CINEMATICS / "paopao-opening-v2-score.wav"
PREVIEW_DIR = CINEMATICS / "previews-v2"

WIDTH = 720
HEIGHT = 1280
FPS = 30
DURATION = 30.0
FRAME_COUNT = int(FPS * DURATION)
SAMPLE_RATE = 48_000
SAMPLE_COUNT = int(SAMPLE_RATE * DURATION)

WORLD_PATHS = {
    "crystal": ASSETS / "worlds" / "v3" / "world-crystal-hd.jpg",
    "emerald": ASSETS / "worlds" / "v3" / "world-emerald-hd.jpg",
    "celestial": ASSETS / "worlds" / "v3" / "world-celestial-hd.jpg",
    "ember": ASSETS / "worlds" / "v3" / "world-ember-hd.jpg",
    "frost": ASSETS / "worlds" / "v9" / "world-frostbound-hd.jpg",
    "nexus": ASSETS / "worlds" / "v9" / "world-nexus-hd.jpg",
}

MECHANIC_PATHS = {
    "crystal": ASSETS / "sprites" / "v8" / "mechanic-crystal-seal.png",
    "emerald": ASSETS / "sprites" / "v8" / "mechanic-vine-bind.png",
    "celestial": ASSETS / "sprites" / "v8" / "mechanic-celestial-portal.png",
    "ember": ASSETS / "sprites" / "v8" / "mechanic-ember-core.png",
    "frost": ASSETS / "sprites" / "v9" / "mechanic-ice-armor.png",
    "nexus": ASSETS / "sprites" / "v9" / "mechanic-polarity-ring.png",
}

ORB_COLORS = {
    "blue": (64, 205, 255),
    "green": (77, 235, 137),
    "orange": (255, 151, 62),
    "purple": (181, 83, 255),
    "red": (255, 79, 103),
    "yellow": (255, 218, 91),
}
ORB_NAMES = tuple(ORB_COLORS)

REALM_BEATS = (
    (11.78, 12.72, "crystal", "purple"),
    (12.72, 13.66, "emerald", "green"),
    (13.66, 14.60, "celestial", "yellow"),
    (14.60, 15.54, "ember", "orange"),
    (15.54, 16.48, "frost", "blue"),
    (16.48, 17.70, "nexus", "red"),
)

PREVIEW_TIMES = (0.75, 4.32, 6.15, 9.40, 12.05, 14.92, 17.95, 21.50, 23.85, 26.40, 28.55, 29.70)


def clamp01(value: float) -> float:
    return max(0.0, min(1.0, value))


def smoothstep(value: float) -> float:
    value = clamp01(value)
    return value * value * (3.0 - 2.0 * value)


def ease_out(value: float) -> float:
    value = clamp01(value)
    return 1.0 - (1.0 - value) ** 3


def lerp(start: float, end: float, amount: float) -> float:
    return start + (end - start) * amount


def bezier(
    p0: tuple[float, float],
    p1: tuple[float, float],
    p2: tuple[float, float],
    p3: tuple[float, float],
    amount: float,
) -> tuple[float, float]:
    amount = clamp01(amount)
    inverse = 1.0 - amount
    return (
        inverse**3 * p0[0]
        + 3 * inverse * inverse * amount * p1[0]
        + 3 * inverse * amount * amount * p2[0]
        + amount**3 * p3[0],
        inverse**3 * p0[1]
        + 3 * inverse * inverse * amount * p1[1]
        + 3 * inverse * amount * amount * p2[1]
        + amount**3 * p3[1],
    )


def find_font() -> Path | None:
    candidates = (
        Path("/usr/share/fonts/truetype/dejavu/DejaVuSansCondensed-Bold.ttf"),
        Path("/mnt/c/Windows/Fonts/trebucbd.ttf"),
        Path("C:/Windows/Fonts/trebucbd.ttf"),
        Path("/mnt/c/Windows/Fonts/arialbd.ttf"),
        Path("C:/Windows/Fonts/arialbd.ttf"),
    )
    return next((path for path in candidates if path.exists()), None)


FONT_PATH = find_font()


@lru_cache(maxsize=64)
def font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    if FONT_PATH:
        return ImageFont.truetype(str(FONT_PATH), size=size)
    return ImageFont.load_default(size=size)


def tracked_text_layer(
    text: str,
    size: int,
    color: tuple[int, int, int, int],
    tracking: int = 2,
    stroke: int = 2,
) -> Image.Image:
    face = font(size)
    scratch = Image.new("RGBA", (16, 16))
    measure = ImageDraw.Draw(scratch)
    widths = [measure.textlength(character, font=face) for character in text]
    width = int(sum(widths) + tracking * max(0, len(text) - 1) + stroke * 4 + 4)
    height = size + stroke * 4 + 14
    result = Image.new("RGBA", (max(1, width), max(1, height)))
    draw = ImageDraw.Draw(result)
    cursor = stroke * 2 + 2
    for character, advance in zip(text, widths):
        draw.text(
            (cursor, stroke * 2),
            character,
            font=face,
            fill=color,
            stroke_width=stroke,
            stroke_fill=(3, 6, 18, 235),
        )
        cursor += advance + tracking
    return result


def trim_alpha(image: Image.Image) -> Image.Image:
    image = image.convert("RGBA")
    box = image.getchannel("A").getbbox()
    return image.crop(box) if box else image


def set_opacity(image: Image.Image, opacity: float) -> Image.Image:
    opacity = clamp01(opacity)
    if opacity >= 0.999:
        return image
    copy = image.copy()
    copy.putalpha(copy.getchannel("A").point(lambda value: round(value * opacity)))
    return copy


def paste_center(canvas: Image.Image, image: Image.Image, center: tuple[float, float], opacity: float = 1.0) -> None:
    if opacity <= 0.0:
        return
    layer = set_opacity(image, opacity)
    x = round(center[0] - layer.width / 2)
    y = round(center[1] - layer.height / 2)
    canvas.alpha_composite(layer, (x, y))


class SpriteBank:
    def __init__(self) -> None:
        self.sources: dict[str, Image.Image] = {}
        self.cache: dict[tuple[str, int, int], Image.Image] = {}

    def add(self, name: str, path: Path) -> None:
        self.sources[name] = trim_alpha(Image.open(path))

    def transformed(self, name: str, width: float, angle: float = 0.0) -> Image.Image:
        quantized_width = max(4, int(round(width / 4.0) * 4))
        quantized_angle = int(round(angle / 2.0) * 2)
        key = (name, quantized_width, quantized_angle)
        if key in self.cache:
            return self.cache[key]
        source = self.sources[name]
        height = max(1, round(source.height * quantized_width / source.width))
        result = source.resize((quantized_width, height), Image.Resampling.LANCZOS)
        if quantized_angle:
            result = result.rotate(
                quantized_angle,
                resample=Image.Resampling.BICUBIC,
                expand=True,
            )
        self.cache[key] = result
        return result


class CrownPieces:
    """Deterministically split the crown alpha into six reusable fragments."""

    def __init__(self, crown: Image.Image) -> None:
        self.crown = trim_alpha(crown)
        self.width, self.height = self.crown.size
        alpha = self.crown.getchannel("A")
        sample_y = (0, self.height // 4, self.height // 2, self.height * 3 // 4, self.height)
        boundary_offsets = (0.00, 0.018, -0.012, 0.014, -0.009)
        boundaries: list[list[tuple[int, int]]] = []
        for boundary in range(7):
            base = self.width * boundary / 6.0
            if boundary in (0, 6):
                points = [(round(base), y) for y in sample_y]
            else:
                direction = -1.0 if boundary % 2 else 1.0
                points = [
                    (round(base + self.width * offset * direction), y)
                    for offset, y in zip(boundary_offsets, sample_y)
                ]
            boundaries.append(points)
        self.pieces: list[tuple[Image.Image, tuple[float, float]]] = []
        for index in range(6):
            mask = Image.new("L", self.crown.size)
            polygon = boundaries[index] + list(reversed(boundaries[index + 1]))
            ImageDraw.Draw(mask).polygon(polygon, fill=255)
            mask = ImageChops.multiply(mask, alpha)
            box = mask.getbbox()
            if not box:
                continue
            fragment = self.crown.crop(box)
            fragment.putalpha(mask.crop(box))
            center = ((box[0] + box[2]) / 2.0, (box[1] + box[3]) / 2.0)
            self.pieces.append((fragment, center))


class ScoreSynth:
    def __init__(self) -> None:
        self.music_left = array("f", [0.0]) * SAMPLE_COUNT
        self.music_right = array("f", [0.0]) * SAMPLE_COUNT
        self.fx_left = array("f", [0.0]) * SAMPLE_COUNT
        self.fx_right = array("f", [0.0]) * SAMPLE_COUNT
        self.rng = random.Random(0xA0A0F052)

    @staticmethod
    def pan_gains(pan: float) -> tuple[float, float]:
        angle = (max(-1.0, min(1.0, pan)) + 1.0) * math.pi / 4.0
        return math.cos(angle), math.sin(angle)

    def buffers(self, bus: str) -> tuple[array, array]:
        if bus == "music":
            return self.music_left, self.music_right
        return self.fx_left, self.fx_right

    @staticmethod
    def envelope(position: float, duration: float, attack: float, release: float) -> float:
        if position < 0.0 or position >= duration:
            return 0.0
        attack_gain = min(1.0, position / max(attack, 0.001))
        release_gain = min(1.0, (duration - position) / max(release, 0.001))
        return math.sin(min(attack_gain, release_gain) * math.pi / 2.0) ** 2

    def pad(self, start: float, duration: float, frequencies: tuple[float, ...], amplitude: float) -> None:
        first = max(0, int(round(start * SAMPLE_RATE)))
        count = min(int(duration * SAMPLE_RATE), SAMPLE_COUNT - first)
        phases = [self.rng.random() * math.tau for _ in frequencies]
        pan_left, pan_right = self.pan_gains(0.0)
        for offset in range(max(0, count)):
            position = offset / SAMPLE_RATE
            tone = 0.0
            for frequency, phase in zip(frequencies, phases):
                tone += math.sin(math.tau * frequency * position + phase)
                tone += 0.20 * math.sin(math.tau * frequency * 2.003 * position + phase * 0.7)
                tone += 0.07 * math.sin(math.tau * frequency * 3.997 * position + phase * 1.3)
            breathe = 0.84 + 0.16 * math.sin(math.tau * 0.075 * (start + position))
            value = tone * self.envelope(position, duration, 1.25, 1.55) * breathe * amplitude / len(frequencies)
            index = first + offset
            self.music_left[index] += value * pan_left
            self.music_right[index] += value * pan_right

    def bell(
        self,
        start: float,
        duration: float,
        frequency: float,
        amplitude: float,
        pan: float = 0.0,
        bus: str = "music",
    ) -> None:
        first = max(0, int(round(start * SAMPLE_RATE)))
        count = min(int(duration * SAMPLE_RATE), SAMPLE_COUNT - first)
        left_buffer, right_buffer = self.buffers(bus)
        left_gain, right_gain = self.pan_gains(pan)
        for offset in range(max(0, count)):
            position = offset / SAMPLE_RATE
            attack = min(1.0, position / 0.016)
            decay = math.exp(-4.0 * position / duration)
            signal = (
                math.sin(math.tau * frequency * position)
                + 0.39 * math.sin(math.tau * frequency * 2.01 * position + 0.35)
                + 0.15 * math.sin(math.tau * frequency * 3.93 * position + 1.05)
            ) * attack * decay * amplitude
            index = first + offset
            left_buffer[index] += signal * left_gain
            right_buffer[index] += signal * right_gain

    def sub_pulse(self, start: float, duration: float, frequency: float, amplitude: float) -> None:
        first = max(0, int(round(start * SAMPLE_RATE)))
        count = min(int(duration * SAMPLE_RATE), SAMPLE_COUNT - first)
        left_gain, right_gain = self.pan_gains(0.0)
        for offset in range(max(0, count)):
            position = offset / SAMPLE_RATE
            phase = math.tau * frequency * position * (1.0 - 0.16 * position / max(duration, 0.001))
            value = math.sin(phase) * math.exp(-5.4 * position / duration) * amplitude
            index = first + offset
            self.fx_left[index] += value * left_gain
            self.fx_right[index] += value * right_gain

    def whoosh(self, start: float, duration: float, amplitude: float, direction: float = 1.0) -> None:
        first = max(0, int(round(start * SAMPLE_RATE)))
        count = min(int(duration * SAMPLE_RATE), SAMPLE_COUNT - first)
        previous = 0.0
        for offset in range(max(0, count)):
            position = offset / SAMPLE_RATE
            raw = self.rng.uniform(-1.0, 1.0)
            colored = raw - 0.94 * previous
            previous = raw
            envelope = math.sin(math.pi * position / duration) ** 2
            pan = direction * lerp(-0.72, 0.72, position / duration)
            left_gain, right_gain = self.pan_gains(pan)
            value = colored * envelope * amplitude
            index = first + offset
            self.fx_left[index] += value * left_gain
            self.fx_right[index] += value * right_gain

    def crown_lock(self, at: float) -> None:
        self.sub_pulse(at, 0.70, 62.0, 0.13)
        for offset, frequency, pan in (
            (0.00, 293.66, -0.25),
            (0.025, 440.00, 0.25),
            (0.055, 587.33, 0.0),
        ):
            self.bell(at + offset, 1.75, frequency, 0.095, pan, "fx")
        for index, pan in enumerate((-0.72, -0.42, -0.14, 0.14, 0.42, 0.72)):
            self.bell(at - 3.60 + index * 0.67, 0.46, 880.0 + index * 61.0, 0.026, pan, "fx")

    def crown_shatter(self, at: float) -> None:
        duration = 1.25
        first = int(round(at * SAMPLE_RATE))
        count = min(int(duration * SAMPLE_RATE), SAMPLE_COUNT - first)
        previous = 0.0
        left_gain, right_gain = self.pan_gains(0.0)
        for offset in range(max(0, count)):
            position = offset / SAMPLE_RATE
            raw = self.rng.uniform(-1.0, 1.0)
            crack = (raw - 0.975 * previous) * math.exp(-13.0 * position) * 0.27
            previous = raw
            sweep_phase = math.tau * (44.0 * position - 7.0 * position * position)
            body = math.sin(sweep_phase) * math.exp(-3.9 * position) * 0.32
            value = crack + body
            index = first + offset
            self.fx_left[index] += value * left_gain
            self.fx_right[index] += value * right_gain
        for index in range(18):
            offset = 0.08 + index * 0.047 + self.rng.uniform(0.0, 0.035)
            frequency = self.rng.uniform(720.0, 1760.0)
            pan = self.rng.uniform(-0.9, 0.9)
            self.bell(at + offset, 0.38, frequency, 0.023, pan, "fx")

    def portal_open(self, at: float) -> None:
        self.sub_pulse(at, 1.1, 49.0, 0.16)
        duration = 1.65
        first = int(round((at - 0.48) * SAMPLE_RATE))
        count = min(int(duration * SAMPLE_RATE), SAMPLE_COUNT - first)
        left_gain, right_gain = self.pan_gains(-0.12)
        for offset in range(max(0, count)):
            position = offset / SAMPLE_RATE
            phase = math.tau * (118.0 * position + 310.0 * position * position)
            value = math.sin(phase) * math.sin(math.pi * position / duration) ** 2 * 0.075
            index = first + offset
            self.fx_left[index] += value * left_gain
            self.fx_right[index] += value * right_gain
        self.whoosh(at - 0.58, 1.55, 0.028, 1.0)
        for index, cue in enumerate((12.48, 13.28, 14.10, 14.92, 15.76, 16.62)):
            self.whoosh(cue - 0.18, 0.46, 0.017, -1.0 if index % 2 else 1.0)

    def lumi_wake(self, at: float) -> None:
        duration = 1.0
        first = int(round(at * SAMPLE_RATE))
        count = min(int(duration * SAMPLE_RATE), SAMPLE_COUNT - first)
        phase = 0.0
        left_gain, right_gain = self.pan_gains(0.0)
        for offset in range(max(0, count)):
            position = offset / SAMPLE_RATE
            frequency = 220.0 + 660.0 * smoothstep(position / 0.70)
            phase += math.tau * frequency / SAMPLE_RATE
            value = math.sin(phase) * self.envelope(position, duration, 0.025, 0.35) * 0.09
            index = first + offset
            self.fx_left[index] += value * left_gain
            self.fx_right[index] += value * right_gain
        for offset, frequency, pan in ((0.17, 587.33, -0.24), (0.53, 880.0, 0.2), (0.93, 1318.51, 0.0)):
            self.bell(at + offset, 1.25, frequency, 0.078, pan, "fx")

    def vow_resolve(self, at: float) -> None:
        self.sub_pulse(at, 1.1, 55.0, 0.15)
        for frequency, pan in ((146.83, 0.0), (185.0, -0.22), (220.0, 0.22), (293.66, 0.0)):
            self.bell(at, 3.0, frequency, 0.085, pan, "fx")
        for index, pan in enumerate((-0.65, -0.38, -0.12, 0.12, 0.38, 0.65)):
            self.bell(24.18 + index * 0.44, 1.25, 523.25 + index * 73.4, 0.055, pan, "fx")
        for offset, frequency in ((0.0, 587.33), (0.25, 739.99), (0.50, 880.0), (0.75, 1174.66)):
            self.bell(28.45 + offset, 1.45, frequency, 0.073, (offset - 0.37) * 0.9, "fx")

    def render(self, path: Path) -> None:
        # Original five-part harmonic arc: unity, fracture, journey, awakening, vow.
        self.pad(0.0, 30.0, (73.42, 110.00, 146.83), 0.047)
        self.pad(0.0, 6.3, (146.83, 174.61, 220.00), 0.083)
        self.pad(5.8, 6.5, (138.59, 164.81, 207.65), 0.068)
        self.pad(11.8, 6.5, (146.83, 220.00, 261.63), 0.078)
        self.pad(17.7, 6.5, (174.61, 220.00, 293.66), 0.076)
        self.pad(23.6, 6.4, (146.83, 185.00, 220.00, 293.66), 0.110)
        notes = (
            (0.70, 587.33, -0.35), (1.90, 440.00, 0.30), (3.10, 523.25, -0.10),
            (6.40, 277.18, -0.40), (8.00, 311.13, 0.25), (9.60, 415.30, -0.20),
            (12.20, 293.66, -0.65), (13.10, 349.23, -0.38), (14.00, 440.00, -0.12),
            (14.90, 523.25, 0.12), (15.80, 587.33, 0.38), (16.70, 698.46, 0.65),
            (18.50, 587.33, -0.25), (20.00, 698.46, 0.25), (21.50, 880.00, -0.10),
            (24.20, 587.33, -0.45), (25.20, 739.99, -0.20), (26.20, 880.00, 0.10),
            (27.20, 1174.66, 0.35), (28.20, 880.00, -0.10),
        )
        for start, frequency, pan in notes:
            self.bell(start, 1.65 if start < 24 else 2.1, frequency, 0.068 if start < 24 else 0.082, pan)
        self.crown_lock(4.32)
        self.crown_shatter(6.15)
        self.portal_open(12.05)
        self.lumi_wake(17.95)
        self.vow_resolve(23.85)

        duck_regions = (
            (6.15, 0.45, 0.07, 1.20),
            (12.05, 0.70, 0.13, 0.95),
            (17.95, 0.75, 0.08, 0.70),
        )
        room_taps = tuple((int(delay * SAMPLE_RATE), gain) for delay, gain in ((0.109, 0.11), (0.223, 0.065), (0.397, 0.035)))

        def sample(index: int, channel: int) -> float:
            at = index / SAMPLE_RATE
            duck = 1.0
            for center, reduction, pre, recovery in duck_regions:
                if center - pre <= at < center:
                    duck *= lerp(1.0, reduction, (at - (center - pre)) / pre)
                elif center <= at < center + recovery:
                    duck *= lerp(reduction, 1.0, (at - center) / recovery)
            music = self.music_left[index] if channel == 0 else self.music_right[index]
            fx_buffer = self.fx_left if channel == 0 else self.fx_right
            value = music * duck + fx_buffer[index]
            for delay, tap_gain in room_taps:
                if index >= delay:
                    value += fx_buffer[index - delay] * tap_gain
            if index >= SAMPLE_COUNT - int(0.04 * SAMPLE_RATE):
                value *= (SAMPLE_COUNT - index) / int(0.04 * SAMPLE_RATE)
            return value

        peak = 1e-6
        for index in range(SAMPLE_COUNT):
            peak = max(peak, abs(sample(index, 0)), abs(sample(index, 1)))
        normalizer = 1.0 / peak
        # Headroom is deliberately generous because AAC can overshoot PCM peaks.
        drive = 1.88
        ceiling = 0.64
        output_scale = ceiling / math.tanh(drive)
        path.parent.mkdir(parents=True, exist_ok=True)
        with wave.open(str(path), "wb") as output:
            output.setnchannels(2)
            output.setsampwidth(2)
            output.setframerate(SAMPLE_RATE)
            block = bytearray()
            for index in range(SAMPLE_COUNT):
                left_value = math.tanh(sample(index, 0) * normalizer * drive) * output_scale
                right_value = math.tanh(sample(index, 1) * normalizer * drive) * output_scale
                left = int(max(-1.0, min(1.0, left_value)) * 32767)
                right = int(max(-1.0, min(1.0, right_value)) * 32767)
                block.extend(struct.pack("<hh", left, right))
                if len(block) >= 65_536:
                    output.writeframesraw(block)
                    block.clear()
            if block:
                output.writeframesraw(block)


class Cinematic:
    def __init__(self) -> None:
        required = list(WORLD_PATHS.values()) + list(MECHANIC_PATHS.values()) + [
            LAYERS / "aurora-crown.png",
            LAYERS / "lumi.png",
            ASSETS / "sprites" / "v3" / "crystal-launcher-hd.png",
            ASSETS / "sprites" / "v9" / "boss-nexus-architect.png",
        ]
        required += [ASSETS / "sprites" / "v7" / f"aurora-{name}.png" for name in ORB_NAMES]
        missing = [str(path) for path in required if not path.exists()]
        if missing:
            raise FileNotFoundError("Missing cinematic assets: " + ", ".join(missing))

        self.bank = SpriteBank()
        self.bank.add("crown", LAYERS / "aurora-crown.png")
        self.bank.add("lumi", LAYERS / "lumi.png")
        self.bank.add("launcher", ASSETS / "sprites" / "v3" / "crystal-launcher-hd.png")
        self.bank.add("architect", ASSETS / "sprites" / "v9" / "boss-nexus-architect.png")
        for realm, path in MECHANIC_PATHS.items():
            self.bank.add(f"mechanic-{realm}", path)
        for name in ORB_NAMES:
            self.bank.add(f"orb-{name}", ASSETS / "sprites" / "v7" / f"aurora-{name}.png")
        self.crown_pieces = CrownPieces(self.bank.sources["crown"])
        self.piece_cache: dict[tuple[int, int, int], Image.Image] = {}
        self.worlds = {name: self.prepare_world(name, path) for name, path in WORLD_PATHS.items()}
        self.vignette = self.make_vignette()
        self.title_backdrop = self.make_title_backdrop()
        self.glow_cache: dict[tuple[int, tuple[int, int, int], int], Image.Image] = {}
        rng = random.Random(0xC1A0A0)
        self.motes = [
            (
                rng.uniform(0, WIDTH),
                rng.uniform(0, HEIGHT),
                rng.uniform(6.0, 24.0),
                rng.uniform(0.6, 2.0),
                rng.uniform(0, math.tau),
                rng.choice(((62, 202, 231), (143, 86, 218), (222, 172, 77))),
            )
            for _ in range(58)
        ]

    @staticmethod
    def prepare_world(name: str, path: Path) -> Image.Image:
        source = Image.open(path).convert("RGB")
        # Fixed overscan keeps every camera move edge-safe and fast.
        result = ImageOps.fit(source, (780, 1387), method=Image.Resampling.LANCZOS)
        brightness = {
            "crystal": 0.88,
            "emerald": 0.86,
            "celestial": 0.78,
            "ember": 0.88,
            "frost": 0.82,
            "nexus": 0.90,
        }[name]
        result = ImageEnhance.Brightness(result).enhance(brightness)
        result = ImageEnhance.Color(result).enhance(0.94)
        result = ImageEnhance.Contrast(result).enhance(1.04)
        return result.convert("RGBA")

    @staticmethod
    def make_vignette() -> Image.Image:
        sample_width, sample_height = 180, 320
        pixels: list[tuple[int, int, int, int]] = []
        for y in range(sample_height):
            ny = (y - sample_height / 2.0) / (sample_height / 2.0)
            for x in range(sample_width):
                nx = (x - sample_width / 2.0) / (sample_width / 2.0)
                radius = math.hypot(nx, ny)
                amount = clamp01((radius - 0.38) / 0.75) ** 1.6
                pixels.append((2, 4, 13, round(amount * 118)))
        small = Image.new("RGBA", (sample_width, sample_height))
        small.putdata(pixels)
        return small.resize((WIDTH, HEIGHT), Image.Resampling.BICUBIC)

    @staticmethod
    def make_title_backdrop() -> Image.Image:
        sample_width, sample_height = 180, 320
        pixels: list[tuple[int, int, int, int]] = []
        for y in range(sample_height):
            vertical = y / sample_height
            for x in range(sample_width):
                radial = math.exp(
                    -(
                        ((x - sample_width / 2.0) / 95.0) ** 2
                        + ((y - 140.0) / 135.0) ** 2
                    )
                )
                pixels.append(
                    (
                        round(3 + radial * 17 + vertical * 2),
                        round(7 + radial * 10 + vertical * 3),
                        round(20 + radial * 36 + vertical * 8),
                        255,
                    )
                )
        small = Image.new("RGBA", (sample_width, sample_height))
        small.putdata(pixels)
        return small.resize((WIDTH, HEIGHT), Image.Resampling.BICUBIC)

    def background(self, name: str, time: float, strength: float = 1.0) -> Image.Image:
        source = self.worlds[name]
        max_x = source.width - WIDTH
        max_y = source.height - HEIGHT
        x = max_x / 2 + math.sin(time * 0.26 + len(name)) * 18.0 * strength
        y = max_y / 2 + math.cos(time * 0.19 + len(name) * 0.4) * 28.0 * strength
        x = max(0, min(max_x, x))
        y = max(0, min(max_y, y))
        return source.crop((round(x), round(y), round(x) + WIDTH, round(y) + HEIGHT))

    def glow(self, radius: float, color: tuple[int, int, int], alpha: int) -> Image.Image:
        quantized_radius = max(8, int(round(radius / 4.0) * 4))
        quantized_alpha = max(1, int(round(alpha / 8.0) * 8))
        key = (quantized_radius, color, quantized_alpha)
        if key in self.glow_cache:
            return self.glow_cache[key]
        size = quantized_radius * 4
        result = Image.new("RGBA", (size, size))
        draw = ImageDraw.Draw(result)
        margin = quantized_radius
        draw.ellipse(
            (margin, margin, size - margin, size - margin),
            fill=(*color, quantized_alpha),
        )
        result = result.filter(ImageFilter.GaussianBlur(quantized_radius * 0.62))
        self.glow_cache[key] = result
        return result

    def draw_motes(self, canvas: Image.Image, time: float, intensity: float = 1.0) -> None:
        overlay = Image.new("RGBA", canvas.size)
        draw = ImageDraw.Draw(overlay)
        for x0, y0, speed, size, phase, color in self.motes:
            x = (x0 + math.sin(time * 0.31 + phase) * 13.0) % WIDTH
            y = (y0 - time * speed) % HEIGHT
            pulse = 0.45 + 0.35 * math.sin(time * 1.15 + phase)
            alpha = int(max(0, pulse) * 95 * intensity)
            radius = size * (0.75 + 0.25 * math.sin(time * 0.7 + phase))
            draw.ellipse((x - radius, y - radius, x + radius, y + radius), fill=(*color, alpha))
        canvas.alpha_composite(overlay)

    def draw_caption(self, canvas: Image.Image, text: str, time: float, start: float, end: float) -> None:
        if time < start or time >= end:
            return
        entrance = smoothstep((time - start) / 0.32)
        exit_amount = smoothstep((end - time) / 0.32)
        opacity = min(entrance, exit_amount)
        layer = tracked_text_layer(text, 25, (246, 219, 157, 255), 2, 2)
        y = lerp(1072, 1058, entrance)
        paste_center(canvas, layer, (WIDTH / 2, y), opacity)

    def draw_shard(
        self,
        canvas: Image.Image,
        center: tuple[float, float],
        size: float,
        color: tuple[int, int, int],
        angle: float = 0.0,
        opacity: float = 1.0,
    ) -> None:
        if size <= 1 or opacity <= 0:
            return
        glow = self.glow(size * 0.72, color, int(92 * opacity))
        paste_center(canvas, glow, center)
        layer_size = int(size * 2.4)
        layer = Image.new("RGBA", (layer_size, layer_size))
        draw = ImageDraw.Draw(layer)
        cx = cy = layer_size / 2
        half = size / 2
        points = ((cx, cy - half), (cx + half * 0.52, cy), (cx, cy + half), (cx - half * 0.52, cy))
        fill = (*color, int(230 * opacity))
        outline = (235, 184, 86, int(235 * opacity))
        draw.polygon(points, fill=fill, outline=outline, width=max(2, round(size * 0.045)))
        draw.line((cx, cy - half * 0.85, cx, cy + half * 0.74), fill=(248, 223, 144, int(150 * opacity)), width=max(1, round(size * 0.025)))
        draw.line((cx, cy, cx + half * 0.43, cy), fill=(30, 25, 78, int(110 * opacity)), width=max(1, round(size * 0.018)))
        if angle:
            layer = layer.rotate(round(angle), resample=Image.Resampling.BICUBIC, expand=False)
        paste_center(canvas, layer, center)

    def draw_trail(
        self,
        canvas: Image.Image,
        points: list[tuple[float, float]],
        color: tuple[int, int, int],
        width: int = 5,
        alpha: int = 150,
    ) -> None:
        if len(points) < 2:
            return
        soft = Image.new("RGBA", canvas.size)
        ImageDraw.Draw(soft).line(points, fill=(*color, alpha // 2), width=width * 4, joint="curve")
        soft = soft.filter(ImageFilter.GaussianBlur(width * 2.2))
        canvas.alpha_composite(soft)
        sharp = Image.new("RGBA", canvas.size)
        ImageDraw.Draw(sharp).line(points, fill=(*color, alpha), width=width, joint="curve")
        canvas.alpha_composite(sharp)

    def radial_reveal(
        self,
        previous: Image.Image,
        following: Image.Image,
        center: tuple[float, float],
        amount: float,
    ) -> Image.Image:
        amount = ease_out(amount)
        radius = amount * math.hypot(WIDTH, HEIGHT)
        mask = Image.new("L", (WIDTH, HEIGHT))
        draw = ImageDraw.Draw(mask)
        draw.ellipse(
            (center[0] - radius, center[1] - radius, center[0] + radius, center[1] + radius),
            fill=255,
        )
        return Image.composite(following, previous, mask)

    def transition_mechanic(
        self,
        canvas: Image.Image,
        realm: str,
        center: tuple[float, float],
        amount: float,
        reverse: bool = False,
    ) -> None:
        if not 0.0 <= amount <= 1.0:
            return
        pulse = math.sin(math.pi * amount)
        width = lerp(86, 760, ease_out(amount))
        angle = lerp(-34 if not reverse else 34, 24 if not reverse else -24, amount)
        color_name = {
            "crystal": "purple",
            "emerald": "green",
            "celestial": "yellow",
            "ember": "orange",
            "frost": "blue",
            "nexus": "red",
        }[realm]
        glow = self.glow(lerp(42, 150, amount), ORB_COLORS[color_name], int(76 * pulse))
        paste_center(canvas, glow, center)
        mechanic = self.bank.transformed(f"mechanic-{realm}", width, angle)
        paste_center(canvas, mechanic, center, min(1.0, pulse * 1.65))

    def crown_piece(self, index: int, target_width: float, angle: float) -> Image.Image:
        source, _ = self.crown_pieces.pieces[index]
        quantized_width = max(4, int(round(target_width / 4.0) * 4))
        quantized_angle = int(round(angle / 2.0) * 2)
        key = (index, quantized_width, quantized_angle)
        if key in self.piece_cache:
            return self.piece_cache[key]
        height = max(1, round(source.height * quantized_width / source.width))
        result = source.resize((quantized_width, height), Image.Resampling.LANCZOS)
        if quantized_angle:
            result = result.rotate(quantized_angle, resample=Image.Resampling.BICUBIC, expand=True)
        self.piece_cache[key] = result
        return result

    def harmony(self, time: float) -> Image.Image:
        canvas = self.background("crystal", time, 0.75)
        self.draw_motes(canvas, time, 0.82)
        crown_center = (360 + math.sin(time * 0.42) * 8, 348 + math.sin(time * 0.86) * 6)
        crown_width = lerp(470, 548, smoothstep(time / 4.32))
        crown = self.bank.transformed("crown", crown_width, math.sin(time * 0.38) * 1.2)
        pulse = 0.5 + 0.5 * math.sin(time * 1.4)
        paste_center(canvas, self.glow(118, (106, 89, 232), int(54 + 26 * pulse)), crown_center)
        paste_center(canvas, crown, crown_center)

        orbit_center = (360, 460)
        for index, name in enumerate(ORB_NAMES):
            angle = index * math.tau / 6.0 + time * 0.34 - math.pi / 2
            radius_x = 272 + 8 * math.sin(time * 0.6 + index)
            radius_y = 250 + 6 * math.cos(time * 0.7 + index)
            position = (orbit_center[0] + math.cos(angle) * radius_x, orbit_center[1] + math.sin(angle) * radius_y)
            size = 76 + 5 * math.sin(time * 1.2 + index)
            paste_center(canvas, self.glow(34, ORB_COLORS[name], 44), position)
            paste_center(canvas, self.bank.transformed(f"orb-{name}", size), position)
            self.draw_trail(canvas, [position, (360, 430)], ORB_COLORS[name], 2, 40)

        note_amount = smoothstep((time - 0.25) / 4.07)
        note = bezier((350, 1118), (94, 850), (650, 680), (360, 290), note_amount)
        trail = [
            bezier((350, 1118), (94, 850), (650, 680), (360, 290), max(0, note_amount - step * 0.035))
            for step in reversed(range(9))
        ]
        self.draw_trail(canvas, trail, ORB_COLORS["purple"], 4, 145)
        self.draw_shard(canvas, note, 44, ORB_COLORS["purple"], time * 65)
        if time >= 4.32:
            lock = smoothstep((time - 4.32) / 0.55)
            ring = Image.new("RGBA", canvas.size)
            draw = ImageDraw.Draw(ring)
            radius = lerp(20, 210, lock)
            draw.ellipse(
                (360 - radius, 348 - radius, 360 + radius, 348 + radius),
                outline=(174, 117, 255, int(120 * (1 - lock))),
                width=5,
            )
            canvas.alpha_composite(ring)
        if time >= 5.16:
            approach = smoothstep((time - 5.16) / 0.66)
            boss = self.bank.transformed("architect", lerp(250, 390, approach), -3 + approach * 3)
            paste_center(canvas, boss, (360, lerp(-170, 120, approach)), 0.82)
        self.draw_caption(canvas, "THE CROWN KEPT SIX REALMS IN HARMONY", time, 0.85, 5.12)
        canvas.alpha_composite(self.vignette)
        return canvas

    def fracture(self, time: float) -> Image.Image:
        reveal = smoothstep((time - 6.02) / 0.58)
        crystal = self.background("crystal", time, 0.75)
        nexus = self.background("nexus", time, 0.58)
        canvas = self.radial_reveal(crystal, nexus, (360, 460), reveal)
        self.draw_motes(canvas, time, 0.72)
        boss_amount = smoothstep((time - 5.82) / 1.0)
        boss_width = lerp(395, 470, boss_amount)
        boss = self.bank.transformed("architect", boss_width, math.sin(time * 0.5) * 1.2)
        paste_center(canvas, self.glow(118, (119, 48, 208), 58), (360, 238))
        paste_center(canvas, boss, (360, lerp(72, 248, boss_amount)))

        ring_amount = clamp01((time - 8.05) / 3.73)
        if time >= 7.92:
            ring_size = 382 + 28 * math.sin((time - 8.0) * 2.0)
            ring = self.bank.transformed("mechanic-nexus", ring_size, (time - 8.0) * 16)
            paste_center(canvas, self.glow(92, (90, 80, 236), 64), (360, 820))
            paste_center(canvas, ring, (360, 820), 0.86)

        if time < 6.15:
            shake = 4.0 * math.sin((time - 5.82) * 74.0) * (1.0 - (time - 5.82) / 0.33)
            crown = self.bank.transformed("crown", 520, shake * 0.25)
            paste_center(canvas, crown, (360 + shake, 590 - shake * 0.5))
            cracks = Image.new("RGBA", canvas.size)
            draw = ImageDraw.Draw(cracks)
            for offset in (-58, -24, 22, 63):
                draw.line(
                    ((360 + offset, 480), (350 + offset * 0.55, 565), (370 + offset * 0.35, 670)),
                    fill=(167, 68, 235, 180),
                    width=3,
                )
            canvas.alpha_composite(cracks)
        else:
            burst = smoothstep((time - 6.15) / 1.65)
            chase = smoothstep((time - 7.85) / 3.60)
            source_center = (360.0, 590.0)
            scale = 520.0 / self.crown_pieces.width
            directions = ((-255, -70), (-215, 142), (-72, 220), (76, 218), (218, 135), (260, -62))
            colors = ("purple", "green", "yellow", "orange", "blue", "red")
            for index, ((fragment, fragment_center), direction, color_name) in enumerate(
                zip(self.crown_pieces.pieces, directions, colors)
            ):
                origin = (
                    source_center[0] + (fragment_center[0] - self.crown_pieces.width / 2.0) * scale,
                    source_center[1] + (fragment_center[1] - self.crown_pieces.height / 2.0) * scale,
                )
                expanded = (origin[0] + direction[0] * burst, origin[1] + direction[1] * burst)
                angle = index * math.tau / 6.0 + (time - 7.8) * 1.35
                portal_target = (360 + math.cos(angle) * lerp(225, 72, chase), 820 + math.sin(angle) * lerp(165, 55, chase))
                center = (lerp(expanded[0], portal_target[0], chase), lerp(expanded[1], portal_target[1], chase))
                trail_start = (lerp(origin[0], center[0], 0.62), lerp(origin[1], center[1], 0.62))
                self.draw_trail(canvas, [trail_start, center], ORB_COLORS[color_name], 4, 116)
                if chase < 0.47:
                    fragment_width = fragment.width * scale * lerp(1.0, 0.72, chase)
                    piece = self.crown_piece(index, fragment_width, direction[0] * 0.03 * burst + index * 8)
                    paste_center(canvas, piece, center)
                else:
                    glyph_amount = smoothstep((chase - 0.47) / 0.16)
                    self.draw_shard(
                        canvas,
                        center,
                        lerp(92, 58, chase),
                        ORB_COLORS[color_name],
                        (time * 78 + index * 34),
                        glyph_amount,
                    )
            if time < 7.28:
                shock = smoothstep((time - 6.15) / 1.13)
                overlay = Image.new("RGBA", canvas.size)
                draw = ImageDraw.Draw(overlay)
                radius = lerp(24, 420, shock)
                draw.ellipse(
                    (360 - radius, 590 - radius, 360 + radius, 590 + radius),
                    outline=(133, 52, 222, int(170 * (1.0 - shock))),
                    width=max(2, round(10 * (1.0 - shock))),
                )
                canvas.alpha_composite(overlay)
        self.draw_caption(canvas, "ITS MAKER CHOSE CONTROL", time, 6.52, 10.78)
        canvas.alpha_composite(self.vignette)
        return canvas

    def realm_journey(self, time: float) -> Image.Image:
        realm_index = next(
            (index for index, (start, end, _, _) in enumerate(REALM_BEATS) if start <= time < end),
            len(REALM_BEATS) - 1,
        )
        start, end, realm, active_color = REALM_BEATS[realm_index]
        previous_realm = "nexus" if realm_index == 0 else REALM_BEATS[realm_index - 1][2]
        local = clamp01((time - start) / (end - start))
        previous = self.background(previous_realm, time, 0.58)
        following = self.background(realm, time, 0.82)
        portal_center = (
            360 + 145 * math.sin(realm_index * 1.73),
            520 + 135 * math.cos(realm_index * 1.11),
        )
        wipe = clamp01(local / 0.28)
        canvas = self.radial_reveal(previous, following, portal_center, wipe)
        if local <= 0.36:
            self.transition_mechanic(canvas, realm, portal_center, clamp01(local / 0.36), realm_index % 2 == 1)
        self.draw_motes(canvas, time, 0.72)

        cluster_phase = (time - 11.78) / (17.70 - 11.78)
        leader = (
            360 + math.sin(cluster_phase * math.tau * 1.55) * 175,
            260 + cluster_phase * 690,
        )
        colors = ("purple", "green", "yellow", "orange", "blue", "red")
        for index, color_name in enumerate(colors):
            if index < realm_index:
                continue
            offset_angle = time * 2.25 + index * math.tau / 6.0
            center = (
                leader[0] + math.cos(offset_angle) * (48 + index * 4),
                leader[1] + math.sin(offset_angle) * (32 + index * 3),
            )
            size = 52
            if index == realm_index:
                deposit = smoothstep((local - 0.34) / 0.56)
                target = (360, 900 if realm not in ("frost", "nexus") else 820)
                center = bezier(center, (center[0] + 120, center[1] + 90), (target[0] - 80, target[1] - 80), target, deposit)
                size = lerp(58, 8, deposit)
            trail = [(center[0] - 44 * math.cos(offset_angle), center[1] - 44 * math.sin(offset_angle)), center]
            self.draw_trail(canvas, trail, ORB_COLORS[color_name], 3, 110)
            self.draw_shard(canvas, center, size, ORB_COLORS[color_name], time * 92 + index * 41)

        if realm == "nexus" and local > 0.72:
            signal = smoothstep((local - 0.72) / 0.28)
            center = bezier((360, 820), (585, 660), (172, 390), (360, 120), signal)
            self.draw_trail(canvas, [(360, 820), center], (91, 220, 249), 5, 138)
            self.draw_shard(canvas, center, 34, (91, 220, 249), -time * 88)
        canvas.alpha_composite(self.vignette)
        return canvas

    def awakening(self, time: float) -> Image.Image:
        local = clamp01((time - 17.70) / (23.58 - 17.70))
        if time < 18.06:
            nexus = self.background("nexus", time, 0.55)
            crystal = self.background("crystal", time, 0.72)
            canvas = self.radial_reveal(nexus, crystal, (360, 142), (time - 17.70) / 0.36)
            self.transition_mechanic(canvas, "celestial", (360, 142), clamp01((time - 17.70) / 0.36), True)
        else:
            canvas = self.background("crystal", time, 0.72)
        self.draw_motes(canvas, time, 0.88)

        launcher_in = ease_out((time - 17.70) / 2.05)
        launcher_center = (470, lerp(1320, 780, launcher_in))
        launcher_width = lerp(350, 432, launcher_in)
        paste_center(canvas, self.glow(112, (69, 195, 246), int(32 + 38 * launcher_in)), launcher_center)
        launcher = self.bank.transformed("launcher", launcher_width, math.sin(time * 0.62) * 1.0)
        paste_center(canvas, launcher, launcher_center)

        lumi_in = ease_out((time - 17.78) / 1.55)
        lumi_center = (
            lerp(82, 223, lumi_in),
            lerp(1210, 790, lumi_in) + math.sin(time * 1.55) * 7,
        )
        lumi_angle = -2.5 + math.sin(time * 0.9) * 1.4
        lumi = self.bank.transformed("lumi", 286, lumi_angle)
        paste_center(canvas, self.glow(72, (96, 220, 245), int(34 + 26 * lumi_in)), (lumi_center[0], lumi_center[1] + 18))
        paste_center(canvas, lumi, lumi_center)

        signal_amount = smoothstep((time - 17.70) / 0.25)
        if time < 18.40:
            signal = bezier((360, 128), (260, 310), (510, 410), (470, 650), signal_amount)
            signal_trail = [
                bezier(
                    (360, 128),
                    (260, 310),
                    (510, 410),
                    (470, 650),
                    lerp(max(0.0, signal_amount - 0.18), signal_amount, step / 7.0),
                )
                for step in range(8)
            ]
            self.draw_trail(canvas, signal_trail, (86, 224, 248), 4, 150)
            self.draw_shard(canvas, signal, 34, (86, 224, 248), -time * 90)
        if 17.95 <= time < 19.10:
            wake = smoothstep((time - 17.95) / 1.15)
            overlay = Image.new("RGBA", canvas.size)
            draw = ImageDraw.Draw(overlay)
            for index in range(3):
                radius = 42 + index * 32 + wake * 74
                draw.arc(
                    (470 - radius, 780 - radius, 470 + radius, 780 + radius),
                    start=30 + index * 46 + wake * 140,
                    end=255 + index * 42 + wake * 140,
                    fill=(73, 215, 242, int(130 * (1.0 - wake) + 24)),
                    width=3,
                )
            canvas.alpha_composite(overlay)
        if 20.95 <= time < 22.15:
            slot = smoothstep((time - 20.95) / 0.55)
            shard = bezier((lumi_center[0] + 40, lumi_center[1] - 20), (310, 620), (430, 560), (470, 548), slot)
            slot_trail = [
                bezier(
                    (lumi_center[0] + 40, lumi_center[1] - 20),
                    (310, 620),
                    (430, 560),
                    (470, 548),
                    lerp(max(0.0, slot - 0.22), slot, step / 7.0),
                )
                for step in range(8)
            ]
            self.draw_trail(canvas, slot_trail, (177, 91, 246), 4, 132)
            self.draw_shard(canvas, shard, lerp(38, 22, slot), ORB_COLORS["purple"], time * 86)
        if 21.50 <= time:
            pulse = 0.5 + 0.5 * math.sin((time - 21.50) * 5.2)
            paste_center(canvas, self.glow(54, (113, 212, 248), int(60 + 40 * pulse)), (470, 592))

        self.draw_caption(canvas, "NOW YOU ARE THE LAST PRISM KEEPER", time, 19.55, 23.25)
        canvas.alpha_composite(self.vignette)
        return canvas

    def vow(self, time: float) -> Image.Image:
        local = clamp01((time - 23.58) / (27.80 - 23.58))
        canvas = self.background("crystal", time, 0.58)
        dark = Image.new("RGBA", canvas.size, (3, 5, 17, int(82 + local * 42)))
        canvas.alpha_composite(dark)
        self.draw_motes(canvas, time, 1.0)

        crown_center = (360, lerp(365, 410, local))
        crown_width = lerp(430, 560, ease_out(local))
        paste_center(canvas, self.glow(130, (112, 84, 224), 60), crown_center)
        paste_center(canvas, self.bank.transformed("crown", crown_width, math.sin(time * 0.32)), crown_center, 0.92)

        # The six realm emblems remain behind the orbiting spirits and never become UI cards.
        for index, realm in enumerate(("crystal", "emerald", "celestial", "ember", "frost", "nexus")):
            angle = index * math.tau / 6.0 + local * 0.42 - math.pi / 2
            center = (360 + math.cos(angle) * 285, 485 + math.sin(angle) * 330)
            emblem = self.bank.transformed(f"mechanic-{realm}", 92, local * 18 * (-1 if index % 2 else 1))
            paste_center(canvas, emblem, center, 0.20)

        for index, name in enumerate(ORB_NAMES):
            delay = index * 0.055
            rise = smoothstep((local - delay) / max(0.01, 0.73 - delay))
            start = (70 + index * 116, 1120 + (index % 2) * 80)
            angle = index * math.tau / 6.0 - math.pi / 2 + local * 0.75
            target = (360 + math.cos(angle) * 260, 490 + math.sin(angle) * 285)
            center = bezier(start, (start[0], 840), (target[0] + math.sin(index) * 85, 620), target, rise)
            trail_start = bezier(start, (start[0], 840), (target[0] + math.sin(index) * 85, 620), target, max(0, rise - 0.12))
            self.draw_trail(canvas, [trail_start, center], ORB_COLORS[name], 4, 108)
            size = 78 + 7 * math.sin(time * 1.7 + index)
            paste_center(canvas, self.glow(34, ORB_COLORS[name], 44), center)
            paste_center(canvas, self.bank.transformed(f"orb-{name}", size), center)

        launch = smoothstep((time - 23.58) / 1.15)
        launch_center = bezier((470, 1020), (580, 780), (230, 610), (360, 330), launch)
        launch_trail = [
            bezier(
                (470, 1020),
                (580, 780),
                (230, 610),
                (360, 330),
                lerp(max(0.0, launch - 0.20), launch, step / 8.0),
            )
            for step in range(9)
        ]
        self.draw_trail(canvas, launch_trail, (86, 225, 248), 5, 145)
        self.draw_shard(canvas, launch_center, lerp(46, 30, launch), (86, 225, 248), time * 90)
        self.draw_caption(canvas, "HEAL THE GUARDIANS  ·  RESTORE THE CROWN", time, 24.02, 27.36)
        canvas.alpha_composite(self.vignette)
        return canvas

    def title(self, time: float) -> Image.Image:
        local = clamp01((time - 27.80) / 2.20)
        canvas = self.title_backdrop.copy()
        self.draw_motes(canvas, time, 0.72)

        crown_width = lerp(610, 1040, ease_out(local / 0.58))
        crown_center = (360, lerp(430, 335, smoothstep(local / 0.65)))
        paste_center(canvas, self.glow(168, (112, 84, 224), 48), crown_center)
        paste_center(canvas, self.bank.transformed("crown", crown_width), crown_center, lerp(0.88, 0.34, local))

        constellation = Image.new("RGBA", canvas.size)
        draw = ImageDraw.Draw(constellation)
        for index, name in enumerate(ORB_NAMES):
            angle = index * math.tau / 6.0 + time * 0.18
            center = (360 + math.cos(angle) * 238, 590 + math.sin(angle) * 270)
            draw.ellipse((center[0] - 3, center[1] - 3, center[0] + 3, center[1] + 3), fill=(*ORB_COLORS[name], 150))
        canvas.alpha_composite(constellation)

        reveal = smoothstep((time - 28.08) / 0.42)
        title = tracked_text_layer("PAOPAO FUSION", 65, (119, 244, 240, 255), 3, 3)
        title_width = max(1, round(title.width * lerp(0.90, 1.0, reveal)))
        title_height = max(1, round(title.height * lerp(0.90, 1.0, reveal)))
        title = title.resize((title_width, title_height), Image.Resampling.LANCZOS)
        paste_center(canvas, title, (360, lerp(660, 642, reveal)), reveal)
        if time >= 28.42:
            subtitle_reveal = smoothstep((time - 28.42) / 0.32)
            subtitle = tracked_text_layer("THE SHATTERED CROWN", 24, (246, 211, 137, 255), 4, 2)
            paste_center(canvas, subtitle, (360, 718), subtitle_reveal)
        if time >= 28.85:
            vow = tracked_text_layer("SIX REALMS  ·  ONE CHOICE", 16, (172, 190, 215, 230), 3, 1)
            paste_center(canvas, vow, (360, 770), smoothstep((time - 28.85) / 0.34))
        canvas.alpha_composite(self.vignette)
        return canvas

    def frame(self, index: int) -> Image.Image:
        time = index / FPS
        if time < 5.82:
            return self.harmony(time)
        if time < 11.78:
            return self.fracture(time)
        if time < 17.70:
            return self.realm_journey(time)
        if time < 23.58:
            return self.awakening(time)
        if time < 27.80:
            return self.vow(time)
        return self.title(time)


def export_previews(cinematic: Cinematic, directory: Path) -> list[Path]:
    directory.mkdir(parents=True, exist_ok=True)
    outputs: list[Path] = []
    frames: list[Image.Image] = []
    for time in PREVIEW_TIMES:
        index = min(FRAME_COUNT - 1, round(time * FPS))
        frame = cinematic.frame(index).convert("RGB")
        output = directory / f"frame-{round(time * 1000):05d}ms.jpg"
        frame.save(output, quality=91, optimize=True, subsampling=0)
        outputs.append(output)
        frames.append(frame.resize((180, 320), Image.Resampling.LANCZOS))
    sheet = Image.new("RGB", (180 * 4, 320 * 3), (3, 5, 15))
    for index, frame in enumerate(frames):
        sheet.paste(frame, ((index % 4) * 180, (index // 4) * 320))
    sheet_path = directory / "paopao-opening-v2-preview-sheet.jpg"
    sheet.save(sheet_path, quality=90, optimize=True, subsampling=0)
    outputs.append(sheet_path)
    return outputs


def render_video(cinematic: Cinematic, score_path: Path, video_path: Path, crf: int) -> None:
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        raise RuntimeError("ffmpeg is required to render the cinematic")
    command = [
        ffmpeg,
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-f",
        "rawvideo",
        "-pix_fmt",
        "rgb24",
        "-s:v",
        f"{WIDTH}x{HEIGHT}",
        "-r",
        str(FPS),
        "-i",
        "pipe:0",
        "-i",
        str(score_path),
        "-map",
        "0:v:0",
        "-map",
        "1:a:0",
        "-t",
        f"{DURATION:.3f}",
        "-r",
        str(FPS),
        "-c:v",
        "libx264",
        "-preset",
        "slow",
        "-crf",
        str(crf),
        "-profile:v",
        "high",
        "-level:v",
        "4.0",
        "-pix_fmt",
        "yuv420p",
        "-colorspace",
        "bt709",
        "-color_primaries",
        "bt709",
        "-color_trc",
        "bt709",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        "-ar",
        str(SAMPLE_RATE),
        "-ac",
        "2",
        "-movflags",
        "+faststart",
        str(video_path),
    ]
    video_path.parent.mkdir(parents=True, exist_ok=True)
    process = subprocess.Popen(command, stdin=subprocess.PIPE, stderr=subprocess.PIPE)
    assert process.stdin is not None
    try:
        for index in range(FRAME_COUNT):
            frame = cinematic.frame(index).convert("RGB")
            process.stdin.write(frame.tobytes())
            if index % 90 == 0 or index == FRAME_COUNT - 1:
                print(f"Rendered {index + 1:03d}/{FRAME_COUNT} frames", file=sys.stderr, flush=True)
    except BrokenPipeError:
        pass
    finally:
        process.stdin.close()
    assert process.stderr is not None
    errors = process.stderr.read().decode("utf-8", errors="replace")
    return_code = process.wait()
    if return_code:
        raise RuntimeError(f"ffmpeg failed with exit code {return_code}:\n{errors}")


def validate(video_path: Path, score_path: Path) -> dict[str, object]:
    ffprobe = shutil.which("ffprobe")
    ffmpeg = shutil.which("ffmpeg")
    if not ffprobe or not ffmpeg:
        raise RuntimeError("ffmpeg and ffprobe are required for validation")
    probe = subprocess.run(
        [
            ffprobe,
            "-v",
            "error",
            "-count_frames",
            "-show_entries",
            "format=duration,size,bit_rate:stream=codec_type,codec_name,profile,level,pix_fmt,width,height,r_frame_rate,nb_read_frames,sample_rate,channels",
            "-of",
            "json",
            str(video_path),
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    payload = json.loads(probe.stdout)
    streams = payload.get("streams", [])
    video = next((item for item in streams if item.get("codec_type") == "video"), {})
    audio = next((item for item in streams if item.get("codec_type") == "audio"), {})
    duration = float(payload.get("format", {}).get("duration", 0))
    size = int(payload.get("format", {}).get("size", 0))
    failures: list[str] = []
    if abs(duration - DURATION) > 0.05:
        failures.append(f"duration is {duration:.3f}s")
    if video.get("codec_name") != "h264":
        failures.append(f"video codec is {video.get('codec_name')}")
    if video.get("profile") != "High":
        failures.append(f"video profile is {video.get('profile')}")
    if int(video.get("level", 999)) > 40:
        failures.append(f"video level is {video.get('level')}")
    if video.get("pix_fmt") != "yuv420p":
        failures.append(f"pixel format is {video.get('pix_fmt')}")
    if (video.get("width"), video.get("height")) != (WIDTH, HEIGHT):
        failures.append(f"dimensions are {video.get('width')}x{video.get('height')}")
    if video.get("r_frame_rate") != f"{FPS}/1":
        failures.append(f"frame rate is {video.get('r_frame_rate')}")
    if int(video.get("nb_read_frames", 0)) != FRAME_COUNT:
        failures.append(f"decoded frame count is {video.get('nb_read_frames')}")
    if audio.get("codec_name") != "aac":
        failures.append(f"audio codec is {audio.get('codec_name')}")
    if audio.get("sample_rate") != str(SAMPLE_RATE) or int(audio.get("channels", 0)) != 2:
        failures.append(f"audio is {audio.get('sample_rate')}Hz/{audio.get('channels')}ch")
    if size > 25 * 1024 * 1024:
        failures.append(f"file size is {size / (1024 * 1024):.2f} MiB")
    with wave.open(str(score_path), "rb") as wav:
        if wav.getframerate() != SAMPLE_RATE or wav.getnchannels() != 2 or wav.getnframes() != SAMPLE_COUNT:
            failures.append("score WAV format/duration is invalid")
    decode = subprocess.run(
        [ffmpeg, "-v", "error", "-i", str(video_path), "-f", "null", "-"],
        capture_output=True,
        text=True,
    )
    if decode.returncode:
        failures.append("full decode failed: " + decode.stderr.strip())
    result: dict[str, object] = {
        "duration_seconds": duration,
        "size_bytes": size,
        "size_mib": round(size / (1024 * 1024), 3),
        "video": video,
        "audio": audio,
        "score": str(score_path),
        "video_path": str(video_path),
        "valid": not failures,
        "failures": failures,
    }
    if failures:
        raise RuntimeError("Validation failed:\n- " + "\n- ".join(failures))
    return result


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--video", type=Path, default=VIDEO_PATH)
    parser.add_argument("--score", type=Path, default=SCORE_PATH)
    parser.add_argument("--preview-dir", type=Path, default=PREVIEW_DIR)
    parser.add_argument("--preview-only", action="store_true", help="Export preview stills without encoding video")
    parser.add_argument("--no-previews", action="store_true")
    parser.add_argument("--validate-only", action="store_true")
    parser.add_argument("--crf", type=int, default=19)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.validate_only:
        print(json.dumps(validate(args.video, args.score), indent=2))
        return 0
    cinematic = Cinematic()
    if not args.no_previews:
        preview_paths = export_previews(cinematic, args.preview_dir)
        print(f"Exported {len(preview_paths)} preview artifacts to {args.preview_dir}")
    if args.preview_only:
        return 0
    ScoreSynth().render(args.score)
    render_video(cinematic, args.score, args.video, args.crf)
    print(json.dumps(validate(args.video, args.score), indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

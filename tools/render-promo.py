#!/usr/bin/env python3
"""Render the official 10-second PaoPao Fusion coming-soon promo."""

from __future__ import annotations

import math
import subprocess
import wave
from functools import lru_cache
from pathlib import Path

import imageio.v2 as imageio
import imageio_ffmpeg
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "promo" / "source"
OUTPUT = ROOT / "promo" / "output"
WORK = ROOT / "promo" / "work"

W, H = 1920, 1080
FPS = 30
DURATION = 10.0
FRAME_COUNT = int(FPS * DURATION)

FONT_DISPLAY = "/System/Library/Fonts/Supplemental/DIN Alternate Bold.ttf"
FONT_BOLD = "/System/Library/Fonts/Supplemental/Arial Bold.ttf"
FONT_REGULAR = "/System/Library/Fonts/Avenir Next.ttc"

BG_PATH = SOURCE / "crystal-kingdom-cinematic-v1.png"
LAUNCHER_PATH = ROOT / "public/assets/sprites/v3/crystal-launcher-hd.png"
ORB_DIR = ROOT / "public/assets/sprites/v7"
POWER_BOMB = ROOT / "public/assets/sprites/v3/power-bomb-hd.png"
POWER_PRISM = ROOT / "public/assets/sprites/v3/power-rainbow-hd.png"
ARTIFACT = ROOT / "public/assets/sprites/v4/artifact-chrono-prism.png"
CHEST = ROOT / "public/assets/ui/v6/mystery-chest-open.png"
COINS = ROOT / "public/assets/ui/v6/coin-stack.png"

CYAN = (104, 239, 255)
GOLD = (255, 213, 118)
VIOLET = (164, 111, 255)
WHITE = (246, 251, 255)
MUTED = (190, 210, 232)
INK = (3, 8, 21)


def clamp(value: float, low: float = 0.0, high: float = 1.0) -> float:
    return max(low, min(high, value))


def lerp(a: float, b: float, t: float) -> float:
    return a + (b - a) * t


def smooth(a: float, b: float, value: float) -> float:
    if a == b:
        return 1.0 if value >= b else 0.0
    x = clamp((value - a) / (b - a))
    return x * x * (3.0 - 2.0 * x)


def ease_out_back(value: float) -> float:
    x = clamp(value)
    c1 = 1.70158
    c3 = c1 + 1.0
    return 1.0 + c3 * (x - 1.0) ** 3 + c1 * (x - 1.0) ** 2


@lru_cache(maxsize=48)
def font(path: str, size: int, index: int = 0) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(path, size=size, index=index)


@lru_cache(maxsize=64)
def asset(path: str) -> Image.Image:
    return Image.open(path).convert("RGBA")


@lru_cache(maxsize=512)
def sized_asset(path: str, size: int) -> Image.Image:
    source = asset(path)
    ratio = min(size / source.width, size / source.height)
    width = max(1, int(source.width * ratio))
    height = max(1, int(source.height * ratio))
    return source.resize((width, height), Image.Resampling.LANCZOS)


def with_opacity(image: Image.Image, opacity: float) -> Image.Image:
    opacity = clamp(opacity)
    if opacity >= 0.999:
        return image
    copy = image.copy()
    alpha = copy.getchannel("A").point(lambda p: int(p * opacity))
    copy.putalpha(alpha)
    return copy


def paste_center(
    target: Image.Image,
    source: Image.Image,
    center: tuple[float, float],
    opacity: float = 1.0,
    rotation: float = 0.0,
) -> None:
    image = source
    if rotation:
        image = image.rotate(rotation, resample=Image.Resampling.BICUBIC, expand=True)
    if opacity < 0.999:
        image = with_opacity(image, opacity)
    x = int(center[0] - image.width / 2)
    y = int(center[1] - image.height / 2)
    target.alpha_composite(image, (x, y))


def alpha_composite(target: Image.Image, layer: Image.Image, opacity: float = 1.0) -> None:
    if opacity <= 0.001:
        return
    target.alpha_composite(layer if opacity >= 0.999 else with_opacity(layer, opacity))


def centered_text(
    draw: ImageDraw.ImageDraw,
    center_x: float,
    y: float,
    text: str,
    typeface: ImageFont.FreeTypeFont,
    fill: tuple[int, int, int] | tuple[int, int, int, int],
    *,
    stroke: int = 0,
    stroke_fill: tuple[int, int, int] = INK,
    shadow: int = 0,
) -> tuple[float, float, float, float]:
    box = draw.textbbox((0, 0), text, font=typeface, stroke_width=stroke)
    width = box[2] - box[0]
    x = center_x - width / 2 - box[0]
    if shadow:
        draw.text(
            (x + shadow, y + shadow), text, font=typeface, fill=(0, 0, 0, 150),
            stroke_width=stroke + 2, stroke_fill=(0, 0, 0, 90),
        )
    draw.text(
        (x, y), text, font=typeface, fill=fill,
        stroke_width=stroke, stroke_fill=stroke_fill,
    )
    return (x, y, x + width, y + box[3] - box[1])


def tracked_text(
    draw: ImageDraw.ImageDraw,
    center_x: float,
    y: float,
    text: str,
    typeface: ImageFont.FreeTypeFont,
    fill: tuple[int, int, int],
    spacing: float,
    *,
    stroke: int = 0,
    stroke_fill: tuple[int, int, int] = INK,
) -> None:
    widths = [draw.textlength(char, font=typeface) for char in text]
    total = sum(widths) + spacing * max(0, len(text) - 1)
    x = center_x - total / 2
    for char, width in zip(text, widths):
        draw.text(
            (x, y), char, font=typeface, fill=fill,
            stroke_width=stroke, stroke_fill=stroke_fill,
        )
        x += width + spacing


def draw_glow(
    target: Image.Image,
    box: tuple[int, int, int, int],
    color: tuple[int, int, int],
    opacity: int,
    blur: int,
) -> None:
    x1, y1, x2, y2 = box
    sprite, pad = glow_sprite(max(1, x2 - x1), max(1, y2 - y1), color, opacity, blur)
    target.alpha_composite(sprite, (x1 - pad, y1 - pad))


@lru_cache(maxsize=256)
def glow_sprite(
    width: int,
    height: int,
    color: tuple[int, int, int],
    opacity: int,
    blur: int,
) -> tuple[Image.Image, int]:
    pad = max(4, blur * 2)
    glow = Image.new("RGBA", (width + pad * 2, height + pad * 2), (0, 0, 0, 0))
    ImageDraw.Draw(glow).ellipse((pad, pad, pad + width, pad + height), fill=(*color, opacity))
    return glow.filter(ImageFilter.GaussianBlur(blur)), pad


@lru_cache(maxsize=24)
def panel_glow_sprite(width: int, height: int, accent: tuple[int, int, int]) -> tuple[Image.Image, int]:
    pad = 42
    glow = Image.new("RGBA", (width + pad * 2, height + pad * 2), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    gd.rounded_rectangle((pad, pad, pad + width, pad + height), radius=34, outline=(*accent, 120), width=10)
    return glow.filter(ImageFilter.GaussianBlur(18)), pad


def draw_glass_panel(
    layer: Image.Image,
    box: tuple[int, int, int, int],
    accent: tuple[int, int, int],
    opacity: int = 220,
) -> None:
    x1, y1, x2, y2 = box
    glow, pad = panel_glow_sprite(x2 - x1 + 12, y2 - y1 + 12, accent)
    layer.alpha_composite(glow, (x1 - 6 - pad, y1 - 6 - pad))
    draw = ImageDraw.Draw(layer)
    draw.rounded_rectangle(box, radius=30, fill=(4, 11, 30, opacity), outline=(*accent, 210), width=3)
    draw.rounded_rectangle((x1 + 7, y1 + 7, x2 - 7, y2 - 7), radius=24, outline=(*GOLD, 94), width=2)
    draw.rounded_rectangle((x1 + 12, y1 + 12, x2 - 12, y1 + 128), radius=18, fill=(18, 45, 76, 108))
    arm = 34
    corners = [
        ((x1 + 15, y1 + 15 + arm), (x1 + 15, y1 + 15), (x1 + 15 + arm, y1 + 15)),
        ((x2 - 15 - arm, y1 + 15), (x2 - 15, y1 + 15), (x2 - 15, y1 + 15 + arm)),
        ((x1 + 15, y2 - 15 - arm), (x1 + 15, y2 - 15), (x1 + 15 + arm, y2 - 15)),
        ((x2 - 15 - arm, y2 - 15), (x2 - 15, y2 - 15), (x2 - 15, y2 - 15 - arm)),
    ]
    for points in corners:
        draw.line(points, fill=(*GOLD, 220), width=5, joint="curve")
    draw.line((x1 + 92, y1 + 14, x2 - 92, y1 + 14), fill=(*accent, 220), width=4)


BACKGROUND = Image.open(BG_PATH).convert("RGB")


def build_vignette() -> Image.Image:
    small_w, small_h = 480, 270
    yy, xx = np.mgrid[0:small_h, 0:small_w]
    nx = (xx - small_w / 2) / (small_w / 2)
    ny = (yy - small_h / 2) / (small_h / 2)
    distance = np.sqrt(nx * nx + ny * ny)
    alpha = np.clip((distance - 0.35) / 0.78, 0, 1) ** 1.5
    rgba = np.zeros((small_h, small_w, 4), dtype=np.uint8)
    rgba[..., 0:3] = np.array([1, 4, 15], dtype=np.uint8)
    rgba[..., 3] = (alpha * 190).astype(np.uint8)
    return Image.fromarray(rgba, "RGBA").resize((W, H), Image.Resampling.BICUBIC)


VIGNETTE = build_vignette()
RNG = np.random.default_rng(713)
PARTICLES = [
    (
        float(RNG.uniform(20, W - 20)),
        float(RNG.uniform(0, H)),
        float(RNG.uniform(0.8, 3.2)),
        float(RNG.uniform(7, 24)),
        float(RNG.uniform(0, math.tau)),
        CYAN if index % 4 else GOLD,
    )
    for index in range(82)
]


def background_frame(t: float) -> Image.Image:
    progress = t / DURATION
    zoom = 1.095 - 0.035 * progress + 0.008 * math.sin(t * 0.45)
    target_w = int(W * zoom)
    target_h = int(H * zoom)
    source = BACKGROUND.resize((target_w, target_h), Image.Resampling.BICUBIC)
    drift_x = int(26 * math.sin(t * 0.23))
    drift_y = int(12 * math.cos(t * 0.19))
    left = (target_w - W) // 2 + drift_x
    top = (target_h - H) // 2 + drift_y
    left = max(0, min(target_w - W, left))
    top = max(0, min(target_h - H, top))
    frame = source.crop((left, top, left + W, top + H)).convert("RGBA")

    grade = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    gd = ImageDraw.Draw(grade)
    gd.rectangle((0, 0, W, H), fill=(0, 18, 48, 30))
    outro_dark = int(115 * smooth(7.15, 8.0, t))
    if outro_dark:
        gd.rectangle((0, 0, W, H), fill=(0, 4, 18, outro_dark))
    frame.alpha_composite(grade)

    stars = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    sd = ImageDraw.Draw(stars)
    for x, y, radius, speed, phase, color in PARTICLES:
        px = x + math.sin(t * 0.42 + phase) * 13
        py = (y - t * speed + H) % H
        pulse = 0.45 + 0.55 * (0.5 + 0.5 * math.sin(t * 1.7 + phase))
        alpha = int(155 * pulse)
        r = max(1, int(radius))
        sd.ellipse((px - r, py - r, px + r, py + r), fill=(*color, alpha))
        if radius > 2.3:
            sd.line((px - r * 3, py, px + r * 3, py), fill=(*color, alpha // 2), width=1)
            sd.line((px, py - r * 3, px, py + r * 3), fill=(*color, alpha // 2), width=1)
    frame.alpha_composite(stars)
    frame.alpha_composite(VIGNETTE)
    return frame


def hero_layer(t: float) -> Image.Image:
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    draw_glow(layer, (W // 2 - 430, 250, W // 2 + 430, 920), (61, 118, 255), 78, 90)
    draw = ImageDraw.Draw(layer)
    appear = smooth(0.12, 0.75, t)
    y_shift = int(35 * (1.0 - appear))
    draw.line((525, 408 + y_shift, 735, 408 + y_shift), fill=(*GOLD, int(210 * appear)), width=3)
    draw.line((1185, 408 + y_shift, 1395, 408 + y_shift), fill=(*GOLD, int(210 * appear)), width=3)
    draw.polygon(
        ((960, 365 + y_shift), (982, 388 + y_shift), (960, 411 + y_shift), (938, 388 + y_shift)),
        fill=(*CYAN, int(220 * appear)), outline=(*GOLD, int(235 * appear)),
    )
    centered_text(
        draw, W / 2, 410 + y_shift, "PAOPAO", font(FONT_DISPLAY, 166),
        (*WHITE, int(255 * appear)), stroke=7, stroke_fill=(16, 20, 54), shadow=9,
    )
    tracked_text(draw, W / 2, 598 + y_shift, "FUSION", font(FONT_BOLD, 58), CYAN, 24, stroke=3)
    centered_text(
        draw, W / 2, 698 + y_shift, "THE CRYSTAL SAGA AWAKENS", font(FONT_BOLD, 31),
        (*GOLD, int(240 * appear)), stroke=2,
    )
    centered_text(
        draw, W / 2, 758 + y_shift, "A CINEMATIC BUBBLE ADVENTURE", font(FONT_REGULAR, 24),
        (*MUTED, int(220 * appear)), stroke=1,
    )
    draw.line((735, 818, 1185, 818), fill=(*CYAN, int(170 * appear)), width=2)
    return layer


ORB_COLORS = ["blue", "red", "green", "orange", "purple", "yellow"]
GRID = [
    (600, 220, 0), (730, 220, 1), (860, 220, 2), (990, 220, 3), (1120, 220, 4), (1250, 220, 5), (1380, 220, 0),
    (665, 350, 3), (795, 350, 2), (925, 350, 0), (1055, 350, 4), (1185, 350, 1), (1315, 350, 5),
    (730, 480, 5), (860, 480, 1), (990, 480, 2), (1120, 480, 0), (1250, 480, 3),
]


def gameplay_layer(t: float) -> Image.Image:
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    title_alpha = smooth(1.5, 2.05, t)
    centered_text(draw, W / 2, 66, "AIM  •  MATCH  •  ASCEND", font(FONT_DISPLAY, 58), WHITE, stroke=4, shadow=5)
    draw.line((680, 144, 1240, 144), fill=(*CYAN, int(210 * title_alpha)), width=3)

    launcher_progress = ease_out_back(smooth(1.55, 2.18, t))
    launcher_size = max(20, int(510 * launcher_progress))
    launcher_y = lerp(1210, 870, clamp(launcher_progress))
    launcher = sized_asset(str(LAUNCHER_PATH), launcher_size)
    draw_glow(layer, (750, 650, 1170, 1060), (94, 238, 255), int(70 * clamp(launcher_progress)), 55)
    paste_center(layer, launcher, (W / 2, launcher_y), opacity=clamp(launcher_progress))

    for index, (x, y, color_index) in enumerate(GRID):
        start = 1.62 + index * 0.032
        progress = ease_out_back(smooth(start, start + 0.5, t))
        if progress <= 0.01:
            continue
        size = max(8, int(126 * clamp(progress, 0.0, 1.08)))
        orb = sized_asset(str(ORB_DIR / f"nova-{ORB_COLORS[color_index]}.png"), size)
        entry_y = y - (1.0 - clamp(progress)) * 270
        paste_center(layer, orb, (x, entry_y), opacity=clamp(progress))

    muzzle = (960, 663)
    target = (1120, 480)
    if 2.05 < t < 3.55:
        aim_alpha = smooth(2.05, 2.35, t) * (1.0 - smooth(3.28, 3.55, t))
        for index in range(11):
            p = index / 10
            px = lerp(muzzle[0], target[0], p)
            py = lerp(muzzle[1], target[1], p)
            radius = 3 + index * 0.18
            draw.ellipse((px - radius, py - radius, px + radius, py + radius), fill=(*CYAN, int(205 * aim_alpha)))

    shot_progress = smooth(2.62, 3.28, t)
    if 0.0 < shot_progress < 1.0:
        curve = math.sin(shot_progress * math.pi) * 25
        px = lerp(muzzle[0], target[0], shot_progress) + curve
        py = lerp(muzzle[1], target[1], shot_progress)
        shot_orb = sized_asset(str(ORB_DIR / "nova-blue.png"), 136)
        draw_glow(layer, (int(px - 80), int(py - 80), int(px + 80), int(py + 80)), CYAN, 105, 22)
        paste_center(layer, shot_orb, (px, py))
    impact = smooth(3.22, 3.32, t) * (1.0 - smooth(3.32, 3.82, t))
    if impact > 0:
        radius = int(45 + 235 * smooth(3.22, 3.75, t))
        draw_glow(layer, (target[0] - radius, target[1] - radius, target[0] + radius, target[1] + radius), WHITE, int(210 * impact), 35)
        draw.ellipse(
            (target[0] - radius, target[1] - radius, target[0] + radius, target[1] + radius),
            outline=(*GOLD, int(235 * impact)), width=6,
        )

    status_alpha = smooth(2.0, 2.5, t)
    draw_glass_panel(layer, (1310, 835, 1790, 975), CYAN, opacity=190)
    draw.line((1360, 878, 1360, 930), fill=(*CYAN, int(230 * status_alpha)), width=5)
    centered_text(draw, 1565, 850, "LIVE HAND AIM", font(FONT_BOLD, 28), CYAN, stroke=2)
    centered_text(draw, 1565, 902, "POINT  •  PINCH  •  RELEASE", font(FONT_BOLD, 20), WHITE, stroke=1)
    return layer


def hand_icon(layer: Image.Image, center: tuple[int, int], opacity: int = 255) -> None:
    draw = ImageDraw.Draw(layer)
    x, y = center
    color = (*CYAN, opacity)
    gold = (*GOLD, opacity)
    arm = 42
    for sx, sy in [(-1, -1), (1, -1), (-1, 1), (1, 1)]:
        ox = x + sx * 104
        oy = y + sy * 82
        draw.line((ox, oy, ox - sx * arm, oy), fill=color, width=7)
        draw.line((ox, oy, ox, oy - sy * arm), fill=color, width=7)
    draw.line((x - 44, y + 42, x - 32, y - 22, x - 12, y - 78), fill=gold, width=12, joint="curve")
    draw.line((x - 12, y - 26, x + 8, y - 92), fill=gold, width=12)
    draw.line((x + 7, y - 20, x + 31, y - 79), fill=gold, width=12)
    draw.line((x + 25, y - 7, x + 53, y - 54), fill=gold, width=12)
    draw.arc((x - 43, y - 13, x + 75, y + 88), 3, 182, fill=gold, width=12)
    draw.ellipse((x - 16, y - 100, x + 20, y - 64), fill=(*CYAN, opacity), outline=(*WHITE, opacity), width=4)


def feature_card(
    layer: Image.Image,
    box: tuple[int, int, int, int],
    accent: tuple[int, int, int],
    title: str,
    line_one: str,
    line_two: str,
    icon_kind: str,
    progress: float,
) -> None:
    if progress <= 0.01:
        return
    x1, y1, x2, y2 = box
    card = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    draw_glass_panel(card, box, accent)
    draw = ImageDraw.Draw(card)
    center_x = (x1 + x2) // 2
    icon_y = y1 + 190
    if icon_kind == "hand":
        hand_icon(card, (center_x, icon_y), 245)
    elif icon_kind == "power":
        paste_center(card, sized_asset(str(POWER_BOMB), 176), (center_x - 105, icon_y), rotation=-7)
        paste_center(card, sized_asset(str(POWER_PRISM), 176), (center_x + 105, icon_y), rotation=7)
        paste_center(card, sized_asset(str(ARTIFACT), 124), (center_x, icon_y + 22))
    else:
        paste_center(card, sized_asset(str(CHEST), 245), (center_x - 32, icon_y + 5))
        paste_center(card, sized_asset(str(COINS), 124), (center_x + 120, icon_y + 74), rotation=4)
    centered_text(draw, center_x, y1 + 315, title, font(FONT_DISPLAY, 43), WHITE, stroke=3, shadow=4)
    centered_text(draw, center_x, y1 + 382, line_one, font(FONT_BOLD, 21), accent, stroke=1)
    centered_text(draw, center_x, y1 + 424, line_two, font(FONT_REGULAR, 19), MUTED, stroke=1)

    scale = 0.9 + 0.1 * clamp(progress)
    if abs(scale - 1.0) > 0.002:
        crop = card.crop((x1 - 28, y1 - 28, x2 + 28, y2 + 28))
        resized = crop.resize((int(crop.width * scale), int(crop.height * scale)), Image.Resampling.LANCZOS)
        paste_center(layer, resized, (center_x, (y1 + y2) / 2 + (1.0 - progress) * 100), opacity=clamp(progress))
    else:
        alpha_composite(layer, card, clamp(progress))


def features_layer(t: float) -> Image.Image:
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    shade = Image.new("RGBA", (W, H), (0, 3, 18, 104))
    layer.alpha_composite(shade)
    draw = ImageDraw.Draw(layer)
    centered_text(draw, W / 2, 72, "PLAY BEYOND TOUCH", font(FONT_DISPLAY, 66), WHITE, stroke=4, shadow=6)
    centered_text(draw, W / 2, 152, "PRECISION CONTROL  •  SUPER POWERS  •  ROYAL REWARDS", font(FONT_BOLD, 23), GOLD, stroke=1)
    draw.line((610, 207, 1310, 207), fill=(*CYAN, 205), width=3)

    cards = [
        ((110, 265, 600, 845), CYAN, "HAND TRACKING", "POINT • PINCH • RELEASE", "LOW-LATENCY AIM", "hand", 4.25),
        ((715, 265, 1205, 845), VIOLET, "SUPER POWERS", "BOMB • PRISM • ARTIFACTS", "COMBO-CHARGED", "power", 4.42),
        ((1320, 265, 1810, 845), GOLD, "ROYAL REWARDS", "VAULTS • SKINS • TIERS", "COLLECT & ASCEND", "rewards", 4.59),
    ]
    for box, accent, title, one, two, kind, start in cards:
        progress = ease_out_back(smooth(start, start + 0.62, t))
        feature_card(layer, box, accent, title, one, two, kind, progress)
    centered_text(draw, W / 2, 910, "ONE MAGICAL WORLD.  ENDLESS WAYS TO PLAY.", font(FONT_BOLD, 27), WHITE, stroke=2)
    return layer


def platform_icon(draw: ImageDraw.ImageDraw, kind: str, x: int, y: int, color: tuple[int, int, int]) -> None:
    if kind == "windows":
        gap = 5
        size = 20
        for row in range(2):
            for col in range(2):
                x1 = x + col * (size + gap)
                y1 = y + row * (size + gap)
                draw.rounded_rectangle((x1, y1, x1 + size, y1 + size), radius=2, fill=(*color, 245))
    elif kind == "play":
        draw.polygon(((x, y), (x, y + 52), (x + 48, y + 26)), outline=(*color, 245))
        draw.line((x + 2, y + 2, x + 28, y + 26, x + 2, y + 50), fill=(*GOLD, 220), width=5)
    elif kind == "app":
        draw.ellipse((x - 3, y - 3, x + 53, y + 53), outline=(*color, 245), width=4)
        draw.line((x + 15, y + 39, x + 28, y + 11, x + 42, y + 39), fill=(*color, 245), width=5)
        draw.line((x + 9, y + 34, x + 45, y + 34), fill=(*color, 245), width=5)
    else:
        draw.rounded_rectangle((x, y + 3, x + 56, y + 40), radius=5, outline=(*color, 245), width=4)
        draw.line((x + 18, y + 48, x + 38, y + 48), fill=(*color, 245), width=4)
        draw.line((x + 28, y + 40, x + 28, y + 48), fill=(*color, 245), width=4)


def platform_badge(
    layer: Image.Image,
    center_x: int,
    center_y: int,
    label: str,
    icon: str,
    accent: tuple[int, int, int],
    progress: float,
) -> None:
    width, height = 310, 108
    y = center_y + int((1.0 - progress) * 55)
    x1, y1 = center_x - width // 2, y - height // 2
    x2, y2 = center_x + width // 2, y + height // 2
    draw = ImageDraw.Draw(layer)
    draw.rounded_rectangle((x1, y1, x2, y2), radius=22, fill=(5, 13, 34, int(226 * progress)), outline=(*accent, int(215 * progress)), width=3)
    draw.rounded_rectangle((x1 + 6, y1 + 6, x2 - 6, y2 - 6), radius=17, outline=(*GOLD, int(86 * progress)), width=2)
    platform_icon(draw, icon, x1 + 29, y1 + 28, accent)
    draw.text((x1 + 102, y1 + 37), label, font=font(FONT_BOLD, 27), fill=(*WHITE, int(250 * progress)), stroke_width=1, stroke_fill=INK)


def outro_layer(t: float) -> Image.Image:
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    draw_glow(layer, (W // 2 - 520, 190, W // 2 + 520, 850), (79, 109, 255), 86, 105)
    draw = ImageDraw.Draw(layer)
    progress = smooth(7.2, 7.85, t)
    tracked_text(draw, W / 2, 170, "PAOPAO  FUSION", font(FONT_BOLD, 34), CYAN, 9, stroke=2)
    title_y = 292 + int((1.0 - progress) * 45)
    centered_text(draw, W / 2, title_y, "COMING SOON", font(FONT_DISPLAY, 126), WHITE, stroke=7, shadow=9)
    centered_text(draw, W / 2, 452, "THE CRYSTAL SAGA IS ALMOST HERE", font(FONT_BOLD, 30), GOLD, stroke=2)
    draw.line((650, 522, 1270, 522), fill=(*CYAN, int(225 * progress)), width=4)
    draw.polygon(((960, 505), (977, 522), (960, 539), (943, 522)), fill=(*GOLD, int(245 * progress)))

    badges = [
        (435, "Windows", "windows", CYAN),
        (785, "Play Store", "play", (116, 238, 170)),
        (1135, "App Store", "app", (158, 206, 255)),
        (1485, "macOS", "mac", VIOLET),
    ]
    for index, (x, label, icon, accent) in enumerate(badges):
        badge_progress = ease_out_back(smooth(7.72 + index * 0.09, 8.25 + index * 0.09, t))
        platform_badge(layer, x, 674, label, icon, accent, clamp(badge_progress))

    powered_progress = smooth(8.12, 8.72, t)
    draw.rounded_rectangle((620, 826, 1300, 925), radius=28, fill=(3, 10, 28, int(190 * powered_progress)), outline=(*GOLD, int(155 * powered_progress)), width=2)
    centered_text(draw, W / 2, 850, "Powered by Rafaygen AI", font(FONT_BOLD, 39), (*WHITE, int(255 * powered_progress)), stroke=2, shadow=3)
    centered_text(draw, W / 2, 964, "A NEW ERA OF MAGICAL PLAY", font(FONT_REGULAR, 22), (*MUTED, int(220 * powered_progress)), stroke=1)
    return layer


def render_frame(t: float) -> Image.Image:
    frame = background_frame(t)
    hero_alpha = smooth(0.0, 0.35, t) * (1.0 - smooth(1.55, 2.12, t))
    game_alpha = smooth(1.42, 2.02, t) * (1.0 - smooth(4.18, 4.75, t))
    features_alpha = smooth(4.12, 4.72, t) * (1.0 - smooth(7.05, 7.72, t))
    outro_alpha = smooth(7.12, 7.82, t)
    if hero_alpha > 0.002:
        alpha_composite(frame, hero_layer(t), hero_alpha)
    if game_alpha > 0.002:
        alpha_composite(frame, gameplay_layer(t), game_alpha)
    if features_alpha > 0.002:
        alpha_composite(frame, features_layer(t), features_alpha)
    if outro_alpha > 0.002:
        alpha_composite(frame, outro_layer(t), outro_alpha)
    return frame.convert("RGB")


def synthesize_audio(path: Path) -> None:
    sample_rate = 48_000
    count = int(DURATION * sample_rate)
    time = np.arange(count, dtype=np.float64) / sample_rate
    left = np.zeros(count, dtype=np.float64)
    right = np.zeros(count, dtype=np.float64)
    chords = [
        (130.81, 155.56, 196.00),
        (103.83, 130.81, 155.56),
        (155.56, 196.00, 233.08),
        (116.54, 146.83, 174.61),
    ]
    for section, chord in enumerate(chords):
        start = section * 2.5
        end = min(DURATION, start + 3.0)
        mask = (time >= start) & (time < end)
        local = time[mask] - start
        envelope = np.sin(np.clip(local / 0.55, 0, 1) * math.pi / 2)
        envelope *= np.sin(np.clip((end - time[mask]) / 0.6, 0, 1) * math.pi / 2)
        pad = np.zeros_like(local)
        for index, frequency in enumerate(chord):
            pad += np.sin(math.tau * frequency * local + index * 0.6) * (0.19 - index * 0.025)
            pad += np.sin(math.tau * frequency * 2.005 * local) * 0.035
        pan = 0.12 * math.sin(section * 1.7)
        left[mask] += pad * envelope * (1.0 - pan)
        right[mask] += pad * envelope * (1.0 + pan)

    bell_notes = [261.63, 311.13, 392.00, 466.16, 523.25, 622.25, 783.99]
    for index, start in enumerate(np.arange(0.45, 9.4, 0.36)):
        frequency = bell_notes[index % len(bell_notes)] * (1.0 if start < 7.2 else 1.5)
        length = min(0.52, DURATION - start)
        if length <= 0:
            continue
        a = int(start * sample_rate)
        b = int((start + length) * sample_rate)
        local = np.arange(b - a) / sample_rate
        env = np.exp(-local * 7.0) * (1.0 - np.exp(-local * 85.0))
        bell = (np.sin(math.tau * frequency * local) + 0.42 * np.sin(math.tau * frequency * 2.01 * local)) * env * 0.12
        pan = 0.72 * math.sin(index * 1.4)
        left[a:b] += bell * (1.0 - pan * 0.45)
        right[a:b] += bell * (1.0 + pan * 0.45)

    rng = np.random.default_rng(2207)
    for start, length, strength in [(1.48, 0.9, 0.16), (4.12, 0.85, 0.15), (7.08, 1.2, 0.21)]:
        a = int(start * sample_rate)
        b = min(count, int((start + length) * sample_rate))
        local = np.arange(b - a) / sample_rate
        noise = rng.normal(0, 1, b - a)
        noise = np.concatenate(([0.0], np.diff(noise)))
        env = np.sin(np.clip(local / length, 0, 1) * math.pi) ** 2
        whoosh = noise * env * strength
        left[a:b] += whoosh * 0.85
        right[a:b] += whoosh

    impact_start = 3.24
    a = int(impact_start * sample_rate)
    b = min(count, a + int(0.85 * sample_rate))
    local = np.arange(b - a) / sample_rate
    impact = np.sin(math.tau * (78 - 34 * local) * local) * np.exp(-local * 7.5) * 0.42
    sparkle = np.sin(math.tau * 980 * local) * np.exp(-local * 14.0) * 0.11
    left[a:b] += impact + sparkle
    right[a:b] += impact + sparkle * 0.8

    master = np.stack([left, right], axis=1)
    fade_in = np.clip(time / 0.16, 0, 1)
    fade_out = np.clip((DURATION - time) / 0.28, 0, 1)
    master *= (fade_in * fade_out)[:, None]
    peak = np.max(np.abs(master)) or 1.0
    master = np.tanh(master * (0.92 / peak) * 1.55) / np.tanh(1.55)
    pcm = np.int16(np.clip(master, -1, 1) * 32767)
    with wave.open(str(path), "wb") as wav:
        wav.setnchannels(2)
        wav.setsampwidth(2)
        wav.setframerate(sample_rate)
        wav.writeframes(pcm.tobytes())


def main() -> None:
    OUTPUT.mkdir(parents=True, exist_ok=True)
    WORK.mkdir(parents=True, exist_ok=True)
    silent_path = WORK / "paopao-fusion-promo-silent.mp4"
    audio_path = WORK / "paopao-fusion-promo-score.wav"
    final_path = OUTPUT / "paopao-fusion-rafaygen-ai-coming-soon-10s.mp4"
    poster_path = OUTPUT / "paopao-fusion-coming-soon-poster.png"

    writer = imageio.get_writer(
        str(silent_path),
        fps=FPS,
        codec="libx264",
        quality=9,
        pixelformat="yuv420p",
        macro_block_size=None,
        ffmpeg_log_level="warning",
        ffmpeg_params=["-movflags", "+faststart", "-preset", "medium", "-crf", "17"],
    )
    poster_saved = False
    try:
        for frame_index in range(FRAME_COUNT):
            t = frame_index / FPS
            frame = render_frame(t)
            writer.append_data(np.asarray(frame))
            if not poster_saved and t >= 8.9:
                frame.save(poster_path, quality=96)
                poster_saved = True
            if frame_index % 30 == 0:
                print(f"Rendered {frame_index:03d}/{FRAME_COUNT} frames", flush=True)
    finally:
        writer.close()

    synthesize_audio(audio_path)
    ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    command = [
        ffmpeg, "-y",
        "-i", str(silent_path),
        "-i", str(audio_path),
        "-c:v", "copy",
        "-c:a", "aac",
        "-b:a", "192k",
        "-ar", "48000",
        "-shortest",
        "-movflags", "+faststart",
        "-metadata", "title=PaoPao Fusion - Coming Soon",
        "-metadata", "artist=Rafaygen AI",
        "-metadata", "comment=Powered by Rafaygen AI",
        str(final_path),
    ]
    subprocess.run(command, check=True)
    silent_path.unlink(missing_ok=True)
    audio_path.unlink(missing_ok=True)
    print(f"Video: {final_path}")
    print(f"Poster: {poster_path}")


if __name__ == "__main__":
    main()

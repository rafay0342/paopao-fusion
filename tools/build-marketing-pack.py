#!/usr/bin/env python3
"""Build the deterministic PAOPAO FUSION marketing graphics pack.

The compositor deliberately separates key art from gameplay. Key-art plates and
transparent character/mechanic sprites decorate the marketing canvas, while the
store screenshots contain untouched, real in-engine captures (only the desktop
browser gutters are center-cropped before proportional resizing).

Only Pillow and the Python standard library are required.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import random
import sys
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Iterable, Sequence

from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageFont


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT = ROOT / "output" / "marketing-pack"
DEFAULT_SCREENSHOTS = ROOT / "output" / "playwright"
DEFAULT_PORTRAIT_PLATE = ROOT / "output" / "marketing-pack" / "sources" / "key-art-portrait-master.png"
DEFAULT_LANDSCAPE_PLATE = ROOT / "output" / "marketing-pack" / "sources" / "key-art-landscape-master.png"
DEFAULT_LUMI = ROOT / "public" / "assets" / "cinematics" / "layers" / "lumi.png"
DEFAULT_CROWN = ROOT / "public" / "assets" / "cinematics" / "layers" / "aurora-crown.png"
DEFAULT_LAUNCHER = ROOT / "public" / "assets" / "sprites" / "v3" / "crystal-launcher-hd.png"
DEFAULT_SPRITES = ROOT / "public" / "assets" / "sprites"

BRAND_TITLE = "PAOPAO FUSION"
BRAND_SUBTITLE = "THE SHATTERED CROWN"
BRAND_TAGLINE = "RESTORE THE CROWN. REUNITE THE REALMS."
CAMPAIGN_LINE = "SIX REALMS. ONE SHATTERED DESTINY."

INK = (4, 9, 28)
DEEP_INDIGO = (12, 13, 51)
MIDNIGHT = (6, 12, 35)
PEARL = (244, 242, 228)
PALE_GOLD = (239, 205, 122)
ANTIQUE_GOLD = (184, 130, 48)
TURQUOISE = (105, 231, 224)
AMETHYST = (135, 76, 230)

SCREEN_SIZE = (1080, 1920)
DESKTOP_GAMEPLAY_ASPECT = 0.566667


@dataclass(frozen=True)
class ScreenSpec:
    index: int
    slug: str
    source_name: str
    headline: str
    subline: str
    accent_relpath: str
    bubble_color: str
    accent_color: tuple[int, int, int]

    @property
    def output_name(self) -> str:
        return f"store-{self.index:02d}-{self.slug}.png"


SCREEN_SPECS: tuple[ScreenSpec, ...] = (
    ScreenSpec(
        1,
        "crystal-seals",
        "paopao-v8-crystal-seals-live.png",
        "BREAK THE CRYSTAL SEALS",
        "Read the formation, choose the angle, and fracture every ward.",
        "v8/mechanic-crystal-seal.png",
        "purple",
        (139, 95, 235),
    ),
    ScreenSpec(
        2,
        "verdant-vines",
        "paopao-v8-vine-miss-spread-live.png",
        "OUTSMART THE HEARTWOOD",
        "Miss a marked shot and the living vines spread across the canopy.",
        "v8/mechanic-vine-bind.png",
        "green",
        (57, 205, 130),
    ),
    ScreenSpec(
        3,
        "celestial-portals",
        "paopao-v8-portal-transit-live.png",
        "BEND THE CELESTIAL PATH",
        "Route shots through ancient portals and turn angles into combos.",
        "v8/mechanic-celestial-portal.png",
        "yellow",
        (239, 196, 79),
    ),
    ScreenSpec(
        4,
        "ember-core",
        "paopao-unified-hud-level11-desktop.png",
        "MASTER THE EMBER CORE",
        "Build pressure, strike with intent, and survive the rising heat.",
        "v8/mechanic-ember-core.png",
        "orange",
        (241, 111, 55),
    ),
    ScreenSpec(
        5,
        "inferno-boss",
        "paopao-unified-hud-boss-desktop.png",
        "FACE THE INFERNO SOVEREIGN",
        "Break the boss pattern before the throne consumes the board.",
        "v8/boss-inferno-sovereign.png",
        "red",
        (228, 72, 68),
    ),
    ScreenSpec(
        6,
        "adventure-map",
        "paopao-v8-world-map-live.png",
        "CHOOSE YOUR NEXT REALM",
        "Follow the Crown fragments through a connected story campaign.",
        "v8/boss-prism-warden.png",
        "blue",
        (66, 177, 238),
    ),
)


@dataclass
class Fonts:
    display: Path
    body: Path


@dataclass
class Assets:
    portrait_plate: Image.Image
    landscape_plate: Image.Image
    lumi: Image.Image
    crown: Image.Image
    launcher: Image.Image
    bubbles: dict[str, Image.Image]
    accents: dict[str, Image.Image]


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Render PAOPAO FUSION posters, feature art, social art, six real-gameplay "
            "store screenshots, a thumbnail, and a machine-readable manifest."
        )
    )
    parser.add_argument(
        "--portrait-plate",
        type=Path,
        default=DEFAULT_PORTRAIT_PLATE,
        help=f"Generated text-free portrait key-art plate (default: {display_path(DEFAULT_PORTRAIT_PLATE)}).",
    )
    parser.add_argument(
        "--landscape-plate",
        type=Path,
        default=DEFAULT_LANDSCAPE_PLATE,
        help=f"Generated text-free landscape key-art plate (default: {display_path(DEFAULT_LANDSCAPE_PLATE)}).",
    )
    parser.add_argument(
        "--screenshots-dir",
        type=Path,
        default=DEFAULT_SCREENSHOTS,
        help=f"Directory containing real Playwright gameplay captures (default: {display_path(DEFAULT_SCREENSHOTS)}).",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=DEFAULT_OUTPUT,
        help=f"Pack destination (default: {display_path(DEFAULT_OUTPUT)}).",
    )
    parser.add_argument("--lumi", type=Path, default=DEFAULT_LUMI, help="Transparent Lumi layer.")
    parser.add_argument("--crown", type=Path, default=DEFAULT_CROWN, help="Transparent Aurora Crown layer.")
    parser.add_argument("--launcher", type=Path, default=DEFAULT_LAUNCHER, help="Transparent Prism Launcher sprite.")
    parser.add_argument("--sprites-dir", type=Path, default=DEFAULT_SPRITES, help="Root containing existing game sprites.")
    parser.add_argument("--display-font", type=Path, help="Optional display font (.ttf/.otf).")
    parser.add_argument("--body-font", type=Path, help="Optional body font (.ttf/.otf).")
    parser.add_argument("--seed", type=int, default=24072026, help="Deterministic decorative particle seed.")
    return parser.parse_args(argv)


def display_path(path: Path) -> str:
    path = path.expanduser()
    try:
        return path.resolve().relative_to(ROOT).as_posix()
    except ValueError:
        return path.resolve().as_posix()


def require_file(path: Path, role: str) -> Path:
    path = path.expanduser().resolve()
    if not path.is_file():
        raise FileNotFoundError(f"Missing {role}: {path}")
    return path


def load_rgba(path: Path, role: str) -> Image.Image:
    checked = require_file(path, role)
    with Image.open(checked) as source:
        source.load()
        return source.convert("RGBA")


def image_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def select_font(explicit: Path | None, *, display: bool) -> Path:
    if explicit is not None:
        return require_file(explicit, "display font" if display else "body font")

    if display:
        candidates = (
            Path("/usr/share/fonts/truetype/noto/NotoSansDisplay-Bold.ttf"),
            Path("/usr/share/fonts/truetype/noto/NotoSans-Bold.ttf"),
            Path("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"),
            Path("/mnt/c/Windows/Fonts/arialbd.ttf"),
            Path("C:/Windows/Fonts/arialbd.ttf"),
        )
    else:
        candidates = (
            Path("/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf"),
            Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"),
            Path("/mnt/c/Windows/Fonts/arial.ttf"),
            Path("C:/Windows/Fonts/arial.ttf"),
        )
    for candidate in candidates:
        if candidate.is_file():
            return candidate.resolve()
    role = "display" if display else "body"
    raise FileNotFoundError(f"No scalable {role} font found; pass --{role}-font explicitly.")


@lru_cache(maxsize=192)
def font_at(path_string: str, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(path_string, max(1, int(size)))


def fit_font(path: Path, text: str, max_width: int, max_size: int, min_size: int = 12) -> ImageFont.FreeTypeFont:
    probe = ImageDraw.Draw(Image.new("L", (4, 4)))
    low, high = min_size, max(max_size, min_size)
    best = font_at(str(path), min_size)
    while low <= high:
        mid = (low + high) // 2
        candidate = font_at(str(path), mid)
        bbox = probe.textbbox((0, 0), text, font=candidate, stroke_width=0)
        if bbox[2] - bbox[0] <= max_width:
            best = candidate
            low = mid + 1
        else:
            high = mid - 1
    return best


def trim_alpha(image: Image.Image) -> Image.Image:
    rgba = image.convert("RGBA")
    bbox = rgba.getchannel("A").getbbox()
    return rgba.crop(bbox) if bbox else rgba


def cover(image: Image.Image, size: tuple[int, int], focus: tuple[float, float] = (0.5, 0.5)) -> Image.Image:
    target_w, target_h = size
    source = image.convert("RGBA")
    scale = max(target_w / source.width, target_h / source.height)
    resized = source.resize(
        (max(target_w, round(source.width * scale)), max(target_h, round(source.height * scale))),
        Image.Resampling.LANCZOS,
    )
    left = round((resized.width - target_w) * min(1.0, max(0.0, focus[0])))
    top = round((resized.height - target_h) * min(1.0, max(0.0, focus[1])))
    left = min(max(0, left), resized.width - target_w)
    top = min(max(0, top), resized.height - target_h)
    return resized.crop((left, top, left + target_w, top + target_h))


def contain(image: Image.Image, size: tuple[int, int]) -> Image.Image:
    target_w, target_h = size
    scale = min(target_w / image.width, target_h / image.height)
    return image.resize(
        (max(1, round(image.width * scale)), max(1, round(image.height * scale))),
        Image.Resampling.LANCZOS,
    )


def alpha_overlay(canvas: Image.Image, color: tuple[int, int, int], alpha: int) -> None:
    canvas.alpha_composite(Image.new("RGBA", canvas.size, (*color, max(0, min(255, alpha)))))


def vertical_color_gradient(
    canvas: Image.Image,
    color: tuple[int, int, int],
    top_alpha: int,
    bottom_alpha: int,
    *,
    start: float = 0.0,
    end: float = 1.0,
) -> None:
    width, height = canvas.size
    start_y = max(0, min(height, round(height * start)))
    end_y = max(start_y + 1, min(height, round(height * end)))
    mask = Image.new("L", canvas.size, 0)
    draw = ImageDraw.Draw(mask)
    span = max(1, end_y - start_y - 1)
    for y in range(start_y, end_y):
        t = (y - start_y) / span
        value = round(top_alpha + (bottom_alpha - top_alpha) * t)
        draw.line((0, y, width, y), fill=max(0, min(255, value)))
    layer = Image.new("RGBA", canvas.size, (*color, 255))
    layer.putalpha(mask)
    canvas.alpha_composite(layer)


def add_vignette(canvas: Image.Image, strength: int = 175) -> None:
    width, height = canvas.size
    mask = Image.new("L", canvas.size, strength)
    draw = ImageDraw.Draw(mask)
    inset_x = round(width * 0.09)
    inset_y = round(height * 0.05)
    draw.ellipse((inset_x, inset_y, width - inset_x, height - inset_y), fill=0)
    mask = mask.filter(ImageFilter.GaussianBlur(max(24, round(min(width, height) * 0.09))))
    layer = Image.new("RGBA", canvas.size, (0, 0, 0, 255))
    layer.putalpha(mask)
    canvas.alpha_composite(layer)


def add_radial_glow(
    canvas: Image.Image,
    center: tuple[int, int],
    radius: tuple[int, int],
    color: tuple[int, int, int],
    alpha: int,
) -> None:
    width, height = canvas.size
    glow = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    mask = Image.new("L", canvas.size, 0)
    draw = ImageDraw.Draw(mask)
    x, y = center
    rx, ry = radius
    draw.ellipse((x - rx, y - ry, x + rx, y + ry), fill=max(0, min(255, alpha)))
    mask = mask.filter(ImageFilter.GaussianBlur(max(12, round(min(rx, ry) * 0.42))))
    glow.paste((*color, 255), (0, 0, width, height), mask)
    canvas.alpha_composite(glow)


def add_starfield(canvas: Image.Image, seed: int, count: int, area: tuple[int, int, int, int] | None = None) -> None:
    rng = random.Random(seed)
    width, height = canvas.size
    left, top, right, bottom = area or (0, 0, width, height)
    draw = ImageDraw.Draw(canvas, "RGBA")
    palette = ((111, 231, 226), (154, 112, 241), (239, 205, 122))
    for _ in range(count):
        x = rng.randrange(left, max(left + 1, right))
        y = rng.randrange(top, max(top + 1, bottom))
        radius = rng.choice((1, 1, 1, 2, 2, 3))
        color = rng.choice(palette)
        alpha = rng.randrange(45, 135)
        draw.ellipse((x - radius, y - radius, x + radius, y + radius), fill=(*color, alpha))


def paste_sprite(
    canvas: Image.Image,
    sprite: Image.Image,
    box: tuple[int, int, int, int],
    *,
    anchor: tuple[float, float] = (0.5, 0.5),
    opacity: int = 255,
    shadow: bool = True,
    glow_color: tuple[int, int, int] | None = None,
) -> tuple[int, int, int, int]:
    left, top, right, bottom = box
    clean = trim_alpha(sprite)
    fitted = contain(clean, (max(1, right - left), max(1, bottom - top)))
    x = round(left + (right - left - fitted.width) * anchor[0])
    y = round(top + (bottom - top - fitted.height) * anchor[1])
    if opacity != 255:
        fitted = fitted.copy()
        fitted.putalpha(fitted.getchannel("A").point(lambda value: value * opacity // 255))

    if glow_color is not None:
        glow_mask = fitted.getchannel("A").filter(ImageFilter.GaussianBlur(max(8, fitted.width // 24)))
        glow = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
        glow_color_layer = Image.new("RGBA", fitted.size, (*glow_color, 150))
        glow_color_layer.putalpha(glow_mask.point(lambda value: value * 2 // 5))
        glow.alpha_composite(glow_color_layer, (x, y))
        canvas.alpha_composite(glow)

    if shadow:
        shadow_mask = fitted.getchannel("A").filter(ImageFilter.GaussianBlur(max(6, fitted.width // 34)))
        shadow_layer = Image.new("RGBA", fitted.size, (0, 0, 0, 0))
        shadow_layer.paste((0, 0, 12, 165), (0, 0, fitted.width, fitted.height), shadow_mask)
        canvas.alpha_composite(shadow_layer, (x + max(5, fitted.width // 45), y + max(8, fitted.height // 45)))

    canvas.alpha_composite(fitted, (x, y))
    return x, y, x + fitted.width, y + fitted.height


def text_width(draw: ImageDraw.ImageDraw, text: str, font: ImageFont.FreeTypeFont, stroke_width: int = 0) -> int:
    bbox = draw.textbbox((0, 0), text, font=font, stroke_width=stroke_width)
    return bbox[2] - bbox[0]


def draw_tracked_text(
    canvas: Image.Image,
    text: str,
    center_x: int,
    y: int,
    font: ImageFont.FreeTypeFont,
    fill: tuple[int, int, int] | tuple[int, int, int, int],
    tracking: int,
) -> int:
    draw = ImageDraw.Draw(canvas)
    widths = [text_width(draw, character, font) for character in text]
    total = sum(widths) + tracking * max(0, len(text) - 1)
    x = center_x - total // 2
    for character, width in zip(text, widths):
        draw.text((x, y), character, font=font, fill=fill, anchor="la")
        x += width + tracking
    return total


def wrap_text(draw: ImageDraw.ImageDraw, text: str, font: ImageFont.FreeTypeFont, max_width: int) -> str:
    words = text.split()
    lines: list[str] = []
    current = ""
    for word in words:
        candidate = f"{current} {word}".strip()
        if not current or text_width(draw, candidate, font) <= max_width:
            current = candidate
        else:
            lines.append(current)
            current = word
    if current:
        lines.append(current)
    return "\n".join(lines)


def draw_brand_lockup(
    canvas: Image.Image,
    center_x: int,
    top: int,
    max_width: int,
    fonts: Fonts,
    *,
    title_size: int,
    subtitle_size: int,
    show_tagline: bool = False,
) -> tuple[int, int, int, int]:
    draw = ImageDraw.Draw(canvas)
    paopao = "PAOPAO"
    fusion = "FUSION"
    gap_factor = 0.28

    while title_size > 24:
        title_font = font_at(str(fonts.display), title_size)
        stroke = max(2, title_size // 34)
        gap = round(title_size * gap_factor)
        width = text_width(draw, paopao, title_font, stroke) + gap + text_width(draw, fusion, title_font, stroke)
        if width <= max_width:
            break
        title_size -= 2

    title_font = font_at(str(fonts.display), title_size)
    stroke = max(2, title_size // 34)
    gap = round(title_size * gap_factor)
    paopao_w = text_width(draw, paopao, title_font, stroke)
    fusion_w = text_width(draw, fusion, title_font, stroke)
    total_w = paopao_w + gap + fusion_w
    start_x = center_x - total_w // 2
    shadow_offset = max(4, title_size // 22)

    draw.text(
        (start_x + shadow_offset, top + shadow_offset),
        paopao,
        font=title_font,
        fill=(0, 0, 12, 190),
        stroke_width=stroke + 2,
        stroke_fill=(0, 0, 0, 180),
        anchor="la",
    )
    draw.text(
        (start_x + paopao_w + gap + shadow_offset, top + shadow_offset),
        fusion,
        font=title_font,
        fill=(0, 0, 12, 190),
        stroke_width=stroke + 2,
        stroke_fill=(0, 0, 0, 180),
        anchor="la",
    )
    draw.text(
        (start_x, top),
        paopao,
        font=title_font,
        fill=PEARL,
        stroke_width=stroke,
        stroke_fill=(31, 24, 72),
        anchor="la",
    )
    draw.text(
        (start_x + paopao_w + gap, top),
        fusion,
        font=title_font,
        fill=TURQUOISE,
        stroke_width=stroke,
        stroke_fill=(52, 28, 105),
        anchor="la",
    )

    title_bbox = draw.textbbox((start_x, top), paopao, font=title_font, stroke_width=stroke, anchor="la")
    title_bottom = title_bbox[3]
    rule_y = title_bottom + max(14, title_size // 11)
    rule_half = min(max_width // 3, total_w // 2)
    draw.line((center_x - rule_half, rule_y, center_x - 36, rule_y), fill=(*ANTIQUE_GOLD, 190), width=max(2, title_size // 45))
    draw.polygon(
        (
            (center_x, rule_y - max(5, title_size // 24)),
            (center_x + max(5, title_size // 24), rule_y),
            (center_x, rule_y + max(5, title_size // 24)),
            (center_x - max(5, title_size // 24), rule_y),
        ),
        fill=PALE_GOLD,
    )
    draw.line((center_x + 36, rule_y, center_x + rule_half, rule_y), fill=(*ANTIQUE_GOLD, 190), width=max(2, title_size // 45))

    subtitle_font = fit_font(fonts.display, BRAND_SUBTITLE, max_width, subtitle_size, 18)
    subtitle_top = rule_y + max(17, title_size // 10)
    subtitle_bbox = draw.textbbox((center_x, subtitle_top), BRAND_SUBTITLE, font=subtitle_font, anchor="ma")
    draw.text(
        (center_x + 3, subtitle_top + 4),
        BRAND_SUBTITLE,
        font=subtitle_font,
        fill=(0, 0, 8, 190),
        anchor="ma",
    )
    draw.text((center_x, subtitle_top), BRAND_SUBTITLE, font=subtitle_font, fill=PALE_GOLD, anchor="ma")
    bottom = subtitle_bbox[3]

    if show_tagline:
        tagline_font = fit_font(fonts.body, BRAND_TAGLINE, max_width, max(20, subtitle_size * 2 // 3), 16)
        tagline_top = bottom + max(20, subtitle_size // 2)
        draw_tracked_text(canvas, BRAND_TAGLINE, center_x, tagline_top, tagline_font, (*PEARL, 220), max(1, subtitle_size // 16))
        tagline_bbox = draw.textbbox((center_x, tagline_top), BRAND_TAGLINE, font=tagline_font, anchor="ma")
        bottom = tagline_bbox[3]

    return center_x - total_w // 2, top, center_x + total_w // 2, bottom


def build_background(
    source: Image.Image,
    size: tuple[int, int],
    *,
    focus: tuple[float, float],
    tint: tuple[int, int, int],
    tint_alpha: int,
    blur: int = 0,
) -> Image.Image:
    base = cover(source, size, focus)
    if blur:
        base = base.filter(ImageFilter.GaussianBlur(blur))
    base = ImageEnhance.Color(base).enhance(0.86)
    canvas = base.convert("RGBA")
    alpha_overlay(canvas, tint, tint_alpha)
    return canvas


def crop_real_gameplay(capture: Image.Image) -> Image.Image:
    """Remove only desktop presentation gutters from a centered game capture."""
    source = capture.convert("RGBA")
    if source.width / source.height >= 1.0:
        gameplay_width = min(source.width, round(source.height * DESKTOP_GAMEPLAY_ASPECT))
        left = (source.width - gameplay_width) // 2
        return source.crop((left, 0, left + gameplay_width, source.height))
    return source


def rounded_gameplay_frame(
    canvas: Image.Image,
    gameplay: Image.Image,
    box: tuple[int, int, int, int],
    accent: tuple[int, int, int],
) -> tuple[int, int, int, int]:
    left, top, right, bottom = box
    outer_w = right - left
    outer_h = bottom - top
    radius = max(28, outer_w // 18)

    shadow_mask = Image.new("L", canvas.size, 0)
    shadow_draw = ImageDraw.Draw(shadow_mask)
    shadow_draw.rounded_rectangle((left + 18, top + 28, right + 22, bottom + 34), radius=radius, fill=210)
    shadow_mask = shadow_mask.filter(ImageFilter.GaussianBlur(28))
    shadow_layer = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    shadow_layer.paste((0, 0, 10, 210), (0, 0, canvas.width, canvas.height), shadow_mask)
    canvas.alpha_composite(shadow_layer)

    frame_layer = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    frame_draw = ImageDraw.Draw(frame_layer)
    frame_draw.rounded_rectangle((left, top, right, bottom), radius=radius, fill=(8, 12, 34, 255), outline=(*PALE_GOLD, 255), width=8)
    frame_draw.rounded_rectangle(
        (left + 10, top + 10, right - 10, bottom - 10),
        radius=max(16, radius - 10),
        outline=(*accent, 235),
        width=3,
    )
    canvas.alpha_composite(frame_layer)

    inset = 18
    inner_size = (outer_w - inset * 2, outer_h - inset * 2)
    exact = gameplay.convert("RGBA").resize(inner_size, Image.Resampling.LANCZOS)
    canvas.alpha_composite(exact, (left + inset, top + inset))
    return left, top, right, bottom


def bubble_asset_path(sprites_dir: Path, color: str) -> Path:
    preferred = sprites_dir / "v5" / f"bubble-{color}-smooth.png"
    fallback = sprites_dir / "v3" / f"bubble-{color}-hd.png"
    return preferred if preferred.is_file() else fallback


def load_assets(args: argparse.Namespace) -> tuple[Assets, dict[str, Path]]:
    sprites_dir = args.sprites_dir.expanduser().resolve()
    input_paths: dict[str, Path] = {
        "key_art_portrait_plate": require_file(args.portrait_plate, "generated portrait key-art plate"),
        "key_art_landscape_plate": require_file(args.landscape_plate, "generated landscape key-art plate"),
        "lumi_layer": require_file(args.lumi, "Lumi transparent layer"),
        "aurora_crown_layer": require_file(args.crown, "Aurora Crown transparent layer"),
        "prism_launcher_sprite": require_file(args.launcher, "Prism Launcher sprite"),
    }

    bubbles: dict[str, Image.Image] = {}
    for color in ("purple", "green", "yellow", "orange", "red", "blue"):
        path = require_file(bubble_asset_path(sprites_dir, color), f"{color} bubble sprite")
        input_paths[f"bubble_{color}"] = path
        bubbles[color] = load_rgba(path, f"{color} bubble sprite")

    accents: dict[str, Image.Image] = {}
    for spec in SCREEN_SPECS:
        path = require_file(sprites_dir / spec.accent_relpath, f"{spec.slug} accent sprite")
        input_paths[f"accent_{spec.slug}"] = path
        accents[spec.slug] = load_rgba(path, f"{spec.slug} accent sprite")

    assets = Assets(
        portrait_plate=load_rgba(input_paths["key_art_portrait_plate"], "generated portrait key-art plate"),
        landscape_plate=load_rgba(input_paths["key_art_landscape_plate"], "generated landscape key-art plate"),
        lumi=load_rgba(input_paths["lumi_layer"], "Lumi transparent layer"),
        crown=load_rgba(input_paths["aurora_crown_layer"], "Aurora Crown transparent layer"),
        launcher=load_rgba(input_paths["prism_launcher_sprite"], "Prism Launcher sprite"),
        bubbles=bubbles,
        accents=accents,
    )
    return assets, input_paths


def render_poster(assets: Assets, fonts: Fonts, seed: int) -> Image.Image:
    size = (2160, 3840)
    canvas = build_background(assets.portrait_plate, size, focus=(0.5, 0.46), tint=DEEP_INDIGO, tint_alpha=44)
    vertical_color_gradient(canvas, INK, 195, 0, start=0.0, end=0.26)
    vertical_color_gradient(canvas, INK, 0, 235, start=0.61, end=1.0)
    add_vignette(canvas, 188)
    add_starfield(canvas, seed + 11, 145, (80, 80, 2080, 1450))
    add_radial_glow(canvas, (1080, 450), (720, 460), AMETHYST, 95)
    draw_brand_lockup(canvas, 1080, 285, 1820, fonts, title_size=196, subtitle_size=68, show_tagline=False)

    bubble_y = 3450
    bubble_size = 155
    colors = ("purple", "green", "yellow", "orange", "red", "blue")
    start_x = 1080 - ((len(colors) - 1) * 175 + bubble_size) // 2
    for position, color in enumerate(colors):
        x = start_x + position * 175
        paste_sprite(canvas, assets.bubbles[color], (x, bubble_y, x + bubble_size, bubble_y + bubble_size), shadow=True)

    draw = ImageDraw.Draw(canvas)
    line_font = fit_font(fonts.body, BRAND_TAGLINE, 1220, 45, 26)
    draw_tracked_text(canvas, BRAND_TAGLINE, 1080, 3665, line_font, (*PEARL, 230), 3)
    draw.line((740, 3758, 1420, 3758), fill=(*ANTIQUE_GOLD, 170), width=3)
    return canvas


def render_feature(assets: Assets, fonts: Fonts, seed: int) -> Image.Image:
    size = (1920, 1080)
    canvas = build_background(assets.landscape_plate, size, focus=(0.52, 0.48), tint=MIDNIGHT, tint_alpha=25)
    horizontal = Image.new("L", size, 0)
    mask_draw = ImageDraw.Draw(horizontal)
    for x in range(size[0]):
        alpha = round(225 * max(0.0, 1.0 - x / 1160))
        mask_draw.line((x, 0, x, size[1]), fill=alpha)
    shade = Image.new("RGBA", size, (*INK, 255))
    shade.putalpha(horizontal)
    canvas.alpha_composite(shade)
    vertical_color_gradient(canvas, INK, 50, 145, start=0.58, end=1.0)
    add_vignette(canvas, 145)
    add_starfield(canvas, seed + 23, 72, (30, 20, 960, 1000))

    draw_brand_lockup(canvas, 510, 165, 900, fonts, title_size=116, subtitle_size=43, show_tagline=False)
    draw = ImageDraw.Draw(canvas)
    line_font = fit_font(fonts.body, CAMPAIGN_LINE, 830, 33, 23)
    draw_tracked_text(canvas, CAMPAIGN_LINE, 510, 490, line_font, (*PEARL, 225), 2)
    draw.line((95, 562, 925, 562), fill=(*ANTIQUE_GOLD, 180), width=3)

    colors = ("purple", "green", "yellow", "orange", "red", "blue")
    for position, color in enumerate(colors):
        x = 405 + position * 94
        paste_sprite(canvas, assets.bubbles[color], (x, 680, x + 78, 758), shadow=True)
    return canvas


def render_square(assets: Assets, fonts: Fonts, seed: int) -> Image.Image:
    size = (2048, 2048)
    canvas = build_background(assets.portrait_plate, size, focus=(0.5, 0.5), tint=DEEP_INDIGO, tint_alpha=54)
    vertical_color_gradient(canvas, INK, 190, 0, start=0.0, end=0.27)
    vertical_color_gradient(canvas, INK, 0, 225, start=0.59, end=1.0)
    add_vignette(canvas, 175)
    add_starfield(canvas, seed + 37, 105, (45, 30, 2000, 980))
    add_radial_glow(canvas, (1024, 280), (690, 340), AMETHYST, 86)

    draw_brand_lockup(canvas, 1024, 235, 1720, fonts, title_size=168, subtitle_size=58, show_tagline=False)

    draw = ImageDraw.Draw(canvas)
    tagline_font = fit_font(fonts.body, BRAND_TAGLINE, 1160, 38, 24)
    draw_tracked_text(canvas, BRAND_TAGLINE, 1024, 1870, tagline_font, (*PEARL, 230), 2)
    return canvas


def render_thumbnail(assets: Assets, fonts: Fonts, seed: int) -> Image.Image:
    size = (1280, 720)
    canvas = build_background(assets.landscape_plate, size, focus=(0.51, 0.48), tint=MIDNIGHT, tint_alpha=30)
    horizontal = Image.new("L", size, 0)
    draw_mask = ImageDraw.Draw(horizontal)
    for x in range(size[0]):
        alpha = round(232 * max(0.0, 1.0 - x / 810))
        draw_mask.line((x, 0, x, size[1]), fill=alpha)
    shade = Image.new("RGBA", size, (*INK, 255))
    shade.putalpha(horizontal)
    canvas.alpha_composite(shade)
    vertical_color_gradient(canvas, INK, 25, 130, start=0.55, end=1.0)
    add_vignette(canvas, 142)
    add_starfield(canvas, seed + 51, 48, (20, 20, 680, 670))

    draw_brand_lockup(canvas, 365, 105, 660, fonts, title_size=84, subtitle_size=31, show_tagline=False)
    draw = ImageDraw.Draw(canvas)
    headline_font = fit_font(fonts.display, "RESTORE THE CROWN", 640, 42, 28)
    draw.text((365, 467), "RESTORE THE CROWN", font=headline_font, fill=PEARL, anchor="ma", stroke_width=2, stroke_fill=(30, 20, 75))
    draw.line((100, 531, 630, 531), fill=(*ANTIQUE_GOLD, 200), width=3)
    return canvas


def render_store_screenshot(
    assets: Assets,
    fonts: Fonts,
    spec: ScreenSpec,
    capture: Image.Image,
    seed: int,
) -> Image.Image:
    gameplay = crop_real_gameplay(capture)
    size = SCREEN_SIZE
    canvas = cover(capture, size, focus=(0.5, 0.48)).filter(ImageFilter.GaussianBlur(38))
    canvas = ImageEnhance.Color(canvas).enhance(0.68).convert("RGBA")
    alpha_overlay(canvas, MIDNIGHT, 118)
    add_radial_glow(canvas, (540, 900), (610, 780), spec.accent_color, 72)
    vertical_color_gradient(canvas, INK, 230, 15, start=0.0, end=0.28)
    vertical_color_gradient(canvas, INK, 0, 238, start=0.64, end=1.0)
    add_vignette(canvas, 168)
    add_starfield(canvas, seed + spec.index * 101, 58, (28, 15, 1052, 1880))

    draw = ImageDraw.Draw(canvas)
    kicker_font = font_at(str(fonts.body), 24)
    draw_tracked_text(canvas, f"{BRAND_TITLE}  •  ACTUAL GAMEPLAY", 540, 55, kicker_font, (*TURQUOISE, 225), 3)
    draw.text((1005, 55), f"{spec.index:02d} / 06", font=kicker_font, fill=(*PALE_GOLD, 220), anchor="ra")
    draw.line((70, 104, 1010, 104), fill=(*ANTIQUE_GOLD, 165), width=2)

    headline_font = fit_font(fonts.display, spec.headline, 920, 70, 42)
    headline = wrap_text(draw, spec.headline, headline_font, 920)
    bbox = draw.multiline_textbbox((540, 137), headline, font=headline_font, anchor="ma", align="center", spacing=3, stroke_width=2)
    draw.multiline_text(
        (543, 141),
        headline,
        font=headline_font,
        fill=(0, 0, 12, 190),
        anchor="ma",
        align="center",
        spacing=3,
        stroke_width=3,
        stroke_fill=(0, 0, 0, 150),
    )
    draw.multiline_text(
        (540, 137),
        headline,
        font=headline_font,
        fill=PEARL,
        anchor="ma",
        align="center",
        spacing=3,
        stroke_width=2,
        stroke_fill=(34, 24, 78),
    )
    headline_bottom = bbox[3]

    frame_width = 704
    inner_ratio = gameplay.height / gameplay.width
    frame_height = round((frame_width - 36) * inner_ratio) + 36
    frame_height = min(1280, frame_height)
    frame_top = max(300, headline_bottom + 42)
    frame_left = (size[0] - frame_width) // 2
    rounded_gameplay_frame(
        canvas,
        gameplay,
        (frame_left, frame_top, frame_left + frame_width, frame_top + frame_height),
        spec.accent_color,
    )

    bubble_box = (34, frame_top + 72, 238, frame_top + 276)
    paste_sprite(canvas, assets.bubbles[spec.bubble_color], bubble_box, shadow=True, glow_color=spec.accent_color)
    accent_box = (820, frame_top + frame_height - 245, 1070, frame_top + frame_height + 52)
    paste_sprite(canvas, assets.accents[spec.slug], accent_box, anchor=(1.0, 0.7), shadow=True, glow_color=spec.accent_color)

    copy_top = min(1765, frame_top + frame_height + 70)
    sub_font = fit_font(fonts.body, spec.subline, 860, 36, 25)
    wrapped_subline = wrap_text(draw, spec.subline, sub_font, 860)
    draw.multiline_text(
        (540, copy_top),
        wrapped_subline,
        font=sub_font,
        fill=(*PEARL, 230),
        anchor="ma",
        align="center",
        spacing=8,
    )
    draw.line((255, 1844, 825, 1844), fill=(*ANTIQUE_GOLD, 175), width=2)
    footer_font = font_at(str(fonts.body), 20)
    draw_tracked_text(canvas, "REAL CAPTURE  •  NO SIMULATED GAMEPLAY", 540, 1866, footer_font, (*PALE_GOLD, 205), 2)
    return canvas


def save_png(image: Image.Image, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    image.convert("RGB").save(destination, format="PNG", compress_level=9, optimize=False)


def input_record(role: str, path: Path) -> dict[str, object]:
    with Image.open(path) as image:
        width, height = image.size
        mode = image.mode
    return {
        "role": role,
        "path": display_path(path),
        "width": width,
        "height": height,
        "mode": mode,
        "sha256": image_sha256(path),
    }


def output_record(identifier: str, path: Path, sources: Iterable[Path] = ()) -> dict[str, object]:
    with Image.open(path) as image:
        width, height = image.size
    return {
        "id": identifier,
        "filename": path.name,
        "width": width,
        "height": height,
        "format": "PNG",
        "sha256": image_sha256(path),
        "gameplaySources": [display_path(source) for source in sources],
    }


def build_pack(args: argparse.Namespace) -> Path:
    output_dir = args.output_dir.expanduser().resolve()
    screenshots_dir = args.screenshots_dir.expanduser().resolve()
    if not screenshots_dir.is_dir():
        raise FileNotFoundError(f"Missing gameplay screenshots directory: {screenshots_dir}")

    fonts = Fonts(
        display=select_font(args.display_font, display=True),
        body=select_font(args.body_font, display=False),
    )
    assets, input_paths = load_assets(args)

    screenshot_paths: dict[str, Path] = {}
    screenshot_images: dict[str, Image.Image] = {}
    for spec in SCREEN_SPECS:
        path = require_file(screenshots_dir / spec.source_name, f"real gameplay capture for {spec.slug}")
        screenshot_paths[spec.slug] = path
        screenshot_images[spec.slug] = load_rgba(path, f"real gameplay capture for {spec.slug}")
        input_paths[f"gameplay_{spec.slug}"] = path

    output_dir.mkdir(parents=True, exist_ok=True)
    outputs: list[dict[str, object]] = []

    standard_jobs = (
        ("poster", "poster-2160x3840.png", render_poster),
        ("feature", "feature-1920x1080.png", render_feature),
        ("square", "square-2048x2048.png", render_square),
        ("thumbnail", "thumbnail-1280x720.png", render_thumbnail),
    )
    for identifier, filename, renderer in standard_jobs:
        destination = output_dir / filename
        save_png(renderer(assets, fonts, args.seed), destination)
        outputs.append(output_record(identifier, destination))
        print(f"rendered {destination}")

    for spec in SCREEN_SPECS:
        destination = output_dir / spec.output_name
        save_png(
            render_store_screenshot(assets, fonts, spec, screenshot_images[spec.slug], args.seed),
            destination,
        )
        outputs.append(output_record(f"store-{spec.index:02d}", destination, (screenshot_paths[spec.slug],)))
        print(f"rendered {destination}")

    manifest = {
        "schemaVersion": 1,
        "brand": {
            "title": BRAND_TITLE,
            "subtitle": BRAND_SUBTITLE,
            "tagline": BRAND_TAGLINE,
        },
        "generator": display_path(Path(__file__)),
        "seed": args.seed,
        "renderPolicy": {
            "keyArt": "Generated portrait and landscape plates are used only as marketing artwork and atmospheric extension.",
            "gameplayIntegrity": (
                "Every store image embeds a real Playwright capture. Only centered desktop gutters are removed; "
                "gameplay pixels are proportionally resized and are never repainted or replaced."
            ),
            "exposure": "No white sweep, glare overlay, or blown-exposure effect is added.",
            "typography": "Brand title and subtitle are rendered deterministically by Pillow, not generated inside key art.",
        },
        "fonts": {
            "display": display_path(fonts.display),
            "body": display_path(fonts.body),
        },
        "inputs": [input_record(role, path) for role, path in sorted(input_paths.items())],
        "outputs": outputs,
    }
    manifest_path = output_dir / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(f"rendered {manifest_path}")
    return manifest_path


def main(argv: Sequence[str] | None = None) -> int:
    try:
        manifest = build_pack(parse_args(argv))
    except (FileNotFoundError, OSError, ValueError) as error:
        print(f"marketing pack failed: {error}", file=sys.stderr)
        return 1
    print(f"marketing pack complete: {manifest}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

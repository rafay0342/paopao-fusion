#!/usr/bin/env python3
"""Build deterministic PaoPao Fusion brand, social, wallpaper and press assets."""

from __future__ import annotations

import hashlib
import json
import math
import os
import random
import shutil
from pathlib import Path

from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageFont


ROOT = Path(__file__).resolve().parents[1]
PACK = ROOT / "output" / "marketing-pack"
SOURCE_DIR = PACK / "sources"

PORTRAIT_SOURCE = SOURCE_DIR / "key-art-portrait-master.png"
LANDSCAPE_SOURCE = SOURCE_DIR / "key-art-landscape-master.png"

FONT_DISPLAY = Path("/usr/share/fonts/truetype/noto/NotoSans-Bold.ttf")
FONT_SERIF = Path("/usr/share/fonts/truetype/noto/NotoSerif-Bold.ttf")

INK = (4, 7, 24)
INDIGO = (27, 13, 70)
VIOLET = (126, 67, 217)
CYAN = (92, 232, 255)
PEARL = (244, 250, 255)
GOLD = (240, 187, 69)
WARM_GOLD = (255, 221, 135)

CUTOUT_SOURCES = {
    "lumi.png": ROOT / "public/assets/cinematics/layers/lumi.png",
    "aurora-crown.png": ROOT / "public/assets/cinematics/layers/aurora-crown.png",
    "prism-launcher.png": ROOT / "public/assets/sprites/v3/crystal-launcher-hd.png",
    "prism-warden.png": ROOT / "public/assets/sprites/v8/boss-prism-warden.png",
    "heartwood-guardian.png": ROOT / "public/assets/sprites/v8/boss-heartwood-guardian.png",
    "astral-sentinel.png": ROOT / "public/assets/sprites/v8/boss-astral-sentinel.png",
    "inferno-sovereign.png": ROOT / "public/assets/sprites/v8/boss-inferno-sovereign.png",
    "frost-regent.png": ROOT / "public/assets/sprites/v9/boss-frost-regent.png",
    "nexus-architect.png": ROOT / "public/assets/sprites/v9/boss-nexus-architect.png",
}


def require_sources() -> None:
    required = [PORTRAIT_SOURCE, LANDSCAPE_SOURCE, *CUTOUT_SOURCES.values()]
    missing = [str(path) for path in required if not path.is_file()]
    if missing:
        raise FileNotFoundError("Missing required marketing sources:\n" + "\n".join(missing))
    if not FONT_DISPLAY.is_file() or not FONT_SERIF.is_file():
        raise FileNotFoundError("Required bundled system fonts are unavailable")


def atomic_save(image: Image.Image, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_name(destination.name + ".tmp")
    image.save(temporary, format="PNG", optimize=True, compress_level=7)
    os.replace(temporary, destination)


def load_rgb(path: Path) -> Image.Image:
    with Image.open(path) as source:
        return source.convert("RGB")


def load_rgba(path: Path) -> Image.Image:
    with Image.open(path) as source:
        return source.convert("RGBA")


def cover(source: Image.Image, size: tuple[int, int], anchor: tuple[float, float] = (0.5, 0.5)) -> Image.Image:
    target_w, target_h = size
    scale = max(target_w / source.width, target_h / source.height)
    resized = source.resize(
        (max(target_w, round(source.width * scale)), max(target_h, round(source.height * scale))),
        Image.Resampling.LANCZOS,
    )
    overflow_x = resized.width - target_w
    overflow_y = resized.height - target_h
    left = round(overflow_x * max(0.0, min(1.0, anchor[0])))
    top = round(overflow_y * max(0.0, min(1.0, anchor[1])))
    return resized.crop((left, top, left + target_w, top + target_h))


def contain_rgba(source: Image.Image, bounds: tuple[int, int]) -> Image.Image:
    alpha_bbox = source.getchannel("A").getbbox()
    cropped = source.crop(alpha_bbox) if alpha_bbox else source.copy()
    scale = min(bounds[0] / cropped.width, bounds[1] / cropped.height)
    return cropped.resize(
        (max(1, round(cropped.width * scale)), max(1, round(cropped.height * scale))),
        Image.Resampling.LANCZOS,
    )


def enhance_scene(image: Image.Image, *, contrast: float = 1.06, color: float = 1.05) -> Image.Image:
    scene = ImageEnhance.Color(image).enhance(color)
    scene = ImageEnhance.Contrast(scene).enhance(contrast)
    return ImageEnhance.Sharpness(scene).enhance(1.05)


def solid_overlay(size: tuple[int, int], color: tuple[int, int, int], alpha: int) -> Image.Image:
    return Image.new("RGBA", size, (*color, max(0, min(255, alpha))))


def vertical_overlay(
    size: tuple[int, int],
    color: tuple[int, int, int],
    stops: tuple[tuple[float, int], ...],
) -> Image.Image:
    width, height = size
    ordered = tuple(sorted(stops))
    column = Image.new("RGBA", (1, height), (0, 0, 0, 0))
    pixels = column.load()
    for y in range(height):
        position = y / max(1, height - 1)
        left = ordered[0]
        right = ordered[-1]
        for index in range(len(ordered) - 1):
            if ordered[index][0] <= position <= ordered[index + 1][0]:
                left, right = ordered[index], ordered[index + 1]
                break
        span = max(1e-9, right[0] - left[0])
        amount = max(0.0, min(1.0, (position - left[0]) / span))
        alpha = round(left[1] + (right[1] - left[1]) * amount)
        pixels[0, y] = (*color, max(0, min(255, alpha)))
    return column.resize((width, height), Image.Resampling.NEAREST)


def add_vignette(image: Image.Image, strength: int = 145) -> Image.Image:
    width, height = image.size
    mask_w = 256
    mask_h = max(64, round(mask_w * height / width))
    mask = Image.new("L", (mask_w, mask_h), 0)
    pixels = mask.load()
    for y in range(mask_h):
        ny = (y + 0.5 - mask_h / 2) / (mask_h / 2)
        for x in range(mask_w):
            nx = (x + 0.5 - mask_w / 2) / (mask_w / 2)
            radius = math.sqrt(nx * nx + ny * ny)
            edge = max(0.0, min(1.0, (radius - 0.45) / 0.75))
            pixels[x, y] = round(strength * edge * edge)
    mask = mask.resize((width, height), Image.Resampling.BICUBIC)
    shade = Image.new("RGBA", (width, height), (*INK, 0))
    shade.putalpha(mask)
    base = image.convert("RGBA")
    base.alpha_composite(shade)
    return base


def font(size: int, *, serif: bool = False) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(FONT_SERIF if serif else FONT_DISPLAY), size=size)


def tracked_width(text: str, typeface: ImageFont.FreeTypeFont, tracking: float) -> float:
    probe = ImageDraw.Draw(Image.new("L", (2, 2)))
    return sum(probe.textlength(char, font=typeface) for char in text) + tracking * max(0, len(text) - 1)


def tracked_mask(
    size: tuple[int, int],
    text: str,
    typeface: ImageFont.FreeTypeFont,
    center_x: float,
    top: float,
    tracking: float,
) -> Image.Image:
    mask = Image.new("L", size, 0)
    draw = ImageDraw.Draw(mask)
    x = center_x - tracked_width(text, typeface, tracking) / 2
    for char in text:
        draw.text((round(x), round(top)), char, font=typeface, fill=255, anchor="lt")
        x += draw.textlength(char, font=typeface) + tracking
    return mask


def gradient_fill(size: tuple[int, int], top: tuple[int, int, int], bottom: tuple[int, int, int]) -> Image.Image:
    width, height = size
    column = Image.new("RGBA", (1, height))
    pixels = column.load()
    for y in range(height):
        amount = y / max(1, height - 1)
        color = tuple(round(top[channel] + (bottom[channel] - top[channel]) * amount) for channel in range(3))
        pixels[0, y] = (*color, 255)
    return column.resize((width, height), Image.Resampling.BILINEAR)


def composite_mask_color(target: Image.Image, mask: Image.Image, color: tuple[int, int, int, int]) -> None:
    layer = Image.new("RGBA", target.size, color)
    layer.putalpha(Image.eval(mask, lambda value: value * color[3] // 255))
    target.alpha_composite(layer)


def add_gradient_text(
    target: Image.Image,
    text: str,
    typeface: ImageFont.FreeTypeFont,
    center_x: float,
    top: float,
    tracking: float,
    fill_top: tuple[int, int, int],
    fill_bottom: tuple[int, int, int],
    *,
    gold_edge: int = 3,
    dark_edge: int = 9,
    shadow_blur: int = 14,
) -> None:
    mask = tracked_mask(target.size, text, typeface, center_x, top, tracking)
    if shadow_blur:
        shadow = mask.filter(ImageFilter.GaussianBlur(shadow_blur))
        composite_mask_color(target, shadow, (0, 0, 0, 170))
    if dark_edge:
        outer = mask.filter(ImageFilter.MaxFilter(dark_edge * 2 + 1))
        composite_mask_color(target, outer, (*INDIGO, 245))
    if gold_edge:
        gold = mask.filter(ImageFilter.MaxFilter(gold_edge * 2 + 1))
        composite_mask_color(target, gold, (*GOLD, 255))
    fill = gradient_fill(target.size, fill_top, fill_bottom)
    target.alpha_composite(Image.composite(fill, Image.new("RGBA", target.size), mask))


def add_flat_tracked_text(
    target: Image.Image,
    text: str,
    typeface: ImageFont.FreeTypeFont,
    center_x: float,
    top: float,
    tracking: float,
    color: tuple[int, int, int],
    *,
    shadow: bool = True,
) -> None:
    mask = tracked_mask(target.size, text, typeface, center_x, top, tracking)
    if shadow:
        blurred = mask.filter(ImageFilter.GaussianBlur(max(4, typeface.size // 10)))
        composite_mask_color(target, blurred, (0, 0, 0, 155))
    composite_mask_color(target, mask, (*color, 255))


def alpha_glow(sprite: Image.Image, color: tuple[int, int, int], radius: int, opacity: int) -> Image.Image:
    pad = radius * 3
    glow = Image.new("RGBA", (sprite.width + pad * 2, sprite.height + pad * 2), (0, 0, 0, 0))
    mask = Image.new("L", glow.size, 0)
    mask.paste(sprite.getchannel("A"), (pad, pad))
    mask = mask.filter(ImageFilter.GaussianBlur(radius))
    mask = mask.point(lambda value: value * opacity // 255)
    color_layer = Image.new("RGBA", glow.size, (*color, 0))
    color_layer.putalpha(mask)
    glow.alpha_composite(color_layer)
    return glow


def paste_center(target: Image.Image, sprite: Image.Image, center: tuple[float, float]) -> None:
    target.alpha_composite(sprite, (round(center[0] - sprite.width / 2), round(center[1] - sprite.height / 2)))


def six_point_star(center: tuple[float, float], outer: float, inner: float) -> list[tuple[float, float]]:
    points: list[tuple[float, float]] = []
    for index in range(12):
        radius = outer if index % 2 == 0 else inner
        angle = -math.pi / 2 + index * math.pi / 6
        points.append((center[0] + math.cos(angle) * radius, center[1] + math.sin(angle) * radius))
    return points


def draw_brand_text(target: Image.Image, center_x: float, top: float, scale: float = 1.0) -> None:
    add_gradient_text(
        target,
        "PAOPAO",
        font(round(166 * scale)),
        center_x,
        top,
        3 * scale,
        PEARL,
        (171, 224, 255),
        gold_edge=max(1, round(2 * scale)),
        dark_edge=max(3, round(7 * scale)),
        shadow_blur=max(5, round(13 * scale)),
    )
    add_gradient_text(
        target,
        "FUSION",
        font(round(88 * scale)),
        center_x,
        top + 154 * scale,
        20 * scale,
        CYAN,
        (152, 104, 246),
        gold_edge=max(1, round(1 * scale)),
        dark_edge=max(2, round(5 * scale)),
        shadow_blur=max(4, round(10 * scale)),
    )
    add_flat_tracked_text(
        target,
        "THE SHATTERED CROWN",
        font(round(34 * scale), serif=True),
        center_x,
        top + 250 * scale,
        5 * scale,
        WARM_GOLD,
    )


def build_logo() -> tuple[Path, str]:
    size = (2400, 900)
    logo = Image.new("RGBA", size, (0, 0, 0, 0))

    crown = contain_rgba(load_rgba(CUTOUT_SOURCES["aurora-crown.png"]), (720, 680))
    paste_center(logo, crown, (430, 445))

    add_gradient_text(logo, "PAOPAO", font(270), 1515, 116, 2, PEARL, (167, 225, 255), gold_edge=4, dark_edge=13)
    add_gradient_text(logo, "FUSION", font(164), 1515, 385, 34, CYAN, (164, 96, 244), gold_edge=2, dark_edge=8)
    add_flat_tracked_text(logo, "THE SHATTERED CROWN", font(63, serif=True), 1515, 615, 9, WARM_GOLD)

    draw = ImageDraw.Draw(logo)
    line_y = 735
    draw.line((870, line_y, 2160, line_y), fill=(*CYAN, 185), width=3)
    draw.polygon(six_point_star((1515, line_y), 20, 9), fill=(*GOLD, 255))
    for index, color in enumerate(((153, 75, 235), (67, 221, 112), (255, 205, 54), (250, 91, 63), (69, 169, 255), (247, 134, 42))):
        x = 1185 + index * 132
        draw.ellipse((x - 6, 790, x + 6, 802), fill=(*color, 235))

    destination = PACK / "brand/logo-primary-transparent.png"
    atomic_save(logo, destination)
    return destination, "Transparent primary wordmark with original Aurora Crown motif"


def build_app_icon() -> tuple[Path, str]:
    size = (1024, 1024)
    scene = cover(load_rgb(LANDSCAPE_SOURCE), size, anchor=(0.69, 0.42))
    scene = ImageEnhance.Brightness(scene).enhance(0.36).convert("RGBA")
    scene.alpha_composite(solid_overlay(size, (7, 9, 34), 98))

    aura = Image.new("RGBA", size, (0, 0, 0, 0))
    aura_draw = ImageDraw.Draw(aura)
    aura_draw.ellipse((165, 130, 859, 824), fill=(*VIOLET, 115))
    aura = aura.filter(ImageFilter.GaussianBlur(105))
    scene.alpha_composite(aura)

    stars = ImageDraw.Draw(scene)
    rng = random.Random(713)
    for _ in range(54):
        x = rng.randrange(55, 969)
        y = rng.randrange(48, 940)
        radius = rng.choice((1, 1, 2, 2, 3))
        color = CYAN if rng.random() < 0.72 else WARM_GOLD
        stars.ellipse((x - radius, y - radius, x + radius, y + radius), fill=(*color, rng.randrange(95, 190)))

    crown = contain_rgba(load_rgba(CUTOUT_SOURCES["aurora-crown.png"]), (900, 665))
    glow = alpha_glow(crown, (184, 111, 255), 32, 185)
    paste_center(scene, glow, (512, 530))
    paste_center(scene, crown, (512, 530))

    frame = ImageDraw.Draw(scene)
    frame.rounded_rectangle((28, 28, 996, 996), radius=218, outline=(*INDIGO, 230), width=24)
    frame.rounded_rectangle((42, 42, 982, 982), radius=204, outline=(*GOLD, 225), width=8)
    frame.rounded_rectangle((54, 54, 970, 970), radius=194, outline=(*CYAN, 90), width=3)

    destination = PACK / "brand/app-icon-master.png"
    atomic_save(scene.convert("RGB"), destination)
    return destination, "Square Aurora Crown app icon master without platform masking"


def prepare_social_scene(
    size: tuple[int, int],
    source: Image.Image,
    anchor: tuple[float, float],
    *,
    vignette: int,
) -> Image.Image:
    scene = enhance_scene(cover(source, size, anchor=anchor)).convert("RGBA")
    return add_vignette(scene, vignette)


def build_social_square() -> tuple[Path, str]:
    size = (1080, 1080)
    scene = prepare_social_scene(size, load_rgb(LANDSCAPE_SOURCE), (0.25, 0.49), vignette=130)
    scene.alpha_composite(vertical_overlay(size, INK, ((0.0, 188), (0.28, 0), (0.68, 0), (1.0, 218))))

    draw_brand_text(scene, 310, 60, 0.58)

    lumi = contain_rgba(load_rgba(CUTOUT_SOURCES["lumi.png"]), (370, 600))
    lumi_glow = alpha_glow(lumi, CYAN, 18, 74)
    paste_center(scene, lumi_glow, (830, 650))
    paste_center(scene, lumi, (830, 650))

    add_flat_tracked_text(scene, "SIX REALMS. SIX SHARDS.", font(38), 350, 904, 1, PEARL)
    add_flat_tracked_text(scene, "ONE LAST PRISM KEEPER.", font(25, serif=True), 350, 974, 3, WARM_GOLD)

    destination = PACK / "social/social-square.png"
    atomic_save(scene.convert("RGB"), destination)
    return destination, "Square social key art with canonical campaign promise"


def build_social_portrait() -> tuple[Path, str]:
    size = (1080, 1350)
    scene = prepare_social_scene(size, load_rgb(PORTRAIT_SOURCE), (0.5, 0.58), vignette=148)
    scene.alpha_composite(vertical_overlay(size, INK, ((0.0, 220), (0.29, 15), (0.70, 0), (1.0, 226))))

    draw_brand_text(scene, 540, 56, 0.72)
    add_flat_tracked_text(scene, "AIM. MATCH. FUSE. RESTORE.", font(39), 540, 1190, 2, PEARL)
    add_flat_tracked_text(scene, "SIX REALMS • ONE LIVING QUEST", font(25, serif=True), 540, 1262, 3, WARM_GOLD)

    destination = PACK / "social/social-portrait.png"
    atomic_save(scene.convert("RGB"), destination)
    return destination, "Four-by-five social key art with the gameplay verb promise"


def build_story_poster() -> tuple[Path, str]:
    size = (1080, 1920)
    scene = prepare_social_scene(size, load_rgb(PORTRAIT_SOURCE), (0.5, 0.5), vignette=142)
    scene.alpha_composite(vertical_overlay(size, INK, ((0.0, 205), (0.20, 5), (0.72, 0), (1.0, 232))))

    draw_brand_text(scene, 540, 58, 0.72)
    add_flat_tracked_text(scene, "RESTORE THE CROWN.", font(55), 540, 1712, 2, PEARL)
    add_flat_tracked_text(scene, "FREE THE SIX GUARDIANS.", font(31, serif=True), 540, 1798, 4, WARM_GOLD)

    line = ImageDraw.Draw(scene)
    line.line((240, 1870, 840, 1870), fill=(*CYAN, 155), width=3)
    line.polygon(six_point_star((540, 1870), 17, 7), fill=(*GOLD, 255))

    destination = PACK / "social/story-poster.png"
    atomic_save(scene.convert("RGB"), destination)
    return destination, "Nine-by-sixteen story poster using the portrait master plate"


def build_wallpaper_desktop() -> tuple[Path, str]:
    size = (3840, 2160)
    wallpaper = enhance_scene(cover(load_rgb(LANDSCAPE_SOURCE), size, anchor=(0.5, 0.5)), contrast=1.04, color=1.04)
    destination = PACK / "wallpapers/wallpaper-desktop.png"
    atomic_save(wallpaper, destination)
    return destination, "Clean sixteen-by-nine desktop key-art wallpaper"


def build_wallpaper_mobile() -> tuple[Path, str]:
    size = (2160, 3840)
    wallpaper = enhance_scene(cover(load_rgb(PORTRAIT_SOURCE), size, anchor=(0.5, 0.5)), contrast=1.04, color=1.04)
    destination = PACK / "wallpapers/wallpaper-mobile.png"
    atomic_save(wallpaper, destination)
    return destination, "Clean nine-by-sixteen mobile key-art wallpaper"


def copy_press_cutouts() -> list[tuple[Path, str]]:
    destination_dir = PACK / "press/cutouts"
    destination_dir.mkdir(parents=True, exist_ok=True)
    outputs: list[tuple[Path, str]] = []
    for filename, source in CUTOUT_SOURCES.items():
        with Image.open(source) as image:
            if "A" not in image.mode:
                raise ValueError(f"Press cutout does not preserve alpha: {source}")
        destination = destination_dir / filename
        temporary = destination.with_name(destination.name + ".tmp")
        shutil.copyfile(source, temporary)
        os.replace(temporary, destination)
        outputs.append((destination, f"Exact alpha-preserved copy of {source.relative_to(ROOT).as_posix()}"))
    return outputs


def file_digest(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def manifest_entry(path: Path, purpose: str) -> dict[str, object]:
    with Image.open(path) as image:
        width, height = image.size
        mode = image.mode
    return {
        "path": path.relative_to(PACK).as_posix(),
        "width": width,
        "height": height,
        "mode": mode,
        "purpose": purpose,
        "sha256": file_digest(path),
    }


def write_manifest(outputs: list[tuple[Path, str]]) -> Path:
    manifest = {
        "name": "PaoPao Fusion Marketing Extras",
        "title": "PAOPAO FUSION: THE SHATTERED CROWN",
        "generated": "2026-07-21",
        "sourcePlates": [
            PORTRAIT_SOURCE.relative_to(PACK).as_posix(),
            LANDSCAPE_SOURCE.relative_to(PACK).as_posix(),
        ],
        "constraints": [
            "Original project artwork only",
            "No generated or altered gameplay UI",
            "No white glare or sweep overlays",
            "Press cutouts preserve the original alpha channels",
        ],
        "assets": [manifest_entry(path, purpose) for path, purpose in outputs],
    }
    destination = PACK / "extras-manifest.json"
    temporary = destination.with_name(destination.name + ".tmp")
    temporary.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    os.replace(temporary, destination)
    return destination


def main() -> None:
    require_sources()
    outputs = [
        build_logo(),
        build_app_icon(),
        build_social_square(),
        build_social_portrait(),
        build_story_poster(),
        build_wallpaper_desktop(),
        build_wallpaper_mobile(),
    ]
    outputs.extend(copy_press_cutouts())
    manifest = write_manifest(outputs)

    for path, _ in outputs:
        with Image.open(path) as image:
            alpha = " alpha" if "A" in image.mode else ""
            print(f"{path.relative_to(ROOT)}  {image.width}x{image.height}{alpha}")
    print(manifest.relative_to(ROOT))


if __name__ == "__main__":
    main()

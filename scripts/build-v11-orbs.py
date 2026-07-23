from __future__ import annotations

from pathlib import Path
from PIL import Image, ImageColor
import colorsys
import math


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "art-source" / "v11"
OUTPUT = ROOT / "public" / "assets" / "sprites" / "v11"

MASTERS = {
    "phoenix": "phoenix-royal-transparent.png",
    "phoenix-optical": "phoenix-optical-transparent.png",
    "frostglass": "frostglass-royal-transparent.png",
    "frostglass-optical": "frostglass-optical-transparent.png",
    "nexus-crown": "nexus-royal-transparent.png",
    "nexus-crown-optical": "nexus-optical-transparent.png",
}

COLORS = {
    "red": "#ff5a6e",
    "blue": "#4fb0ff",
    "green": "#4be08a",
    "yellow": "#ffd24b",
    "purple": "#b46bff",
    "orange": "#ff9f45",
}


def crop_square(image: Image.Image) -> Image.Image:
    alpha = image.getchannel("A")
    box = alpha.getbbox()
    if box is None:
        raise ValueError("master has no visible pixels")
    left, top, right, bottom = box
    size = max(right - left, bottom - top)
    pad = max(18, round(size * 0.035))
    size += pad * 2
    cx = (left + right) // 2
    cy = (top + bottom) // 2
    square = Image.new("RGBA", (size, size))
    square.alpha_composite(image, ((size - image.width) // 2 - (cx - image.width // 2), (size - image.height) // 2 - (cy - image.height // 2)))
    return square


def colour_variant(master: Image.Image, target_hex: str) -> Image.Image:
    target_rgb = ImageColor.getrgb(target_hex)
    target_h, target_s, _ = colorsys.rgb_to_hsv(*(value / 255 for value in target_rgb))
    pixels = master.load()
    cx = (master.width - 1) / 2
    cy = (master.height - 1) / 2
    radius = max(master.width, master.height) / 2

    for y in range(master.height):
        for x in range(master.width):
            r, g, b, a = pixels[x, y]
            if a == 0:
                continue
            h, s, v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
            distance = math.hypot(x - cx, y - cy) / radius
            metallic = distance > 0.69 and (s < 0.22 or 0.07 < h < 0.18)
            if metallic:
                continue
            new_s = max(0.28, min(1.0, target_s * (0.52 + s * 0.62)))
            new_v = min(1.0, v * (0.92 + (1 - s) * 0.12))
            nr, ng, nb = colorsys.hsv_to_rgb(target_h, new_s, new_v)
            pixels[x, y] = (round(nr * 255), round(ng * 255), round(nb * 255), a)
    return master


def main() -> None:
    OUTPUT.mkdir(parents=True, exist_ok=True)
    for slug, filename in MASTERS.items():
        source = crop_square(Image.open(SOURCE / filename).convert("RGBA"))
        for colour, value in COLORS.items():
            variant = colour_variant(source.copy(), value)
            variant.thumbnail((256, 256), Image.Resampling.LANCZOS)
            canvas = Image.new("RGBA", (256, 256))
            canvas.alpha_composite(variant, ((256 - variant.width) // 2, (256 - variant.height) // 2))
            canvas.save(OUTPUT / f"{slug}-{colour}.png", optimize=True)


if __name__ == "__main__":
    main()

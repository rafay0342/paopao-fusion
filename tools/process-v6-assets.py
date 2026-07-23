#!/usr/bin/env python3
"""Build clean runtime sprites from the generated V6/V7 production-art sheets."""

from __future__ import annotations

from collections import deque
from pathlib import Path

from PIL import Image, ImageFilter, ImageOps


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "art-source/full-art-v6"
SOURCE_V7 = ROOT / "art-source/full-art-v7"
SPRITES = ROOT / "public/assets/sprites/v6"
SPRITES_V7 = ROOT / "public/assets/sprites/v7"
UI = ROOT / "public/assets/ui/v6"
WORLDS = ROOT / "public/assets/worlds/v6"


def color_distance(a: tuple[int, int, int], b: tuple[int, int, int]) -> int:
    return max(abs(a[0] - b[0]), abs(a[1] - b[1]), abs(a[2] - b[2]))


def border_connected_cutout(image: Image.Image, tolerance: int = 62) -> Image.Image:
    """Remove only key-colour pixels connected to the canvas border.

    A normal global chroma key deletes violet/red detail inside reflective art.
    Flooding from the border preserves those enclosed highlights while still
    removing the generated magenta backdrop and its antialiased halo.
    """

    rgba = image.convert("RGBA")
    width, height = rgba.size
    pixels = rgba.load()
    samples = [
        pixels[0, 0][:3],
        pixels[width - 1, 0][:3],
        pixels[0, height - 1][:3],
        pixels[width - 1, height - 1][:3],
    ]
    key = tuple(sum(sample[channel] for sample in samples) // len(samples) for channel in range(3))

    visited = bytearray(width * height)
    queue: deque[tuple[int, int]] = deque()

    def enqueue(x: int, y: int) -> None:
        index = y * width + x
        if visited[index] or color_distance(pixels[x, y][:3], key) > tolerance:
            return
        visited[index] = 1
        queue.append((x, y))

    for x in range(width):
        enqueue(x, 0)
        enqueue(x, height - 1)
    for y in range(height):
        enqueue(0, y)
        enqueue(width - 1, y)

    while queue:
        x, y = queue.popleft()
        if x > 0:
            enqueue(x - 1, y)
        if x + 1 < width:
            enqueue(x + 1, y)
        if y > 0:
            enqueue(x, y - 1)
        if y + 1 < height:
            enqueue(x, y + 1)

    alpha = Image.new("L", (width, height), 255)
    alpha_pixels = alpha.load()
    for y in range(height):
        row = y * width
        for x in range(width):
            if visited[row + x]:
                alpha_pixels[x, y] = 0

    # One-pixel contract removes chroma spill; a fractional blur restores a
    # clean, natural antialiased edge after high-quality downsampling.
    alpha = alpha.filter(ImageFilter.MinFilter(3)).filter(ImageFilter.GaussianBlur(0.45))
    rgba.putalpha(alpha)
    return rgba


def grid_cells(image: Image.Image, columns: int, rows: int) -> list[Image.Image]:
    cell_width = image.width // columns
    cell_height = image.height // rows
    return [
        image.crop((column * cell_width, row * cell_height, (column + 1) * cell_width, (row + 1) * cell_height))
        for row in range(rows)
        for column in range(columns)
    ]


def fit_sprite(cell: Image.Image, size: int, padding_ratio: float = 0.055) -> Image.Image:
    alpha = cell.getchannel("A")
    bounds = alpha.getbbox()
    if bounds is None:
        return Image.new("RGBA", (size, size), (0, 0, 0, 0))
    subject = cell.crop(bounds)
    pad = max(4, round(max(subject.size) * padding_ratio))
    side = max(subject.size) + pad * 2
    square = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    square.alpha_composite(subject, ((side - subject.width) // 2, (side - subject.height) // 2))
    return square.resize((size, size), Image.Resampling.LANCZOS)


def build_sheet(
    source_name: str,
    output_dir: Path,
    names: list[str],
    columns: int,
    rows: int,
    size: int,
    padding_ratio: float,
    source_dir: Path = SOURCE,
) -> None:
    cutout = border_connected_cutout(Image.open(source_dir / source_name))
    cells = grid_cells(cutout, columns, rows)
    if len(cells) != len(names):
        raise ValueError(f"{source_name}: expected {len(names)} cells, found {len(cells)}")
    output_dir.mkdir(parents=True, exist_ok=True)
    for cell, name in zip(cells, names):
        output = fit_sprite(cell, size, padding_ratio)
        target = output_dir / name
        output.save(target, optimize=True)
        alpha = output.getchannel("A")
        coverage = sum(1 for value in alpha.getdata() if value > 16) / (size * size)
        print(f"{target.relative_to(ROOT)}  {size}x{size}  coverage={coverage:.1%}")


def main() -> None:
    colors = ["red", "blue", "green", "yellow", "purple", "orange"]
    build_sheet(
        "nova-liquid-crystal-source.png",
        SPRITES_V7,
        [f"nova-{color}.png" for color in colors],
        3,
        2,
        256,
        0.035,
        SOURCE_V7,
    )
    build_sheet(
        "royal-aurora-circular-source.png",
        SPRITES_V7,
        [f"aurora-{color}.png" for color in colors],
        3,
        2,
        256,
        0.035,
        SOURCE_V7,
    )
    build_sheet(
        "voidforge-celestial-source.png",
        SPRITES_V7,
        [f"voidforge-{color}.png" for color in colors],
        3,
        2,
        256,
        0.035,
        SOURCE_V7,
    )
    build_sheet(
        "reward-collection-source.png",
        UI,
        [
            "mystery-chest-closed.png",
            "mystery-chest-open.png",
            "gift-hamper.png",
            "coin-stack.png",
            "skin-token.png",
            "prize-pool.png",
        ],
        3,
        2,
        384,
        0.045,
    )
    build_sheet(
        "tier-crests-source.png",
        UI,
        ["tier-bronze.png", "tier-silver.png", "tier-gold.png", "tier-prismatic.png"],
        2,
        2,
        384,
        0.045,
    )

    WORLDS.mkdir(parents=True, exist_ok=True)
    vault = Image.open(SOURCE / "prize-vault-source.png").convert("RGB")
    vault = ImageOps.fit(vault, (720, 1280), method=Image.Resampling.LANCZOS, centering=(0.5, 0.5))
    target = WORLDS / "prize-vault-hd.jpg"
    vault.save(target, quality=92, optimize=True, progressive=True)
    print(f"{target.relative_to(ROOT)}  720x1280")


if __name__ == "__main__":
    main()

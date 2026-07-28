#!/usr/bin/env python3
"""Build the editable PF-asset-231 Nexus master from its selected generated seed.

This is intentionally a narrow, deterministic finishing pass. It preserves the
true generated source, lowers launcher-zone frequency, splits the final plate
into editable composition bands, and updates only PF-asset-231 integrity metadata.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

from PIL import Image, ImageEnhance, ImageFilter


ROOT = Path(__file__).resolve().parents[1]
MASTER_ROOT = ROOT / "art-source" / "v14" / "masters"
MANIFEST_PATH = ROOT / "art-source" / "v14" / "manifest.json"
PREFIX = "PF-asset-231-nexus-realm-hero"
GENERATED_AT = "2026-07-28T14:53:25.000Z"
REVIEWED_AT = "2026-07-28T15:45:46.000Z"

PATHS = {
    "generated-source": MASTER_ROOT / f"{PREFIX}-generated-source.png",
    "environment-plate": MASTER_ROOT / f"{PREFIX}-environment.png",
    "background-layer": MASTER_ROOT / f"{PREFIX}-background.png",
    "midground-layer": MASTER_ROOT / f"{PREFIX}-midground.png",
    "gameplay-plane-layer": MASTER_ROOT / f"{PREFIX}-gameplay-plane.png",
    "foreground-layer": MASTER_ROOT / f"{PREFIX}-foreground.png",
    "atmosphere-layer": MASTER_ROOT / f"{PREFIX}-atmosphere.png",
    "primary": MASTER_ROOT / f"{PREFIX}-layered.json",
}

LAYER_BANDS = {
    "background-layer": (0.0, 0.28),
    "midground-layer": (0.28, 0.48),
    "gameplay-plane-layer": (0.48, 0.78),
    "foreground-layer": (0.78, 1.0),
}
COMPOSITE_LAYER_IDS = (
    "background",
    "midground",
    "gameplay-plane",
    "foreground",
)


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def png_descriptor(role: str, path: Path) -> dict[str, object]:
    return {
        "role": role,
        "path": path.relative_to(ROOT).as_posix(),
        "format": "png",
        "bytes": path.stat().st_size,
        "sha256": sha256(path),
    }


def launcher_safe_plate(generated: Image.Image) -> Image.Image:
    """Calm lower micro-detail while retaining the authored launch dais."""

    source = generated.convert("RGB")
    width, height = source.size
    reduced = source.resize(
        (max(1, width // 3), max(1, height // 3)),
        Image.Resampling.LANCZOS,
    ).resize(source.size, Image.Resampling.LANCZOS)
    reduced = reduced.filter(ImageFilter.GaussianBlur(1.15))
    reduced = ImageEnhance.Contrast(reduced).enhance(0.78)
    reduced = ImageEnhance.Color(reduced).enhance(0.82)
    reduced = ImageEnhance.Brightness(reduced).enhance(0.91)

    blend_mask = Image.new("L", source.size, 0)
    mask_pixels = blend_mask.load()
    fade_start = int(height * 0.72)
    full_start = int(height * 0.82)
    for y in range(fade_start, height):
        if y < full_start:
            alpha = round(158 * (y - fade_start) / max(1, full_start - fade_start))
        else:
            alpha = 158
        for x in range(width):
            # Preserve slightly more definition at the exact cradle centre,
            # while calming the busy engraved floor and peripheral machinery.
            centre = abs((x / max(1, width - 1)) - 0.5)
            centre_relief = max(0.0, 1.0 - centre / 0.19)
            mask_pixels[x, y] = round(alpha * (1.0 - centre_relief * 0.22))
    plate = Image.composite(reduced, source, blend_mask)

    veil = Image.new("RGBA", source.size, (7, 9, 24, 0))
    veil_alpha = veil.getchannel("A")
    veil_pixels = veil_alpha.load()
    for y in range(fade_start, height):
        progress = (y - fade_start) / max(1, height - fade_start)
        alpha = round(12 + 34 * progress)
        for x in range(width):
            veil_pixels[x, y] = alpha
    veil.putalpha(veil_alpha)
    return Image.alpha_composite(plate.convert("RGBA"), veil).convert("RGB")


def split_depth_layers(plate: Image.Image) -> None:
    width, height = plate.size
    for role, (start, end) in LAYER_BANDS.items():
        top = round(height * start)
        bottom = height if end == 1.0 else round(height * end)
        layer = Image.new("RGBA", plate.size, (0, 0, 0, 0))
        layer.paste(plate.crop((0, top, width, bottom)), (0, top))
        layer.save(PATHS[role], "PNG", optimize=True, compress_level=9)


def write_layered_master(width: int, height: int) -> None:
    layers = [
        {
            "id": "generated-source",
            "role": "immutable selected Candidate C generation source",
            "source": PATHS["generated-source"].relative_to(ROOT).as_posix(),
            "blend": "normal",
            "visible": False,
            "editable": False,
            "runtimeUse": "provenance-reference",
        },
        {
            "id": "background",
            "role": "editable upper vault and distant rift composition band",
            "source": PATHS["background-layer"].relative_to(ROOT).as_posix(),
            "blend": "normal",
            "parallax": 0.0,
        },
        {
            "id": "midground",
            "role": "editable crown machinery and archive composition band",
            "source": PATHS["midground-layer"].relative_to(ROOT).as_posix(),
            "blend": "normal",
            "parallax": 0.0,
        },
        {
            "id": "gameplay-plane",
            "role": "contrast-stable Bubble Shooter and Match-3 gameplay composition band",
            "source": PATHS["gameplay-plane-layer"].relative_to(ROOT).as_posix(),
            "blend": "normal",
            "parallax": 0.0,
        },
        {
            "id": "foreground",
            "role": "launcher-safe dais and crop-bleed foreground composition band",
            "source": PATHS["foreground-layer"].relative_to(ROOT).as_posix(),
            "blend": "normal",
            "parallax": 0.0,
        },
        {
            "id": "atmosphere",
            "role": "quality-scaled corrupted rift atmosphere",
            "source": PATHS["atmosphere-layer"].relative_to(ROOT).as_posix(),
            "blend": "screen",
            "parallax": 0.035,
        },
        {
            "id": "runtime-composite",
            "role": "deterministic runtime composite preview of the editable composition bands",
            "source": PATHS["environment-plate"].relative_to(ROOT).as_posix(),
            "blend": "normal",
            "visible": False,
            "editable": False,
            "runtimeUse": "compiled-world-source",
            "derivedFrom": list(COMPOSITE_LAYER_IDS),
        },
    ]
    master = {
        "schemaVersion": 1,
        "compositionId": "paopao.v14.nexus-realm.corrupted-hero",
        "canvas": {
            "width": width,
            "height": height,
            "orientation": "portrait",
        },
        "safeZones": {
            "topHud": {"x": 0.08, "y": 0, "width": 0.84, "height": 0.14},
            "shooterBoard": {"x": 0.09, "y": 0.15, "width": 0.82, "height": 0.58},
            "match3Board": {"x": 0.14, "y": 0.22, "width": 0.72, "height": 0.48},
            "launcher": {"x": 0.12, "y": 0.78, "width": 0.76, "height": 0.18},
        },
        "layers": layers,
        "cropPolicy": {
            "desktopLateralBleed": 0.12,
            "mobileVerticalBleed": 0.08,
            "focalAnchor": {"x": 0.5, "y": 0.42},
        },
        "finishing": {
            "launcherDetailReduction": "deterministic soft-frequency reduction from y=0.72",
            "layerMethod": (
                "lossless disjoint composition-band separation; only the independent "
                "atmosphere layer is parallax-safe"
            ),
            "generatedSourcePreserved": True,
        },
    }
    PATHS["primary"].write_text(
        json.dumps(master, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )


def update_manifest(width: int, height: int) -> None:
    manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    entry = next(item for item in manifest["entries"] if item["id"] == "PF-asset-231")
    # Keep this finishing command idempotent. A previous run may already have
    # wrapped the immutable generation brief with the local finishing brief.
    original_prompt = entry["provenance"]["finalPrompt"].split(
        "Original generation brief: "
    )[-1]
    generated_source = png_descriptor("generated-source", PATHS["generated-source"])
    companions = [
        generated_source,
        png_descriptor("environment-plate", PATHS["environment-plate"]),
        png_descriptor("background-layer", PATHS["background-layer"]),
        png_descriptor("midground-layer", PATHS["midground-layer"]),
        png_descriptor("gameplay-plane-layer", PATHS["gameplay-plane-layer"]),
        png_descriptor("foreground-layer", PATHS["foreground-layer"]),
        png_descriptor("atmosphere-layer", PATHS["atmosphere-layer"]),
    ]
    primary_hash = sha256(PATHS["primary"])
    entry["provenance"].update({
        "actualTool": "local-post-processing",
        "mode": "layer-compose",
        "generatedAt": GENERATED_AT,
        "finalPrompt": (
            "Finish the selected built-in generated Nexus Candidate C as a production "
            "layered environment: preserve the immutable generated source, reduce "
            "micro-detail and contrast in the lower launcher safety zone, separate "
            "background, midground, gameplay plane and foreground into full-canvas "
            "editable composition bands, retain the independent parallax-safe atmosphere "
            "layer, and compile "
            "one deterministic runtime composite without changing the focal anchor or "
            f"safe zones. Original generation brief: {original_prompt}"
        ),
        "referenceImages": [
            {
                "role": "generated-source selected Candidate C",
                "path": generated_source["path"],
                "sha256": generated_source["sha256"],
            },
            *[
                reference
                for reference in entry["provenance"]["referenceImages"]
                if reference["path"] != generated_source["path"]
            ],
        ],
        "sourceSha256": primary_hash,
    })
    entry["approval"]["notes"] = (
        "Three independent candidates were reviewed at true resolution. Candidate C "
        "was preserved as the immutable generated source, then locally finished into "
        "lossless disjoint background, midground, gameplay-plane and foreground "
        "composition bands plus one independent parallax-safe atmosphere layer. The "
        "runtime composite reduces lower-launcher detail while preserving the authored "
        "focal anchor, safe zones and original non-graphic fantasy-horror tone."
    )
    entry["approval"]["reviewedAt"] = REVIEWED_AT
    entry["primary"].update({
        "bytes": PATHS["primary"].stat().st_size,
        "sha256": primary_hash,
        "authoredResolution": {"width": width, "height": height},
    })
    entry["companions"] = companions
    entry["technical"].update({
        "schema": "paopao.v14.layered-environment.v1",
        "sourceCanvas": {"width": width, "height": height},
        "layerRoles": [descriptor["role"] for descriptor in companions],
        "focalAnchor": {"x": 0.5, "y": 0.42},
    })
    MANIFEST_PATH.write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )


def main() -> None:
    if not PATHS["generated-source"].is_file():
        raise SystemExit(
            f"Missing immutable generated source: {PATHS['generated-source'].relative_to(ROOT)}"
        )
    if not PATHS["atmosphere-layer"].is_file():
        raise SystemExit(
            f"Missing approved atmosphere layer: {PATHS['atmosphere-layer'].relative_to(ROOT)}"
        )
    generated = Image.open(PATHS["generated-source"]).convert("RGB")
    width, height = generated.size
    if (width, height) != (941, 1672):
        raise SystemExit(f"Unexpected generated source resolution: {width}x{height}")
    plate = launcher_safe_plate(generated)
    plate.save(PATHS["environment-plate"], "PNG", optimize=True, compress_level=9)
    split_depth_layers(plate)
    write_layered_master(width, height)
    update_manifest(width, height)
    print(
        "PF-asset-231 layered master prepared: "
        f"layers={len(LAYER_BANDS) + 3} primarySha256={sha256(PATHS['primary'])}"
    )


if __name__ == "__main__":
    main()

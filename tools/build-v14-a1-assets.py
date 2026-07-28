#!/usr/bin/env python3
"""Compile explicitly approved V14 sources into Phaser runtime bundles.

The production manifest and approved master files are immutable compiler
inputs. Candidate promotion is a separate receipt-backed command. The six Pao
identities are cut from one approved neutral family master and receive
deterministic colour/material treatments; those derivatives never count as
additional PF masters.
"""

from __future__ import annotations

import argparse
import colorsys
import hashlib
import io
import json
import os
import re
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from PIL import Image, ImageEnhance, ImageFilter, ImageOps


ROOT = Path(__file__).resolve().parents[1]
RUNTIME = ROOT / "public" / "assets" / "v14"
MANIFEST_PATH = RUNTIME / "art-manifest.json"
RELEASE_ID = "r6-art-v14-a1-preview"
GENERATED_AT = "2026-07-28T08:56:01.000Z"
PRODUCTION_MANIFEST_PATH = ROOT / "art-source" / "v14" / "manifest.json"
A1_RUNTIME_MASTER_IDS = (
    "PF-asset-002",
    "PF-asset-012",
    "PF-asset-021",
    "PF-asset-031",
    "PF-asset-102",
    "PF-asset-402",
    "PF-asset-411",
)
PF_ID_PATTERN = re.compile(r"^PF-asset-\d{3}$")
SHA256_PATTERN = re.compile(r"^[a-f0-9]{64}$")
ISO_UTC_PATTERN = re.compile(
    r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$"
)

QUALITY_SQUARE = {
    "performance": 256,
    "balanced": 384,
    "ultra": 512,
}
QUALITY_WORLD = {
    "performance": (720, 1280),
    "balanced": (1080, 1920),
    "ultra": (1440, 2560),
}
QUALITY_WEBP = {
    "performance": 78,
    "balanced": 84,
    "ultra": 90,
}

COLOUR_ORDER = ("red", "blue", "green", "yellow", "purple", "orange")
COLOUR_RAMPS = {
    "red": ("#6f1523", "#f4485e", "#ffd6db"),
    "blue": ("#0d438d", "#339cff", "#daf4ff"),
    "green": ("#0f6941", "#35cc78", "#dcfae9"),
    "yellow": ("#835600", "#f5c62e", "#fff1af"),
    "purple": ("#472076", "#9f59ed", "#eadcff"),
    "orange": ("#913b00", "#f28325", "#ffe0bb"),
}

SKIN_TREATMENTS = {
    "nova": (1.00, 1.00, 1.00, None),
    "aurora": (1.08, 0.88, 1.04, "#f3caff"),
    "voidforge": (0.72, 1.12, 1.16, "#44266f"),
    "nova_optical": (1.08, 1.14, 1.15, "#b9f6ff"),
    "aurora_optical": (1.12, 1.04, 1.17, "#ffd9ff"),
    "voidforge_optical": (0.78, 1.20, 1.24, "#663a9c"),
    "phoenix": (0.98, 1.14, 1.08, "#ffb06d"),
    "frostglass": (1.06, 0.83, 1.13, "#b7edff"),
    "nexus_crown": (0.91, 1.08, 1.14, "#c4a0ff"),
    "phoenix_optical": (1.08, 1.19, 1.19, "#ffbb86"),
    "frostglass_optical": (1.15, 0.88, 1.23, "#d8f7ff"),
    "nexus_crown_optical": (0.98, 1.18, 1.25, "#d4b8ff"),
}


@dataclass(frozen=True)
class MasterBinding:
    pf_id: str
    primary: Path

    @property
    def sha256(self) -> str:
        return file_sha256(self.primary)


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def bytes_sha256(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def read_json_object(path: Path, label: str) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as error:
        raise RuntimeError(f"{label} is missing: {path}") from error
    except json.JSONDecodeError as error:
        raise RuntimeError(f"{label} is not valid JSON: {path}") from error
    if not isinstance(value, dict):
        raise RuntimeError(f"{label} must contain one JSON object: {path}")
    return value


def confined_repo_path(
    project_root: Path,
    relative_path: Any,
    required_root: str,
    label: str,
) -> Path:
    if (
        not isinstance(relative_path, str)
        or not relative_path
        or "\\" in relative_path
        or relative_path.startswith("/")
    ):
        raise RuntimeError(f"{label} must use a repository-relative POSIX path")
    parts = relative_path.split("/")
    if any(part in {"", ".", ".."} for part in parts):
        raise RuntimeError(f"{label} contains an unsafe path segment")
    required_parts = required_root.split("/")
    if parts[: len(required_parts)] != required_parts:
        raise RuntimeError(f"{label} must stay under {required_root}/")
    root = project_root.resolve()
    allowed = root.joinpath(*required_parts).resolve()
    candidate = root.joinpath(*parts)
    resolved = candidate.resolve(strict=False)
    try:
        resolved.relative_to(allowed)
    except ValueError as error:
        raise RuntimeError(f"{label} escapes {required_root}/") from error
    return candidate


def guarded_manifest_file(
    project_root: Path,
    descriptor: Any,
    pf_id: str,
    label: str,
) -> Path:
    if not isinstance(descriptor, dict):
        raise RuntimeError(f"{label} descriptor is missing")
    path = confined_repo_path(
        project_root,
        descriptor.get("path"),
        "art-source/v14/masters",
        label,
    )
    if not path.name.startswith(f"{pf_id}-"):
        raise RuntimeError(f"{label} filename must begin with {pf_id}-")
    if path.is_symlink() or not path.is_file():
        raise RuntimeError(f"{label} is missing or is not an immutable regular file")
    expected_bytes = descriptor.get("bytes")
    expected_hash = descriptor.get("sha256")
    if (
        not isinstance(expected_bytes, int)
        or expected_bytes <= 0
        or not isinstance(expected_hash, str)
        or not SHA256_PATTERN.fullmatch(expected_hash)
    ):
        raise RuntimeError(f"{label} has invalid integrity metadata")
    actual_bytes = path.stat().st_size
    actual_hash = file_sha256(path)
    if actual_bytes != expected_bytes or actual_hash != expected_hash:
        raise RuntimeError(
            f"{label} immutable hash guard failed: "
            f"expected {expected_bytes} bytes/{expected_hash}, "
            f"received {actual_bytes} bytes/{actual_hash}"
        )
    return path


def load_approved_master_bindings(
    *,
    project_root: Path = ROOT,
    manifest_path: Path | None = None,
    required_ids: tuple[str, ...] = A1_RUNTIME_MASTER_IDS,
    scan_master_tree: bool = True,
) -> tuple[dict[str, Any], dict[str, dict[str, Any]], dict[str, MasterBinding]]:
    """Load approved sources without creating, changing or approving any master."""

    source_manifest_path = (
        manifest_path
        if manifest_path is not None
        else project_root / "art-source" / "v14" / "manifest.json"
    )
    manifest = read_json_object(source_manifest_path, "V14 production manifest")
    raw_entries = manifest.get("entries")
    if not isinstance(raw_entries, list):
        raise RuntimeError("V14 production manifest entries are missing")

    entries: dict[str, dict[str, Any]] = {}
    bindings: dict[str, MasterBinding] = {}
    listed_paths: set[Path] = set()
    primary_hashes: set[str] = set()
    for raw_entry in raw_entries:
        if not isinstance(raw_entry, dict):
            raise RuntimeError("V14 production manifest contains a non-object entry")
        pf_id = raw_entry.get("id")
        if not isinstance(pf_id, str) or not PF_ID_PATTERN.fullmatch(pf_id):
            raise RuntimeError(f"V14 production manifest contains invalid PF ID {pf_id!r}")
        if pf_id in entries:
            raise RuntimeError(f"V14 production manifest repeats {pf_id}")
        entries[pf_id] = raw_entry
        approval = raw_entry.get("approval")
        approved = isinstance(approval, dict) and approval.get("state") == "approved"
        if not approved:
            if raw_entry.get("primary") is not None:
                raise RuntimeError(f"{pf_id} binds a primary without explicit approval")
            continue

        primary = raw_entry.get("primary")
        primary_path = guarded_manifest_file(
            project_root,
            primary,
            pf_id,
            f"{pf_id} approved primary",
        )
        primary_hash = primary["sha256"]
        provenance = raw_entry.get("provenance")
        if (
            not isinstance(provenance, dict)
            or provenance.get("state") != "generated"
            or provenance.get("sourceSha256") != primary_hash
        ):
            raise RuntimeError(f"{pf_id} approved provenance does not bind its primary hash")
        if primary_hash in primary_hashes:
            raise RuntimeError(f"{pf_id} duplicates another approved primary hash")
        primary_hashes.add(primary_hash)
        listed_paths.add(primary_path.resolve())

        companions = raw_entry.get("companions")
        if not isinstance(companions, list):
            raise RuntimeError(f"{pf_id} companions must be an array")
        for index, companion in enumerate(companions, start=1):
            companion_path = guarded_manifest_file(
                project_root,
                companion,
                pf_id,
                f"{pf_id} approved companion {index}",
            )
            resolved_companion = companion_path.resolve()
            if resolved_companion in listed_paths:
                raise RuntimeError(f"{pf_id} repeats approved master path {companion['path']}")
            listed_paths.add(resolved_companion)
        bindings[pf_id] = MasterBinding(pf_id, primary_path)

    for pf_id in required_ids:
        if pf_id not in bindings:
            raise RuntimeError(
                f"runtime compilation requires explicitly approved source {pf_id}"
            )

    if scan_master_tree:
        master_root = project_root / "art-source" / "v14" / "masters"
        disk_paths: set[Path] = set()
        if master_root.is_dir():
            for path in master_root.rglob("*"):
                if path.is_symlink():
                    raise RuntimeError(f"approved master tree contains a symbolic link: {path}")
                if path.is_file():
                    disk_paths.add(path.resolve())
        unreferenced = sorted(disk_paths - listed_paths)
        missing = sorted(listed_paths - disk_paths)
        if unreferenced:
            raise RuntimeError(
                "approved master tree contains unreferenced output: "
                f"{unreferenced[0].relative_to(project_root.resolve())}"
            )
        if missing:
            raise RuntimeError(
                "approved master manifest references missing output: "
                f"{missing[0].relative_to(project_root.resolve())}"
            )

    runtime_bindings = {pf_id: bindings[pf_id] for pf_id in required_ids}
    return manifest, entries, runtime_bindings


def approved_companion_path(
    project_root: Path,
    entry: dict[str, Any],
    role: str,
) -> Path:
    pf_id = entry["id"]
    matches = [
        companion
        for companion in entry.get("companions", [])
        if isinstance(companion, dict) and companion.get("role") == role
    ]
    if len(matches) != 1:
        raise RuntimeError(f"{pf_id} must bind exactly one approved {role} companion")
    return guarded_manifest_file(
        project_root,
        matches[0],
        pf_id,
        f"{pf_id} approved {role} companion",
    )


def approved_reference_path(
    project_root: Path,
    entry: dict[str, Any],
    role: str,
) -> Path:
    pf_id = entry["id"]
    provenance = entry.get("provenance")
    references = (
        provenance.get("referenceImages", [])
        if isinstance(provenance, dict)
        else []
    )
    matches = [
        reference
        for reference in references
        if isinstance(reference, dict) and reference.get("role") == role
    ]
    if len(matches) != 1:
        raise RuntimeError(f"{pf_id} must bind exactly one approved {role} reference")
    reference = matches[0]
    path = confined_repo_path(
        project_root,
        reference.get("path"),
        "art-source/v14/canon",
        f"{pf_id} {role} reference",
    )
    expected_hash = reference.get("sha256")
    if (
        path.is_symlink()
        or not path.is_file()
        or not isinstance(expected_hash, str)
        or not SHA256_PATTERN.fullmatch(expected_hash)
    ):
        raise RuntimeError(f"{pf_id} {role} reference is missing or invalid")
    actual_hash = file_sha256(path)
    if actual_hash != expected_hash:
        raise RuntimeError(
            f"{pf_id} {role} reference hash guard failed: "
            f"expected {expected_hash}, received {actual_hash}"
        )
    return path


def rgba_fit(image: Image.Image, size: int, padding_ratio: float = 0.075) -> Image.Image:
    source = image.convert("RGBA")
    alpha = source.getchannel("A")
    box = alpha.getbbox()
    if box is None:
        raise RuntimeError("approved alpha source has no visible pixels")
    left, top, right, bottom = box
    padding = max(2, round(max(right - left, bottom - top) * padding_ratio))
    left = max(0, left - padding)
    top = max(0, top - padding)
    right = min(source.width, right + padding)
    bottom = min(source.height, bottom + padding)
    cropped = source.crop((left, top, right, bottom))
    scale = min(size / cropped.width, size / cropped.height)
    resized = cropped.resize(
        (max(1, round(cropped.width * scale)), max(1, round(cropped.height * scale))),
        Image.Resampling.LANCZOS,
    )
    output = Image.new("RGBA", (size, size))
    output.alpha_composite(resized, ((size - resized.width) // 2, size - resized.height))
    return output


def contain_world(image: Image.Image, size: tuple[int, int]) -> Image.Image:
    """Scale/crop a portrait source to the exact runtime tier without stretching."""
    source = image.convert("RGB")
    target_w, target_h = size
    scale = max(target_w / source.width, target_h / source.height)
    resized = source.resize(
        (max(1, round(source.width * scale)), max(1, round(source.height * scale))),
        Image.Resampling.LANCZOS,
    )
    left = max(0, (resized.width - target_w) // 2)
    top = max(0, (resized.height - target_h) // 2)
    return resized.crop((left, top, left + target_w, top + target_h))


def encode_image(image: Image.Image, image_format: str, *, quality: int = 90) -> bytes:
    buffer = io.BytesIO()
    save_kwargs: dict[str, Any] = {}
    if image_format == "WEBP":
        save_kwargs = {"quality": quality, "method": 4, "exact": True}
    elif image_format == "PNG":
        save_kwargs = {"optimize": False, "compress_level": 6}
    elif image_format == "JPEG":
        save_kwargs = {"quality": quality, "optimize": True, "progressive": True, "subsampling": 1}
    image.save(buffer, format=image_format, **save_kwargs)
    return buffer.getvalue()


def content_addressed_write(
    bundle: str,
    slug: str,
    extension: str,
    payload: bytes,
) -> tuple[str, int, str]:
    digest = bytes_sha256(payload)
    relative = Path("assets") / "v14" / "bundles" / bundle / f"{slug}.{digest[:12]}.{extension}"
    destination = ROOT / "public" / relative
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes(payload)
    return f"/{relative.as_posix()}", len(payload), digest


def image_file_descriptor(
    bundle: str,
    slug: str,
    image: Image.Image,
    image_format: str,
    quality: int,
) -> dict[str, Any]:
    extension = image_format.lower().replace("jpeg", "jpg")
    payload = encode_image(image, image_format, quality=quality)
    url, byte_count, digest = content_addressed_write(bundle, slug, extension, payload)
    return {
        "format": "jpeg" if image_format == "JPEG" else image_format.lower(),
        "dimensions": {"width": image.width, "height": image.height},
        "bytes": byte_count,
        "sha256": digest,
        "url": url,
    }


def crop_family_slots(source_path: Path) -> dict[str, Image.Image]:
    sheet = Image.open(source_path).convert("RGBA")
    slots: dict[str, Image.Image] = {}
    for index, colour in enumerate(COLOUR_ORDER):
        column = index % 3
        row = index // 3
        left = round(column * sheet.width / 3)
        right = round((column + 1) * sheet.width / 3)
        top = round(row * sheet.height / 2)
        bottom = round((row + 1) * sheet.height / 2)
        slot = sheet.crop((left, top, right, bottom))
        alpha_box = slot.getchannel("A").getbbox()
        if alpha_box is None:
            raise RuntimeError(f"neutral Pao slot {colour} has no visible pixels")
        slots[colour] = slot.crop(alpha_box)
    return slots


def hex_rgb(value: str) -> tuple[int, int, int]:
    value = value.removeprefix("#")
    return tuple(int(value[offset : offset + 2], 16) for offset in (0, 2, 4))  # type: ignore[return-value]


def colourize_neutral_pao(source: Image.Image, colour: str) -> Image.Image:
    rgba = source.convert("RGBA")
    rgb = rgba.convert("RGB")
    grayscale = ImageOps.grayscale(rgb)
    dark, middle, light = (hex_rgb(value) for value in COLOUR_RAMPS[colour])
    coloured = ImageOps.colorize(
        grayscale,
        black=dark,
        mid=middle,
        white=light,
        blackpoint=18,
        midpoint=132,
        whitepoint=250,
    )
    source_pixels = rgb.load()
    output_pixels = coloured.load()
    alpha = rgba.getchannel("A")
    for y in range(rgba.height):
        for x in range(rgba.width):
            red, green, blue = source_pixels[x, y]
            hue, saturation, value = colorsys.rgb_to_hsv(red / 255, green / 255, blue / 255)
            gold = 0.045 <= hue <= 0.17 and saturation >= 0.20 and value >= 0.32
            facial = value <= 0.28
            if gold or facial:
                output_pixels[x, y] = (red, green, blue)
            elif saturation >= 0.24 and value >= 0.46:
                # Preserve subtle iridescent crystal facets while keeping the
                # body colour unmistakable.
                cr, cg, cb = output_pixels[x, y]
                output_pixels[x, y] = (
                    round(red * 0.36 + cr * 0.64),
                    round(green * 0.36 + cg * 0.64),
                    round(blue * 0.36 + cb * 0.64),
                )
    coloured.putalpha(alpha)
    return coloured


def apply_skin_treatment(source: Image.Image, skin: str) -> Image.Image:
    brightness, saturation, contrast, overlay_hex = SKIN_TREATMENTS[skin]
    image = ImageEnhance.Brightness(source).enhance(brightness)
    image = ImageEnhance.Color(image).enhance(saturation)
    image = ImageEnhance.Contrast(image).enhance(contrast)
    if overlay_hex:
        overlay = Image.new("RGBA", image.size, (*hex_rgb(overlay_hex), 0))
        overlay.putalpha(image.getchannel("A").point(lambda alpha: round(alpha * 0.13)))
        image = Image.alpha_composite(image.convert("RGBA"), overlay)
    if "optical" in skin:
        alpha = image.getchannel("A")
        glow = Image.new("RGBA", image.size, (*hex_rgb("#bff7ff"), 0))
        glow.putalpha(alpha.filter(ImageFilter.GaussianBlur(radius=max(1, image.width // 90))).point(
            lambda value: round(value * 0.13)
        ))
        image = Image.alpha_composite(glow, image.convert("RGBA"))
    return image


def make_entry(
    *,
    stable_key: str,
    pf_id: str,
    bundle: str,
    media_kind: str,
    source_sha256: str,
    variants: dict[str, Any],
    pivot: dict[str, float] | None = None,
    safe_zones: dict[str, float] | None = None,
) -> dict[str, Any]:
    entry: dict[str, Any] = {
        "stableKey": stable_key,
        "pfId": pf_id,
        "bundle": bundle,
        "mediaKind": media_kind,
        "variants": variants,
        "provenance": {
            "manifest": "art-source/v14/manifest.json",
            "recordId": pf_id,
            "sourceSha256": source_sha256,
            "approved": True,
        },
    }
    if pivot is not None:
        entry["pivot"] = pivot
    if safe_zones is not None:
        entry["safeZones"] = safe_zones
    return entry


def alpha_variants(bundle: str, slug: str, image: Image.Image) -> dict[str, Any]:
    variants: dict[str, Any] = {}
    fallback = image_file_descriptor(
        bundle,
        f"{slug}-fallback",
        rgba_fit(image, QUALITY_SQUARE["ultra"]),
        "PNG",
        88,
    )
    for quality, size in QUALITY_SQUARE.items():
        fitted = rgba_fit(image, size)
        variants[quality] = {
            **image_file_descriptor(
            bundle,
            f"{slug}-{quality}",
            fitted,
            "WEBP",
            QUALITY_WEBP[quality],
            ),
            "fallbacks": [fallback],
        }
    return variants


def world_variants(bundle: str, slug: str, image: Image.Image) -> dict[str, Any]:
    variants: dict[str, Any] = {}
    fallback = image_file_descriptor(
        bundle,
        f"{slug}-fallback",
        contain_world(image, QUALITY_WORLD["balanced"]),
        "JPEG",
        84,
    )
    for quality, size in QUALITY_WORLD.items():
        fitted = contain_world(image, size)
        variants[quality] = {
            **image_file_descriptor(
            bundle,
            f"{slug}-{quality}",
            fitted,
            "WEBP",
            QUALITY_WEBP[quality],
            ),
            "fallbacks": [fallback],
        }
    return variants


def archive_preview_variants(
    bundle: str,
    slug: str,
    image: Image.Image,
    *,
    cover: bool,
) -> dict[str, Any]:
    """Create bounded archive cards from the approved source, never a surrogate sheet."""

    variants: dict[str, Any] = {}

    def fit(size: int) -> Image.Image:
        if cover:
            return ImageOps.fit(
                image.convert("RGB"),
                (size, size),
                method=Image.Resampling.LANCZOS,
                centering=(0.5, 0.36),
            )
        return rgba_fit(image.convert("RGBA"), size, 0.045)

    fallback = image_file_descriptor(
        bundle,
        f"{slug}-fallback",
        fit(QUALITY_SQUARE["ultra"]),
        "PNG",
        88,
    )
    for quality, size in QUALITY_SQUARE.items():
        variants[quality] = {
            **image_file_descriptor(
                bundle,
                f"{slug}-{quality}",
                fit(size),
                "WEBP",
                QUALITY_WEBP[quality],
            ),
            "fallbacks": [fallback],
        }
    return variants


def build_runtime(
    bindings: dict[str, MasterBinding],
    source_entries: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    entries: list[dict[str, Any]] = []

    alpha_sources = [
        ("lumi_guide", "PF-asset-002", "characters", bindings["PF-asset-002"].primary, {"x": 0.5, "y": 0.88}),
        ("aurora_crown", "PF-asset-012", "core", bindings["PF-asset-012"].primary, {"x": 0.5, "y": 0.82}),
        ("boss_prism", "PF-asset-102", "realm-crystal", bindings["PF-asset-102"].primary, {"x": 0.5, "y": 0.92}),
        (
            "prism_keeper_hero",
            "PF-asset-402",
            "characters",
            approved_reference_path(
                ROOT,
                source_entries["PF-asset-402"],
                "approved-seed Keeper render",
            ),
            {"x": 0.5, "y": 1.0},
        ),
        (
            "crystal_launcher",
            "PF-asset-402",
            "core",
            approved_reference_path(
                ROOT,
                source_entries["PF-asset-402"],
                "approved-seed launcher render",
            ),
            {"x": 0.5, "y": 1.0},
        ),
    ]
    for stable_key, pf_id, bundle, source_path, pivot in alpha_sources:
        source = Image.open(source_path).convert("RGBA")
        entries.append(
            make_entry(
                stable_key=stable_key,
                pf_id=pf_id,
                bundle=bundle,
                media_kind="image",
                source_sha256=bindings[pf_id].sha256,
                variants=alpha_variants(bundle, stable_key.replace("_", "-"), source),
                pivot=pivot,
            )
        )

    world_sources = [
        (
            "world_crystal",
            "PF-asset-021",
            "realm-crystal",
            approved_companion_path(
                ROOT,
                source_entries["PF-asset-021"],
                "environment-plate",
            ),
        ),
        (
            "world_emerald",
            "PF-asset-031",
            "realm-emerald",
            approved_companion_path(
                ROOT,
                source_entries["PF-asset-031"],
                "environment-plate",
            ),
        ),
    ]
    for stable_key, pf_id, bundle, source_path in world_sources:
        source = Image.open(source_path).convert("RGB")
        entries.append(
            make_entry(
                stable_key=stable_key,
                pf_id=pf_id,
                bundle=bundle,
                media_kind="layered",
                source_sha256=bindings[pf_id].sha256,
                variants=world_variants(bundle, stable_key.replace("_", "-"), source),
                safe_zones={"top": 0.14, "right": 0.09, "bottom": 0.18, "left": 0.09},
            )
        )

    # The in-game Production Archive must show the same approved V14 sources,
    # not the retired procedural V2-V13 documentation sheets. These previews
    # remain derived runtime copies and therefore never count as PF masters.
    archive_sources = [
        ("PF-asset-002", bindings["PF-asset-002"].primary, False),
        ("PF-asset-012", bindings["PF-asset-012"].primary, False),
        (
            "PF-asset-021",
            approved_companion_path(
                ROOT,
                source_entries["PF-asset-021"],
                "environment-plate",
            ),
            True,
        ),
        (
            "PF-asset-031",
            approved_companion_path(
                ROOT,
                source_entries["PF-asset-031"],
                "environment-plate",
            ),
            True,
        ),
        ("PF-asset-102", bindings["PF-asset-102"].primary, False),
        ("PF-asset-402", bindings["PF-asset-402"].primary, False),
        ("PF-asset-411", bindings["PF-asset-411"].primary, False),
    ]
    for pf_id, source_path, cover in archive_sources:
        with Image.open(source_path) as opened:
            source = opened.convert("RGB" if cover else "RGBA")
        slug = f"archive-{pf_id.lower()}"
        entries.append(
            make_entry(
                stable_key=f"archive.{pf_id.lower()}",
                pf_id=pf_id,
                bundle="rewards",
                media_kind="image",
                source_sha256=bindings[pf_id].sha256,
                variants=archive_preview_variants(
                    "rewards",
                    slug,
                    source,
                    cover=cover,
                ),
                pivot={"x": 0.5, "y": 0.5},
            )
        )

    neutral_slots = crop_family_slots(bindings["PF-asset-411"].primary)
    for skin in SKIN_TREATMENTS:
        bundle = f"skin-{skin.replace('_', '-')}"
        for colour, neutral in neutral_slots.items():
            derived = apply_skin_treatment(colourize_neutral_pao(neutral, colour), skin)
            stable_key = f"bubble_{skin}_{colour}"
            entries.append(
                make_entry(
                    stable_key=stable_key,
                    pf_id="PF-asset-411",
                    bundle=bundle,
                    media_kind="image",
                    source_sha256=bindings["PF-asset-411"].sha256,
                    variants=alpha_variants(bundle, stable_key.replace("_", "-"), derived),
                    pivot={"x": 0.5, "y": 0.5},
                )
            )

    entries.sort(key=lambda entry: entry["stableKey"])
    manifest = {
        "schemaVersion": 1,
        "releaseId": RELEASE_ID,
        "generatedAt": GENERATED_AT,
        "entries": entries,
    }
    RUNTIME.mkdir(parents=True, exist_ok=True)
    MANIFEST_PATH.write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    return manifest


def build_evidence(bindings: dict[str, MasterBinding], manifest: dict[str, Any]) -> None:
    budgets = runtime_budget_report(manifest)
    evidence = {
        "schemaVersion": 1,
        "releaseId": RELEASE_ID,
        "generatedAt": GENERATED_AT,
        "approvedMasterIds": sorted(bindings),
        "runtimeStableKeys": len(manifest["entries"]),
        "sourceHashes": {pf_id: binding.sha256 for pf_id, binding in sorted(bindings.items())},
        "manifestSha256": file_sha256(MANIFEST_PATH),
        "budgetBytes": budgets,
        "policies": {
            "derivedRuntimeEntriesDoNotCountAsMasters": True,
            "sourceResolutionPreservedInProductionManifest": True,
            "fightingContentExcluded": True,
            "contentAddressedRuntime": True,
        },
    }
    destination = ROOT / "docs" / "art" / "v14" / "a1-runtime-evidence.json"
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(
        json.dumps(evidence, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )


def runtime_budget_report(manifest: dict[str, Any]) -> dict[str, dict[str, int]]:
    """Measure the bytes fetched for one selected quality, excluding fallbacks."""
    report: dict[str, dict[str, int]] = {}
    for quality in ("performance", "balanced", "ultra"):
        by_bundle: dict[str, int] = {}
        for entry in manifest["entries"]:
            by_bundle[entry["bundle"]] = (
                by_bundle.get(entry["bundle"], 0)
                + int(entry["variants"][quality]["bytes"])
            )
        skin_sizes = [
            size for bundle, size in by_bundle.items() if bundle.startswith("skin-")
        ]
        report[quality] = {
            "coreNonVideo": sum(
                int(entry["variants"][quality]["bytes"])
                for entry in manifest["entries"]
                if entry["bundle"] == "core" and entry["mediaKind"] != "video"
            ),
            "firstRealm": by_bundle.get("realm-crystal", 0),
            "largestSkin": max(skin_sizes, default=0),
            "defaultInitial": sum(
                by_bundle.get(bundle, 0)
                for bundle in ("core", "characters", "realm-crystal", "skin-nova")
            ),
        }
    return report


def referenced_runtime_files(manifest: dict[str, Any]) -> set[Path]:
    files: set[Path] = set()
    for entry in manifest["entries"]:
        for variant in entry["variants"].values():
            files.add(ROOT / "public" / variant["url"].removeprefix("/"))
            for fallback in variant.get("fallbacks", []):
                files.add(ROOT / "public" / fallback["url"].removeprefix("/"))
    return files


def verify_runtime(
    manifest: dict[str, Any],
    approved_bindings: dict[str, MasterBinding] | None = None,
) -> None:
    stable_keys: set[str] = set()
    urls: dict[str, str] = {}
    for entry in manifest["entries"]:
        stable_key = entry["stableKey"]
        if stable_key in stable_keys or "fight" in stable_key.lower():
            raise RuntimeError(f"duplicate or blocked V14 stable key: {stable_key}")
        stable_keys.add(stable_key)
        if approved_bindings is not None:
            pf_id = entry.get("pfId")
            binding = approved_bindings.get(pf_id)
            provenance = entry.get("provenance")
            if binding is None:
                raise RuntimeError(
                    f"V14 runtime entry {stable_key} has no approved source binding"
                )
            if (
                not isinstance(provenance, dict)
                or provenance.get("approved") is not True
                or provenance.get("recordId") != pf_id
                or provenance.get("sourceSha256") != binding.sha256
            ):
                raise RuntimeError(
                    f"V14 runtime entry {stable_key} drifted from approved source {pf_id}"
                )
        for quality in ("performance", "balanced", "ultra"):
            variant = entry["variants"][quality]
            candidates = [variant, *variant.get("fallbacks", [])]
            for candidate in candidates:
                url = candidate["url"]
                if "/fight" in url.lower():
                    raise RuntimeError(f"blocked V14 runtime URL: {url}")
                if url in urls and urls[url] != candidate["sha256"]:
                    raise RuntimeError(f"V14 runtime URL has conflicting hashes: {url}")
                urls[url] = candidate["sha256"]
                path = ROOT / "public" / url.removeprefix("/")
                payload = path.read_bytes()
                if len(payload) != candidate["bytes"] or bytes_sha256(payload) != candidate["sha256"]:
                    raise RuntimeError(f"integrity mismatch for {url}")
                if candidate["sha256"][:12] not in path.name:
                    raise RuntimeError(f"non-content-addressed V14 file: {url}")
    expected_orbs = {
        f"bubble_{skin}_{colour}" for skin in SKIN_TREATMENTS for colour in COLOUR_ORDER
    }
    missing = expected_orbs - stable_keys
    if missing:
        raise RuntimeError(f"V14 runtime is missing stable orb keys: {sorted(missing)[:3]}")

    bundles_root = RUNTIME / "bundles"
    disk_files = {
        path
        for path in bundles_root.rglob("*")
        if path.is_file()
    }
    unreferenced = sorted(disk_files - referenced_runtime_files(manifest))
    if unreferenced:
        raise RuntimeError(
            f"unreferenced V14 runtime output: {unreferenced[0].relative_to(ROOT)}"
        )

    limits = {
        "coreNonVideo": 8 * 1024 * 1024,
        "firstRealm": 12 * 1024 * 1024,
        "largestSkin": 3 * 1024 * 1024,
        "defaultInitial": 75 * 1024 * 1024,
    }
    for quality, metrics in runtime_budget_report(manifest).items():
        for name, limit in limits.items():
            if metrics[name] > limit:
                raise RuntimeError(
                    f"V14 {quality} {name} budget exceeded: {metrics[name]} > {limit}"
                )


def clean_previous_runtime() -> None:
    """Remove only files bound by the previous V14 manifest."""
    if not MANIFEST_PATH.is_file():
        return
    try:
        previous = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return
    for path in referenced_runtime_files(previous):
        try:
            relative = path.resolve().relative_to((RUNTIME / "bundles").resolve())
        except ValueError:
            continue
        if not relative.parts or not path.is_file():
            continue
        path.unlink()


def existing_repo_file(
    project_root: Path,
    relative_path: Any,
    label: str,
) -> Path:
    if (
        not isinstance(relative_path, str)
        or not relative_path
        or "\\" in relative_path
        or relative_path.startswith("/")
    ):
        raise RuntimeError(f"{label} must use a repository-relative POSIX path")
    parts = relative_path.split("/")
    if any(part in {"", ".", ".."} for part in parts):
        raise RuntimeError(f"{label} contains an unsafe path segment")
    if any(part.lower() in {"fight", "fighting"} for part in parts):
        raise RuntimeError(f"{label} contains retired fighting content")
    candidate = project_root.resolve().joinpath(*parts)
    resolved = candidate.resolve(strict=False)
    try:
        resolved.relative_to(project_root.resolve())
    except ValueError as error:
        raise RuntimeError(f"{label} escapes the repository") from error
    if candidate.is_symlink() or not candidate.is_file():
        raise RuntimeError(f"{label} is missing or is not a regular file")
    return candidate


def promotion_file_descriptor(
    *,
    project_root: Path,
    pf_id: str,
    file_record: dict[str, Any],
    primary: bool,
) -> tuple[Path, Path, bytes, dict[str, Any]]:
    source = confined_repo_path(
        project_root,
        file_record.get("sourcePath"),
        "art-source/v14/review",
        f"{pf_id} promotion source",
    )
    if source.is_symlink() or not source.is_file():
        raise RuntimeError(f"{pf_id} promotion source is missing or is not a regular file")
    destination = confined_repo_path(
        project_root,
        file_record.get("destinationPath"),
        "art-source/v14/masters",
        f"{pf_id} promotion destination",
    )
    if not destination.name.startswith(f"{pf_id}-"):
        raise RuntimeError(f"{pf_id} promotion destination must begin with {pf_id}-")
    if source.suffix.lower() != destination.suffix.lower():
        raise RuntimeError(f"{pf_id} promotion cannot silently convert the candidate format")
    if destination.exists() or destination.is_symlink():
        raise RuntimeError(
            f"{pf_id} promotion refuses to overwrite approved master {destination.name}"
        )
    payload = source.read_bytes()
    digest = bytes_sha256(payload)
    expected_hash = file_record.get("expectedSha256")
    if (
        len(payload) < 32
        or not isinstance(expected_hash, str)
        or not SHA256_PATTERN.fullmatch(expected_hash)
        or digest != expected_hash
    ):
        raise RuntimeError(f"{pf_id} promotion source hash does not match its review receipt")

    extension = destination.suffix.lower().lstrip(".").replace("jpg", "jpeg")
    descriptor: dict[str, Any] = {
        "path": destination.relative_to(project_root).as_posix(),
        "format": extension,
        "bytes": len(payload),
        "sha256": digest,
    }
    if primary:
        width: int | None = None
        height: int | None = None
        if destination.suffix.lower() in {".png", ".jpg", ".jpeg", ".webp", ".avif"}:
            try:
                with Image.open(source) as image:
                    width, height = image.size
                    image.verify()
            except Exception as error:
                raise RuntimeError(
                    f"{pf_id} promotion source is not a decodable image"
                ) from error
        supplied_resolution = file_record.get("authoredResolution")
        if width is None and height is None and supplied_resolution is not None:
            if (
                not isinstance(supplied_resolution, dict)
                or set(supplied_resolution) != {"width", "height"}
                or not all(
                    value is None or (isinstance(value, int) and value > 0)
                    for value in supplied_resolution.values()
                )
            ):
                raise RuntimeError(f"{pf_id} promotion authored resolution is invalid")
            width = supplied_resolution["width"]
            height = supplied_resolution["height"]
        duration_ms = file_record.get("durationMs")
        if duration_ms is not None and (
            not isinstance(duration_ms, int) or duration_ms <= 0
        ):
            raise RuntimeError(f"{pf_id} promotion duration must be a positive integer")
        if extension in {"mp4", "webm"} and duration_ms is None:
            raise RuntimeError(f"{pf_id} video promotion requires measured durationMs")
        descriptor["authoredResolution"] = {"width": width, "height": height}
        descriptor["durationMs"] = duration_ms
    else:
        role = file_record.get("role")
        if not isinstance(role, str) or not role.strip() or role == "primary":
            raise RuntimeError(f"{pf_id} companion promotion requires a concrete role")
        descriptor = {"role": role.strip(), **descriptor}
    return source, destination, payload, descriptor


def write_json_atomic(path: Path, value: dict[str, Any]) -> None:
    temporary = path.with_name(f".{path.name}.promotion-tmp")
    payload = (json.dumps(value, indent=2, ensure_ascii=False) + "\n").encode("utf-8")
    try:
        descriptor = os.open(
            temporary,
            os.O_WRONLY | os.O_CREAT | os.O_EXCL,
            0o644,
        )
    except FileExistsError as error:
        raise RuntimeError(f"stale promotion transaction exists: {temporary}") from error
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def validate_promoted_manifest() -> None:
    node_executable = shutil.which("node") or shutil.which("node.exe")
    if node_executable is None:
        raise RuntimeError("promotion validation requires Node.js")
    result = subprocess.run(
        [
            node_executable,
            "tools/v14-art-pipeline.mjs",
            "validate",
            "--phase",
            "briefing",
        ],
        cwd=ROOT,
        text=True,
        capture_output=True,
        check=False,
    )
    if result.returncode != 0:
        detail = (result.stderr or result.stdout).strip()
        raise RuntimeError(f"promoted manifest validation failed: {detail}")


def promote_reviewed_candidate(
    record_path: Path,
    *,
    project_root: Path = ROOT,
    validate_after_write: bool = True,
) -> str:
    """Atomically promote one explicitly reviewed candidate; never infer approval."""

    record = read_json_object(record_path, "V14 promotion receipt")
    if record.get("schemaVersion") != 1 or record.get("approvalAcknowledged") is not True:
        raise RuntimeError(
            "promotion receipt must use schemaVersion 1 and explicit approvalAcknowledged=true"
        )
    pf_id = record.get("pfId")
    if not isinstance(pf_id, str) or not PF_ID_PATTERN.fullmatch(pf_id):
        raise RuntimeError("promotion receipt has an invalid PF ID")

    manifest_path = project_root / "art-source" / "v14" / "manifest.json"
    manifest_before = manifest_path.read_bytes()
    manifest, entries, _bindings = load_approved_master_bindings(
        project_root=project_root,
        manifest_path=manifest_path,
        required_ids=(),
        scan_master_tree=True,
    )
    entry = entries.get(pf_id)
    if entry is None:
        raise RuntimeError(f"promotion receipt references unknown source {pf_id}")
    approval = entry.get("approval")
    current_state = approval.get("state") if isinstance(approval, dict) else None
    if current_state == "approved":
        raise RuntimeError(f"{pf_id} is already approved and immutable")
    if current_state not in {"briefed", "candidate-review"}:
        raise RuntimeError(f"{pf_id} cannot be promoted from {current_state!r}")
    if entry.get("primary") is not None or entry.get("companions") not in ([], None):
        raise RuntimeError(f"{pf_id} has pre-existing master bindings")

    reviewer = record.get("reviewer")
    reviewed_at = record.get("reviewedAt")
    generated_at = record.get("generatedAt")
    final_prompt = record.get("finalPrompt")
    actual_tool = record.get("actualTool")
    mode = record.get("mode")
    approval_notes = record.get("approvalNotes")
    required_text = {
        "reviewer": reviewer,
        "finalPrompt": final_prompt,
        "actualTool": actual_tool,
        "mode": mode,
        "approvalNotes": approval_notes,
    }
    for field, value in required_text.items():
        if not isinstance(value, str) or not value.strip():
            raise RuntimeError(f"promotion receipt requires explicit {field}")
    if (
        not isinstance(reviewed_at, str)
        or not ISO_UTC_PATTERN.fullmatch(reviewed_at)
        or not isinstance(generated_at, str)
        or not ISO_UTC_PATTERN.fullmatch(generated_at)
    ):
        raise RuntimeError("promotion receipt requires explicit UTC generation and review timestamps")
    if actual_tool not in {
        "built-in-image-generation",
        "local-authoring",
        "local-post-processing",
    }:
        raise RuntimeError("promotion receipt actualTool is invalid")
    if mode not in {
        "generate",
        "edit",
        "strip-edit",
        "layer-compose",
        "local-authoring",
    }:
        raise RuntimeError("promotion receipt mode is invalid")

    contact_sheet_path = record.get("contactSheetPath")
    contact_sheet = confined_repo_path(
        project_root,
        contact_sheet_path,
        "docs/art/v14/review",
        f"{pf_id} contact sheet",
    )
    if contact_sheet.is_symlink() or not contact_sheet.is_file():
        raise RuntimeError(f"{pf_id} promotion contact sheet is missing")

    references = record.get("referenceImages")
    if not isinstance(references, list) or not references:
        raise RuntimeError(f"{pf_id} promotion requires durable reference-image bindings")
    checked_references: list[dict[str, str]] = []
    for index, reference in enumerate(references, start=1):
        if not isinstance(reference, dict):
            raise RuntimeError(f"{pf_id} reference {index} must be an object")
        role = reference.get("role")
        path_value = reference.get("path")
        expected_hash = reference.get("sha256")
        if not isinstance(role, str) or not role.strip():
            raise RuntimeError(f"{pf_id} reference {index} requires a role")
        reference_path = existing_repo_file(
            project_root,
            path_value,
            f"{pf_id} reference {index}",
        )
        if str(path_value).startswith("art-source/v14/review/"):
            raise RuntimeError(f"{pf_id} reference {index} must survive review cleanup")
        if (
            not isinstance(expected_hash, str)
            or not SHA256_PATTERN.fullmatch(expected_hash)
            or file_sha256(reference_path) != expected_hash
        ):
            raise RuntimeError(f"{pf_id} reference {index} hash does not match")
        checked_references.append(
            {"role": role.strip(), "path": str(path_value), "sha256": expected_hash}
        )

    file_records = record.get("files")
    if not isinstance(file_records, list) or not file_records:
        raise RuntimeError(f"{pf_id} promotion requires reviewed source files")
    primary_records = [
        item
        for item in file_records
        if isinstance(item, dict) and item.get("role") == "primary"
    ]
    if len(primary_records) != 1:
        raise RuntimeError(f"{pf_id} promotion requires exactly one primary file")
    ordered_records = [
        primary_records[0],
        *[item for item in file_records if item is not primary_records[0]],
    ]
    prepared: list[tuple[Path, Path, bytes, dict[str, Any]]] = []
    destination_paths: set[Path] = set()
    for index, file_record in enumerate(ordered_records):
        if not isinstance(file_record, dict):
            raise RuntimeError(f"{pf_id} promotion file record must be an object")
        item = promotion_file_descriptor(
            project_root=project_root,
            pf_id=pf_id,
            file_record=file_record,
            primary=index == 0,
        )
        destination = item[1].resolve()
        if destination in destination_paths:
            raise RuntimeError(f"{pf_id} promotion repeats destination {item[1].name}")
        destination_paths.add(destination)
        prepared.append(item)

    primary_descriptor_value = prepared[0][3]
    existing_hashes = {
        candidate["primary"]["sha256"]
        for candidate in entries.values()
        if isinstance(candidate.get("approval"), dict)
        and candidate["approval"].get("state") == "approved"
        and isinstance(candidate.get("primary"), dict)
    }
    if primary_descriptor_value["sha256"] in existing_hashes:
        raise RuntimeError(f"{pf_id} promotion duplicates an approved primary hash")

    technical = record.get("technical")
    dependencies = record.get("dependencies", [])
    usage_references = record.get("usageReferences")
    if not isinstance(technical, dict) or not technical:
        raise RuntimeError(f"{pf_id} promotion requires authored technical metadata")
    if (
        not isinstance(dependencies, list)
        or not all(isinstance(value, str) and PF_ID_PATTERN.fullmatch(value) for value in dependencies)
    ):
        raise RuntimeError(f"{pf_id} promotion dependencies are invalid")
    if (
        not isinstance(usage_references, list)
        or not any(
            isinstance(value, dict)
            and value.get("kind") == "runtime"
            and isinstance(value.get("target"), str)
            and value["target"].strip()
            for value in usage_references
        )
    ):
        raise RuntimeError(f"{pf_id} promotion requires a concrete runtime usage reference")

    provenance_before = entry.get("provenance")
    if not isinstance(provenance_before, dict):
        raise RuntimeError(f"{pf_id} has no provenance scaffold")
    entry["provenance"] = {
        **provenance_before,
        "state": "generated",
        "actualTool": actual_tool,
        "mode": mode,
        "generatedAt": generated_at,
        "finalPrompt": final_prompt,
        "referenceImages": checked_references,
        "model": record.get("model"),
        "seed": record.get("seed"),
        "outputId": record.get("outputId"),
        "sourceSha256": primary_descriptor_value["sha256"],
    }
    entry["approval"] = {
        "state": "approved",
        "reviewer": reviewer.strip(),
        "reviewedAt": reviewed_at,
        "contactSheetPath": contact_sheet.relative_to(project_root).as_posix(),
        "notes": approval_notes.strip(),
    }
    entry["primary"] = primary_descriptor_value
    entry["companions"] = [item[3] for item in prepared[1:]]
    entry["technical"] = technical
    entry["dependencies"] = dependencies
    entry["usageReferences"] = usage_references

    created: list[Path] = []
    try:
        for _source, destination, payload, _descriptor in prepared:
            destination.parent.mkdir(parents=True, exist_ok=True)
            try:
                file_descriptor = os.open(
                    destination,
                    os.O_WRONLY | os.O_CREAT | os.O_EXCL,
                    0o644,
                )
            except FileExistsError as error:
                raise RuntimeError(
                    f"{pf_id} promotion refuses to overwrite {destination.name}"
                ) from error
            with os.fdopen(file_descriptor, "wb") as handle:
                handle.write(payload)
                handle.flush()
                os.fsync(handle.fileno())
            created.append(destination)
        write_json_atomic(manifest_path, manifest)
        if validate_after_write:
            validate_promoted_manifest()
        load_approved_master_bindings(
            project_root=project_root,
            manifest_path=manifest_path,
            required_ids=(),
            scan_master_tree=True,
        )
    except Exception:
        write_json_atomic(manifest_path, json.loads(manifest_before))
        for destination in created:
            destination.unlink(missing_ok=True)
        raise
    return pf_id


def command_build() -> None:
    source_manifest, source_entries, bindings = load_approved_master_bindings()
    clean_previous_runtime()
    manifest = build_runtime(bindings, source_entries)
    build_evidence(bindings, manifest)
    verify_runtime(manifest, bindings)
    if read_json_object(PRODUCTION_MANIFEST_PATH, "V14 production manifest") != source_manifest:
        raise RuntimeError("runtime build mutated the V14 production manifest")
    total_bytes = sum(
        candidate["bytes"]
        for entry in manifest["entries"]
        for variant in entry["variants"].values()
        for candidate in [variant, *variant.get("fallbacks", [])]
    )
    print(
        f"V14 A1 runtime built: masters={len(bindings)} "
        f"stableKeys={len(manifest['entries'])} bytes={total_bytes}"
    )


def command_verify() -> None:
    _source_manifest, _source_entries, bindings = load_approved_master_bindings()
    manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    verify_runtime(manifest, bindings)
    print(
        f"V14 A1 runtime verified: stableKeys={len(manifest['entries'])} "
        f"manifestSha256={file_sha256(MANIFEST_PATH)}"
    )


def command_promote(record: str | None) -> None:
    if not record:
        raise RuntimeError("promote requires --record <reviewed-promotion-receipt.json>")
    pf_id = promote_reviewed_candidate(Path(record).resolve())
    print(
        f"V14 source promoted: {pf_id}; "
        "run art:v14:build to compile runtime derivatives"
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "command",
        choices=("build", "verify", "promote"),
        nargs="?",
        default="build",
    )
    parser.add_argument(
        "--record",
        help="reviewer-authored promotion receipt; required only for promote",
    )
    args = parser.parse_args()
    if args.command == "build":
        command_build()
    elif args.command == "verify":
        command_verify()
    else:
        command_promote(args.record)


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""CPU-only rebake of the fixed cabin SDXL views into a fresh atlas.

This deliberately does not invoke ``spray_generate``.  It consumes the
already-created RGB views and their exact ``polygon-uv-image.json`` sidecars,
so page-size experiments cannot alter the artwork being evaluated.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def texture_metrics(texture: np.ndarray, state: np.ndarray) -> dict[str, float | int]:
    """Report coverage and unambiguous BT.709 luma detail measurements."""

    luma = texture.astype(np.float64) @ np.asarray((0.2126, 0.7152, 0.0722))
    dx = np.abs(np.diff(luma, axis=1)).mean()
    dy = np.abs(np.diff(luma, axis=0)).mean()
    return {
        "observedTexels": int(np.count_nonzero(state == 1)),
        "observedTexelPercent": float(100.0 * np.mean(state == 1)),
        "lumaStd": float(luma.std()),
        "meanAbsoluteLumaGradient": float((dx + dy) / 2.0),
        "meanAbsoluteLumaGradientX": float(dx),
        "meanAbsoluteLumaGradientY": float(dy),
    }


def parse(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--controls", required=True, type=Path, help="views/frames directory")
    parser.add_argument("--generated", required=True, type=Path, help="directory containing frame-NNN.png")
    parser.add_argument("--output", required=True, type=Path, help="new, empty output directory")
    parser.add_argument("--page-size", required=True, type=int)
    parser.add_argument("--view-count", type=int, default=46)
    parser.add_argument("--prefer-new-observation", action="store_true")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> None:
    args = parse(argv)
    if args.page_size < 1 or args.view_count < 1:
        raise SystemExit("page size and view count must be positive")
    if args.output.exists():
        raise SystemExit(f"refusing to resume or overwrite existing output: {args.output}")
    args.output.mkdir(parents=True)

    # The prepared cabin intentionally routes every source face to one atlas.
    sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
    import spray_texture

    page = spray_texture.TexturePage(args.page_size, 1)
    projections: list[dict[str, int | float]] = []
    source_hashes: list[dict[str, str]] = []
    for index in range(args.view_count):
        frame = f"frame-{index:03d}"
        image_path = args.generated / f"{frame}.png"
        frame_dir = args.controls / frame
        if not image_path.is_file() or not frame_dir.is_dir():
            raise SystemExit(f"missing generated image or controls: {frame}")
        maps = spray_texture.load_control_maps(frame_dir)
        routing = np.where(maps.winner_polygon >= 0, 0, -1).astype(np.int32)
        direction, _ = spray_texture.derive_view_direction(maps)
        image = np.asarray(Image.open(image_path).convert("RGB"), dtype=np.float32) / 255.0
        projections.append(spray_texture.back_project(
            page, maps, image, 1.0, routing, view_direction=direction,
            prefer_new_observation=args.prefer_new_observation,
        ))
        source_hashes.append({"frame": frame, "sha256": sha256(image_path)})

    before_fill = texture_metrics(np.rint(np.clip(page.rgb[0], 0, 1) * 255).astype(np.uint8), page.state[0])
    fill = spray_texture.fill_unknown(page)
    files = spray_texture.bake_png(page, args.output)
    texture = np.asarray(Image.open(args.output / "texture-0.png").convert("RGB"), dtype=np.uint8)
    metrics = texture_metrics(texture, page.state[0])
    report = {
        "schemaVersion": "glyph-cabin-cpu-rebake/v1",
        "pageSize": args.page_size,
        "viewCount": args.view_count,
        "preferNewObservation": args.prefer_new_observation,
        "sourceImages": source_hashes,
        "beforeFill": before_fill,
        "fillUnknown": fill,
        "textureMetrics": metrics,
        "backProjection": projections,
        "files": [{"name": path.name, "sha256": sha256(path)} for path in files],
    }
    (args.output / "rebake-report.json").write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps(report["textureMetrics"], sort_keys=True))


if __name__ == "__main__":
    main()

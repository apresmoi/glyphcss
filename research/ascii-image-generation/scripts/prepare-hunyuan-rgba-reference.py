#!/usr/bin/env python3
"""Make a tight RGBA Hunyuan conditioning image from Glyph's grey-pad render."""

from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
from PIL import Image


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("input", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--crop", type=int, nargs=4, metavar=("LEFT", "TOP", "RIGHT", "BOTTOM"), required=True)
    parser.add_argument("--pad", type=int, default=128)
    parser.add_argument("--tolerance", type=int, default=10)
    args = parser.parse_args()

    image = Image.open(args.input).convert("RGB")
    left, top, right, bottom = args.crop
    if not (0 <= left < right <= image.width and 0 <= top < bottom <= image.height):
        raise ValueError(f"crop {args.crop} is outside {image.size}")
    rgb = np.asarray(image.crop((left, top, right, bottom)), dtype=np.uint8)
    distance = np.abs(rgb.astype(np.int16) - args.pad).max(axis=2)
    alpha = np.where(distance > args.tolerance, 255, 0).astype(np.uint8)
    occupied = np.argwhere(alpha > 0)
    if occupied.size == 0:
        raise ValueError("threshold found no non-pad cabin pixels")
    min_row, min_col = occupied.min(axis=0)
    max_row, max_col = occupied.max(axis=0)
    rgba = np.dstack((rgb, alpha))[min_row:max_row + 1, min_col:max_col + 1]
    args.output.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(rgba, "RGBA").save(args.output)
    print(
        "HUNYUAN_RGBA_REFERENCE="
        f"source={args.input},crop={args.crop},tightBox="
        f"({min_col},{min_row},{max_col + 1},{max_row + 1}),output={args.output}"
    )


if __name__ == "__main__":
    main()

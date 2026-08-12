#!/usr/bin/env python3
"""Make a square, cabin-only conditioning image from an authored frame."""

from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("input", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--box", type=int, nargs=4, metavar=("LEFT", "TOP", "RIGHT", "BOTTOM"), required=True)
    parser.add_argument("--size", type=int, default=512)
    args = parser.parse_args()
    image = Image.open(args.input).convert("RGB")
    left, top, right, bottom = args.box
    if not (0 <= left < right <= image.width and 0 <= top < bottom <= image.height):
        raise ValueError(f"crop {args.box} is outside {image.size}")
    crop = image.crop((left, top, right, bottom)).resize((args.size, args.size), Image.Resampling.LANCZOS)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    crop.save(args.output)
    print(f"CABIN_REFERENCE_CROPPED:source={args.input},box={args.box},output={args.output}")


if __name__ == "__main__":
    main()

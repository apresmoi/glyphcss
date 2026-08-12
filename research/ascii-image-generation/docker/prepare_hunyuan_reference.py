#!/usr/bin/env python3
"""Prepare an RGBA Paint conditioning image with Tencent's BackgroundRemover."""

from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("input", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--crop", type=int, nargs=4, metavar=("LEFT", "TOP", "RIGHT", "BOTTOM"), required=True)
    parser.add_argument("--size", type=int, default=512)
    args = parser.parse_args()

    source = Image.open(args.input).convert("RGB")
    left, top, right, bottom = args.crop
    if not (0 <= left < right <= source.width and 0 <= top < bottom <= source.height):
        raise ValueError(f"crop {args.crop} is outside {source.size}")
    cropped = source.crop((left, top, right, bottom)).resize((args.size, args.size), Image.Resampling.LANCZOS)

    # This is the public upstream segmentation component, not a custom mask.
    from hy3dgen.rembg import BackgroundRemover

    rgba = BackgroundRemover()(cropped)
    if rgba.mode != "RGBA" or rgba.getchannel("A").getbbox() is None:
        raise RuntimeError("BackgroundRemover did not produce a non-empty RGBA image")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    rgba.save(args.output)
    print(f"HUNYUAN_REFERENCE_READY:source={args.input},crop={args.crop},output={args.output}", flush=True)


if __name__ == "__main__":
    main()

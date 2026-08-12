#!/usr/bin/env python3
"""Paint a neutral material-color atlas for a cabin-shell conditioning image."""

from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image, ImageDraw


MATERIAL_COLORS = {
    "glyph_c9b391": "#e7c99b",  # cream walls and gables
    "glyph_8c4a3f": "#a94832",  # terracotta roof
    "glyph_4ea8de": "#6c9fc2",  # windows
    "glyph_6f4e37": "#6f412b",  # timber door
    "glyph_8d8578": "#9a8f82",  # stone step
    "glyph_7a6a5f": "#b86b4e",  # chimney
}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("input", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--size", type=int, default=1024)
    args = parser.parse_args()
    if args.size <= 0:
        raise ValueError("size must be positive")

    texcoords: list[tuple[float, float]] = []
    faces: list[tuple[str, list[int]]] = []
    material: str | None = None
    for line_number, raw in enumerate(args.input.read_text(encoding="utf-8").splitlines(), start=1):
        fields = raw.split()
        if not fields:
            continue
        if fields[0] == "usemtl":
            if len(fields) != 2:
                raise ValueError(f"invalid material at {args.input}:{line_number}")
            material = fields[1]
        elif fields[0] == "vt":
            texcoords.append((float(fields[1]), float(fields[2])))
        elif fields[0] == "f":
            if material not in MATERIAL_COLORS:
                raise ValueError(f"unrecognized cabin material at {args.input}:{line_number}: {material}")
            indices: list[int] = []
            for token in fields[1:]:
                parts = token.split("/")
                if len(parts) < 2 or not parts[1]:
                    raise ValueError(f"missing UV at {args.input}:{line_number}")
                index = int(parts[1]) - 1
                if not 0 <= index < len(texcoords):
                    raise ValueError(f"bad UV index at {args.input}:{line_number}")
                indices.append(index)
            faces.append((material, indices))

    image = Image.new("RGB", (args.size, args.size), "#303840")
    draw = ImageDraw.Draw(image)
    for face_material, indices in faces:
        # The source OBJ's v is already top-origin, exactly like PIL rows.
        points = [(round(texcoords[index][0] * (args.size - 1)), round(texcoords[index][1] * (args.size - 1))) for index in indices]
        draw.polygon(points, fill=MATERIAL_COLORS[face_material], outline="#20252a", width=max(1, args.size // 512))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    image.save(args.output)
    print(f"CABIN_STRUCTURAL_ATLAS:faces={len(faces)},output={args.output}")


if __name__ == "__main__":
    main()

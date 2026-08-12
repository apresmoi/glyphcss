#!/usr/bin/env python3
"""Make the extracted cabin's packed UV atlas a single spray material.

The public cabin OBJ intentionally has separate semantic materials (wall,
roof, glass, stone, chimney).  They already occupy non-overlapping regions in
one 4096² UV page, while the website binds every material to one atlas image.
For spray projection they must therefore share one TexturePage too; otherwise
five partial pages could not be consumed by that one-image website contract.
"""

from __future__ import annotations

import argparse
import hashlib
from pathlib import Path


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("input", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()

    source = args.input.read_text(encoding="utf-8")
    faces = sum(1 for line in source.splitlines() if line.startswith("f "))
    materials = {line.split(maxsplit=1)[1] for line in source.splitlines() if line.startswith("usemtl ")}
    if faces != 48 or not {"glyph_c9b391", "glyph_8c4a3f", "glyph_7a6a5f"}.issubset(materials):
        raise RuntimeError("CABIN_SPRAY_MESH_SOURCE_NOT_EXPECTED_BUILDING")

    texture = args.input.parent / "material_0.png"
    if not texture.is_file():
        raise RuntimeError("CABIN_SPRAY_MESH_TEXTURE_BINDING_MISSING")
    material_file = args.output.with_suffix(".mtl")
    result = [f"mtllib {material_file.name}"]
    emitted_material = False
    for line in source.splitlines():
        if line.startswith("usemtl "):
            if not emitted_material:
                result.append("usemtl building")
                emitted_material = True
        else:
            result.append(line)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text("\n".join(result) + "\n", encoding="utf-8")
    material_file.write_text("newmtl building\nKd 1.000000 1.000000 1.000000\nmap_Kd material_0.png\n", encoding="utf-8")
    print({"input": str(args.input), "inputSha256": sha256(args.input), "output": str(args.output), "outputSha256": sha256(args.output), "material": str(material_file), "materialSha256": sha256(material_file), "faces": faces, "materials": ["building"]})


if __name__ == "__main__":
    main()

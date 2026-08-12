#!/usr/bin/env python3
"""Extract the authored cabin shell from the cabin + yard OBJ scene.

The source OBJ deliberately has one flat object, so object/group selection is
not available.  Face ordinal selection is unsafe: it included a lawn face and
stopped before the gable roof.  The authored materials are the stable boundary
between the cabin shell and the yard, fence, and trees.
"""

from __future__ import annotations

import argparse
from pathlib import Path


CABIN_MATERIALS = frozenset({
    "glyph_c9b391",  # wall and gables
    "glyph_8c4a3f",  # roof
    "glyph_4ea8de",  # window
    "glyph_6f4e37",  # door
    "glyph_8d8578",  # stone / step
    "glyph_7a6a5f",  # chimney
})


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("input", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()

    vertices: list[str] = []
    texcoords: list[str] = []
    faces: list[tuple[str | None, list[str]]] = []
    material: str | None = None

    for line in args.input.read_text(encoding="utf-8").splitlines():
        if line.startswith("v "):
            vertices.append(line)
        elif line.startswith("vt "):
            texcoords.append(line)
        elif line.startswith("usemtl "):
            material = line.split(maxsplit=1)[1]
        elif line.startswith("f "):
            faces.append((material, line.split()[1:]))

    selected = [(face_material, face) for face_material, face in faces if face_material in CABIN_MATERIALS]
    selected_materials = {face_material for face_material, _ in selected if face_material}
    missing = CABIN_MATERIALS - selected_materials
    if missing:
        raise ValueError(f"cabin materials missing from {args.input}: {', '.join(sorted(missing))}")
    if not selected:
        raise ValueError(f"no cabin faces found in {args.input}")

    vertex_ids: dict[int, int] = {}
    texcoord_ids: dict[int, int] = {}

    def remap(token: str) -> str:
        fields = token.split("/")
        vertex = int(fields[0])
        if vertex not in vertex_ids:
            vertex_ids[vertex] = len(vertex_ids) + 1
        fields[0] = str(vertex_ids[vertex])
        if len(fields) > 1 and fields[1]:
            texcoord = int(fields[1])
            if texcoord not in texcoord_ids:
                texcoord_ids[texcoord] = len(texcoord_ids) + 1
            fields[1] = str(texcoord_ids[texcoord])
        return "/".join(fields)

    output = [
        "# Reproducibly extracted cabin shell from textured-house/cabin.obj.",
        "# Kept only authored cabin materials; dropped lawn, fence, and all trees.",
        "o cabin_shell",
    ]
    remapped_faces: list[tuple[str | None, list[str]]] = []
    for face_material, face in selected:
        remapped_faces.append((face_material, [remap(token) for token in face]))
    for index in sorted(vertex_ids, key=vertex_ids.get):
        output.append(vertices[index - 1])
    for index in sorted(texcoord_ids, key=texcoord_ids.get):
        output.append(texcoords[index - 1])
    previous_material = None
    for face_material, face in remapped_faces:
        if face_material != previous_material and face_material:
            output.append("usemtl " + face_material)
            previous_material = face_material
        output.append("f " + " ".join(face))

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text("\n".join(output) + "\n", encoding="utf-8")
    print(
        "CABIN_SHELL_EXTRACTED:"
        f"selection=materials,faces={len(selected)},"
        f"vertices={len(vertex_ids)},texcoords={len(texcoord_ids)},output={args.output}"
    )


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Extract ONLY the cabin building from the authored scene OBJ.

Hunyuan3D-Paint is trained on single OBJECTS, so it must be handed the building
alone -- not the 24x18 m plot with its lawn, fence and trees. The previous
extractor selected by hardcoded face-index ranges and silently produced a
24x18x3 m slab with no gable roof, which is what both texturing methods were
actually painting.

Selection is by MATERIAL, which is the stable authored boundary:
  wall, roof, window, door, stone (foundation), chimney
and the result is asserted against the cabin's known extent so a bad selection
fails loudly instead of shipping a slab.
"""
import sys
from pathlib import Path

CABIN = {
    "glyph_c9b391",  # wall
    "glyph_8c4a3f",  # roof
    "glyph_4ea8de",  # window
    "glyph_6f4e37",  # door
    "glyph_8d8578",  # stone foundation
    "glyph_7a6a5f",  # chimney
}

src, dst = Path(sys.argv[1]), Path(sys.argv[2])
vs, vts, faces, material = [], [], [], None
for line in src.read_text().splitlines():
    if line.startswith("v "):
        vs.append(tuple(float(x) for x in line.split()[1:4]))
    elif line.startswith("vt "):
        vts.append(tuple(float(x) for x in line.split()[1:3]))
    elif line.startswith("usemtl "):
        material = line.split(maxsplit=1)[1].strip()
    elif line.startswith("f ") and material in CABIN:
        faces.append((material, line.split()[1:]))

# Reindex only the vertices/UVs the cabin actually uses.
vmap, vtmap, out_v, out_vt = {}, {}, [], []
def keep(table, cache, out, idx):
    if idx not in cache:
        cache[idx] = len(out) + 1
        out.append(table[idx])
    return cache[idx]

emitted = []
for mat, corners in faces:
    parts = []
    for corner in corners:
        bits = corner.split("/")
        vi = keep(vs, vmap, out_v, int(bits[0]) - 1)
        ti = keep(vts, vtmap, out_vt, int(bits[1]) - 1) if len(bits) > 1 and bits[1] else None
        parts.append(f"{vi}/{ti}" if ti else str(vi))
    emitted.append((mat, parts))

lines = ["# cabin building only - extracted by material"]
lines += [f"v {x} {y} {z}" for x, y, z in out_v]
lines += [f"vt {u} {v}" for u, v in out_vt]
last = None
for mat, parts in emitted:
    if mat != last:
        lines.append(f"usemtl {mat}")
        last = mat
    lines.append("f " + " ".join(parts))
dst.write_text("\n".join(lines) + "\n")

xs = [p[0] for p in out_v]; ys = [p[1] for p in out_v]; zs = [p[2] for p in out_v]
size = (max(xs) - min(xs), max(ys) - min(ys), max(zs) - min(zs))
print({"faces": len(emitted), "verts": len(out_v), "uvs": len(out_vt),
       "min": (min(xs), min(ys), min(zs)), "max": (max(xs), max(ys), max(zs)),
       "size": tuple(round(s, 2) for s in size)})
# A cabin, not a plot: reject anything plot-sized or missing the ridge.
assert size[0] < 12 and size[1] < 10, f"selection is plot-sized, not a building: {size}"
assert size[2] > 4.5, f"gable roof missing - height only {size[2]:.2f} m"

#!/usr/bin/env python3
"""Render two textured cabin meshes from identical simple orthographic cameras.

This deliberately small CPU renderer is for visual comparison artifacts, not
production rendering: it depth-tests triangle fans, samples authored UVs, and
adds one flat Lambert term.  It keeps the SDXL atlas and Hunyuan output on the
same geometry, camera, background, and lighting.
"""

from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw


SIZE = 768
BACKGROUND = np.array([142, 142, 142], dtype=np.uint8)
LIGHT = np.array([-0.45, -0.7, 0.55], dtype=np.float32)
LIGHT /= np.linalg.norm(LIGHT)
STRUCTURAL_MATERIAL_COLORS = {
    "glyph_c9b391": (231, 201, 155),
    "glyph_8c4a3f": (169, 72, 50),
    "glyph_4ea8de": (108, 159, 194),
    "glyph_6f4e37": (111, 65, 43),
    "glyph_8d8578": (154, 143, 130),
    "glyph_7a6a5f": (184, 107, 78),
}


def texture_from_obj(path: Path, fallback_texture: Path | None) -> Image.Image:
    """Find the diffuse map without letting an OBJ loader rewrite UVs."""
    for raw in path.read_text(encoding="utf-8").splitlines():
        fields = raw.split(maxsplit=1)
        if len(fields) != 2 or fields[0] != "mtllib":
            continue
        mtl_path = path.parent / fields[1]
        if not mtl_path.is_file():
            continue
        for material_line in mtl_path.read_text(encoding="utf-8").splitlines():
            material_fields = material_line.split(maxsplit=1)
            if len(material_fields) == 2 and material_fields[0] == "map_Kd":
                texture_path = mtl_path.parent / material_fields[1]
                if texture_path.is_file():
                    return Image.open(texture_path)
    if fallback_texture is not None:
        return Image.open(fallback_texture)
    raise ValueError(f"{path} has no readable diffuse texture")


def obj_index(token: str, count: int, kind: str, path: Path) -> int:
    value = int(token)
    index = value - 1 if value > 0 else count + value
    if not 0 <= index < count:
        raise ValueError(f"{path} has out-of-range {kind} index {value}")
    return index


def load_mesh(path: Path, fallback_texture: Path | None = None) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray, list[str | None]]:
    """Read OBJ face corners directly, retaining its authored top-origin UVs.

    Trimesh's merged-mesh loader can reorder OBJ submeshes while retaining one
    shared UV array.  On this material-partitioned atlas that decouples UVs
    from vertices and produces striped/black geometry.  Expanding each face
    corner here is tiny for this diagnostic renderer and preserves the exact
    ``v/vt`` relationship exported by glyphcss.
    """
    source_vertices: list[tuple[float, float, float]] = []
    source_uvs: list[tuple[float, float]] = []
    vertices: list[tuple[float, float, float]] = []
    uvs: list[tuple[float, float]] = []
    faces: list[tuple[int, int, int]] = []
    materials: list[str | None] = []
    material: str | None = None
    for line_number, raw in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        fields = raw.split()
        if not fields:
            continue
        if fields[0] == "v":
            if len(fields) < 4:
                raise ValueError(f"invalid vertex at {path}:{line_number}")
            source_vertices.append((float(fields[1]), float(fields[2]), float(fields[3])))
        elif fields[0] == "vt":
            if len(fields) < 3:
                raise ValueError(f"invalid texture coordinate at {path}:{line_number}")
            source_uvs.append((float(fields[1]), float(fields[2])))
        elif fields[0] == "usemtl":
            material = fields[1] if len(fields) == 2 else None
        elif fields[0] == "f":
            if len(fields) < 4:
                raise ValueError(f"invalid face at {path}:{line_number}")
            corners: list[int] = []
            for token in fields[1:]:
                indices = token.split("/")
                if len(indices) < 2 or not indices[1]:
                    raise ValueError(f"missing texture coordinate at {path}:{line_number}")
                vertex = obj_index(indices[0], len(source_vertices), "vertex", path)
                uv = obj_index(indices[1], len(source_uvs), "texture", path)
                corners.append(len(vertices))
                vertices.append(source_vertices[vertex])
                uvs.append(source_uvs[uv])
            for index in range(1, len(corners) - 1):
                faces.append((corners[0], corners[index], corners[index + 1]))
                materials.append(material)
    if not faces:
        raise ValueError(f"{path} has no textured faces")
    # The shell deliberately exports back-to-back copies of many surfaces.
    # They can carry separate OBJ corner records after Paint round-trips the
    # mesh, so rendering both makes their equally deep textures zebra-stripe.
    # This comparison is an exterior view: retain the first geometric triangle
    # at each location, independent of winding, rather than z-fighting them.
    deduped_faces: list[tuple[int, int, int]] = []
    deduped_materials: list[str | None] = []
    seen_geometry: set[tuple[tuple[float, float, float], ...]] = set()
    for face, face_material in zip(faces, materials):
        # Paint's UV unwrap round-trips duplicate shell sides through float32,
        # so byte-identical positions can differ by a few ULPs.  Quantize the
        # geometric key (not UVs) before suppressing the exterior's coincident
        # opposite-wound copy; otherwise its equal-depth texels zebra-stripe.
        key = tuple(sorted(tuple(round(float(value), 5) for value in vertices[index]) for index in face))
        if key in seen_geometry:
            continue
        seen_geometry.add(key)
        deduped_faces.append(face)
        deduped_materials.append(face_material)
    texture = texture_from_obj(path, fallback_texture)
    return (
        np.asarray(vertices, dtype=np.float32),
        np.asarray(deduped_faces, dtype=np.int32),
        np.asarray(uvs, dtype=np.float32),
        np.asarray(texture.convert("RGB"), dtype=np.uint8),
        deduped_materials,
    )


def camera_basis(eye: tuple[float, float, float]) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    eye_vec = np.asarray(eye, dtype=np.float32)
    forward = -eye_vec / np.linalg.norm(eye_vec)
    right = np.cross(forward, np.array([0, 0, 1], dtype=np.float32))
    right /= np.linalg.norm(right)
    up = np.cross(right, forward)
    return eye_vec, right, up, forward


def render(mesh_data: tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray, list[str | None]], eye: tuple[float, float, float], structural: bool = False, scale: float = 13.0) -> Image.Image:
    vertices, faces, uv, texture, materials = mesh_data
    eye_vec, right, up, forward = camera_basis(eye)
    screen = np.stack((vertices @ right, vertices @ up), axis=1)
    depth = (vertices - eye_vec) @ forward
    pixels = np.empty((SIZE, SIZE, 3), dtype=np.uint8)
    pixels[:] = BACKGROUND
    zbuffer = np.full((SIZE, SIZE), -np.inf, dtype=np.float32)
    texture_height, texture_width = texture.shape[:2]

    coords = np.empty_like(screen)
    coords[:, 0] = (screen[:, 0] / scale + 0.5) * (SIZE - 1)
    coords[:, 1] = (0.5 - screen[:, 1] / scale) * (SIZE - 1)
    for face_index, face in enumerate(faces):
        ids = np.asarray(face, dtype=np.int32)
        for tri in ((ids[0], ids[index], ids[index + 1]) for index in range(1, len(ids) - 1)):
            tri = np.asarray(tri, dtype=np.int32)
            normal = np.cross(vertices[tri[1]] - vertices[tri[0]], vertices[tri[2]] - vertices[tri[0]])
            normal /= max(np.linalg.norm(normal), 1e-7)
            points = coords[tri]
            xmin = max(int(np.floor(points[:, 0].min())), 0)
            xmax = min(int(np.ceil(points[:, 0].max())), SIZE - 1)
            ymin = max(int(np.floor(points[:, 1].min())), 0)
            ymax = min(int(np.ceil(points[:, 1].max())), SIZE - 1)
            if xmin > xmax or ymin > ymax:
                continue
            a, b, c = points
            area = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
            if abs(area) < 1e-7:
                continue
            xs, ys = np.meshgrid(np.arange(xmin, xmax + 1), np.arange(ymin, ymax + 1))
            w0 = ((b[0] - xs) * (c[1] - ys) - (b[1] - ys) * (c[0] - xs)) / area
            w1 = ((c[0] - xs) * (a[1] - ys) - (c[1] - ys) * (a[0] - xs)) / area
            w2 = 1.0 - w0 - w1
            inside = (w0 >= 0) & (w1 >= 0) & (w2 >= 0)
            tri_depth = w0 * depth[tri[0]] + w1 * depth[tri[1]] + w2 * depth[tri[2]]
            rows, cols = np.where(inside & (tri_depth > zbuffer[ymin:ymax + 1, xmin:xmax + 1]))
            if not len(rows):
                continue
            bary = np.stack((w0[rows, cols], w1[rows, cols], w2[rows, cols]), axis=1)
            # Glyph's exported OBJ stores v from the *top* of the atlas. GPU
            # consumers compensate into conventional bottom-origin UVs as
            # [u, 1 - v]; this PIL renderer already addresses image rows from
            # the top, so doing that conversion here would flip the atlas a
            # second time.  Sample the authored top-origin v directly.
            # The shell uses intentional opposite windings for several
            # material faces.  This renderer presents both sides, so light
            # the geometric plane rather than letting the opposite winding
            # turn an otherwise identical texel black and create z-fighting
            # stripes.
            shade = 0.35 + 0.65 * abs(float(np.dot(normal, LIGHT)))
            rows += ymin
            cols += xmin
            if structural:
                color = np.asarray(STRUCTURAL_MATERIAL_COLORS.get(materials[face_index], (192, 192, 192)), dtype=np.float32)
                pixels[rows, cols] = np.clip(color * shade, 0, 255).astype(np.uint8)
            else:
                tri_uv = bary @ uv[tri]
                tex_x = np.clip((tri_uv[:, 0] * (texture_width - 1)).round().astype(int), 0, texture_width - 1)
                tex_y = np.clip((tri_uv[:, 1] * (texture_height - 1)).round().astype(int), 0, texture_height - 1)
                pixels[rows, cols] = np.clip(texture[tex_y, tex_x].astype(np.float32) * shade, 0, 255).astype(np.uint8)
            zbuffer[rows, cols] = tri_depth[rows - ymin, cols - xmin]
    return Image.fromarray(pixels, "RGB")


def label(image: Image.Image, text: str) -> Image.Image:
    framed = Image.new("RGB", (SIZE, SIZE + 28), (30, 30, 30))
    framed.paste(image, (0, 28))
    ImageDraw.Draw(framed).text((8, 7), text, fill=(255, 255, 255))
    return framed


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--sdxl-mesh", type=Path, required=True)
    parser.add_argument("--sdxl-texture", type=Path, required=True)
    parser.add_argument("--hunyuan-mesh", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--reference-output", type=Path, help="write the clean front-oblique SDXL mesh render for image conditioning")
    parser.add_argument("--structural-reference", action="store_true", help="render authored material colors instead of sampling the atlas")
    parser.add_argument("--scale", type=float, default=13.0, help="orthographic world-width framing; smaller values zoom in")
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    sdxl = load_mesh(args.sdxl_mesh, args.sdxl_texture)
    cameras = {
        "front-oblique": (-10, -14, 12),
        "rear-oblique": (10, 14, 12),
        "left-oblique": (-14, 8, 10),
        "right-oblique": (14, -8, 10),
    }
    if args.reference_output:
        args.reference_output.parent.mkdir(parents=True, exist_ok=True)
        render(sdxl, cameras["front-oblique"], structural=args.structural_reference, scale=args.scale).save(args.reference_output)
        print(f"STRUCTURAL_REFERENCE_RENDERED:{args.reference_output}")
    if args.hunyuan_mesh is None:
        return
    hunyuan = load_mesh(args.hunyuan_mesh)
    for name, eye in cameras.items():
        left = render(sdxl, eye, scale=args.scale)
        right = render(hunyuan, eye, scale=args.scale)
        comparison = Image.new("RGB", (SIZE * 2, SIZE + 28))
        comparison.paste(label(left, "SDXL atlas (sequential inpaint)"), (0, 0))
        comparison.paste(label(right, "Hunyuan3D-Paint v2.0"), (SIZE, 0))
        left.save(args.output / f"{name}-sdxl-atlas.png")
        right.save(args.output / f"{name}-hunyuan3d.png")
        comparison.save(args.output / f"{name}-comparison.png")
        print(f"COMPARISON_RENDERED:{name}")


if __name__ == "__main__":
    main()

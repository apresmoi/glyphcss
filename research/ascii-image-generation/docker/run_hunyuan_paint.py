#!/usr/bin/env python3
"""Run Hunyuan3D-Paint through Tencent's public pipeline API only."""

from __future__ import annotations

import argparse
import json
import os
import time
from pathlib import Path

import trimesh
from PIL import Image


MODEL_ID = "tencent/Hunyuan3D-2"
DEFAULT_SUBFOLDER = "hunyuan3d-paint-v2-0"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--stage", choices=("capability", "cabin"), required=True)
    parser.add_argument("--mesh", type=Path)
    parser.add_argument("--image", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--subfolder", default=DEFAULT_SUBFOLDER)
    # Retained solely for launcher compatibility.  The upstream pipeline owns
    # its own render and texture configuration.
    parser.add_argument("--render-size", type=int)
    parser.add_argument("--texture-size", type=int)
    args = parser.parse_args()

    args.output.mkdir(parents=True, exist_ok=True)

    # Keep the public demo's conditional behavior: RGB source images are
    # segmented with its BackgroundRemover before Paint; prepared RGBA cabin
    # references retain their authored alpha untouched.  ShapeGen is never
    # imported or called because this experiment supplies the mesh directly.
    image = Image.open(args.image)
    background_removed = image.mode == "RGB"
    if background_removed:
        from hy3dgen.rembg import BackgroundRemover

        image = BackgroundRemover()(image)
    if image.mode != "RGBA":
        raise ValueError(f"Paint conditioning image must resolve to RGBA, got {image.mode}")
    if image.getchannel("A").getbbox() is None:
        raise ValueError("Paint conditioning input is fully transparent")
    image.save(args.output / "conditioning-rgba.png")

    if args.stage == "capability":
        mesh = trimesh.creation.box(extents=(1.0, 1.0, 1.0))
        mesh.export(args.output / "capability-input-box.obj")
    else:
        if args.mesh is None:
            raise ValueError("--mesh is required for the cabin stage")
        mesh = trimesh.load(args.mesh, force="mesh", process=False)
        if not isinstance(mesh, trimesh.Trimesh):
            raise TypeError(f"expected one mesh, got {type(mesh).__name__}")

    # This is intentionally the public, documented Hunyuan call path.  Do
    # not duplicate its delight, multiview, render, UV-wrap, bake, or inpaint
    # stages here.
    from hy3dgen.texgen import Hunyuan3DPaintPipeline

    started = time.monotonic()
    # The full local HF snapshot is supplied by the launcher.  Passing its
    # filesystem path lets upstream resolve delight + Paint unchanged while
    # keeping offline mode and avoiding ShapeGen's absent DiT checkpoint.
    model_path = os.environ.get("HUNYUAN3D_PAINT_MODEL_PATH", MODEL_ID)
    pipeline = Hunyuan3DPaintPipeline.from_pretrained(model_path, subfolder=args.subfolder)
    textured_mesh = pipeline(mesh, image=image)

    stem = "capability-box" if args.stage == "capability" else "cabin"
    glb = args.output / f"{stem}-hunyuan3d-paint.glb"
    obj = args.output / f"{stem}-hunyuan3d-paint.obj"
    albedo = args.output / f"{stem}-hunyuan3d-paint-albedo.png"
    textured_mesh.export(glb)
    textured_mesh.export(obj)
    texture = getattr(getattr(textured_mesh.visual, "material", None), "image", None)
    if texture is None:
        raise RuntimeError("Hunyuan3D-Paint returned a mesh without a texture map")
    texture.save(albedo)

    result = {
        "implementation": "Tencent/Hunyuan3D-2 Hunyuan3DPaintPipeline",
        "model": MODEL_ID,
        "modelPath": model_path,
        "paintSubfolder": args.subfolder,
        "conditioningImage": str(args.image),
        "backgroundRemoverApplied": background_removed,
        "outputAlbedo": str(albedo),
        "outputGlb": str(glb),
        "outputObj": str(obj),
        "textureSize": list(texture.size),
        "elapsedSeconds": round(time.monotonic() - started, 3),
        "vertices": int(len(textured_mesh.vertices)),
        "triangles": int(len(textured_mesh.faces)),
    }
    (args.output / "run.json").write_text(json.dumps(result, indent=2) + "\n")
    print("HUNYUAN_STAGE=" + json.dumps({"stage": args.stage, "state": "pass", **result}, sort_keys=True), flush=True)


if __name__ == "__main__":
    main()

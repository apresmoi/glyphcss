#!/usr/bin/env python3
"""Pre-training prompt + stock depth-ControlNet baseline.

This deliberately consumes only a control representation the public SD1.5
ControlNet already understands. It does not claim that the stock model
understands glyphcss semantic, visible-glyph, identity, UV, or normal planes.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import platform
import time
from pathlib import Path

import numpy as np
import torch
from diffusers import (
    ControlNetModel,
    DPMSolverMultistepScheduler,
    StableDiffusionControlNetPipeline,
    StableDiffusionXLControlNetPipeline,
)
from PIL import Image


def digest(path: Path) -> str:
    value = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            value.update(chunk)
    return value.hexdigest()


def parse() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--variant-root", type=Path, required=True)
    parser.add_argument("--frame", default="frame-000")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--prompt", required=True)
    parser.add_argument("--negative-prompt", default="deformed, distorted, cropped, duplicate, extra objects, text, watermark, low quality")
    parser.add_argument("--seed", type=int, default=1701)
    parser.add_argument("--steps", type=int, default=24)
    parser.add_argument("--guidance", type=float, default=7.5)
    parser.add_argument("--control-scale", type=float, default=1.0)
    parser.add_argument("--depth-source", choices=("corpus-normalized", "frame-minmax"), default="corpus-normalized")
    parser.add_argument("--pipeline", choices=("sd15", "sdxl"), default="sd15")
    parser.add_argument("--width", type=int, default=None)
    parser.add_argument("--height", type=int, default=None)
    parser.add_argument("--base-model", default="stable-diffusion-v1-5/stable-diffusion-v1-5")
    parser.add_argument("--base-revision", default="f03de327dd89b501a01da37fc5240cf4fdba85a1")
    parser.add_argument("--control-model", default="lllyasviel/control_v11f1p_sd15_depth")
    parser.add_argument("--control-revision", default="a43126082377f76ee013e650bee33d626c52a8f4")
    return parser.parse_args()


def main() -> None:
    args = parse()
    width = args.width or (1024 if args.pipeline == "sdxl" else 512)
    height = args.height or (1024 if args.pipeline == "sdxl" else 512)
    if width % 8 or height % 8 or width < 256 or height < 256:
        raise RuntimeError("STOCK_BASELINE_OUTPUT_SIZE_INVALID")
    manifest_path = args.variant_root / "controls" / "manifest.json"
    manifest = json.loads(manifest_path.read_text())
    frame = next((entry for entry in manifest["frames"] if entry["id"] == args.frame), None)
    if frame is None:
        raise RuntimeError(f"unknown frame {args.frame}")
    metadata_path = args.variant_root / "controls" / frame["files"]["metadata"]
    metadata = json.loads(metadata_path.read_text())
    cols = int(metadata["cols"])
    rows = int(metadata["rows"])
    if (cols, rows, float(metadata["cellAspect"])) != (256, 128, 2.0):
        raise RuntimeError("STOCK_BASELINE_UNAPPROVED_MODEL_RASTER_SOURCE")
    depth_role = "depth-f64" if args.depth_source == "frame-minmax" else "depth-normalized-f32"
    depth_path = args.variant_root / "controls" / frame["files"][depth_role]
    coverage_path = args.variant_root / "controls" / frame["files"]["coverage-u8"]
    depth = np.fromfile(depth_path, dtype="<f8" if args.depth_source == "frame-minmax" else "<f4")
    coverage = np.fromfile(coverage_path, dtype=np.uint8)
    if depth.size != cols * rows or coverage.size != cols * rows:
        raise RuntimeError("STOCK_BASELINE_CONTROL_SIZE_INVALID")
    depth = depth.reshape(rows, cols)
    coverage = coverage.reshape(rows, cols) != 0
    if not np.isfinite(depth[coverage]).all():
        raise RuntimeError("STOCK_BASELINE_COVERED_DEPTH_NONFINITE")
    # MiDaS-style ControlNet depth images use brighter values for nearer
    # geometry. The corpus-normalized plane preserves the frozen tensor
    # contract. Frame-minmax is an explicit stock-ControlNet presentation
    # adapter: it restores usable contrast without changing any corpus bytes.
    if args.depth_source == "frame-minmax":
        low, high = np.percentile(depth[coverage], [1.0, 99.0])
        if not np.isfinite([low, high]).all() or not high > low:
            raise RuntimeError("STOCK_BASELINE_DEPTH_RANGE_DEGENERATE")
        depth = (depth - low) / (high - low)
    control = np.zeros((rows, cols), dtype=np.uint8)
    control[coverage] = np.rint((1.0 - np.clip(depth[coverage], 0.0, 1.0)) * 255.0).astype(np.uint8)
    control_image = Image.fromarray(control, mode="L").resize((width, height), Image.Resampling.NEAREST).convert("RGB")

    args.output.mkdir(parents=True, exist_ok=True)
    control_output = args.output / "control-depth.png"
    generated_output = args.output / "generated.png"
    report_output = args.output / "report.json"
    control_image.save(control_output)

    started = time.time()
    controlnet = ControlNetModel.from_pretrained(
        args.control_model,
        revision=args.control_revision,
        torch_dtype=torch.float16,
        use_safetensors=True,
    )
    pipeline_class = StableDiffusionXLControlNetPipeline if args.pipeline == "sdxl" else StableDiffusionControlNetPipeline
    pipeline = pipeline_class.from_pretrained(
        args.base_model,
        revision=args.base_revision,
        controlnet=controlnet,
        torch_dtype=torch.float16,
        use_safetensors=True,
    )
    pipeline.scheduler = DPMSolverMultistepScheduler.from_config(pipeline.scheduler.config)
    pipeline.enable_attention_slicing()
    if args.pipeline == "sdxl":
        pipeline.enable_model_cpu_offload()
    else:
        pipeline.to("cuda")
    loaded = time.time()
    generator = torch.Generator(device="cuda").manual_seed(args.seed)
    result = pipeline(
        prompt=args.prompt,
        negative_prompt=args.negative_prompt,
        image=control_image,
        width=width,
        height=height,
        num_inference_steps=args.steps,
        guidance_scale=args.guidance,
        controlnet_conditioning_scale=args.control_scale,
        generator=generator,
    )
    generated = result.images[0]
    generated.save(generated_output)
    finished = time.time()
    report = {
        "schemaVersion": "glyph-stock-controlnet-baseline/v1",
        "disposition": "pre-training-pipeline-baseline-not-custom-semantic-proof",
        "pipeline": args.pipeline,
        "depthSource": args.depth_source,
        "prompt": args.prompt,
        "negativePrompt": args.negative_prompt,
        "seed": args.seed,
        "steps": args.steps,
        "guidanceScale": args.guidance,
        "controlScale": args.control_scale,
        "models": {
            "base": {"id": args.base_model, "revision": args.base_revision},
            "control": {"id": args.control_model, "revision": args.control_revision, "kind": "depth"},
        },
        "source": {
            "manifestSha256": digest(manifest_path),
            "metadataSha256": digest(metadata_path),
            "depthSha256": digest(depth_path),
            "coverageSha256": digest(coverage_path),
            "grid": {"cols": cols, "rows": rows, "cellAspect": 2},
            "frame": args.frame,
        },
        "outputs": {
            "controlDepth": {"path": control_output.name, "sha256": digest(control_output)},
            "generated": {"path": generated_output.name, "sha256": digest(generated_output), "width": generated.width, "height": generated.height},
        },
        "runtime": {
            "torch": torch.__version__,
            "cuda": torch.version.cuda,
            "gpu": torch.cuda.get_device_name(0),
            "python": platform.python_version(),
            "loadSeconds": loaded - started,
            "inferenceSeconds": finished - loaded,
            "peakVramBytes": torch.cuda.max_memory_allocated(),
        },
    }
    report_output.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n")
    print(json.dumps(report, sort_keys=True))


if __name__ == "__main__":
    main()

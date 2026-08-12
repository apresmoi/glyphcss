#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import os
import platform
import time
from pathlib import Path
from typing import Any

import numpy as np
import torch
from diffusers import ControlNetModel, EulerDiscreteScheduler, StableDiffusionXLControlNetPipeline
from PIL import Image
from safetensors.torch import save_file


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def value_sha256(value: Any) -> str:
    return hashlib.sha256(
        json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()
    ).hexdigest()


def text_sha256(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def parse() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model-root", type=Path, required=True)
    parser.add_argument("--control-root", type=Path, required=True)
    parser.add_argument("--preflight", type=Path, required=True)
    parser.add_argument("--native-config", type=Path, required=True)
    parser.add_argument("--control-manifest", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--branches", type=int, default=3)
    parser.add_argument("--steps", type=int, default=24)
    parser.add_argument("--resume-after-steps", type=int, default=12)
    parser.add_argument("--guidance-scale", type=float, default=7.0)
    parser.add_argument("--control-scale", type=float, default=0.75)
    parser.add_argument("--negative-prompt", default="deformed, distorted, duplicate, text, watermark, low quality")
    return parser.parse_args()


def required_file(repository: dict[str, Any], path: str) -> dict[str, Any]:
    return next(item for item in repository["files"] if item["path"] == path)


def save_tensor(path: Path, tensor: torch.Tensor, role: str) -> dict[str, Any]:
    contiguous = tensor.detach().to("cpu").contiguous()
    save_file({"tensor": contiguous}, str(path), metadata={"role": role, "dtype": str(contiguous.dtype)})
    return {
        "path": path.name,
        "sha256": file_sha256(path),
        "format": "safetensors",
        "key": "tensor",
        "dtype": str(contiguous.dtype).removeprefix("torch."),
        "shape": list(contiguous.shape),
    }


def main() -> None:
    args = parse()
    if args.branches < 2 or args.branches > 8:
        raise RuntimeError("NATIVE_TEACHER_BRANCH_COUNT")
    if args.resume_after_steps < 1 or args.resume_after_steps >= args.steps:
        raise RuntimeError("NATIVE_TEACHER_RESUME_STEP")
    preflight = json.loads(args.preflight.read_text())
    native_config = json.loads(args.native_config.read_text())
    control_manifest = json.loads(args.control_manifest.read_text())
    control_root = args.control_manifest.parent
    request_path = control_root / control_manifest["request"]["path"]
    depth_path = control_root / control_manifest["depthControl"]["path"]
    tensor_path = control_root / control_manifest["tensor"]["path"]
    request = json.loads(request_path.read_text())
    for path, expected in (
        (request_path, control_manifest["request"]["sha256"]),
        (depth_path, control_manifest["depthControl"]["sha256"]),
        (tensor_path, control_manifest["tensor"]["sha256"]),
    ):
        if file_sha256(path) != expected:
            raise RuntimeError(f"NATIVE_TEACHER_CONTROL_HASH:{path.name}")
    if preflight["verdict"] != "pass":
        raise RuntimeError("NATIVE_TEACHER_PREFLIGHT")
    if native_config["pipeline"]["class"] != "StableDiffusionXLControlNetPipeline":
        raise RuntimeError("NATIVE_TEACHER_PIPELINE")

    base_authority = next(item for item in preflight["repositories"] if item["role"] == "base")
    control_authority = next(item for item in preflight["repositories"] if item["role"] == "depth-control")
    args.output.mkdir(parents=True, exist_ok=True)
    started = time.perf_counter()
    torch.cuda.reset_peak_memory_stats()

    controlnet = ControlNetModel.from_pretrained(
        args.control_root,
        torch_dtype=torch.float16,
        use_safetensors=True,
        local_files_only=True,
    )
    pipeline = StableDiffusionXLControlNetPipeline.from_pretrained(
        args.model_root,
        controlnet=controlnet,
        torch_dtype=torch.float16,
        use_safetensors=True,
        local_files_only=True,
    )
    pipeline.scheduler = EulerDiscreteScheduler.from_config(pipeline.scheduler.config)
    pipeline.enable_model_cpu_offload()
    loaded = time.perf_counter()

    control_image = Image.open(depth_path).convert("RGB")
    width, height = control_image.size
    latent_shape = (1, pipeline.unet.config.in_channels, height // pipeline.vae_scale_factor, width // pipeline.vae_scale_factor)
    initial_generator = torch.Generator(device="cuda").manual_seed(request["seed"])
    initial_noise = torch.randn(latent_shape, generator=initial_generator, device="cuda", dtype=torch.float16)
    initial_noise_record = save_tensor(args.output / "initial-noise.safetensors", initial_noise, "initial-noise")
    captured: dict[str, Any] = {}

    def capture_callback(_pipeline, step_index: int, timestep: torch.Tensor, callback_kwargs: dict[str, torch.Tensor]):
        if step_index == args.resume_after_steps - 1:
            captured["latent"] = callback_kwargs["latents"].detach().to("cpu").clone()
            captured["timestep"] = int(timestep.item())
            captured["timesteps"] = [int(value) for value in _pipeline.scheduler.timesteps.detach().cpu().tolist()]
            captured["sigmas"] = [float(value) for value in _pipeline.scheduler.sigmas.detach().cpu().tolist()]
        return callback_kwargs

    common = {
        "prompt": request["prompt"],
        "negative_prompt": args.negative_prompt,
        "image": control_image,
        "width": width,
        "height": height,
        "guidance_scale": args.guidance_scale,
        "controlnet_conditioning_scale": args.control_scale,
        "output_type": "pil",
    }
    baseline_started = time.perf_counter()
    baseline = pipeline(
        **common,
        num_inference_steps=args.steps,
        latents=initial_noise,
        callback_on_step_end=capture_callback,
        callback_on_step_end_tensor_inputs=["latents"],
    ).images[0]
    baseline_path = args.output / "baseline-full.png"
    baseline.save(baseline_path)
    baseline_seconds = time.perf_counter() - baseline_started
    if "latent" not in captured:
        raise RuntimeError("NATIVE_TEACHER_CAPTURE_MISSING")

    anchor = captured["latent"]
    anchor_record = save_tensor(args.output / "anchor-latent.safetensors", anchor, "intermediate-anchor")
    full_timesteps = captured["timesteps"]
    remaining_timesteps = full_timesteps[args.resume_after_steps:]
    if len(remaining_timesteps) != args.steps - args.resume_after_steps:
        raise RuntimeError("NATIVE_TEACHER_REMAINING_TIMESTEPS")
    branches = []
    branch_seconds = []
    for index in range(args.branches):
        branch_seed = (request["seed"] + (index + 1) * 0x9E3779B1) & 0xFFFFFFFF
        perturb_scale = 0.0 if index == 0 else 0.015
        perturb_generator = torch.Generator(device="cuda").manual_seed(branch_seed)
        perturb = torch.randn(anchor.shape, generator=perturb_generator, device="cuda", dtype=torch.float16)
        branch_start = anchor.to("cuda") + perturb * perturb_scale
        branch_start_record = save_tensor(
            args.output / f"branch-{index:02d}-start.safetensors",
            branch_start,
            f"continuation-branch-{index:02d}",
        )
        perturb_record = save_tensor(
            args.output / f"branch-{index:02d}-noise.safetensors",
            perturb,
            f"continuation-noise-{index:02d}",
        )
        pipeline.scheduler = EulerDiscreteScheduler.from_config(pipeline.scheduler.config)
        pipeline.scheduler.set_timesteps(timesteps=remaining_timesteps, device="cuda")
        init_noise_sigma = float(pipeline.scheduler.init_noise_sigma)
        branch_started = time.perf_counter()
        preview = pipeline(
            **common,
            timesteps=remaining_timesteps,
            # The pipeline scales supplied latents by init_noise_sigma. Divide
            # here so its public input contract reconstructs the captured state.
            latents=branch_start / init_noise_sigma,
        ).images[0]
        branch_seconds.append(time.perf_counter() - branch_started)
        preview_path = args.output / f"branch-{index:02d}.png"
        preview.save(preview_path)
        branches.append({
            "id": f"branch-{index:02d}",
            "seed": branch_seed,
            "perturbScale": perturb_scale,
            "noise": perturb_record,
            "startLatent": branch_start_record,
            "decodedPreview": {
                "path": preview_path.name,
                "sha256": file_sha256(preview_path),
                "mimeType": "image/png",
                "width": preview.width,
                "height": preview.height,
            },
            "remainingTimesteps": remaining_timesteps,
        })
        torch.cuda.empty_cache()

    baseline_pixels = np.asarray(baseline, dtype=np.int16)
    resumed_pixels = np.asarray(Image.open(args.output / "branch-00.png").convert("RGB"), dtype=np.int16)
    absolute = np.abs(baseline_pixels - resumed_pixels)
    source_sha256 = file_sha256(Path(__file__))
    scheduler_config = dict(pipeline.scheduler.config)
    manifest_base = {
        "schemaVersion": "glyph-native-teacher-latent/v1",
        "id": f"native-teacher/{control_manifest['contentSha256'][:16]}-{request['seed']}",
        "contentSha256": "",
        "disposition": "actual-pinned-sdxl-depth-controlnet-intermediate-capture",
        "authority": {
            "nativeConfig": {"path": args.native_config.name, "sha256": file_sha256(args.native_config)},
            "preflight": {
                "path": args.preflight.name,
                "sha256": file_sha256(args.preflight),
                "contentSha256": preflight["contentSha256"],
                "treeSha256": preflight["treeSha256"],
            },
            "model": {
                "pipelineClass": native_config["pipeline"]["class"],
                "dtype": native_config["pipeline"]["runtimeDtype"],
                "base": {
                    "repository": base_authority["repository"],
                    "revision": base_authority["resolvedRevision"],
                    "treeSha256": base_authority["treeSha256"],
                    "unetSha256": required_file(base_authority, "unet/diffusion_pytorch_model.safetensors")["sha256"],
                    "textEncoderSha256": required_file(base_authority, "text_encoder/model.safetensors")["sha256"],
                    "textEncoder2Sha256": required_file(base_authority, "text_encoder_2/model.safetensors")["sha256"],
                },
                "controlnet": {
                    "repository": control_authority["repository"],
                    "revision": control_authority["resolvedRevision"],
                    "treeSha256": control_authority["treeSha256"],
                    "weightsSha256": required_file(control_authority, "diffusion_pytorch_model.safetensors")["sha256"],
                    "conditioning": "stock-depth-only",
                },
            },
            "vae": {
                "class": pipeline.vae.__class__.__name__,
                "configSha256": required_file(base_authority, "vae/config.json")["sha256"],
                "weightsSha256": required_file(base_authority, "vae/diffusion_pytorch_model.safetensors")["sha256"],
                "scalingFactor": float(pipeline.vae.config.scaling_factor),
                "vaeScaleFactor": int(pipeline.vae_scale_factor),
                "forceUpcast": bool(pipeline.vae.config.force_upcast),
            },
            "scheduler": {
                "class": pipeline.scheduler.__class__.__name__,
                "sourceConfigSha256": required_file(base_authority, "scheduler/scheduler_config.json")["sha256"],
                "resolvedConfigSha256": value_sha256(scheduler_config),
                "steps": args.steps,
                "fullTimesteps": full_timesteps,
                "fullSigmas": captured["sigmas"],
            },
            "timestep": {
                "captureAfterSteps": args.resume_after_steps,
                "capturedTimestep": captured["timestep"],
                "nextTimestep": remaining_timesteps[0],
                "remainingTimesteps": remaining_timesteps,
            },
            "scaling": {
                "anchorDtype": anchor_record["dtype"],
                "anchorShape": anchor_record["shape"],
                "continuationInputRule": "exact branchStart bypasses initial-noise-only scaling in pipeline prepare_latents",
                "branchInitNoiseSigma": init_noise_sigma,
                "branchPerturbScale": 0.015,
            },
            "prompt": {
                "text": request["prompt"],
                "sha256": text_sha256(request["prompt"]),
                "negativeText": args.negative_prompt,
                "negativeSha256": text_sha256(args.negative_prompt),
                "styleId": request["styleId"],
                "guidanceScale": args.guidance_scale,
            },
            "control": {
                "manifestContentSha256": control_manifest["contentSha256"],
                "requestSha256": control_manifest["request"]["sha256"],
                "scene": control_manifest["scene"],
                "tensor": control_manifest["tensor"],
                "depthControl": control_manifest["depthControl"],
                "controlnetConditioningScale": args.control_scale,
                "camera": request["controls"]["camera"],
            },
            "noise": {
                "algorithm": "torch.Generator(cuda).manual_seed",
                "initialSeed": request["seed"],
                "initialNoise": initial_noise_record,
                "branchSeeds": [branch["seed"] for branch in branches],
            },
            "captureCode": {"sha256": source_sha256},
            "container": {"digest": os.environ.get("GLYPH_IMAGE_DIGEST")},
        },
        "anchor": {
            "latent": anchor_record,
            "resume": {
                "schedulerClass": pipeline.scheduler.__class__.__name__,
                "nextTimestep": remaining_timesteps[0],
                "remainingTimesteps": remaining_timesteps,
            },
        },
        "branches": branches,
        "resumeParity": {
            "baselinePreview": {
                "path": baseline_path.name,
                "sha256": file_sha256(baseline_path),
                "width": baseline.width,
                "height": baseline.height,
            },
            "unperturbedBranchPreviewSha256": branches[0]["decodedPreview"]["sha256"],
            "exactImageSha256": file_sha256(baseline_path) == branches[0]["decodedPreview"]["sha256"],
            "meanAbsoluteRgb8": float(absolute.mean()),
            "maximumAbsoluteRgb8": int(absolute.max()),
        },
        "runtime": {
            "gpu": torch.cuda.get_device_name(0),
            "totalVramBytes": int(torch.cuda.get_device_properties(0).total_memory),
            "peakAllocatedBytes": int(torch.cuda.max_memory_allocated()),
            "peakReservedBytes": int(torch.cuda.max_memory_reserved()),
            "python": platform.python_version(),
            "torch": torch.__version__,
            "cuda": torch.version.cuda,
            "diffusers": __import__("diffusers").__version__,
            "loadSeconds": loaded - started,
            "baselineSeconds": baseline_seconds,
            "branchSeconds": branch_seconds,
        },
    }
    manifest = {**manifest_base, "contentSha256": value_sha256({key: value for key, value in manifest_base.items() if key != "contentSha256"})}
    (args.output / "manifest.json").write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n")
    print(json.dumps(manifest, sort_keys=True))


if __name__ == "__main__":
    main()

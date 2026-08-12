#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import json
import math
import os
import platform
import time
from datetime import datetime, timezone
from pathlib import Path


BASE_REVISION = "462165984030d82259a11f4367a4eed129e94a7b"
CONTROL_REVISION = "17bb97973f29801224cd66f192c5ffacf82648b4"


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def canonical(value: object) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--repo-root", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    args = parser.parse_args()
    config_path, repo_root = args.config.resolve(), args.repo_root.resolve()
    config = json.loads(config_path.read_text())
    native_config_path = repo_root / config["nativeReferenceConfig"]
    preflight_path = repo_root / config["nativeReferencePreflight"]
    if digest(native_config_path) != config["nativeReferenceConfigSha256"]:
        raise RuntimeError("B52_FEASIBILITY_NATIVE_CONFIG_HASH")
    preflight = json.loads(preflight_path.read_text())
    if preflight.get("verdict") != "pass":
        raise RuntimeError("B52_FEASIBILITY_PREFLIGHT_REQUIRED")
    repositories = {item["role"]: item for item in preflight["repositories"]}
    if repositories["base"]["revision"] != BASE_REVISION or repositories["depth-control"]["revision"] != CONTROL_REVISION:
        raise RuntimeError("B52_FEASIBILITY_MODEL_AUTHORITY")
    if os.environ.get("GLYPH_IMAGE_DIGEST") != config["runtime"]["imageDigest"]:
        raise RuntimeError("B52_FEASIBILITY_CONTAINER_DIGEST")

    import bitsandbytes as bnb
    import torch
    from diffusers import ControlNetModel

    if not torch.cuda.is_available():
        raise RuntimeError("B52_FEASIBILITY_CUDA_REQUIRED")
    training = config["training"]
    torch.manual_seed(training["seed"])
    torch.cuda.manual_seed_all(training["seed"])
    torch.cuda.reset_peak_memory_stats()
    device = torch.device("cuda")
    control_root = Path(config["modelRoot"]) / "controlnet-depth-sdxl-1.0" / CONTROL_REVISION
    model = ControlNetModel.from_pretrained(
        control_root, torch_dtype=torch.float16, use_safetensors=True, local_files_only=True
    ).to(device)
    model.enable_gradient_checkpointing()
    optimizer = bnb.optim.AdamW8bit(model.parameters(), lr=1e-5)
    latent_size = training["resolution"] // 8
    sample = torch.randn((1, 4, latent_size, latent_size), device=device, dtype=torch.float16)
    control = torch.randn((1, 3, training["resolution"], training["resolution"]), device=device, dtype=torch.float16)
    hidden = torch.randn((1, 77, 2048), device=device, dtype=torch.float16)
    added = {
        "text_embeds": torch.randn((1, 1280), device=device, dtype=torch.float16),
        "time_ids": torch.tensor([[training["resolution"], training["resolution"], 0, 0, training["resolution"], training["resolution"]]], device=device, dtype=torch.float16),
    }
    started = time.perf_counter()
    with torch.autocast("cuda", dtype=torch.float16):
        output = model(sample, torch.tensor([500], device=device), encoder_hidden_states=hidden, controlnet_cond=control, added_cond_kwargs=added)
        loss = sum(value.float().square().mean() for value in output.down_block_res_samples) + output.mid_block_res_sample.float().square().mean()
    torch.cuda.synchronize()
    forwarded = time.perf_counter()
    loss.backward()
    torch.cuda.synchronize()
    backward = time.perf_counter()
    optimizer.step()
    optimizer.zero_grad(set_to_none=True)
    torch.cuda.synchronize()
    finished = time.perf_counter()
    loss_value = float(loss.detach().cpu())
    peak_allocated = torch.cuda.max_memory_allocated()
    peak_reserved = torch.cuda.max_memory_reserved()
    passed = math.isfinite(loss_value) and peak_reserved <= training["maximumPeakVramBytes"]
    report = {
        "schemaVersion": "glyph-native-training-feasibility/v1",
        "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "verdict": "pass" if passed else "fail",
        "authorities": {
            "configSha256": digest(config_path), "nativeReferenceConfigSha256": digest(native_config_path),
            "nativeReferencePreflightSha256": digest(preflight_path), "nativeReferenceTreeSha256": preflight["treeSha256"],
            "baseTreeSha256": repositories["base"]["treeSha256"], "controlTreeSha256": repositories["depth-control"]["treeSha256"],
            "baseRevision": BASE_REVISION, "controlRevision": CONTROL_REVISION,
            "containerDigest": config["runtime"]["imageDigest"],
        },
        "training": training,
        "runtime": {
            "gpu": torch.cuda.get_device_name(0), "totalVramBytes": torch.cuda.get_device_properties(0).total_memory,
            "python": platform.python_version(), "torch": torch.__version__, "cuda": str(torch.version.cuda),
            "diffusers": importlib.metadata.version("diffusers"), "bitsandbytes": importlib.metadata.version("bitsandbytes"),
        },
        "measurement": {
            "loss": loss_value, "forwardSeconds": forwarded - started, "backwardSeconds": backward - forwarded,
            "stepSeconds": finished - started, "peakAllocatedBytes": peak_allocated, "peakReservedBytes": peak_reserved,
        },
    }
    report["contentSha256"] = hashlib.sha256(canonical(report)).hexdigest()
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, indent=2) + "\n")
    if not passed:
        raise RuntimeError("B52_FEASIBILITY_LIMIT_FAILED")


if __name__ == "__main__":
    main()

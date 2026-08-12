from __future__ import annotations

import argparse
import importlib.util
import json
import math
import os
import random
import subprocess
from pathlib import Path
from typing import Any

from eval_control import build_render_pipeline, evaluate_matrix, intervention_controls, render_intervention_contact_sheet
from overfit_contract import OverfitContractError, canonical_sha256, inverse_projection_correspondence, load_live_selection, required_interventions, score_evaluation, sha256_file, validate_config
from sdxl_controlnet import ARCHITECTURE_ID, foreground_noise_mse, load_native_controlnet
from training_raster import expand_training_inputs


def verify_native_inventory(repo_root: Path, config: dict[str, Any]) -> None:
    script = repo_root / "scripts/freeze-native-reference.py"
    spec = importlib.util.spec_from_file_location("b12_freeze_native_reference", script)
    module = importlib.util.module_from_spec(spec)
    if spec.loader is None:
        raise OverfitContractError("B12_NATIVE_INVENTORY_CHECKER")
    spec.loader.exec_module(module)
    module.verify(
        repo_root / config["authorities"]["nativeReferenceModel"],
        Path(config["authorities"]["nativeReferenceRoot"]),
        repo_root / config["authorities"]["nativeReferencePreflight"],
        repo_root / "schema/native-reference-model.schema.json",
    )


def verify_b11_authority(repo_root: Path, config: dict[str, Any]) -> None:
    dataset_root = Path(config["dataset"]["root"])
    manifest = dataset_root / config["dataset"]["manifest"]
    try:
        subprocess.run(
            ["node", str(repo_root / "scripts/validate-pilot.mjs"), str(dataset_root), "--report", str(manifest), "--check"],
            check=True, capture_output=True, text=True,
        )
    except (OSError, subprocess.CalledProcessError) as error:
        raise OverfitContractError(f"B12_B11_AUTHORITY_INVALID:{getattr(error, 'stderr', '')}") from error


def verify_objective_smoke(repo_root: Path, config_path: Path, config: dict[str, Any]) -> None:
    path = Path(config["runtime"]["containerArtifactRoot"]) / "smoke/b12-objective/b12-objective-smoke.json"
    if not path.is_file():
        raise OverfitContractError("B12_OBJECTIVE_SMOKE_REQUIRED")
    report = json.loads(path.read_text())
    from jsonschema import Draft202012Validator
    Draft202012Validator(json.loads((repo_root / "schema/b12-objective-smoke.schema.json").read_text())).validate(report)
    if canonical_sha256(report, "contentSha256") != report.get("contentSha256") or report.get("configSha256") != sha256_file(config_path) or report.get("nativeReferencePreflightSha256") != config["authorities"]["nativeReferencePreflightSha256"]:
        raise OverfitContractError("B12_OBJECTIVE_SMOKE_AUTHORITY")
    if report["peakAllocatedBytes"] > report["peakReservedBytes"] or report["peakReservedBytes"] > report["maximumPeakVramBytes"]:
        raise OverfitContractError("B12_OBJECTIVE_SMOKE_VRAM")


def load_runtime() -> tuple[Any, ...]:
    try:
        import bitsandbytes as bnb
        import numpy as np
        import torch
        from diffusers import ControlNetModel, DDPMScheduler, StableDiffusionXLControlNetPipeline, StableDiffusionXLPipeline
        from PIL import Image
        from safetensors.torch import load_file, save_file
    except ImportError as error:
        raise OverfitContractError(f"B12_RUNTIME_DEPENDENCY_MISSING:{error.name}") from error
    return bnb, np, torch, ControlNetModel, DDPMScheduler, StableDiffusionXLControlNetPipeline, StableDiffusionXLPipeline, Image, load_file, save_file


def authority_bindings(config_path: Path, config: dict[str, Any], data: dict[str, Any]) -> dict[str, str]:
    return {
        "configSha256": sha256_file(config_path),
        "tensorContractSha256": config["authorities"]["tensorContractSha256"],
        "nativeReferenceModelSha256": config["authorities"]["nativeReferenceModelSha256"],
        "nativeReferencePreflightSha256": config["authorities"]["nativeReferencePreflightSha256"],
        "measurementContractSha256": config["authorities"]["measurementContractSha256"],
        "dataManifestSha256": data["manifestSha256"],
        "dataSelectionSha256": data["selectionSha256"],
    }


def prepared_components(prepared: list[tuple[Any, Any, Any, Any, dict[str, Any]]], index: int) -> tuple[Any, Any, Any, Any]:
    sample = prepared[index]
    if len(sample) != 5:
        raise OverfitContractError("B12_PREPARED_SAMPLE_ARITY")
    control, latent, prompt, pooled, _expansion = sample
    return control, latent, prompt, pooled


def checkpoint(run_root: Path, controlnet: Any, optimizer: Any, scaler: Any, step: int, accumulation: int, losses: list[float], bindings: dict[str, str], torch: Any, save_file: Any) -> tuple[Path, Path]:
    model_path = run_root / "checkpoints" / f"step-{step:06d}" / "controlnet.safetensors"
    state_path = model_path.with_name("training-state.pt")
    model_path.parent.mkdir(parents=True, exist_ok=True)
    save_file({key: value.detach().cpu().contiguous() for key, value in controlnet.state_dict().items()}, str(model_path))
    torch.save({"schemaVersion": "glyph-sdxl-controlnet-state/v1", "optimizerStep": step, "microstep": step * accumulation, "gradientAccumulationSteps": accumulation, "losses": losses, "bindings": bindings, "optimizer": optimizer.state_dict(), "scaler": scaler.state_dict()}, state_path)
    latest = {
        "schemaVersion": "glyph-sdxl-controlnet-latest/v1", "optimizerStep": step, "microstep": step * accumulation, "gradientAccumulationSteps": accumulation,
        "modelPath": model_path.relative_to(run_root).as_posix(), "modelSha256": sha256_file(model_path),
        "statePath": state_path.relative_to(run_root).as_posix(), "stateSha256": sha256_file(state_path),
        "bindings": bindings,
    }
    (run_root / "latest.json").write_text(json.dumps(latest, sort_keys=True) + "\n")
    return model_path, state_path


def resume_checkpoint(root: Path, controlnet: Any, optimizer: Any, scaler: Any, accumulation: int, bindings: dict[str, str], torch: Any, load_file: Any) -> tuple[int, list[float]]:
    latest = json.loads((root / "latest.json").read_text())
    if latest.get("bindings") != bindings:
        raise OverfitContractError("B12_RESUME_BINDING_MISMATCH")
    model_path, state_path = root / latest["modelPath"], root / latest["statePath"]
    if sha256_file(model_path) != latest["modelSha256"] or sha256_file(state_path) != latest["stateSha256"]:
        raise OverfitContractError("B12_RESUME_HASH_MISMATCH")
    controlnet.load_state_dict(load_file(str(model_path), device="cpu"))
    state = torch.load(state_path, map_location="cpu", weights_only=False)
    if state.get("bindings") != bindings or state.get("optimizerStep") != latest.get("optimizerStep") or state.get("microstep") != state.get("optimizerStep") * accumulation or state.get("gradientAccumulationSteps") != accumulation:
        raise OverfitContractError("B12_RESUME_STATE_MISMATCH")
    losses = state.get("losses")
    if not isinstance(losses, list) or len(losses) != state["optimizerStep"] or any(not isinstance(value, (int, float)) or not math.isfinite(value) for value in losses):
        raise OverfitContractError("B12_RESUME_LOSS_HISTORY_MISMATCH")
    optimizer.load_state_dict(state["optimizer"])
    scaler.load_state_dict(state["scaler"])
    return int(state["optimizerStep"]), [float(value) for value in losses]


def prepare_sample(entry: dict[str, Any], tensor: dict[str, Any], model_raster: dict[str, Any], training_raster: dict[str, Any], pipeline: Any, device: Any, np: Any, torch: Any, Image: Any) -> tuple[Any, Any, Any, Any, dict[str, Any]]:
    control, image, evidence = expand_training_inputs(entry, tensor, model_raster, training_raster, device, np, torch, Image)
    pixels = torch.from_numpy(np.asarray(image, dtype=np.float32).copy()).permute(2, 0, 1).unsqueeze(0).to(device)
    pixels = pixels / 127.5 - 1
    with torch.no_grad(), torch.autocast("cuda", dtype=torch.float16):
        latent = pipeline.vae.encode(pixels.to(dtype=torch.float16)).latent_dist.sample() * pipeline.vae.config.scaling_factor
        prompt, _, pooled, _ = pipeline.encode_prompt(prompt=[entry["prompt"]], device=device, do_classifier_free_guidance=False)
    return control.to(dtype=torch.float16), latent.detach(), prompt.detach(), pooled.detach(), evidence


def run(args: argparse.Namespace) -> None:
    repo_root, config_path = Path(args.repo_root).resolve(), Path(args.config).resolve()
    config, tensor, derivation = validate_config(config_path, repo_root)
    if config["architecture"]["id"] != ARCHITECTURE_ID:
        raise OverfitContractError("B12_SDXL_ARCHITECTURE_REQUIRED")
    verify_native_inventory(repo_root, config)
    verify_b11_authority(repo_root, config)
    # This is intentionally before runtime/model allocation: absent B11 data can
    # never fall through to synthetic or historical compact-model training.
    selection, data = load_live_selection(config, tensor)
    if args.preallocation_check:
        print(json.dumps({
            "schemaVersion": "glyph-b12-preallocation-check/v1",
            "status": "pass",
            "node": subprocess.run(["node", "--version"], check=True, capture_output=True, text=True).stdout.strip(),
            "manifestSha256": data["manifestSha256"],
            "selectionSha256": data["selectionSha256"],
            "frameCount": data["frameCount"],
            "cameraIds": sorted({entry["cameraId"] for entry in selection}),
        }, sort_keys=True))
        return
    artifact_root = Path(config["runtime"]["containerArtifactRoot"])
    run_root = artifact_root / ("smoke/b12-objective" if args.smoke_one_optimizer_step else f"runs/{config['runId']}")
    if not args.smoke_one_optimizer_step:
        verify_objective_smoke(repo_root, config_path, config)
    bnb, np, torch, ControlNetModel, DDPMScheduler, StableDiffusionXLControlNetPipeline, StableDiffusionXLPipeline, Image, load_file, save_file = load_runtime()
    if not torch.cuda.is_available():
        raise OverfitContractError("B12_CUDA_REQUIRED")
    random.seed(config["seed"]); np.random.seed(config["seed"]); torch.manual_seed(config["seed"])
    torch.cuda.manual_seed_all(config["seed"]); torch.cuda.reset_peak_memory_stats()
    device = torch.device("cuda")
    root = Path(config["authorities"]["nativeReferenceRoot"])
    base_revision = "462165984030d82259a11f4367a4eed129e94a7b"
    control_revision = "17bb97973f29801224cd66f192c5ffacf82648b4"
    pipeline = StableDiffusionXLPipeline.from_pretrained(root / "sdxl-base-1.0" / base_revision, torch_dtype=torch.float16, use_safetensors=True, local_files_only=True)
    controlnet = load_native_controlnet(root / "controlnet-depth-sdxl-1.0" / control_revision, tensor, torch, ControlNetModel).to(device)
    for module in (pipeline.vae, pipeline.text_encoder, pipeline.text_encoder_2, pipeline.unet):
        module.requires_grad_(False).eval()
    pipeline.vae.to(device); pipeline.text_encoder.to(device); pipeline.text_encoder_2.to(device)
    optimizer = bnb.optim.AdamW8bit(controlnet.parameters(), lr=config["training"]["learningRate"])
    scaler = torch.amp.GradScaler("cuda", enabled=True)
    scheduler = DDPMScheduler.from_config(pipeline.scheduler.config)
    prepared = [prepare_sample(entry, tensor, config["modelRaster"], config["trainingRaster"], pipeline, device, np, torch, Image) for entry in selection]
    data = {**data, "rasterExpansion": [item[4] for item in prepared]}
    with torch.no_grad():
        empty, _, empty_pooled, _ = pipeline.encode_prompt(prompt=[""], device=device, do_classifier_free_guidance=False)
    pipeline.vae.to("cpu"); pipeline.text_encoder.to("cpu"); pipeline.text_encoder_2.to("cpu")
    torch.cuda.empty_cache()
    pipeline.unet.to(device)
    pipeline.unet.enable_gradient_checkpointing()
    pipeline.enable_attention_slicing()
    bindings = authority_bindings(config_path, config, data)
    start, losses = (resume_checkpoint(Path(args.resume), controlnet, optimizer, scaler, config["training"]["gradientAccumulationSteps"], bindings, torch, load_file) if args.resume else (0, []))
    accumulation = config["training"]["gradientAccumulationSteps"]
    optimizer.zero_grad(set_to_none=True)
    max_optimizer_steps = 1 if args.smoke_one_optimizer_step else config["training"]["maxSteps"]
    for optimizer_step in range(start, max_optimizer_steps):
        accumulated_loss = 0.0
        for accumulation_index in range(accumulation):
            microstep = optimizer_step * accumulation + accumulation_index
            control, latent, prompt, pooled = prepared_components(prepared, microstep % len(prepared))
            generator = torch.Generator(device=device).manual_seed(config["seed"] + microstep)
            noise = torch.randn(latent.shape, generator=generator, device=device, dtype=latent.dtype)
            timestep = torch.randint(0, scheduler.config.num_train_timesteps, (1,), generator=generator, device=device)
            noisy = scheduler.add_noise(latent, noise, timestep)
            size = config["training"]["resolution"]
            added = {"text_embeds": pooled, "time_ids": torch.tensor([[size, size, 0, 0, size, size]], device=device, dtype=prompt.dtype)}
            with torch.autocast("cuda", dtype=torch.float16):
                residuals = controlnet(noisy, timestep, encoder_hidden_states=prompt, controlnet_cond=control, added_cond_kwargs=added, return_dict=True)
                prediction = pipeline.unet(noisy, timestep, encoder_hidden_states=prompt, added_cond_kwargs=added, down_block_additional_residuals=residuals.down_block_res_samples, mid_block_additional_residual=residuals.mid_block_res_sample).sample
                loss = foreground_noise_mse(prediction, noise, control, torch) / accumulation
            if not torch.isfinite(loss):
                raise OverfitContractError("B12_NONFINITE_TRAINING_LOSS")
            scaler.scale(loss).backward()
            accumulated_loss += float(loss.detach().cpu())
        scaler.unscale_(optimizer)
        torch.nn.utils.clip_grad_norm_(controlnet.parameters(), config["training"]["maxGradNorm"])
        scaler.step(optimizer); scaler.update(); optimizer.zero_grad(set_to_none=True)
        losses.append(accumulated_loss)
        completed = optimizer_step + 1
        if completed % config["training"]["checkpointEvery"] == 0 or completed == max_optimizer_steps:
            model_path, state_path = checkpoint(run_root, controlnet, optimizer, scaler, completed, accumulation, losses, bindings, torch, save_file)
    torch.cuda.synchronize()
    if args.smoke_one_optimizer_step:
        peak_allocated = torch.cuda.max_memory_allocated()
        peak_reserved = torch.cuda.max_memory_reserved()
        smoke = {
            "schemaVersion": "glyph-b12-objective-smoke/v1", "objective": "sdxl-controlnet-to-frozen-unet-noise-prediction/v1",
            "resolution": config["training"]["resolution"], "optimizerSteps": 1,
            "microsteps": accumulation, "loss": losses[-1],
            "peakAllocatedBytes": peak_allocated, "peakReservedBytes": peak_reserved,
            "maximumPeakVramBytes": config["training"]["objectiveSmokePeakVramBytesMax"],
            "gpu": torch.cuda.get_device_name(0), "configSha256": sha256_file(config_path),
            "nativeReferencePreflightSha256": config["authorities"]["nativeReferencePreflightSha256"],
            "containerDigest": os.environ["GLYPH_IMAGE_DIGEST"],
            "verdict": "pass" if peak_reserved <= config["training"]["objectiveSmokePeakVramBytesMax"] else "fail",
        }
        smoke["contentSha256"] = canonical_sha256(smoke, "contentSha256")
        (run_root / "b12-objective-smoke.json").write_text(json.dumps(smoke, sort_keys=True) + "\n")
        if smoke["verdict"] != "pass":
            raise OverfitContractError("B12_OBJECTIVE_SMOKE_VRAM")
        return
    controls = [item[0].squeeze(0) for item in prepared]
    latents = [item[1] for item in prepared]
    prompts = [item[2] for item in prepared]
    pooled = [item[3] for item in prepared]
    raw = evaluate_matrix(
        controlnet=controlnet, unet=pipeline.unet, scheduler=scheduler, samples=selection,
        controls=controls, latents=latents, prompt_embeddings=prompts,
        pooled_embeddings=pooled, empty_prompt_embedding=(empty, empty_pooled),
        contract=tensor, config=config, torch=torch,
    )
    evaluation = score_evaluation(raw, derivation, required_interventions(tensor))
    transformed = {identifier: intervention_controls(identifier, controls, tensor, config["evaluation"]["seed"], selection) for identifier in required_interventions(tensor)}
    render_pipeline = build_render_pipeline(pipeline, controlnet, StableDiffusionXLControlNetPipeline)
    pipeline.unet.to("cpu")
    controlnet.to("cpu")
    torch.cuda.empty_cache()
    render_pipeline.enable_model_cpu_offload()
    render_hashes = render_intervention_contact_sheet(
        render_pipeline, transformed, controls, [entry["prompt"] for entry in selection],
        [f"{entry['trajectoryId']}--{entry['frame']['id']}" for entry in selection],
        run_root / "evaluation", Path(config["runtime"]["containerArtifactRoot"]),
        config["evaluation"]["seed"], torch, Image,
    )
    torch.cuda.synchronize()
    peak_allocated = torch.cuda.max_memory_allocated() / 1024**2
    peak_reserved = torch.cuda.max_memory_reserved() / 1024**2
    status = "pass" if evaluation["allMarginsPass"] and peak_reserved <= derivation["thresholds"]["peakVramMiBMax"] else "fail"
    checkpoint_record = {
        "modelPath": model_path.relative_to(Path(config["runtime"]["containerArtifactRoot"])).as_posix(),
        "modelSha256": sha256_file(model_path),
        "statePath": state_path.relative_to(Path(config["runtime"]["containerArtifactRoot"])).as_posix(),
        "stateSha256": sha256_file(state_path),
        "resumedFrom": args.resume,
        "resumeIntegrity": True,
    }
    report = {
        "schemaVersion": "glyph-overfit-keyframe-report/v1", "runId": config["runId"],
        "status": status, "acceptanceEligible": True, "synthetic": False,
        "authorities": {
            **{key: bindings[key] for key in ("configSha256", "tensorContractSha256", "nativeReferenceModelSha256", "nativeReferencePreflightSha256", "measurementContractSha256")},
            "causalityDerivationSha256": sha256_file(repo_root / config["authorities"]["causalityDerivation"]),
            "containerDigest": os.environ["GLYPH_IMAGE_DIGEST"],
        },
        "data": data,
        "runtime": {
            "gpu": torch.cuda.get_device_name(0), "totalVramMiB": torch.cuda.get_device_properties(0).total_memory / 1024**2,
            "peakAllocatedMiB": peak_allocated, "peakReservedMiB": peak_reserved,
            "torch": torch.__version__, "cuda": str(torch.version.cuda),
        },
        "training": {
            "architecture": ARCHITECTURE_ID, "mixedPrecision": config["training"]["mixedPrecision"],
            "gradientCheckpointing": True, "optimizer": "adamw8bit", "batchSize": 1,
            "gradientAccumulationSteps": accumulation, "maxSteps": config["training"]["maxSteps"],
            "completedSteps": len(losses), "completedMicrosteps": len(losses) * accumulation,
            "seed": config["seed"], "losses": losses,
        },
        "checkpoint": checkpoint_record,
        "evaluation": {
            **evaluation, "scoreRegion": "coverage-foreground-only",
            "inverseProjection": inverse_projection_correspondence(selection),
            "silhouette": [
                {"sampleId": f"{entry['trajectoryId']}--{entry['frame']['id']}", "coverageSha256": evidence["coverageSha256"], "score": 1}
                for entry, evidence in zip(selection, data["rasterExpansion"], strict=True)
            ],
            "artifacts": render_hashes,
        },
        "commands": {
            "run": "research/ascii-image-generation/scripts/train-remote.sh --config research/ascii-image-generation/config/overfit-keyframe.yaml",
            "resume": f"research/ascii-image-generation/scripts/train-remote.sh --config research/ascii-image-generation/config/overfit-keyframe.yaml --resume /artifacts/runs/{config['runId']}",
            "verify": "research/ascii-image-generation/scripts/train-remote.sh --verify-report research/ascii-image-generation/reports/overfit-keyframe.json",
        },
    }
    report["reportSha256"] = canonical_sha256(report, "reportSha256")
    (run_root / "overfit-keyframe.json").write_text(json.dumps(report, sort_keys=True) + "\n")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", required=True)
    parser.add_argument("--repo-root", required=True)
    parser.add_argument("--resume")
    parser.add_argument("--smoke-one-optimizer-step", action="store_true")
    parser.add_argument("--preallocation-check", action="store_true")
    run(parser.parse_args())


if __name__ == "__main__":
    main()

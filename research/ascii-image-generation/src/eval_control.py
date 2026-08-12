from __future__ import annotations

import argparse
import copy
import json
import math
from pathlib import Path
from typing import Any

from overfit_contract import (
    OverfitContractError,
    keyframe_slices,
    required_interventions,
    synthetic_wiring_report,
    validate_config,
    validate_report,
)
import hashlib
from sdxl_controlnet import foreground_noise_mse


def derangement(length: int, seed: int) -> list[int]:
    if length < 2:
        raise OverfitContractError("B12_SHUFFLE_REQUIRES_MULTIPLE_SAMPLES")
    shift = seed % (length - 1) + 1
    return [(index + shift) % length for index in range(length)]


def camera_derangement(samples: list[dict[str, Any]], seed: int) -> list[int]:
    if len(samples) < 2 or any(sample.get("cameraId") is None for sample in samples):
        raise OverfitContractError("B12_WRONG_CAMERA_DONOR_UNAVAILABLE")
    order = list(range(len(samples)))
    shift = seed % len(order)
    order = order[shift:] + order[:shift]
    donors = [-1] * len(samples)

    def assign(index: int, available: set[int]) -> bool:
        if index == len(samples):
            return True
        for donor in order:
            if donor in available and donor != index and samples[donor]["cameraId"] != samples[index]["cameraId"]:
                donors[index] = donor
                if assign(index + 1, available - {donor}):
                    return True
        return False

    if assign(0, set(order)):
        return donors
    raise OverfitContractError("B12_WRONG_CAMERA_DONOR_UNAVAILABLE")


def evaluation_coverage(controls: list[Any], index: int) -> Any:
    """Return the unmodified correct-sample mask for every causal intervention."""
    value = controls[index]
    return value.unsqueeze(0) if value.ndim == 3 else value


def intervention_controls(identifier: str, controls: list[Any], contract: dict[str, Any], seed: int, samples: list[dict[str, Any]] | None = None) -> tuple[list[Any], str]:
    result = [value.clone() if hasattr(value, "clone") else copy.deepcopy(value) for value in controls]
    prompt_mode = "original"
    slices = keyframe_slices(contract)
    if identifier == "correct-controls":
        return result, prompt_mode
    if identifier == "prompt-only":
        return [value * 0 for value in result], prompt_mode
    if identifier == "all-controls-removed":
        return [value * 0 for value in result], "empty"
    if identifier.startswith("leave-out/"):
        start, end = slices[identifier.removeprefix("leave-out/")]
        for value in result:
            value[start:end] = 0
        return result, prompt_mode
    if identifier.startswith("shuffle/"):
        start, end = slices[identifier.removeprefix("shuffle/")]
        donors = derangement(len(result), seed + start)
        original = controls
        for index, donor in enumerate(donors):
            result[index][start:end] = original[donor][start:end]
        return result, prompt_mode
    if identifier == "wrong-camera":
        if samples is None or len(samples) != len(result):
            raise OverfitContractError("B12_WRONG_CAMERA_METADATA_REQUIRED")
        donors = camera_derangement(samples, seed + 97)
        return [controls[donor].clone() if hasattr(controls[donor], "clone") else copy.deepcopy(controls[donor]) for donor in donors], prompt_mode
    if identifier == "wrong-dictionary":
        semantic_start, semantic_end = slices["semantic-glyph"]
        color_start, color_end = slices["semantic-control-color"]
        for value in result:
            value[semantic_start:semantic_end] = 1 - value[semantic_start:semantic_end]
            value[color_start:color_end] = value[color_start:color_end].flip(0) if hasattr(value[color_start:color_end], "flip") else list(reversed(value[color_start:color_end]))
        return result, prompt_mode
    raise OverfitContractError(f"B12_UNKNOWN_INTERVENTION:{identifier}")


def evaluate_matrix(
    *,
    controlnet: Any,
    unet: Any,
    scheduler: Any,
    samples: list[dict[str, Any]],
    controls: list[Any],
    latents: list[Any],
    prompt_embeddings: list[Any],
    pooled_embeddings: list[Any],
    empty_prompt_embedding: tuple[Any, Any],
    contract: dict[str, Any],
    config: dict[str, Any],
    torch: Any,
) -> dict[str, list[float]]:
    required = required_interventions(contract)
    if required != config["evaluation"]["requiredInterventions"]:
        raise OverfitContractError("B12_INTERVENTION_MATRIX")
    timestep_value = config["evaluation"]["timestep"]
    generator = torch.Generator(device=latents[0].device).manual_seed(config["evaluation"]["seed"])
    noises = [torch.randn(value.shape, generator=generator, device=value.device, dtype=value.dtype) for value in latents]
    transformed = {identifier: intervention_controls(identifier, controls, contract, config["evaluation"]["seed"], samples) for identifier in required}
    intervention_fingerprints(transformed)
    losses: dict[str, list[float]] = {identifier: [] for identifier in required}
    controlnet.eval()
    for identifier in required:
        condition_values, prompt_mode = transformed[identifier]
        for index, sample in enumerate(samples):
            timestep = torch.tensor([timestep_value], device=latents[index].device, dtype=torch.long)
            noisy = scheduler.add_noise(latents[index], noises[index], timestep)
            condition = condition_values[index].unsqueeze(0) if condition_values[index].ndim == 3 else condition_values[index]
            embedding, pooled = empty_prompt_embedding if prompt_mode == "empty" else (prompt_embeddings[index], pooled_embeddings[index])
            size = config["training"]["resolution"]
            added = {"text_embeds": pooled, "time_ids": torch.tensor([[size, size, 0, 0, size, size]], device=noisy.device, dtype=embedding.dtype)}
            with torch.no_grad(), torch.autocast(device_type="cuda", dtype=torch.float16):
                residuals = controlnet(noisy, timestep, encoder_hidden_states=embedding, controlnet_cond=condition, added_cond_kwargs=added, return_dict=True)
                prediction = unet(noisy, timestep, encoder_hidden_states=embedding, added_cond_kwargs=added, down_block_additional_residuals=residuals.down_block_res_samples, mid_block_additional_residual=residuals.mid_block_res_sample).sample
            reference_coverage = evaluation_coverage(controls, index)
            loss = foreground_noise_mse(prediction, noises[index], reference_coverage, torch).item()
            if not math.isfinite(loss) or loss < 0:
                raise OverfitContractError("B12_NONFINITE_EVALUATION")
            losses[identifier].append(loss)
    controlnet.train()
    return losses


def intervention_fingerprints(transformed: dict[str, tuple[list[Any], str]]) -> dict[str, str]:
    fingerprints = {}
    per_sample: dict[str, list[str]] = {}
    for identifier, (controls, prompt_mode) in transformed.items():
        digest = hashlib.sha256(prompt_mode.encode())
        sample_hashes = []
        for value in controls:
            raw = value.detach().cpu().contiguous().numpy().tobytes() if hasattr(value, "detach") else repr(value).encode()
            digest.update(raw)
            sample_hashes.append(hashlib.sha256(prompt_mode.encode() + raw).hexdigest())
        fingerprints[identifier] = digest.hexdigest()
        per_sample[identifier] = sample_hashes
    correct = per_sample.get("correct-controls")
    if correct is None or any(len(values) != len(correct) for values in per_sample.values()):
        raise OverfitContractError("B12_INTERVENTION_TAUTOLOGY")
    for index, correct_value in enumerate(correct):
        changed = [values[index] for identifier, values in per_sample.items() if identifier != "correct-controls"]
        if any(value == correct_value for value in changed) or len(set(changed)) != len(changed):
            raise OverfitContractError(f"B12_INTERVENTION_TAUTOLOGY:sample-{index}")
    return fingerprints


def build_render_pipeline(base_pipeline: Any, controlnet: Any, pipeline_class: Any) -> Any:
    rendered = pipeline_class(**base_pipeline.components, controlnet=controlnet)
    for name in ("unet", "vae", "text_encoder", "text_encoder_2"):
        if getattr(rendered, name) is not getattr(base_pipeline, name):
            raise OverfitContractError("B12_RENDER_PIPELINE_DUPLICATED_BASE")
    return rendered


def validate_pipeline_control_tensor(pipeline: Any, control: Any, device: Any, dtype: Any) -> Any:
    prepared = pipeline.prepare_image(
        image=control, width=control.shape[-1], height=control.shape[-2],
        batch_size=1, num_images_per_prompt=1, device=device, dtype=dtype,
        do_classifier_free_guidance=False, guess_mode=False,
    )
    if prepared.ndim != 4 or prepared.shape[1] != 17:
        raise OverfitContractError("B12_PIPELINE_COERCED_CONTROL_CHANNELS")
    return prepared


def render_intervention_contact_sheet(pipeline: Any, transformed: dict[str, tuple[list[Any], str]], alpha_controls: list[Any], prompts: list[str], sample_ids: list[str], output: Path, artifact_root: Path, seed: int, torch: Any, Image: Any) -> dict[str, Any]:
    """Run the real modified SDXL ControlNet and retain every causal PNG."""
    output.mkdir(parents=True, exist_ok=True)
    fingerprints = intervention_fingerprints(transformed)
    images = []
    hashes = {}
    if not prompts or len(prompts) != len(sample_ids) or len(alpha_controls) != len(prompts):
        raise OverfitContractError("B12_EVALUATION_SAMPLE_BINDING")
    for identifier, (controls, prompt_mode) in transformed.items():
        if len(controls) != len(prompts):
            raise OverfitContractError("B12_EVALUATION_SAMPLE_BINDING")
        for sample_index, (control, original_prompt, sample_id) in enumerate(zip(controls, prompts, sample_ids, strict=True)):
            prompt = "" if prompt_mode == "empty" else original_prompt
            generator = torch.Generator(device="cuda").manual_seed(seed + sample_index)
            prepared = validate_pipeline_control_tensor(pipeline, control.unsqueeze(0), control.device, control.dtype)
            image = pipeline(prompt=prompt, image=prepared, num_inference_steps=24, generator=generator).images[0]
            key = f"{identifier}@{sample_id}"
            stem = f"{identifier.replace('/', '--')}--{sample_id.replace('/', '--')}"
            path = output / f"{stem}.rgb.png"
            image.save(path)
            hashes[f"raw/{key}"] = {"path": path.relative_to(artifact_root).as_posix(), "sha256": hashlib.sha256(path.read_bytes()).hexdigest(), "width": image.width, "height": image.height}
            alpha_values = alpha_controls[sample_index][15].detach().float().clamp(0, 1).mul(255).byte().cpu().numpy()
            alpha = Image.fromarray(alpha_values, mode="L").resize(image.size, Image.Resampling.NEAREST)
            transparent = image.convert("RGBA")
            transparent.putalpha(alpha)
            alpha_path = output / f"{stem}.rgba.png"
            transparent.save(alpha_path)
            hashes[f"transparent/{key}"] = {"path": alpha_path.relative_to(artifact_root).as_posix(), "sha256": hashlib.sha256(alpha_path.read_bytes()).hexdigest(), "width": transparent.width, "height": transparent.height}
            images.append(image)
    width, height = images[0].size
    sheet = Image.new("RGB", (width * 5, height * ((len(images) + 4) // 5)))
    for index, image in enumerate(images):
        sheet.paste(image, ((index % 5) * width, (index // 5) * height))
    sheet.save(output / "contact-sheet.png")
    sheet_path = output / "contact-sheet.png"
    hashes["contact-sheet"] = {"path": sheet_path.relative_to(artifact_root).as_posix(), "sha256": hashlib.sha256(sheet_path.read_bytes()).hexdigest(), "width": sheet.width, "height": sheet.height}
    fingerprint_path = output / "intervention-fingerprints.json"
    fingerprint_path.write_text(json.dumps(fingerprints, sort_keys=True) + "\n")
    hashes["intervention-fingerprints"] = {"path": fingerprint_path.relative_to(artifact_root).as_posix(), "sha256": hashlib.sha256(fingerprint_path.read_bytes()).hexdigest(), "width": 0, "height": 0}
    return hashes


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--verify-report")
    parser.add_argument("--config", default="research/ascii-image-generation/config/overfit-keyframe.yaml")
    parser.add_argument("--repo-root", default=".")
    parser.add_argument("--artifact-root")
    parser.add_argument("--synthetic-wiring-check", action="store_true")
    args = parser.parse_args()
    repo_root = Path(args.repo_root).resolve()
    config_path = Path(args.config).resolve()
    if args.synthetic_wiring_check:
        print(json.dumps(synthetic_wiring_report(config_path, repo_root), sort_keys=True))
        return
    if not args.verify_report:
        parser.error("--verify-report is required unless --synthetic-wiring-check is used")
    report = validate_report(Path(args.verify_report).resolve(), config_path, repo_root, Path(args.artifact_root).resolve() if args.artifact_root else None)
    print(json.dumps({"status": report["status"], "runId": report["runId"], "reportSha256": report["reportSha256"]}, sort_keys=True))


if __name__ == "__main__":
    main()

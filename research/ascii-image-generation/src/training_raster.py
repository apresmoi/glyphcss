from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

from model_raster import controls_to_model, target_to_model, validate_control_metadata, validate_target_metadata


def nearest_expand_plane_u8(source: bytes, source_width: int, source_height: int, width: int, height: int) -> bytes:
    if len(source) != source_width * source_height or width % source_width or height % source_height:
        raise ValueError("B12_NEAREST_PLANE_SHAPE")
    scale_x, scale_y = width // source_width, height // source_height
    return bytes(
        source[(y // scale_y) * source_width + (x // scale_x)]
        for y in range(height) for x in range(width)
    )


def foreground_mse_values(prediction: list[float], target: list[float], coverage: list[int]) -> float:
    if len(prediction) != len(target) or len(prediction) != len(coverage) or not any(coverage):
        raise ValueError("B12_FOREGROUND_VALUE_SHAPE")
    return sum((left - right) ** 2 for left, right, mask in zip(prediction, target, coverage, strict=True) if mask) / sum(1 for value in coverage if value)


def expand_training_inputs(entry: dict[str, Any], tensor: dict[str, Any], model_raster: Any, training_raster: dict[str, Any], device: Any, np: Any, torch: Any, Image: Any) -> tuple[Any, Any, dict[str, Any]]:
    metadata = json.loads(Path(entry["metadataPathControl"]).read_text())
    validate_control_metadata(metadata, model_raster)
    raw = np.fromfile(entry["tensorPath"], dtype="<f4")
    control = torch.from_numpy(raw.reshape(17, metadata["rows"], metadata["cols"]).copy()).to(device=device, dtype=torch.float32)
    control = controls_to_model(control, model_raster, tensor, torch).unsqueeze(0)
    source_control = control.detach().cpu().contiguous().numpy().tobytes()
    control = torch.nn.functional.interpolate(control, size=(training_raster["height"], training_raster["width"]), mode="nearest")
    output_control = control.detach().cpu().contiguous().numpy().tobytes()
    validate_target_metadata(entry, model_raster)
    image = target_to_model(Image.open(entry["imagePath"]), model_raster, Image)
    source_target = image.tobytes()
    image = image.resize((training_raster["width"], training_raster["height"]), Image.Resampling.NEAREST)
    output_target = image.tobytes()
    plane_bytes = training_raster["width"] * training_raster["height"] * 4
    evidence = {
        "id": training_raster["id"], "sourceWidth": 256, "sourceHeight": 256,
        "width": 1024, "height": 1024, "algorithm": "nearest",
        "coverageChannel": 15, "alphaAuthority": "coverage-only",
        "backgroundCompositing": "downstream-optional-not-training-or-causal-eval",
        "sourceControlSha256": hashlib.sha256(source_control).hexdigest(),
        "outputControlSha256": hashlib.sha256(output_control).hexdigest(),
        "sourceTargetSha256": hashlib.sha256(source_target).hexdigest(),
        "outputTargetSha256": hashlib.sha256(output_target).hexdigest(),
        "coverageSha256": hashlib.sha256(output_control[15 * plane_bytes:16 * plane_bytes]).hexdigest(),
    }
    return control, image, evidence

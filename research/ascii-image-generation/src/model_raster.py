"""The one physical raster mapping used by keyframe targets and controls.

Glyphcss controls are stored as character cells, not square pixels.  A source
grid of ``cols x rows`` therefore occupies ``cols x rows*cellAspect`` physical
units.  This module is deliberately the only place where that fact is changed
into a square diffusion-model raster.  It uses a contain/letterbox mapping;
it never independently stretches the RGB target and control tensor.
"""

from __future__ import annotations

from dataclasses import dataclass
import math
from typing import Any

from overfit_contract import OverfitContractError


MODEL_RASTER_ID = "glyph-model-raster/physical-cell-letterbox-v1"
DISCRETE_ENCODINGS = frozenset(("ascii-printable-index-v1", "packed-rgb-v1", "binary-v1"))
CONTINUOUS_ENCODINGS = frozenset(("linear-depth-v1", "xyz-v1", "uv-v1", "scalar-v1"))


@dataclass(frozen=True)
class ModelRaster:
    width: int
    height: int
    cols: int
    rows: int
    cell_aspect: float
    target_sampling: str
    discrete_control_sampling: str
    continuous_control_sampling: str
    latent_continuous_sampling: str


@dataclass(frozen=True)
class RasterLayout:
    left: int
    top: int
    width: int
    height: int


def _error(code: str) -> None:
    raise OverfitContractError(code)


def parse_model_raster(value: Any, *, training_resolution: int, tensor: dict[str, Any]) -> ModelRaster:
    if not isinstance(value, dict) or value.get("id") != MODEL_RASTER_ID:
        _error("B12_MODEL_RASTER_CONTRACT")
    source = value.get("source")
    if not isinstance(source, dict):
        _error("B12_MODEL_RASTER_SOURCE")
    numeric = ("width", "height")
    if any(type(value.get(key)) is not int or value[key] <= 0 for key in numeric):
        _error("B12_MODEL_RASTER_DIMENSIONS")
    if any(type(source.get(key)) is not int or source[key] <= 0 for key in ("cols", "rows")):
        _error("B12_MODEL_RASTER_SOURCE")
    cell_aspect = source.get("cellAspect")
    if not isinstance(cell_aspect, (int, float)) or isinstance(cell_aspect, bool) or not math.isfinite(cell_aspect) or cell_aspect <= 0:
        _error("B12_MODEL_RASTER_SOURCE")
    if (value.get("fit") != "contain"
            or value.get("targetSampling") != "nearest"
            or value.get("discreteControlSampling") != "nearest"
            or value.get("continuousControlSampling") != "nearest"
            or value.get("latentContinuousSampling") != "bilinear"):
        _error("B12_MODEL_RASTER_SAMPLING")
    if value["width"] != value["height"] or value["width"] != training_resolution:
        _error("B12_MODEL_RASTER_RESOLUTION")
    if not isinstance(tensor.get("keyframeChannels"), list) or sum(channel.get("width", -1) for channel in tensor["keyframeChannels"] if isinstance(channel, dict)) != tensor.get("keyframeWidth"):
        _error("B12_MODEL_RASTER_TENSOR")
    for channel in tensor["keyframeChannels"]:
        if not isinstance(channel, dict) or channel.get("encoding") not in DISCRETE_ENCODINGS | CONTINUOUS_ENCODINGS:
            _error("B12_MODEL_RASTER_CHANNEL_SAMPLING")
    return ModelRaster(
        width=value["width"], height=value["height"], cols=source["cols"], rows=source["rows"],
        cell_aspect=float(cell_aspect), target_sampling=value["targetSampling"],
        discrete_control_sampling=value["discreteControlSampling"], continuous_control_sampling=value["continuousControlSampling"],
        latent_continuous_sampling=value["latentContinuousSampling"],
    )


def validate_control_metadata(metadata: Any, raster: ModelRaster) -> None:
    if not isinstance(metadata, dict):
        _error("B12_MODEL_RASTER_CONTROL_METADATA")
    if metadata.get("cols") != raster.cols or metadata.get("rows") != raster.rows:
        _error("B12_MODEL_RASTER_SOURCE_GRID_MISMATCH")
    cell_aspect = metadata.get("cellAspect")
    if not isinstance(cell_aspect, (int, float)) or isinstance(cell_aspect, bool) or not math.isfinite(cell_aspect) or not math.isclose(float(cell_aspect), raster.cell_aspect, rel_tol=0, abs_tol=1e-12):
        _error("B12_MODEL_RASTER_CELL_ASPECT_MISMATCH")


def validate_target_metadata(metadata: Any, raster: ModelRaster) -> None:
    """Require the target record to bind the same raw-grid contract as K."""
    if not isinstance(metadata, dict) or not isinstance(metadata.get("modelRaster"), dict):
        _error("B12_MODEL_RASTER_TARGET_METADATA")
    value = metadata["modelRaster"]
    source = value.get("source")
    if value.get("id") != MODEL_RASTER_ID or not isinstance(source, dict):
        _error("B12_MODEL_RASTER_TARGET_METADATA")
    if (value.get("width") != raster.width or value.get("height") != raster.height
            or value.get("fit") != "contain" or value.get("targetSampling") != raster.target_sampling
            or value.get("discreteControlSampling") != raster.discrete_control_sampling
            or value.get("continuousControlSampling") != raster.continuous_control_sampling
            or value.get("latentContinuousSampling") != raster.latent_continuous_sampling):
        _error("B12_MODEL_RASTER_TARGET_METADATA")
    if source.get("cols") != raster.cols or source.get("rows") != raster.rows or source.get("cellAspect") != raster.cell_aspect:
        _error("B12_MODEL_RASTER_TARGET_METADATA")


def layout_for(raster: ModelRaster) -> RasterLayout:
    # Physical source dimensions, not raw bitmap dimensions.  This is the
    # aspect-preserving operation that old ``resize((n, n))`` skipped.
    scale = min(raster.width / raster.cols, raster.height / (raster.rows * raster.cell_aspect))
    scaled_width = round(raster.cols * scale)
    scaled_height = round(raster.rows * raster.cell_aspect * scale)
    if not (0 < scaled_width <= raster.width and 0 < scaled_height <= raster.height):
        _error("B12_MODEL_RASTER_LAYOUT")
    return RasterLayout(
        left=(raster.width - scaled_width) // 2,
        top=(raster.height - scaled_height) // 2,
        width=scaled_width,
        height=scaled_height,
    )


def target_to_model(image: Any, raster: ModelRaster, Image: Any) -> Any:
    """Nearest-resample an exact raw target into the shared physical layout.

    The source must be the raw control-grid PNG.  Accepting an arbitrary
    provider-sized image here would make a target/control alignment claim we
    cannot prove, so it rejects rather than silently resizing it.
    """
    if image.size != (raster.cols, raster.rows):
        _error("B12_MODEL_RASTER_TARGET_DIMENSIONS_MISMATCH")
    layout = layout_for(raster)
    if image.mode == "RGBA":
        # Empty control cells are transparent in target-frame PNGs.  Their
        # physically corresponding model pixels must be the same zero padding
        # used by all control planes, not hidden RGB below alpha.
        source = Image.new("RGB", image.size, (0, 0, 0))
        source.paste(image.convert("RGB"), mask=image.getchannel("A"))
    else:
        source = image.convert("RGB")
    result = Image.new("RGB", (raster.width, raster.height), (0, 0, 0))
    result.paste(source.resize((layout.width, layout.height), Image.Resampling.NEAREST), (layout.left, layout.top))
    return result


def channel_sampling_modes(tensor: dict[str, Any], raster: ModelRaster) -> list[str]:
    result: list[str] = []
    for channel in tensor["keyframeChannels"]:
        encoding = channel["encoding"]
        sampling = raster.discrete_control_sampling if encoding in DISCRETE_ENCODINGS else raster.continuous_control_sampling
        result.extend([sampling] * channel["width"])
    if len(result) != tensor["keyframeWidth"]:
        _error("B12_MODEL_RASTER_TENSOR")
    return result


def controls_to_model(control: Any, raster: ModelRaster, tensor: dict[str, Any], torch: Any) -> Any:
    """Place every K plane in the same letterbox rectangle as the RGB target.

    Every plane uses nearest sampling here so a model-raster pixel retains the
    exact same raw depth winner as the RGB target. Continuous values may be
    filtered only later, at the explicit model-to-latent boundary.
    """
    if tuple(control.shape) != (tensor["keyframeWidth"], raster.rows, raster.cols):
        _error("B12_MODEL_RASTER_CONTROL_DIMENSIONS_MISMATCH")
    layout = layout_for(raster)
    result = torch.zeros((tensor["keyframeWidth"], raster.height, raster.width), device=control.device, dtype=control.dtype)
    modes = channel_sampling_modes(tensor, raster)
    for mode in dict.fromkeys((raster.discrete_control_sampling, raster.continuous_control_sampling)):
        indices = [index for index, candidate in enumerate(modes) if candidate == mode]
        if not indices:
            continue
        source = control[indices].unsqueeze(0)
        if mode == "nearest":
            sampled = torch.nn.functional.interpolate(source, size=(layout.height, layout.width), mode="nearest")
        else:
            sampled = torch.nn.functional.interpolate(source, size=(layout.height, layout.width), mode="bilinear", align_corners=False)
        result[indices, layout.top:layout.top + layout.height, layout.left:layout.left + layout.width] = sampled[0]
    return result


def controls_to_latent(control: Any, latent_size: tuple[int, int], raster: ModelRaster, tensor: dict[str, Any], torch: Any) -> Any:
    """Downsample a model-raster control without turning categorical planes soft."""
    if tuple(control.shape) != (tensor["keyframeWidth"], raster.height, raster.width):
        _error("B12_MODEL_RASTER_MODEL_CONTROL_DIMENSIONS_MISMATCH")
    modes = channel_sampling_modes(tensor, raster)
    result = torch.empty((tensor["keyframeWidth"], *latent_size), device=control.device, dtype=control.dtype)
    latent_modes = [
        raster.discrete_control_sampling if mode == raster.discrete_control_sampling else raster.latent_continuous_sampling
        for mode in modes
    ]
    for mode in dict.fromkeys(latent_modes):
        indices = [index for index, candidate in enumerate(latent_modes) if candidate == mode]
        if not indices:
            continue
        source = control[indices].unsqueeze(0)
        if mode == "nearest":
            sampled = torch.nn.functional.interpolate(source, size=latent_size, mode="nearest")
        else:
            sampled = torch.nn.functional.interpolate(source, size=latent_size, mode="bilinear", align_corners=False)
        result[indices] = sampled[0]
    return result

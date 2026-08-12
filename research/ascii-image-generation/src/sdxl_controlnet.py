from __future__ import annotations

from pathlib import Path
from typing import Any

from overfit_contract import OverfitContractError, keyframe_slices


ARCHITECTURE_ID = "sdxl-depth-controlnet-17ch/v1"
CHANNEL_IDS = (
    "visible-glyph", "semantic-glyph", "semantic-control-color", "camera-depth",
    "geometric-normal", "world-position", "surface-uv", "surface-uv-valid",
    "coverage", "lambert-shade",
)
DEPTH_CHANNEL = 5


def validate_channel_layout(contract: dict[str, Any]) -> None:
    slices = keyframe_slices(contract)
    if contract.get("keyframeWidth") != 17 or tuple(slices) != CHANNEL_IDS:
        raise OverfitContractError("B12_SDXL_CONTROL_CHANNEL_LAYOUT")
    if slices["camera-depth"] != (DEPTH_CHANNEL, DEPTH_CHANNEL + 1):
        raise OverfitContractError("B12_SDXL_DEPTH_CHANNEL")


def expanded_weight_values(stock_weight: list[list[list[list[float]]]], channels: int = 17, depth_channel: int = DEPTH_CHANNEL) -> list[list[list[list[float]]]]:
    """Pure oracle: zero every new input and sum stock RGB into B32 camera depth."""
    if channels != 17 or depth_channel != 5:
        raise OverfitContractError("B12_SDXL_DEPTH_INITIALIZATION")
    result = []
    for output in stock_weight:
        if len(output) != 3:
            raise OverfitContractError("B12_STOCK_DEPTH_RGB_STEM")
        kernel = [[[0.0 for _ in row] for row in output[0]] for _ in range(channels)]
        kernel[depth_channel] = [
            [output[0][y][x] + output[1][y][x] + output[2][y][x] for x in range(len(output[0][y]))]
            for y in range(len(output[0]))
        ]
        result.append(kernel)
    return result


def expand_stock_depth_stem(controlnet: Any, torch: Any) -> None:
    stock = controlnet.controlnet_cond_embedding.conv_in
    if stock.in_channels != 3:
        raise OverfitContractError("B12_STOCK_DEPTH_RGB_STEM")
    replacement = torch.nn.Conv2d(
        17, stock.out_channels, stock.kernel_size, stride=stock.stride,
        padding=stock.padding, dilation=stock.dilation, groups=stock.groups,
        bias=stock.bias is not None, padding_mode=stock.padding_mode,
        device=stock.weight.device, dtype=stock.weight.dtype,
    )
    with torch.no_grad():
        replacement.weight.zero_()
        replacement.weight[:, DEPTH_CHANNEL:DEPTH_CHANNEL + 1].copy_(stock.weight.sum(dim=1, keepdim=True))
        if stock.bias is not None:
            replacement.bias.copy_(stock.bias)
    controlnet.controlnet_cond_embedding.conv_in = replacement


def load_native_controlnet(root: Path, contract: dict[str, Any], torch: Any, ControlNetModel: Any) -> Any:
    validate_channel_layout(contract)
    controlnet = ControlNetModel.from_pretrained(
        root, torch_dtype=torch.float16, use_safetensors=True, local_files_only=True
    )
    expand_stock_depth_stem(controlnet, torch)
    controlnet.enable_gradient_checkpointing()
    if sum(value.numel() for value in controlnet.parameters() if value.requires_grad) <= 49_000:
        raise OverfitContractError("B12_FORBID_TOY_LATENT_RESIDUAL")
    return controlnet


def depth_only_stock_equivalent(control: Any) -> Any:
    if control.ndim != 4 or control.shape[1] != 17:
        raise OverfitContractError("B12_SDXL_CONTROL_SHAPE")
    depth = control[:, DEPTH_CHANNEL:DEPTH_CHANNEL + 1]
    return depth.repeat(1, 3, 1, 1)


def foreground_noise_mse(prediction: Any, target: Any, control: Any, torch: Any) -> Any:
    coverage = control[:, 15:16]
    coverage = torch.nn.functional.interpolate(coverage.float(), size=prediction.shape[-2:], mode="nearest")
    if not torch.any(coverage > 0):
        raise OverfitContractError("B12_EMPTY_FOREGROUND")
    squared = (prediction.float() - target.float()).square()
    weights = coverage.expand_as(squared)
    return (squared * weights).sum() / weights.sum()

#!/usr/bin/env python3
"""Offline SDXL depth-ControlNet generation for one spray-paint view.

This module deliberately imports only the standard library at module load time.
That keeps ``--help`` and syntax checks usable on the Mac; torch, diffusers,
numpy, and Pillow are imported only by :func:`main` in the GPU container.
"""

from __future__ import annotations

import argparse
import contextlib
import hashlib
import json
import os
import platform
import sys
import time
import traceback
from pathlib import Path
from typing import Any


DEFAULT_MODEL_ROOT = Path(
    "/artifacts/models/native-reference/sdxl-base-1.0/"
    "462165984030d82259a11f4367a4eed129e94a7b"
)
DEFAULT_CONTROL_ROOT = Path(
    "/artifacts/models/native-reference/controlnet-depth-sdxl-1.0/"
    "17bb97973f29801224cd66f192c5ffacf82648b4"
)
DEFAULT_NEGATIVE_PROMPT = "deformed, distorted, duplicate, text, watermark, low quality"
# 512 is the only SDXL+ControlNet resolution proven on this 16 GB laptop 4090 (B57's
# capture_native_teacher_latents run). 1024 segfaults mid-denoise under cpu-offload.
# It also suits the 256x256 model raster better: a 2x upsample rather than 4x.
MODEL_WIDTH = int(os.environ.get("GLYPH_SPRAY_WIDTH", "512"))
MODEL_HEIGHT = int(os.environ.get("GLYPH_SPRAY_HEIGHT", "512"))
DEPTH_DEGENERATE_RANGE_U8 = 2
ANCHOR_TO_AUTHORED_RENDER_CHOICES = ("off", "seed-only", "all-views")
BASE_KIND_CHOICES = (
    "auto",
    "none",
    "texture-atlas",
    "authored-render",
    "texture-atlas-authored-render-blend",
)

# Process-lifetime pipeline reuse; see the loading block in main().
_CONTROLNET_CACHE: dict[Any, Any] = {}
_PIPELINE_CACHE: dict[Any, Any] = {}
_PLACEMENT: dict[Any, str] = {}


def file_sha256(path: Path) -> str:
    """Return the SHA-256 of one regular file without loading it all at once."""

    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def value_sha256(value: Any) -> str:
    return hashlib.sha256(
        json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    ).hexdigest()


def parse(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Generate one offline SDXL + depth-ControlNet spray-paint view."
    )
    parser.add_argument(
        "--controls-root",
        type=Path,
        help="Control-map root or its frames/ directory (required except for --dry-run-synchronized).",
    )
    parser.add_argument("--view-index", type=int, default=0, help="Zero-based control-frame index.")
    parser.add_argument(
        "--mode",
        choices=("auto", "text2img", "inpaint"),
        default="auto",
        help="auto uses the configured authored-render anchor for view 0, then inpaint for later views (default: auto).",
    )
    parser.add_argument(
        "--anchor-to-authored-render",
        choices=ANCHOR_TO_AUTHORED_RENDER_CHOICES,
        default="seed-only",
        help="Use glyphcss's shaded authored render as the view-0 base, every view's base, or not at all (default: seed-only).",
    )
    parser.add_argument(
        "--base-kind",
        choices=BASE_KIND_CHOICES,
        default="auto",
        help="Provenance label for the img2img/inpaint base; spray_pass.py always supplies it explicitly.",
    )
    parser.add_argument("--prompt", help="Generation prompt (required unless --emit-control-only is set).")
    parser.add_argument("--negative-prompt", default=DEFAULT_NEGATIVE_PROMPT)
    parser.add_argument("--seed", type=int, help="Generation seed (required unless --emit-control-only is set).")
    parser.add_argument("--steps", type=int, default=24)
    parser.add_argument("--guidance", type=float, default=7.0)
    parser.add_argument(
        "--control-scale",
        type=float,
        default=0.7,
        help="ControlNet conditioning scale (default: 0.7; the spray-pass config overrides this).",
    )
    parser.add_argument(
        "--inpaint-strength",
        type=float,
        default=0.7,
        help="Inpaint denoise strength. 1.0 regenerates the masked region from pure noise and "
             "discards the already-painted base, which makes each view a different-looking object; "
             "lower values let the existing texture steer the result (default: 0.7).",
    )
    parser.add_argument(
        "--depth-source",
        choices=("frame-minmax", "corpus-normalized"),
        default="frame-minmax",
        help="Depth presentation source: per-frame raw-depth percentiles or frozen corpus tensor plane.",
    )
    parser.add_argument(
        "--known-image",
        type=Path,
        help="RGB img2img/inpaint base (texture atlas, authored render, or their configured blend; required for inpaint).",
    )
    parser.add_argument(
        "--known-mask",
        type=Path,
        help="L/PNG mask whose non-zero pixels are unknown and may be regenerated (required for inpaint).",
    )
    parser.add_argument(
        "--output",
        type=Path,
        help="Generated PNG output path, or the control PNG path with --emit-control-only.",
    )
    parser.add_argument(
        "--emit-control-only",
        action="store_true",
        help="Write only the depth ControlNet PNG to --output and its report; requires only numpy and Pillow.",
    )
    parser.add_argument(
        "--report",
        type=Path,
        help="Optional report path; defaults to <output stem>.report.json.",
    )
    parser.add_argument("--model-root", type=Path, default=DEFAULT_MODEL_ROOT)
    parser.add_argument("--control-root", type=Path, default=DEFAULT_CONTROL_ROOT)
    parser.add_argument(
        "--multi-view-mode",
        choices=("per-view", "synchronized"),
        default="per-view",
        help="Denoise each view independently (default) or jointly synchronize all views through an authored-UV atlas.",
    )
    parser.add_argument(
        "--synchronized-view-count",
        type=int,
        default=1,
        help="Number of manifest views participating in synchronized denoising (default: 1).",
    )
    parser.add_argument(
        "--synchronization-start-step",
        type=int,
        default=0,
        help="Zero-based denoise step at which UV consensus begins (default: 0, the earliest step).",
    )
    parser.add_argument(
        "--synchronization-blend",
        type=float,
        default=1.0,
        help="Atlas-resample weight blended into predicted-clean latents; 1 is a SyncMVD-style replace (default: 1).",
    )
    parser.add_argument(
        "--synchronized-texture-page-size",
        type=int,
        default=4096,
        help="Authored-UV texture-page side used by synchronized consensus (default: 4096).",
    )
    parser.add_argument(
        "--synchronized-manifest",
        type=Path,
        help="JSON manifest with one output path, seed, and authored-UV material routing per synchronized view.",
    )
    parser.add_argument(
        "--dry-run-synchronized",
        action="store_true",
        help="CPU-only stub UNet/VAE exercise of the synchronized timestep orchestration; no controls or GPU are read.",
    )
    return parser.parse_args(argv)


def authored_render_anchor_active(anchor: str, view_index: int) -> bool:
    return anchor == "all-views" or (anchor == "seed-only" and view_index == 0)


def selected_mode(args: argparse.Namespace) -> str:
    if args.view_index < 0:
        raise RuntimeError("SPRAY_GENERATE_VIEW_INDEX")
    expected = "inpaint" if authored_render_anchor_active(args.anchor_to_authored_render, args.view_index) else (
        "text2img" if args.view_index == 0 else "inpaint"
    )
    if args.mode not in ("auto", expected):
        raise RuntimeError(f"SPRAY_GENERATE_MODE_VIEW_MISMATCH: view {args.view_index} requires {expected}")
    return expected


def selected_base_kind(args: argparse.Namespace, mode: str) -> str:
    """Resolve and validate the base provenance sent by spray_pass.py."""

    if args.view_index == 0:
        expected = "authored-render" if authored_render_anchor_active(
            args.anchor_to_authored_render, args.view_index
        ) else "none"
    elif args.anchor_to_authored_render == "all-views":
        expected = "texture-atlas-authored-render-blend"
    else:
        expected = "texture-atlas"
    actual = expected if args.base_kind == "auto" else args.base_kind
    if actual != expected:
        raise RuntimeError(
            f"SPRAY_GENERATE_BASE_KIND_MISMATCH: view {args.view_index} requires {expected}, received {actual}"
        )
    if (mode == "text2img") != (actual == "none"):
        raise RuntimeError("SPRAY_GENERATE_BASE_KIND_MODE_MISMATCH")
    return actual


def frame_directory(controls_root: Path, view_index: int) -> Path:
    """Accept both a control export root and a frame directory for one view."""

    frame_name = f"frame-{view_index:03d}"
    candidates = (
        controls_root / "frames" / frame_name,
        controls_root / frame_name,
        controls_root,
    )
    for candidate in candidates:
        if (candidate / "metadata.json").is_file():
            return candidate
    searched = ", ".join(str(candidate) for candidate in candidates)
    raise FileNotFoundError(f"SPRAY_GENERATE_CONTROL_FRAME_MISSING: {searched}")


def resolved_root_hashes(root: Path, cache_dir: Path | None = None) -> dict[str, Any]:
    """Hash a frozen model tree once, then reuse it via an on-disk cache.

    The frozen roots are immutable by construction (B52 pins them by revision and
    verifies their treeSha256), but this walked and SHA-256'd ~18.6 GB on EVERY
    view. Across a 3-subject 14-view run that was ~780 GB of reads, dominating
    runtime and pinning the page cache. Cache on (path, size, mtime_ns) of every
    file so a genuinely changed tree still re-hashes and provenance stays honest.
    """

    root = root.resolve()
    cache_dir = cache_dir or Path(os.environ.get("GLYPH_SPRAY_HASH_CACHE", "/artifacts/spray-pass/.hash-cache"))
    fingerprint = []
    for path in sorted(root.rglob("*")):
        if path.is_file():
            stat = path.stat()
            fingerprint.append([path.relative_to(root).as_posix(), stat.st_size, stat.st_mtime_ns])
    if not fingerprint:
        raise RuntimeError(f"SPRAY_GENERATE_MODEL_ROOT_EMPTY: {root}")
    key = hashlib.sha256(
        json.dumps([str(root), fingerprint], sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()
    cached = cache_dir / f"{key}.json"
    if cached.is_file():
        try:
            return json.loads(cached.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            cached.unlink(missing_ok=True)
    result = _resolved_root_hashes_uncached(root)
    cache_dir.mkdir(parents=True, exist_ok=True)
    temporary = cached.with_suffix(".json.tmp")
    temporary.write_text(json.dumps(result, sort_keys=True), encoding="utf-8")
    temporary.replace(cached)
    return result


def _resolved_root_hashes_uncached(root: Path) -> dict[str, Any]:
    """Hash every resolved model artifact used from a local, offline root."""

    root = root.resolve()
    if not root.is_dir():
        raise FileNotFoundError(f"SPRAY_GENERATE_MODEL_ROOT_MISSING: {root}")
    files = []
    for path in sorted(root.rglob("*")):
        if path.is_file():
            files.append(
                {
                    "path": path.relative_to(root).as_posix(),
                    "bytes": path.stat().st_size,
                    "sha256": file_sha256(path),
                }
            )
    if not files:
        raise RuntimeError(f"SPRAY_GENERATE_MODEL_ROOT_EMPTY: {root}")
    return {
        "root": str(root),
        "files": files,
        "treeSha256": value_sha256(files),
    }


def pinned_requirements_evidence() -> dict[str, Any]:
    """Return the repository evidence for the container's intended diffusers version."""

    requirements = Path(__file__).resolve().parents[1] / "docker" / "requirements.lock"
    result: dict[str, Any] = {"path": str(requirements), "exists": requirements.is_file()}
    if requirements.is_file():
        text = requirements.read_text(encoding="utf-8")
        result.update(
            {
                "sha256": file_sha256(requirements),
                "diffusersPinned": "diffusers==0.31.0" in text,
                "diffusersRequirement": "diffusers==0.31.0",
            }
        )
    return result


def report_path_for(output: Path, explicit: Path | None) -> Path:
    if explicit is not None:
        return explicit
    return output.with_name(f"{output.stem}.report.json")


def build_depth_control(
    maps: Any,
    *,
    depth_source: str,
    model_width: int,
    model_height: int,
    np: Any,
    Image: Any,
    derive_view_direction: Any,
) -> tuple[Any, dict[str, Any]]:
    """Build the exact depth-ControlNet image and its inspectable statistics.

    The frozen control tensor has a corpus-wide normalization for training.  It
    is not a usable presentation transform for stock ControlNet, whose depth
    image needs contrast in each individual view.
    """

    covered = np.asarray(maps.coverage, dtype=np.uint8).reshape(maps.rows, maps.cols) != 0
    raw_depth = np.asarray(maps.depth, dtype=np.float64).reshape(maps.rows, maps.cols)
    if not covered.any():
        raise RuntimeError("SPRAY_GENERATE_DEPTH_NO_COVERED_CELLS")
    if not np.isfinite(raw_depth[covered]).all():
        raise RuntimeError("SPRAY_GENERATE_COVERED_DEPTH_NONFINITE")

    normalization: dict[str, Any]
    if depth_source == "frame-minmax":
        # This is the stock_controlnet_baseline.py formula verbatim in intent:
        # percentile only over covered raw depths, normalize, then clip.  The
        # percentiles avoid one extreme depth sample flattening a whole view.
        low, high = np.percentile(raw_depth[covered], [1.0, 99.0])
        if not np.isfinite([low, high]).all() or not high > low:
            raise RuntimeError("SPRAY_GENERATE_DEPTH_RANGE_DEGENERATE")
        normalized = (raw_depth - low) / (high - low)
        normalization = {
            "kind": "covered-raw-depth-percentile",
            "percentiles": [1.0, 99.0],
            "low": float(low),
            "high": float(high),
        }
    elif depth_source == "corpus-normalized":
        normalized = np.asarray(maps.depth_normalized, dtype=np.float32).reshape(maps.rows, maps.cols)
        if not np.isfinite(normalized[covered]).all():
            raise RuntimeError("SPRAY_GENERATE_COVERED_NORMALIZED_DEPTH_NONFINITE")
        normalization = {
            "kind": "frozen-corpus-depth-normalized-f32",
            "percentiles": None,
            "low": None,
            "high": None,
        }
    else:
        raise RuntimeError(f"SPRAY_GENERATE_DEPTH_SOURCE: {depth_source}")

    # Glyphcss retains the larger raw r[2] at each cell: its rasterizer states
    # that larger depth is closer.  The data independently verifies that raw
    # depth is affine in world position along the fitted view direction.  Thus
    # increasing raw depth is nearer, and ControlNet's MiDaS convention requires
    # this increasing presentation to be bright -- not the previous 1-depth.
    view_direction, view_fit = derive_view_direction(maps)
    cell_u8 = np.zeros((maps.rows, maps.cols), dtype=np.uint8)
    cell_u8[covered] = np.rint(np.clip(normalized[covered], 0.0, 1.0) * 255.0).astype(np.uint8)

    # Frozen model-raster addressing: a glyph cell owns exactly x1,y2 pixels.
    model_u8 = np.repeat(cell_u8, 2, axis=0)
    model_covered = np.repeat(covered, 2, axis=0)
    control_small = Image.fromarray(model_u8, mode="L")

    # Smooth only the model-raster -> SDXL-input resample.  Re-apply the nearest
    # coverage mask afterwards so cells with no geometry remain exactly black.
    control_l = control_small.resize((model_width, model_height), resample=Image.Resampling.BILINEAR)
    covered_l = Image.fromarray(model_covered.astype(np.uint8) * 255, mode="L").resize(
        (model_width, model_height), resample=Image.Resampling.NEAREST
    )
    # BILINEAR otherwise darkens the inside edge of a silhouette by blending in
    # its required black background.  Divide by a bilinearly-resampled coverage
    # weight so smoothing happens among covered samples only; a constant depth
    # remains constant and is correctly reported as degenerate.
    coverage_weight = np.asarray(
        Image.fromarray(model_covered.astype(np.uint8) * 255, mode="L").resize(
            (model_width, model_height), resample=Image.Resampling.BILINEAR
        ),
        dtype=np.float32,
    ) / 255.0
    control_u8 = np.zeros((model_height, model_width), dtype=np.uint8)
    smooth_depth = np.asarray(control_l, dtype=np.float32)
    smooth_active = coverage_weight > 0.0
    control_u8[smooth_active] = np.rint(
        np.clip(smooth_depth[smooth_active] / coverage_weight[smooth_active], 0.0, 255.0)
    ).astype(np.uint8)
    covered_pixels = np.asarray(covered_l, dtype=np.uint8) != 0
    control_u8[~covered_pixels] = 0
    active = control_u8[covered_pixels]
    if active.size == 0:
        raise RuntimeError("SPRAY_GENERATE_DEPTH_NO_COVERED_PIXELS")
    minimum = int(active.min())
    maximum = int(active.max())
    statistics = {
        "min": minimum,
        "max": maximum,
        "mean": float(active.mean()),
        "std": float(active.std()),
        "uniqueValues": int(np.unique(active).size),
        "coveredPixels": int(active.size),
        "degenerate": maximum - minimum < DEPTH_DEGENERATE_RANGE_U8,
        "degenerateRangeThreshold": DEPTH_DEGENERATE_RANGE_U8,
    }
    control_image = Image.fromarray(control_u8, mode="L").convert("RGB")
    return control_image, {
        "source": depth_source,
        "normalization": normalization,
        "polarity": {
            "near": "bright",
            "rawDepthNearOrdering": "larger-is-nearer",
            "justification": (
                "Glyphcss's depth buffer retains greater r[2] as nearer "
                "(packages/glyphcss/src/render/rasterize.ts:265-267). "
                "The covered frame data also fits raw depth as an affine function "
                "of world position along the recovered view direction."
            ),
            "viewDirection": [float(value) for value in view_direction],
            "worldPositionFit": view_fit,
        },
        "cellToModelRaster": "nearest x1,y2 (256x128 cells to 256x256 model raster)",
        "modelToControlResample": "bilinear",
        "statistics": statistics,
    }


def validate_synchronization_args(args: argparse.Namespace) -> None:
    """Validate the opt-in synchronized controls before opening CUDA objects."""

    if args.synchronized_view_count < 1:
        raise RuntimeError("SPRAY_GENERATE_SYNCHRONIZED_VIEW_COUNT")
    if args.synchronization_start_step < 0:
        raise RuntimeError("SPRAY_GENERATE_SYNCHRONIZATION_START_STEP")
    if args.synchronization_start_step >= args.steps:
        raise RuntimeError("SPRAY_GENERATE_SYNCHRONIZATION_START_STEP")
    if not 0.0 <= args.synchronization_blend <= 1.0:
        raise RuntimeError("SPRAY_GENERATE_SYNCHRONIZATION_BLEND")
    if args.synchronized_texture_page_size < 1:
        raise RuntimeError("SPRAY_GENERATE_SYNCHRONIZED_TEXTURE_PAGE_SIZE")
    if not args.dry_run_synchronized and args.multi_view_mode == "synchronized" and args.synchronized_manifest is None:
        raise RuntimeError("SPRAY_GENERATE_SYNCHRONIZED_MANIFEST_REQUIRED")


def synchronized_timestep_loop(
    views: list[Any],
    timesteps: list[Any],
    *,
    synchronization_start_step: int,
    synchronization_blend: float,
    predict: Any,
    decode: Any,
    create_atlas: Any,
    back_project: Any,
    sample_atlas: Any,
    encode: Any,
    mix_clean: Any,
    advance: Any,
) -> tuple[list[Any], list[dict[str, Any]]]:
    """Run a lock-step multi-view denoise loop without owning a model or renderer.

    Every view predicts from the same timestep's incoming state before any atlas
    is touched.  Only then are all predicted-clean images decoded, accumulated
    into one atlas, rendered back into *every* view, encoded, blended, and
    advanced.  The callback boundary makes the sequencing CPU-testable and
    keeps this module import-safe where torch is unavailable.
    """

    states = list(views)
    trace: list[dict[str, Any]] = []
    for step_index, timestep in enumerate(timesteps):
        predictions = [predict(state, timestep, step_index, view_index) for view_index, state in enumerate(states)]
        clean = [item["clean"] for item in predictions]
        synchronized = step_index >= synchronization_start_step
        atlas = None
        if synchronized:
            # Decode every x0 before the first projection so atlas mutation can
            # never make a later view observe an earlier view's partially baked
            # value from this timestep.
            decoded = [decode(value, view_index) for view_index, value in enumerate(clean)]
            atlas = create_atlas()
            for view_index, image in enumerate(decoded):
                back_project(atlas, states[view_index], image, view_index)
            sampled = [sample_atlas(atlas, state, view_index) for view_index, state in enumerate(states)]
            encoded = [encode(image, view_index) for view_index, image in enumerate(sampled)]
            clean = [
                mix_clean(predictions[view_index]["clean"], encoded[view_index], synchronization_blend)
                for view_index in range(len(states))
            ]
        states = [
            advance(states[view_index], predictions[view_index], clean[view_index], timestep, step_index)
            for view_index in range(len(states))
        ]
        trace.append({
            "step": step_index,
            "timestep": int(timestep) if hasattr(timestep, "__int__") else timestep,
            "views": len(states),
            "synchronized": synchronized,
            "atlas": atlas is not None,
        })
    return states, trace


def synchronized_dry_run(args: argparse.Namespace) -> dict[str, Any]:
    """Exercise the exact lock-step orchestration with CPU-only UNet/VAE stubs."""

    view_count = args.synchronized_view_count
    calls: list[str] = []

    class StubUnet:
        def predict(self, state: float, timestep: int, step: int, view: int) -> dict[str, float]:
            calls.append(f"unet:{step}:{view}")
            return {"clean": state - (0.01 * (view + 1)), "noise": 0.01 * (view + 1)}

    class StubVae:
        def decode(self, clean: float, view: int) -> float:
            calls.append(f"decode:{view}")
            return clean

        def encode(self, image: float, view: int) -> float:
            calls.append(f"encode:{view}")
            return image

    unet, vae = StubUnet(), StubVae()

    def create_atlas() -> list[float]:
        calls.append("atlas")
        return []

    def back_project(atlas: list[float], _state: float, image: float, view: int) -> None:
        calls.append(f"project:{view}")
        atlas.append(image)

    def sample_atlas(atlas: list[float], _state: float, view: int) -> float:
        calls.append(f"sample:{view}")
        return sum(atlas) / len(atlas)

    states, trace = synchronized_timestep_loop(
        [float(index + 1) for index in range(view_count)],
        list(range(args.steps)),
        synchronization_start_step=args.synchronization_start_step,
        synchronization_blend=args.synchronization_blend,
        predict=lambda state, timestep, step, view: unet.predict(state, timestep, step, view),
        decode=vae.decode,
        create_atlas=create_atlas,
        back_project=back_project,
        sample_atlas=sample_atlas,
        encode=vae.encode,
        mix_clean=lambda predicted, resampled, blend: predicted * (1.0 - blend) + resampled * blend,
        advance=lambda _state, _prediction, clean, _timestep, _step: clean,
    )
    return {
        "schemaVersion": "glyph-spray-generate/synchronized-dry-run/v1",
        "modeUsed": "synchronized-dry-run",
        "views": view_count,
        "steps": args.steps,
        "synchronizationStartStep": args.synchronization_start_step,
        "synchronizationBlend": args.synchronization_blend,
        "trace": trace,
        "finalStubLatents": states,
        "calls": calls,
        "runtime": {"execution": "cpu-only stub UNet/VAE; torch and diffusers not imported"},
    }


def synchronized_generate(
    args: argparse.Namespace,
    *,
    np: Any,
    Image: Any,
    emit_report: bool,
    worker_reused: bool | None,
) -> dict[str, Any]:
    """Generate all manifest views in one manually-stepped SDXL denoise loop.

    This intentionally uses one UNet/ControlNet inference at a time.  Holding an
    SDXL+ControlNet pipeline and even a single inference already approaches the
    16 GB device budget, whereas the atlas itself stays as CPU numpy state.
    """

    if args.prompt is None:
        raise RuntimeError("SPRAY_GENERATE_PROMPT_REQUIRED")
    if args.controls_root is None:
        raise RuntimeError("SPRAY_GENERATE_CONTROLS_ROOT_REQUIRED")
    assert args.synchronized_manifest is not None
    manifest = json.loads(args.synchronized_manifest.read_text(encoding="utf-8"))
    manifest_views = manifest.get("views") if isinstance(manifest, dict) else None
    if not isinstance(manifest_views, list) or len(manifest_views) != args.synchronized_view_count:
        raise RuntimeError("SPRAY_GENERATE_SYNCHRONIZED_MANIFEST_VIEWS")

    try:
        import torch
        from diffusers import ControlNetModel, EulerDiscreteScheduler, StableDiffusionXLControlNetPipeline
    except ImportError as error:
        raise RuntimeError(
            "SPRAY_GENERATE_GPU_DEPENDENCIES_MISSING: run this only in glyphcss-ascii-trainer:b8"
        ) from error
    if not torch.cuda.is_available():
        raise RuntimeError("SPRAY_GENERATE_CUDA_REQUIRED")
    torch.backends.cuda.enable_flash_sdp(False)
    torch.backends.cuda.enable_mem_efficient_sdp(False)
    torch.backends.cuda.enable_math_sdp(True)

    try:
        from spray_texture import TexturePage, back_project, derive_view_direction, load_control_maps, sample_page
    except ImportError as error:
        raise RuntimeError("SPRAY_GENERATE_TEXTURE_HELPER_MISSING") from error

    # Load all geometry controls before denoising step zero.  The payload carries
    # material routing prepared by spray_pass.py; this generator remains unaware
    # of OBJ parsing and uses spray_texture for all authored-UV operations.
    views: list[dict[str, Any]] = []
    for expected_index, item in enumerate(manifest_views):
        if not isinstance(item, dict) or int(item.get("index", -1)) != expected_index:
            raise RuntimeError("SPRAY_GENERATE_SYNCHRONIZED_MANIFEST_INDEX")
        routing = np.asarray(item.get("routing"), dtype=np.int32)
        frame_dir = frame_directory(args.controls_root, expected_index)
        maps = load_control_maps(frame_dir)
        if maps.cols != 256 or maps.rows != 128 or routing.size != maps.cells:
            raise RuntimeError("SPRAY_GENERATE_SYNCHRONIZED_CONTROL_OR_ROUTING")
        control_image, depth_control = build_depth_control(
            maps,
            depth_source=args.depth_source,
            model_width=MODEL_WIDTH,
            model_height=MODEL_HEIGHT,
            np=np,
            Image=Image,
            derive_view_direction=derive_view_direction,
        )
        output = Path(str(item.get("output", "")))
        report = Path(str(item.get("report", "")))
        if not str(output) or not str(report):
            raise RuntimeError("SPRAY_GENERATE_SYNCHRONIZED_MANIFEST_OUTPUT")
        direction, direction_fit = derive_view_direction(maps)
        views.append({
            "index": expected_index,
            "maps": maps,
            "routing": routing,
            "control": control_image,
            "depthControl": depth_control,
            "output": output,
            "report": report,
            "seed": int(item.get("seed", args.seed if args.seed is not None else 0)),
            "viewDirection": direction,
            "viewDirectionFit": direction_fit,
        })

    started = time.perf_counter()
    torch.cuda.reset_peak_memory_stats()
    controlnet = _CONTROLNET_CACHE.get(args.control_root)
    if controlnet is None:
        controlnet = ControlNetModel.from_pretrained(
            args.control_root, torch_dtype=torch.float16, use_safetensors=True, local_files_only=True
        )
        _CONTROLNET_CACHE[args.control_root] = controlnet
    cache_key = ("synchronized", str(args.model_root), str(args.control_root))
    pipeline = _PIPELINE_CACHE.get(cache_key)
    reused = pipeline is not None
    if pipeline is None:
        pipeline = StableDiffusionXLControlNetPipeline.from_pretrained(
            args.model_root,
            controlnet=controlnet,
            torch_dtype=torch.float16,
            use_safetensors=True,
            local_files_only=True,
        )
        pipeline.scheduler = EulerDiscreteScheduler.from_config(pipeline.scheduler.config)
        try:
            pipeline.to("cuda")
            pipeline.enable_vae_slicing()
            placement = "cuda-resident"
        except torch.cuda.OutOfMemoryError:
            torch.cuda.empty_cache()
            pipeline.enable_model_cpu_offload()
            placement = "model-cpu-offload"
        _PLACEMENT[cache_key] = placement
        _PIPELINE_CACHE[cache_key] = pipeline
    loaded = time.perf_counter()

    device = pipeline._execution_device
    do_cfg = args.guidance > 1.0
    prompt_embeds, negative_prompt_embeds, pooled_prompt_embeds, negative_pooled_prompt_embeds = pipeline.encode_prompt(
        args.prompt,
        device=device,
        num_images_per_prompt=1,
        do_classifier_free_guidance=do_cfg,
        negative_prompt=args.negative_prompt,
    )
    if do_cfg:
        prompt_embeds = torch.cat([negative_prompt_embeds, prompt_embeds])
        pooled_prompt_embeds = torch.cat([negative_pooled_prompt_embeds, pooled_prompt_embeds])
    projection_dim = (
        pooled_prompt_embeds.shape[-1]
        if pipeline.text_encoder_2 is None
        else pipeline.text_encoder_2.config.projection_dim
    )
    add_time_ids = pipeline._get_add_time_ids(
        (MODEL_HEIGHT, MODEL_WIDTH), (0, 0), (MODEL_HEIGHT, MODEL_WIDTH),
        dtype=prompt_embeds.dtype,
        text_encoder_projection_dim=projection_dim,
    ).to(device)
    if do_cfg:
        add_time_ids = torch.cat([add_time_ids, add_time_ids])
    added_cond_kwargs = {"text_embeds": pooled_prompt_embeds, "time_ids": add_time_ids}
    controls = [
        pipeline.prepare_image(
            image=view["control"], width=MODEL_WIDTH, height=MODEL_HEIGHT, batch_size=1,
            num_images_per_prompt=1, device=device, dtype=controlnet.dtype,
            do_classifier_free_guidance=do_cfg, guess_mode=False,
        )
        for view in views
    ]
    pipeline.scheduler.set_timesteps(args.steps, device=device)
    timesteps = list(pipeline.scheduler.timesteps)
    initial_latents = []
    for view in views:
        generator = torch.Generator(device=device).manual_seed(view["seed"])
        latent = torch.randn(
            (1, pipeline.unet.config.in_channels, MODEL_HEIGHT // pipeline.vae_scale_factor,
             MODEL_WIDTH // pipeline.vae_scale_factor),
            generator=generator, device=device, dtype=prompt_embeds.dtype,
        )
        initial_latents.append(latent * pipeline.scheduler.init_noise_sigma)

    def predict(latent: Any, timestep: Any, step_index: int, view_index: int) -> dict[str, Any]:
        latent_model_input = pipeline.scheduler.scale_model_input(latent, timestep)
        down, mid = pipeline.controlnet(
            latent_model_input, timestep, encoder_hidden_states=prompt_embeds,
            controlnet_cond=controls[view_index], conditioning_scale=args.control_scale,
            guess_mode=False, added_cond_kwargs=added_cond_kwargs, return_dict=False,
        )
        model_output = pipeline.unet(
            latent_model_input, timestep, encoder_hidden_states=prompt_embeds,
            added_cond_kwargs=added_cond_kwargs, down_block_additional_residuals=down,
            mid_block_additional_residual=mid, return_dict=False,
        )[0]
        if do_cfg:
            unconditional, conditional = model_output.chunk(2)
            model_output = unconditional + args.guidance * (conditional - unconditional)
        sigma = pipeline.scheduler.sigmas[step_index].to(device=device, dtype=latent.dtype)
        prediction_type = pipeline.scheduler.config.prediction_type
        if prediction_type == "epsilon":
            clean = latent - sigma * model_output
        elif prediction_type == "sample":
            clean = model_output
        elif prediction_type == "v_prediction":
            clean = model_output * (-sigma / (sigma * sigma + 1).sqrt()) + latent / (sigma * sigma + 1)
        else:
            raise RuntimeError(f"SPRAY_GENERATE_SYNCHRONIZED_PREDICTION_TYPE: {prediction_type}")
        return {"clean": clean, "sigma": sigma}

    def vae_io_dtype() -> tuple[bool, Any]:
        """Mirror SDXL's pipeline decode path when its VAE requires fp32 IO."""

        needs_upcast = pipeline.vae.dtype == torch.float16 and pipeline.vae.config.force_upcast
        if needs_upcast:
            pipeline.upcast_vae()
        return needs_upcast, next(iter(pipeline.vae.post_quant_conv.parameters())).dtype

    def restore_vae_dtype(needs_upcast: bool) -> None:
        if needs_upcast:
            pipeline.vae.to(dtype=torch.float16)

    def decode(clean: Any, _view_index: int) -> Any:
        needs_upcast, vae_dtype = vae_io_dtype()
        with torch.inference_mode():
            image = pipeline.vae.decode(
                (clean / pipeline.vae.config.scaling_factor).to(dtype=vae_dtype), return_dict=False
            )[0]
        restore_vae_dtype(needs_upcast)
        return (image / 2 + 0.5).clamp(0, 1).float().permute(0, 2, 3, 1)[0].cpu().numpy()

    def sample_atlas(page: Any, view: Any, _view_index: int) -> Any:
        sampled, _known = sample_page(page, view["maps"], view["routing"])
        sampled_u8 = np.rint(np.clip(sampled, 0.0, 1.0) * 255.0).astype(np.uint8)
        image = np.asarray(
            Image.fromarray(sampled_u8, mode="RGB").resize((MODEL_WIDTH, MODEL_HEIGHT), Image.Resampling.LANCZOS),
            dtype=np.float32,
        ) / 255.0
        covered = np.repeat(
            (np.asarray(view["maps"].coverage) != 0).reshape(view["maps"].rows, view["maps"].cols), 2, axis=0
        )
        covered = np.asarray(
            Image.fromarray(covered.astype(np.uint8) * 255, mode="L").resize(
                (MODEL_WIDTH, MODEL_HEIGHT), Image.Resampling.NEAREST
            ), dtype=np.uint8,
        ) != 0
        image[~covered] = 0.5
        return image

    def encode(image: Any, _view_index: int) -> Any:
        needs_upcast, _vae_dtype = vae_io_dtype()
        encoder_dtype = next(iter(pipeline.vae.encoder.parameters())).dtype
        tensor = torch.from_numpy(image).permute(2, 0, 1).unsqueeze(0).to(device=device, dtype=encoder_dtype)
        with torch.inference_mode():
            result = pipeline.vae.encode(tensor * 2 - 1).latent_dist.mode() * pipeline.vae.config.scaling_factor
        restore_vae_dtype(needs_upcast)
        return result.to(dtype=prompt_embeds.dtype)

    def advance(latent: Any, prediction: dict[str, Any], clean: Any, _timestep: Any, step_index: int) -> Any:
        # Euler's derivative is the predicted residual (x_t - x0) / sigma.
        # Retaining it while replacing x0 with the atlas-consensus x0 produces
        # x_(t-1)=x0_consensus + sigma_(t-1)*residual, preserving the scheduler's
        # noise level for the next lock-step iteration.
        sigma = prediction["sigma"]
        if float(sigma) == 0.0:
            return clean
        residual = (latent - prediction["clean"]) / sigma
        next_sigma = pipeline.scheduler.sigmas[step_index + 1].to(device=device, dtype=latent.dtype)
        return clean + next_sigma * residual

    inference_started = time.perf_counter()
    with torch.inference_mode():
        final_latents, trace = synchronized_timestep_loop(
            initial_latents,
            timesteps,
            synchronization_start_step=args.synchronization_start_step,
            synchronization_blend=args.synchronization_blend,
            predict=predict,
            decode=decode,
            create_atlas=lambda: TexturePage(args.synchronized_texture_page_size, int(manifest.get("materialCount", 1))),
            back_project=lambda page, _state, image, index: back_project(
                page, views[index]["maps"], image, 1.0, views[index]["routing"],
                view_direction=views[index]["viewDirection"]
            ),
            sample_atlas=lambda page, _state, index: sample_atlas(page, views[index], index),
            encode=encode,
            mix_clean=lambda predicted, resampled, blend: predicted * (1.0 - blend) + resampled * blend,
            advance=advance,
        )
        final_images = [decode(latent, index) for index, latent in enumerate(final_latents)]
    inference_finished = time.perf_counter()

    model_hashes = resolved_root_hashes(args.model_root)
    control_hashes = resolved_root_hashes(args.control_root)
    reports: list[dict[str, Any]] = []
    for view, pixels in zip(views, final_images):
        output, report_path = view["output"], view["report"]
        output.parent.mkdir(parents=True, exist_ok=True)
        report_path.parent.mkdir(parents=True, exist_ok=True)
        generated = Image.fromarray(np.rint(np.clip(pixels, 0.0, 1.0) * 255.0).astype(np.uint8), mode="RGB")
        generated.save(output)
        control_path = output.with_name(f"{output.stem}-control-depth.png")
        view["control"].save(control_path)
        item = {
            "schemaVersion": "glyph-spray-generate/v1",
            "modeUsed": "synchronized",
            "requestedMode": "synchronized",
            "viewIndex": view["index"], "seed": view["seed"], "steps": args.steps,
            "guidance": args.guidance, "controlScale": args.control_scale,
            "synchronization": {
                "viewCount": args.synchronized_view_count,
                "startStep": args.synchronization_start_step,
                "blend": args.synchronization_blend,
                "atlasPageSize": args.synchronized_texture_page_size,
                "timestepTrace": trace,
            },
            "controls": {"root": str(args.controls_root.resolve()), "coverageCells": int((view["maps"].coverage != 0).sum()), "depthControl": view["depthControl"]},
            "models": {"base": model_hashes, "depthControl": control_hashes},
            "controlImage": {"path": str(control_path.resolve()), "sha256": file_sha256(control_path), "width": MODEL_WIDTH, "height": MODEL_HEIGHT},
            "outputImage": {"path": str(output.resolve()), "sha256": file_sha256(output), "mimeType": "image/png", "width": MODEL_WIDTH, "height": MODEL_HEIGHT},
            "runtime": {
                "torch": torch.__version__, "cuda": torch.version.cuda, "gpu": torch.cuda.get_device_name(0),
                "python": platform.python_version(), "loadSeconds": loaded - started,
                "pipelineReused": reused, "workerReused": worker_reused,
                "devicePlacement": _PLACEMENT.get(cache_key, "unknown"),
                "inferenceSeconds": inference_finished - inference_started,
                "peakVramBytes": int(torch.cuda.max_memory_allocated()),
                "peakReservedVramBytes": int(torch.cuda.max_memory_reserved()),
                "containerDigest": os.environ.get("GLYPH_IMAGE_DIGEST"),
            },
        }
        report_path.write_text(json.dumps(item, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        reports.append(item)
    result = {"schemaVersion": "glyph-spray-generate/synchronized/v1", "modeUsed": "synchronized", "views": reports, "runtime": reports[0]["runtime"]}
    if emit_report:
        print(json.dumps(result, sort_keys=True))
    return result


def main(
    argv: list[str] | None = None,
    *,
    emit_report: bool = True,
    worker_reused: bool | None = None,
) -> dict[str, Any]:
    """Generate one view and return its report.

    ``emit_report`` keeps the one-shot CLI's stdout contract intact while the
    persistent service can reserve stdout for its JSON-lines protocol.
    """

    args = parse(argv)
    if args.steps < 1:
        raise RuntimeError("SPRAY_GENERATE_STEPS")
    if args.guidance < 0:
        raise RuntimeError("SPRAY_GENERATE_GUIDANCE")
    if args.control_scale < 0:
        raise RuntimeError("SPRAY_GENERATE_CONTROL_SCALE")
    validate_synchronization_args(args)
    if args.dry_run_synchronized:
        report = synchronized_dry_run(args)
        if emit_report:
            print(json.dumps(report, sort_keys=True))
        return report
    if args.controls_root is None:
        raise RuntimeError("SPRAY_GENERATE_CONTROLS_ROOT_REQUIRED")
    if args.output is None:
        raise RuntimeError("SPRAY_GENERATE_OUTPUT_REQUIRED")

    # numpy/Pillow are sufficient to inspect the exact ControlNet input on a
    # CPU-only Mac.  torch and diffusers deliberately remain below the
    # --emit-control-only early return.
    try:
        import numpy as np
        from PIL import Image
    except ImportError as error:
        raise RuntimeError(
            "SPRAY_GENERATE_CONTROL_DEPENDENCIES_MISSING: install numpy and Pillow"
        ) from error

    if args.multi_view_mode == "synchronized":
        # Do not pre-load a privileged view 0: synchronized_generate loads the
        # complete manifest before its scheduler receives timestep zero.
        return synchronized_generate(
            args, np=np, Image=Image, emit_report=emit_report, worker_reused=worker_reused
        )

    frame_dir = frame_directory(args.controls_root, args.view_index)
    try:
        from spray_texture import derive_view_direction, load_control_maps
    except ImportError as error:
        raise RuntimeError("SPRAY_GENERATE_TEXTURE_HELPER_MISSING") from error
    maps = load_control_maps(frame_dir)
    if maps.cols != 256 or maps.rows != 128:
        raise RuntimeError(
            f"SPRAY_GENERATE_CONTROL_GRID: expected 256x128, received {maps.cols}x{maps.rows}"
        )

    covered = np.asarray(maps.coverage, dtype=np.uint8).reshape(maps.rows, maps.cols) != 0
    control_image, depth_control = build_depth_control(
        maps,
        depth_source=args.depth_source,
        model_width=MODEL_WIDTH,
        model_height=MODEL_HEIGHT,
        np=np,
        Image=Image,
        derive_view_direction=derive_view_direction,
    )

    args.output.parent.mkdir(parents=True, exist_ok=True)
    report_path = report_path_for(args.output, args.report)
    report_path.parent.mkdir(parents=True, exist_ok=True)
    if args.emit_control_only:
        # In this mode --output names the control itself, rather than a generated
        # image beside which to place it.  No torch/diffusers/model path is read.
        control_image.save(args.output)
        report = {
            "schemaVersion": "glyph-spray-generate/v1",
            "modeUsed": "emit-control-only",
            "viewIndex": args.view_index,
            "controls": {
                "root": str(args.controls_root.resolve()),
                "frameDirectory": str(frame_dir.resolve()),
                "coverageCells": int(covered.sum()),
                "modelRaster": {"width": maps.cols, "height": maps.rows * 2},
                "depthControl": {"width": MODEL_WIDTH, "height": MODEL_HEIGHT, **depth_control},
            },
            "controlImage": {
                "path": str(args.output.resolve()),
                "sha256": file_sha256(args.output),
                "width": MODEL_WIDTH,
                "height": MODEL_HEIGHT,
                "role": "exact depth-ControlNet conditioning input",
            },
            "runtime": {
                "python": platform.python_version(),
                "execution": "cpu-control-emission-only (numpy + Pillow; torch/diffusers not imported)",
            },
        }
        report_path.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        if emit_report:
            print(json.dumps(report, sort_keys=True))
        return report

    if args.prompt is None or args.seed is None:
        raise RuntimeError("SPRAY_GENERATE_PROMPT_AND_SEED_REQUIRED")
    mode = selected_mode(args)
    base_kind = selected_base_kind(args, mode)
    if mode == "inpaint" and (args.known_image is None or args.known_mask is None):
        raise RuntimeError("SPRAY_GENERATE_INPAINT_INPUTS_REQUIRED")

    # Keep all GPU-only imports here so --emit-control-only does not even import
    # torch on machines that have no CUDA runtime.
    try:
        import torch
        import diffusers
        from diffusers import ControlNetModel, EulerDiscreteScheduler, StableDiffusionXLControlNetPipeline
    except ImportError as error:
        raise RuntimeError(
            "SPRAY_GENERATE_GPU_DEPENDENCIES_MISSING: run this only in glyphcss-ascii-trainer:b8"
        ) from error

    if not torch.cuda.is_available():
        raise RuntimeError("SPRAY_GENERATE_CUDA_REQUIRED")

    # torch 2.5.1+cu121 on this RTX 4090 Laptop segfaults inside the fused
    # scaled-dot-product-attention kernels on the SECOND generation in a process
    # (verified: AttnProcessor2_0 -> attention_processor.py:2393 SIGSEGV on image 2,
    # while image 1 always succeeds). Math SDPA is stable: a 5-image smoke ran
    # 1.6 s/image with flat 10.07 GiB peak. This is the difference between a
    # single-shot capture like B57 and a multi-view sequential run.
    torch.backends.cuda.enable_flash_sdp(False)
    torch.backends.cuda.enable_mem_efficient_sdp(False)
    torch.backends.cuda.enable_math_sdp(True)

    # Importing through the package object permits a runtime check against the
    # actual installed diffusers build rather than assuming the lock file alone
    # implies an inpaint pipeline is exported.
    pipeline_classes = {
        "StableDiffusionXLControlNetPipeline": StableDiffusionXLControlNetPipeline,
        "StableDiffusionXLControlNetInpaintPipeline": getattr(
            diffusers, "StableDiffusionXLControlNetInpaintPipeline", None
        ),
        "StableDiffusionXLControlNetImg2ImgPipeline": getattr(
            diffusers, "StableDiffusionXLControlNetImg2ImgPipeline", None
        ),
    }
    class_availability = {name: value is not None for name, value in pipeline_classes.items()}

    known_image = None
    unknown_mask = None
    unknown_pixels = None
    if mode == "inpaint":
        if not args.known_image.is_file() or not args.known_mask.is_file():
            raise FileNotFoundError("SPRAY_GENERATE_INPAINT_INPUT_MISSING")
        known_image = Image.open(args.known_image).convert("RGB").resize(
            (MODEL_WIDTH, MODEL_HEIGHT), resample=Image.Resampling.LANCZOS
        )
        unknown_mask = Image.open(args.known_mask).convert("L").resize(
            (MODEL_WIDTH, MODEL_HEIGHT), resample=Image.Resampling.NEAREST
        )
        unknown_pixels = np.asarray(unknown_mask, dtype=np.uint8) > 0

    started = time.perf_counter()
    torch.cuda.reset_peak_memory_stats()

    if mode == "text2img":
        PipelineClass = StableDiffusionXLControlNetPipeline
        mode_used = "text2img"
    elif pipeline_classes["StableDiffusionXLControlNetInpaintPipeline"] is not None:
        PipelineClass = pipeline_classes["StableDiffusionXLControlNetInpaintPipeline"]
        mode_used = "inpaint"
    else:
        PipelineClass = pipeline_classes["StableDiffusionXLControlNetImg2ImgPipeline"]
        if PipelineClass is None:
            raise RuntimeError("SPRAY_GENERATE_NO_SDXL_CONTROLNET_INPAINT_OR_IMG2IMG_PIPELINE")
        mode_used = "img2img-mask-composite"

    # This loading block is deliberately cloned from
    # capture_native_teacher_latents.py: local roots, float16 safetensors,
    # local-files-only, and the Euler scheduler are the proven offline SDXL +
    # depth-ControlNet path. Do not add a revision or hub fallback.
    #
    # The orchestrator calls main() once per view in ONE process. Rebuilding the
    # pipeline per view reloaded ~15 GB of weights every time and stacked a second
    # set of accelerate cpu-offload hooks onto freshly constructed modules, which
    # segfaults on the first inpaint view. Cache per pipeline class and derive the
    # inpaint/img2img variants with from_pipe so they share the loaded
    # UNet/VAE/text encoders instead of allocating a second copy.
    controlnet = _CONTROLNET_CACHE.get(args.control_root)
    if controlnet is None:
        controlnet = ControlNetModel.from_pretrained(
            args.control_root,
            torch_dtype=torch.float16,
            use_safetensors=True,
            local_files_only=True,
        )
        _CONTROLNET_CACHE[args.control_root] = controlnet

    cache_key = (PipelineClass.__name__, str(args.model_root), str(args.control_root))
    pipeline = _PIPELINE_CACHE.get(cache_key)
    reused = pipeline is not None
    if pipeline is None:
        sibling = next(
            (p for (_, root, control), p in _PIPELINE_CACHE.items()
             if root == str(args.model_root) and control == str(args.control_root)),
            None,
        )
        if sibling is not None and hasattr(PipelineClass, "from_pipe"):
            pipeline = PipelineClass.from_pipe(sibling, controlnet=controlnet)
        else:
            pipeline = PipelineClass.from_pretrained(
                args.model_root,
                controlnet=controlnet,
                torch_dtype=torch.float16,
                use_safetensors=True,
                local_files_only=True,
            )
            pipeline.scheduler = EulerDiscreteScheduler.from_config(pipeline.scheduler.config)
            # accelerate's cpu-offload pre_forward hook moves modules onto the GPU
            # inside the denoise loop; over a 14-view sequential run that repeated
            # swap segfaults in torch's Module._apply recursion (verified stack:
            # pipeline_controlnet_sd_xl.py:1486 -> hooks.py:702 -> modeling_utils.to).
            # SDXL fp16 + depth ControlNet is ~9.4 GB resident, which fits this
            # 16 GB card at 512x512, so keep it on-device and only fall back to
            # offload if the allocation genuinely fails.
            try:
                pipeline.to("cuda")
                # Deliberately NO enable_attention_slicing(): it installs
                # SlicedAttnProcessor, which raises "KeyError: None" from
                # attn.to_q on this diffusers 0.31 + SDXL ControlNet stack
                # (attention_processor.py:3453). The resident fp16 pipeline fits the
                # card, so the memory it would save is unnecessary.
                pipeline.enable_vae_slicing()
                placement = "cuda-resident"
            except torch.cuda.OutOfMemoryError:
                torch.cuda.empty_cache()
                pipeline.enable_model_cpu_offload()
                placement = "model-cpu-offload"
            _PLACEMENT[cache_key] = placement
        _PIPELINE_CACHE[cache_key] = pipeline
    loaded = time.perf_counter()

    generator = torch.Generator(device="cuda").manual_seed(args.seed)
    common = {
        "prompt": args.prompt,
        "negative_prompt": args.negative_prompt,
        "width": MODEL_WIDTH,
        "height": MODEL_HEIGHT,
        "num_inference_steps": args.steps,
        "guidance_scale": args.guidance,
        "controlnet_conditioning_scale": args.control_scale,
        "generator": generator,
        "output_type": "pil",
    }
    inference_started = time.perf_counter()
    if mode_used == "text2img":
        generated = pipeline(image=control_image, **common).images[0]
    elif mode_used == "inpaint":
        generated = pipeline(
            image=known_image,
            mask_image=unknown_mask,
            control_image=control_image,
            strength=args.inpaint_strength,
            **common,
        ).images[0]
    else:
        # Diffusers 0.31.0 is checked at runtime for a native inpaint pipeline.
        # If it is absent, use a high-strength ControlNet img2img proposal and
        # then hard-composite it only into white/unknown mask pixels.  Thus an
        # already painted pixel is byte-for-byte retained despite the fallback.
        generated = pipeline(
            image=known_image,
            control_image=control_image,
            strength=args.inpaint_strength,
            **common,
        ).images[0]
    inference_finished = time.perf_counter()

    if mode == "inpaint":
        generated_pixels = np.asarray(generated.convert("RGB"), dtype=np.uint8)
        known_pixels = np.asarray(known_image, dtype=np.uint8)
        generated = Image.fromarray(np.where(unknown_pixels[..., None], generated_pixels, known_pixels), mode="RGB")
    generated.save(args.output)
    # Persist the exact ControlNet input beside the output. Without this the only
    # record of what the model was actually conditioned on is a prose description,
    # which makes the pipeline impossible to inspect or debug visually.
    control_path = args.output.with_name(f"{args.output.stem}-control-depth.png")
    control_image.save(control_path)

    # Hashing the resolved local trees is intentionally explicit provenance,
    # rather than trusting a model name or an online revision at report time.
    model_hashes = resolved_root_hashes(args.model_root)
    control_hashes = resolved_root_hashes(args.control_root)
    output_sha256 = file_sha256(args.output)
    report = {
        "schemaVersion": "glyph-spray-generate/v1",
        "modeUsed": mode_used,
        "requestedMode": mode,
        "viewIndex": args.view_index,
        "seed": args.seed,
        "steps": args.steps,
        "guidance": args.guidance,
        "controlScale": args.control_scale,
        "anchorToAuthoredRender": args.anchor_to_authored_render,
        "prompt": args.prompt,
        "negativePrompt": args.negative_prompt,
        "controls": {
            "root": str(args.controls_root.resolve()),
            "frameDirectory": str(frame_dir.resolve()),
            "coverageCells": int(covered.sum()),
            "modelRaster": {"width": maps.cols, "height": maps.rows * 2},
            "depthControl": {
                "width": MODEL_WIDTH,
                "height": MODEL_HEIGHT,
                **depth_control,
            },
        },
        "generationBase": None
        if base_kind == "none"
        else {
            "kind": base_kind,
            "path": str(args.known_image.resolve()),
            "sha256": file_sha256(args.known_image),
        },
        "inpaint": None if mode == "text2img" else {
            "base": {
                "kind": base_kind,
                "path": str(args.known_image.resolve()),
                "sha256": file_sha256(args.known_image),
            },
            "knownImage": {"path": str(args.known_image.resolve()), "sha256": file_sha256(args.known_image)},
            "unknownMask": {
                "path": str(args.known_mask.resolve()),
                "sha256": file_sha256(args.known_mask),
                "unknownPixels": int(unknown_pixels.sum()),
                "semantics": "non-zero means unknown/regenerable",
            },
            "knownPixelsHeldFixedByFinalComposite": True,
            "fallbackStrength": 0.99 if mode_used == "img2img-mask-composite" else None,
        },
        "models": {"base": model_hashes, "depthControl": control_hashes},
        "controlImage": {
            "path": str(control_path.resolve()),
            "sha256": file_sha256(control_path),
            "width": MODEL_WIDTH,
            "height": MODEL_HEIGHT,
            "role": "exact depth-ControlNet conditioning input",
        },
        "outputImage": {
            "path": str(args.output.resolve()),
            "sha256": output_sha256,
            "mimeType": "image/png",
            "width": generated.width,
            "height": generated.height,
        },
        "pipelineAvailability": {
            "classes": class_availability,
            "selectedClass": pipeline.__class__.__name__,
            "evidence": {
                "method": "runtime getattr(diffusers, className) in the executing container",
                "diffusersVersion": diffusers.__version__,
                "diffusersPackage": str(Path(diffusers.__file__).resolve()),
                "pinnedRequirements": pinned_requirements_evidence(),
            },
        },
        "runtime": {
            "torch": torch.__version__,
            "cuda": torch.version.cuda,
            "gpu": torch.cuda.get_device_name(0),
            "python": platform.python_version(),
            "loadSeconds": loaded - started,
            "pipelineReused": reused,
            "devicePlacement": _PLACEMENT.get(cache_key, "unknown"),
            "inferenceSeconds": inference_finished - inference_started,
            "peakVramBytes": int(torch.cuda.max_memory_allocated()),
            "peakReservedVramBytes": int(torch.cuda.max_memory_reserved()),
            "containerDigest": os.environ.get("GLYPH_IMAGE_DIGEST"),
        },
    }
    if worker_reused is not None:
        report["runtime"]["workerReused"] = worker_reused
    report_path.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    if emit_report:
        print(json.dumps(report, sort_keys=True))
    return report


def serve() -> None:
    """Serve one generation request per JSON line without reloading the models.

    The protocol deliberately has a single stdout response for each stdin line.
    Generation libraries occasionally write progress output themselves, so route
    any such output to stderr while a request runs.
    """

    requests_processed = 0
    for line in sys.stdin:
        try:
            request = json.loads(line)
            request_args = request.get("args") if isinstance(request, dict) else None
            if not isinstance(request_args, list) or not all(isinstance(value, str) for value in request_args):
                raise RuntimeError("SPRAY_GENERATE_SERVE_REQUEST_ARGS")
            worker_reused = requests_processed > 0
            requests_processed += 1
            with contextlib.redirect_stdout(sys.stderr):
                report = main(request_args, emit_report=False, worker_reused=worker_reused)
            response: dict[str, Any] = {"ok": True, "report": report}
        except SystemExit as error:
            response = {"ok": False, "error": f"SystemExit: {error}"}
        except Exception as error:
            response = {
                "ok": False,
                "error": f"{type(error).__name__}: {error}",
                "traceback": traceback.format_exc(),
            }
        sys.stdout.write(json.dumps(response, sort_keys=True) + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    if sys.argv[1:] == ["--serve"]:
        serve()
    else:
        main()

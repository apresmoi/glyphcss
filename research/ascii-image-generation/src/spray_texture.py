"""CPU-only authored-UV texture pages for the spray-paint proof pipeline.

This module deliberately has no renderer, CUDA, or model dependency.  It reads
the maps written by ``writeGlyphControlMaps`` and uses the exact model-raster
addressing contract: model pixel ``(x, y)`` belongs to control cell
``floor(y / 2) * cols + x``.
"""

from __future__ import annotations

from dataclasses import dataclass
import json
import math
from pathlib import Path
from typing import Any

# Must come from collections.abc, not typing: isinstance() against typing.Mapping
# raises TypeError on the container's Python 3.11 while succeeding on newer local
# interpreters, so a typing import passes Mac unit tests and fails only on the GPU.
from collections.abc import Mapping

import numpy as np
from PIL import Image


KEYFRAME_CHANNELS = 17
SURFACE_UV_VALID_PLANE = 14


@dataclass(frozen=True)
class ControlMaps:
    """The subset of one control-export frame needed by the spray pipeline."""

    cols: int
    rows: int
    coverage: np.ndarray
    surface_uv: np.ndarray
    albedo_rgb: np.ndarray
    depth_normalized: np.ndarray
    surface_id: np.ndarray
    winner_polygon: np.ndarray
    normal: np.ndarray
    world_position: np.ndarray
    shade: np.ndarray
    depth: np.ndarray
    class_id: np.ndarray
    instance_id: np.ndarray
    tensor_keyframe: np.ndarray
    metadata: Mapping[str, Any]
    index_lookups: Mapping[str, Any]
    # Optional for generic frozen control-map exports.  Authored spray scenes
    # provide this sidecar so texel back-projection never infers geometry from
    # sparse winner cells.
    polygon_uv_image: Mapping[int, tuple[tuple[np.ndarray, np.ndarray], ...]] | None = None

    @property
    def cells(self) -> int:
        return self.cols * self.rows


class TexturePage:
    """One authored-UV texture page for each material.

    ``state`` is intentionally separate from confidence: a later fill can be
    displayed or exported without pretending that it was observed by a view.
    """

    def __init__(self, size: int, material_count: int = 1, *, state_only: bool = False):
        if not isinstance(size, int) or size <= 0:
            raise ValueError("texture page size must be a positive integer")
        if not isinstance(material_count, int) or material_count <= 0:
            raise ValueError("material_count must be a positive integer")
        self.size = size
        self.material_count = material_count
        # The schedule verifier only needs the exact observed/not-observed
        # topology. Avoid allocating a 4096² RGB atlas for that CPU-only audit.
        self.rgb = None if state_only else np.zeros((material_count, size, size, 3), dtype=np.float32)
        self.confidence = np.zeros((material_count, size, size), dtype=np.float32)
        self.state = np.zeros((material_count, size, size), dtype=np.uint8)
        self.state_only = state_only


def _read_raw(path: Path, dtype: np.dtype[Any], count: int) -> np.ndarray:
    if not path.is_file():
        raise FileNotFoundError(f"required control map is missing: {path}")
    result = np.fromfile(path, dtype=dtype)
    if result.size != count:
        raise ValueError(f"invalid control map size for {path.name}: expected {count} values, found {result.size}")
    return result


def _load_polygon_uv_image(frame_dir: Path, cols: int, rows: int) -> Mapping[int, tuple[tuple[np.ndarray, np.ndarray], ...]] | None:
    """Load the opt-in exact authored-UV/control-image triangle sidecar.

    It intentionally lives outside the frozen control-map manifest.  Existing
    exports may omit it and retain cell sampling, while authored spray exports
    use it to project every atlas texel from source mesh corners rather than
    recovering an affine map from winner cells.
    """

    path = frame_dir / "polygon-uv-image.json"
    if not path.is_file():
        return None
    try:
        document = json.loads(path.read_text(encoding="utf-8"))
        grid = document["controlGrid"]
        if (
            document["schemaVersion"] != "glyph-spray-polygon-uv-image/v1"
            or grid != {"cols": cols, "rows": rows, "modelCols": cols, "modelRows": rows * 2}
            or not isinstance(document["polygons"], list)
        ):
            raise ValueError
    except (KeyError, TypeError, ValueError, json.JSONDecodeError) as error:
        raise ValueError(f"invalid exact polygon UV/image table: {path}") from error

    result: dict[int, tuple[tuple[np.ndarray, np.ndarray], ...]] = {}
    for expected_polygon, polygon in enumerate(document["polygons"]):
        try:
            if not isinstance(polygon, Mapping) or polygon["polygon"] != expected_polygon or not isinstance(polygon["triangles"], list):
                raise ValueError
            triangles: list[tuple[np.ndarray, np.ndarray]] = []
            for triangle in polygon["triangles"]:
                if not isinstance(triangle, Mapping):
                    raise ValueError
                uv = np.asarray(triangle["uv"], dtype=np.float64)
                image = np.asarray(triangle["image"], dtype=np.float64)
                if uv.shape != (3, 2) or image.shape != (3, 2) or not np.isfinite(uv).all() or not np.isfinite(image).all():
                    raise ValueError
                triangles.append((uv, image))
            result[expected_polygon] = tuple(triangles)
        except (KeyError, TypeError, ValueError) as error:
            raise ValueError(f"invalid exact polygon UV/image table: {path}") from error
    return result


def load_control_maps(frame_dir: Path) -> ControlMaps:
    """Load the exact raw-map names and dtypes emitted by ``writeGlyphControlMaps``.

    Appearance maps are opt-in in the exporter.  Spray requires the v2
    ``albedo-rgb-u32.bin`` map and fails clearly when a v1 export is supplied;
    it never reads the lit ``target-rgb-u32.bin`` map.
    """

    frame_dir = Path(frame_dir)
    metadata_path = frame_dir / "metadata.json"
    lookups_path = frame_dir / "index-lookups.json"
    if not metadata_path.is_file():
        raise FileNotFoundError(f"required control metadata is missing: {metadata_path}")
    if not lookups_path.is_file():
        raise FileNotFoundError(f"required control lookups are missing: {lookups_path}")
    metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    index_lookups = json.loads(lookups_path.read_text(encoding="utf-8"))
    try:
        cols = int(metadata["cols"])
        rows = int(metadata["rows"])
    except (KeyError, TypeError, ValueError) as error:
        raise ValueError("metadata.json must contain integer cols and rows") from error
    if cols <= 0 or rows <= 0:
        raise ValueError("metadata.json cols and rows must be positive")
    cells = cols * rows

    # All maps are written from JS typed arrays, which are little-endian in the
    # frozen artifact contract.  Keep them one-dimensional where that reflects
    # the on-disk map and reshape vector/tensor maps only after validating size.
    coverage = _read_raw(frame_dir / "coverage-u8.bin", np.dtype("<u1"), cells)
    surface_uv = _read_raw(frame_dir / "surface-uv-f32.bin", np.dtype("<f4"), 2 * cells).reshape(cells, 2)
    albedo_rgb = _read_raw(frame_dir / "albedo-rgb-u32.bin", np.dtype("<u4"), cells)
    depth_normalized = _read_raw(frame_dir / "depth-normalized-f32.bin", np.dtype("<f4"), cells)
    surface_id = _read_raw(frame_dir / "surface-id-i32.bin", np.dtype("<i4"), cells)
    winner_polygon = _read_raw(frame_dir / "winner-polygon-i32.bin", np.dtype("<i4"), cells)
    normal = _read_raw(frame_dir / "normal-f32.bin", np.dtype("<f4"), 3 * cells).reshape(cells, 3)
    world_position = _read_raw(frame_dir / "world-position-f32.bin", np.dtype("<f4"), 3 * cells).reshape(cells, 3)
    shade = _read_raw(frame_dir / "shade-f32.bin", np.dtype("<f4"), cells)
    depth = _read_raw(frame_dir / "depth-f64.bin", np.dtype("<f8"), cells)
    class_id = _read_raw(frame_dir / "class-id-i32.bin", np.dtype("<i4"), cells)
    instance_id = _read_raw(frame_dir / "instance-id-i32.bin", np.dtype("<i4"), cells)
    tensor_keyframe = _read_raw(
        frame_dir / "tensor-keyframe-f32.bin", np.dtype("<f4"), KEYFRAME_CHANNELS * cells
    ).reshape(KEYFRAME_CHANNELS, cells)
    polygon_uv_image = _load_polygon_uv_image(frame_dir, cols, rows)

    return ControlMaps(
        cols=cols,
        rows=rows,
        coverage=coverage,
        surface_uv=surface_uv,
        albedo_rgb=albedo_rgb,
        depth_normalized=depth_normalized,
        surface_id=surface_id,
        winner_polygon=winner_polygon,
        normal=normal,
        world_position=world_position,
        shade=shade,
        depth=depth,
        class_id=class_id,
        instance_id=instance_id,
        tensor_keyframe=tensor_keyframe,
        metadata=metadata,
        index_lookups=index_lookups,
        polygon_uv_image=polygon_uv_image,
    )


def derive_view_direction(maps: ControlMaps) -> tuple[np.ndarray, dict[str, Any]]:
    """Recover an orthographic camera's world-space view direction from depth.

    Glyphcss's orthographic depth is affine in world position.  Fitting the
    relation from the emitted maps avoids relying on a renderer-coordinate or
    camera-sign convention in this independent pipeline.
    """

    coverage = np.asarray(maps.coverage)
    world_position = np.asarray(maps.world_position, dtype=np.float64)
    depth = np.asarray(maps.depth, dtype=np.float64)
    if coverage.shape != (maps.cells,):
        raise ValueError("coverage must have shape (cols * rows,)")
    if world_position.shape != (maps.cells, 3):
        raise ValueError("world_position must have shape (cols * rows, 3)")
    if depth.shape != (maps.cells,):
        raise ValueError("depth must have shape (cols * rows,)")

    usable = (coverage != 0) & np.isfinite(world_position).all(axis=1) & np.isfinite(depth)
    sample_count = int(usable.sum())
    if sample_count < 64:
        raise ValueError(f"orthographic view-direction fit needs at least 64 usable cells, found {sample_count}")
    positions = world_position[usable]
    samples = depth[usable]
    design = np.column_stack((positions, np.ones(sample_count, dtype=np.float64)))
    coefficients, _, rank, _ = np.linalg.lstsq(design, samples, rcond=None)
    if rank < 4:
        raise ValueError("orthographic view-direction fit is degenerate")
    residual_rms = float(np.sqrt(np.mean((design @ coefficients - samples) ** 2)))
    depth_range = float(np.ptp(samples))
    tolerance = max(1e-10, depth_range * 1e-5)
    if residual_rms > tolerance:
        raise ValueError(
            "orthographic view-direction fit residual is too large: "
            f"rms={residual_rms:.6g}, tolerance={tolerance:.6g}"
        )
    direction = coefficients[:3]
    direction_norm = float(np.linalg.norm(direction))
    if not np.isfinite(direction_norm) or direction_norm <= 1e-12:
        raise ValueError("orthographic view-direction fit has zero-length direction")
    return (direction / direction_norm).astype(np.float64), {
        "sampleCount": sample_count,
        "residualRms": residual_rms,
        "coefficients": [float(value) for value in coefficients],
    }


def _uv_valid_plane(maps: ControlMaps) -> np.ndarray:
    tensor = np.asarray(maps.tensor_keyframe)
    if tensor.shape == (KEYFRAME_CHANNELS, maps.cells):
        return tensor[SURFACE_UV_VALID_PLANE]
    if tensor.ndim == 1 and tensor.size == KEYFRAME_CHANNELS * maps.cells:
        return tensor.reshape(KEYFRAME_CHANNELS, maps.cells)[SURFACE_UV_VALID_PLANE]
    raise ValueError("tensor_keyframe must contain exactly 17 planes of cols * rows values")


def uv_valid_mask(maps: ControlMaps) -> np.ndarray:
    """Return covered cells with finite authored UVs and keyframe plane 14 set.

    Plane 14 is required even when a UV happens to be finite: normalized planes
    12--13 encode unavailable UVs as zero and therefore cannot distinguish a
    missing mapping from the valid authored corner ``(0, 0)``.
    """

    uv = np.asarray(maps.surface_uv)
    if uv.shape != (maps.cells, 2):
        raise ValueError("surface_uv must have shape (cols * rows, 2)")
    coverage = np.asarray(maps.coverage)
    if coverage.shape != (maps.cells,):
        raise ValueError("coverage must have shape (cols * rows,)")
    return (coverage != 0) & np.isfinite(uv).all(axis=1) & (_uv_valid_plane(maps) > 0)


def _wrapped_uv(value: float) -> tuple[float, bool]:
    """Wrap only out-of-range OBJ coordinates; keep exact 0/1 edge semantics."""

    if value < 0.0 or value > 1.0:
        return float(np.mod(value, 1.0)), True
    return value, False


def _texel_for_uv(size: int, uv: np.ndarray) -> tuple[int, int, bool]:
    u, wrapped_u = _wrapped_uv(float(uv[0]))
    v, wrapped_v = _wrapped_uv(float(uv[1]))
    x = min(max(int(np.floor(u * size)), 0), size - 1)
    y = min(max(int(np.floor(v * size)), 0), size - 1)
    return y, x, wrapped_u or wrapped_v


def _bilinear_image(pixels: np.ndarray, coordinates: np.ndarray) -> np.ndarray:
    """Sample an image at pixel-centre coordinates with clamped bilinear taps."""

    height, width = pixels.shape[:2]
    x = np.clip(coordinates[:, 0], 0.0, width - 1.0)
    y = np.clip(coordinates[:, 1], 0.0, height - 1.0)
    x0 = np.floor(x).astype(np.intp)
    y0 = np.floor(y).astype(np.intp)
    x1 = np.minimum(x0 + 1, width - 1)
    y1 = np.minimum(y0 + 1, height - 1)
    dx = (x - x0)[:, None]
    dy = (y - y0)[:, None]
    return (
        pixels[y0, x0] * (1.0 - dx) * (1.0 - dy)
        + pixels[y0, x1] * dx * (1.0 - dy)
        + pixels[y1, x0] * (1.0 - dx) * dy
        + pixels[y1, x1] * dx * dy
    )


def _material_for_cell(material_of_cell: Any, maps: ControlMaps, cell: int) -> int | None:
    """Support the runner's per-cell array and convenient test/caller adapters."""

    if callable(material_of_cell):
        try:
            value = material_of_cell(cell)
        except TypeError:
            value = material_of_cell(maps, cell)
    elif isinstance(material_of_cell, Mapping):
        value = material_of_cell.get(int(maps.surface_id[cell]))
    else:
        values = np.asarray(material_of_cell)
        value = values.item() if values.ndim == 0 else values[cell]
    try:
        material = int(value)
    except (TypeError, ValueError, OverflowError):
        return None
    return material


def _bilinear_known(page: TexturePage, material: int, uv: np.ndarray) -> tuple[np.ndarray, float]:
    """Bilinearly sample observed texels, without black bleeding from unknowns."""

    u, _ = _wrapped_uv(float(uv[0]))
    v, _ = _wrapped_uv(float(uv[1]))
    # UV indexing in the spec is floor(u * size).  Use the same coordinate for
    # samples so a just-back-projected UV round-trips to its texel exactly.
    fx, fy = u * page.size, v * page.size
    x0 = min(max(int(np.floor(fx)), 0), page.size - 1)
    y0 = min(max(int(np.floor(fy)), 0), page.size - 1)
    x1 = min(x0 + 1, page.size - 1)
    y1 = min(y0 + 1, page.size - 1)
    dx, dy = fx - np.floor(fx), fy - np.floor(fy)
    weights = ((y0, x0, (1.0 - dx) * (1.0 - dy)), (y0, x1, dx * (1.0 - dy)),
               (y1, x0, (1.0 - dx) * dy), (y1, x1, dx * dy))
    rgb_sum = np.zeros(3, dtype=np.float32)
    confidence_sum = 0.0
    for y, x, sample_weight in weights:
        confidence = float(page.confidence[material, y, x])
        weighted_confidence = sample_weight * confidence
        rgb_sum += page.rgb[material, y, x] * weighted_confidence
        confidence_sum += weighted_confidence
    if confidence_sum == 0.0:
        return rgb_sum, 0.0
    return rgb_sum / confidence_sum, confidence_sum


def sample_page(
    page: TexturePage, maps: ControlMaps, material_of_cell: Any
) -> tuple[np.ndarray, np.ndarray]:
    """Sample authored-UV pages into the model's rows*2 by cols raster."""

    image = np.zeros((maps.rows * 2, maps.cols, 3), dtype=np.float32)
    known = np.zeros((maps.rows * 2, maps.cols), dtype=bool)
    valid = uv_valid_mask(maps)
    for cell in np.flatnonzero(valid):
        material = _material_for_cell(material_of_cell, maps, int(cell))
        if material is None or material < 0 or material >= page.material_count:
            continue
        rgb, confidence = _bilinear_known(page, material, maps.surface_uv[cell])
        if confidence <= 0.0:
            continue
        row, col = divmod(int(cell), maps.cols)
        image[row * 2:row * 2 + 2, col] = rgb
        known[row * 2:row * 2 + 2, col] = True
    return image, known


def sample_page_known(page: TexturePage, maps: ControlMaps, material_of_cell: Any) -> np.ndarray:
    """Return only the inherited-pixel mask, including bilinear confidence gates.

    This is deliberately equivalent to ``sample_page(...)[1]`` but supports a
    state-only page for a full-resolution, before-GPU schedule audit.
    """

    known = np.zeros((maps.rows * 2, maps.cols), dtype=bool)
    valid = uv_valid_mask(maps)
    for cell in np.flatnonzero(valid):
        material = _material_for_cell(material_of_cell, maps, int(cell))
        if material is None or material < 0 or material >= page.material_count:
            continue
        u, _ = _wrapped_uv(float(maps.surface_uv[cell, 0]))
        v, _ = _wrapped_uv(float(maps.surface_uv[cell, 1]))
        fx, fy = u * page.size, v * page.size
        x0 = min(max(int(np.floor(fx)), 0), page.size - 1)
        y0 = min(max(int(np.floor(fy)), 0), page.size - 1)
        x1, y1 = min(x0 + 1, page.size - 1), min(y0 + 1, page.size - 1)
        dx, dy = fx - np.floor(fx), fy - np.floor(fy)
        confidence = (
            page.confidence[material, y0, x0] * (1.0 - dx) * (1.0 - dy)
            + page.confidence[material, y0, x1] * dx * (1.0 - dy)
            + page.confidence[material, y1, x0] * (1.0 - dx) * dy
            + page.confidence[material, y1, x1] * dx * dy
        )
        if confidence > 0.0:
            row, col = divmod(int(cell), maps.cols)
            known[row * 2:row * 2 + 2, col] = True
    return known


def back_project(
    page: TexturePage,
    maps: ControlMaps,
    image: np.ndarray,
    weight: float,
    material_of_cell: Any,
    *,
    view_direction: np.ndarray | None = None,
    incidence_weighting: bool = True,
    grazing_threshold: float = 0.15,
    sampling: str = "texel",
    prefer_new_observation: bool = False,
) -> dict[str, int | float]:
    """Accumulate a generated model image into authored UV texture pages.

    Authored spray exports provide exact source-mesh UV triangles paired with
    the camera projection used for their control frame.  We rasterise those
    triangles at atlas-texel centres, use the same barycentric coordinates to
    locate the generated image pixel, then bilinearly sample it.  Thus a 512 px
    generation survives as texel detail instead of being collapsed to the 256 x
    128 control grid first.  ``sampling = \"cell\"`` remains a deliberately
    explicit compatibility/measurement mode; old generic exports with no
    auxiliary triangle table retain that conservative cell-level path.
    """

    pixels = np.asarray(image, dtype=np.float32)
    if pixels.ndim != 3 or pixels.shape[2] != 3 or pixels.shape[0] <= 0 or pixels.shape[1] <= 0:
        raise ValueError("image must have shape (height, width, 3) with positive dimensions")
    if not np.isfinite(weight) or weight <= 0.0:
        raise ValueError("weight must be finite and greater than zero")
    if not np.isfinite(grazing_threshold) or not 0.0 <= grazing_threshold < 1.0:
        raise ValueError("grazing_threshold must be finite and in [0, 1)")
    if sampling not in {"texel", "cell"}:
        raise ValueError('sampling must be either "texel" or "cell"')

    stats: dict[str, int | float] = {
        "cells_total": maps.cells,
        "cells_covered": 0,
        "cells_valid_uv": 0,
        "cells_projected": 0,
        "cells_skipped_uncovered": 0,
        "cells_skipped_no_uv": 0,
        "cells_skipped_uv_invalid_plane": 0,
        "cells_skipped_uv_nonfinite": 0,
        "cells_skipped_invalid_material": 0,
        "cells_skipped_nonfinite_color": 0,
        "cells_skipped_grazing": 0,
        "cells_skipped_no_normal": 0,
        "texels_written": 0,
        "texels_new": 0,
        "texels_refined": 0,
        "uvs_wrapped": 0,
        "incidence_sum": 0.0,
        # Keep the cell-level keys above for the frozen report/validator
        # contract.  These describe the old gates; the following keys make the
        # new texel-resolution work separately inspectable.
        "polygons_total": 0,
        "polygons_reconstructed": 0,
        "polygons_fallback_cell_sampling": 0,
        "texels_total_candidates": 0,
        "texels_covered": 0,
        "texels_valid_uv": 0,
        "texels_projected": 0,
        "texels_skipped_uncovered": 0,
        "texels_skipped_no_uv": 0,
        "texels_skipped_uv_invalid_plane": 0,
        "texels_skipped_uv_nonfinite": 0,
        "texels_skipped_invalid_material": 0,
        "texels_skipped_nonfinite_color": 0,
        "texels_skipped_grazing": 0,
        "texels_skipped_no_normal": 0,
    }
    coverage = np.asarray(maps.coverage)
    uv = np.asarray(maps.surface_uv)
    plane = _uv_valid_plane(maps)
    if coverage.shape != (maps.cells,) or uv.shape != (maps.cells, 2):
        raise ValueError("control map cell arrays do not match metadata cols * rows")
    normal: np.ndarray | None = None
    normalized_view_direction: np.ndarray | None = None
    if incidence_weighting:
        normal = np.asarray(maps.normal, dtype=np.float64)
        if normal.shape != (maps.cells, 3):
            raise ValueError("normal must have shape (cols * rows, 3)")
        if view_direction is None:
            view_direction, _ = derive_view_direction(maps)
        normalized_view_direction = np.asarray(view_direction, dtype=np.float64)
        if normalized_view_direction.shape != (3,) or not np.isfinite(normalized_view_direction).all():
            raise ValueError("view_direction must be a finite three-vector")
        direction_norm = float(np.linalg.norm(normalized_view_direction))
        if direction_norm <= 1e-12:
            raise ValueError("view_direction must be non-zero")
        normalized_view_direction /= direction_norm

    # First apply every historic *cell* gate exactly once.  This preserves the
    # report's established counters while producing the trusted source-cell
    # gates applied to each exact projected triangle.
    eligible = np.zeros(maps.cells, dtype=bool)
    cell_material = np.full(maps.cells, -1, dtype=np.int32)
    cell_incidence = np.zeros(maps.cells, dtype=np.float64)
    cell_color = np.full((maps.cells, 3), np.nan, dtype=np.float32)
    cell_wrote = np.zeros(maps.cells, dtype=bool)
    cell_coordinates = np.column_stack((
        np.arange(maps.cells, dtype=np.float64) % maps.cols + 0.5,
        (np.arange(maps.cells, dtype=np.float64) // maps.cols) * 2.0 + 1.0,
    ))
    model_scale = np.array((pixels.shape[1] / maps.cols, pixels.shape[0] / (maps.rows * 2)), dtype=np.float64)
    representative_colours = _bilinear_image(pixels, cell_coordinates * model_scale - 0.5)

    for cell in range(maps.cells):
        if coverage[cell] == 0:
            stats["cells_skipped_uncovered"] += 1
            continue
        stats["cells_covered"] += 1
        if not plane[cell] > 0:
            stats["cells_skipped_no_uv"] += 1
            stats["cells_skipped_uv_invalid_plane"] += 1
            continue
        if not np.isfinite(uv[cell]).all():
            stats["cells_skipped_no_uv"] += 1
            stats["cells_skipped_uv_nonfinite"] += 1
            continue
        stats["cells_valid_uv"] += 1
        material = _material_for_cell(material_of_cell, maps, cell)
        if material is None or material < 0 or material >= page.material_count:
            stats["cells_skipped_invalid_material"] += 1
            continue
        color = representative_colours[cell]
        if not np.isfinite(color).all():
            stats["cells_skipped_nonfinite_color"] += 1
            continue
        incidence = 1.0
        if incidence_weighting:
            assert normal is not None and normalized_view_direction is not None
            cell_normal = normal[cell]
            normal_norm = float(np.linalg.norm(cell_normal))
            if not np.isfinite(cell_normal).all() or not np.isfinite(normal_norm) or normal_norm <= 1e-12:
                stats["cells_skipped_no_normal"] += 1
                continue
            incidence = abs(float(np.dot(cell_normal / normal_norm, normalized_view_direction)))
            if incidence < grazing_threshold:
                stats["cells_skipped_grazing"] += 1
                continue
        _, _, wrapped = _texel_for_uv(page.size, uv[cell])
        if wrapped:
            stats["uvs_wrapped"] += 1
        eligible[cell] = True
        cell_material[cell] = material
        cell_incidence[cell] = incidence
        cell_color[cell] = color

    def write_samples(
        material: int, texel_y: np.ndarray, texel_x: np.ndarray, colors: np.ndarray, incidences: np.ndarray,
    ) -> None:
        """Write an observation, optionally letting a detail observation replace it."""

        old_confidence = page.confidence[material, texel_y, texel_x]
        sample_weight = (weight * incidences).astype(np.float32)
        if page.state_only:
            # The verifier reconstructs only visibility state; RGB is neither
            # observed nor used, so skip its large allocation and blend.
            pass
        elif prefer_new_observation:
            page.rgb[material, texel_y, texel_x] = colors
            stats["texels_refined"] += int((old_confidence > 0.0).sum())
        else:
            page.rgb[material, texel_y, texel_x] = (
                page.rgb[material, texel_y, texel_x] * old_confidence[:, None] + colors * sample_weight[:, None]
            ) / (old_confidence[:, None] + sample_weight[:, None])
        page.confidence[material, texel_y, texel_x] = np.minimum(1.0, old_confidence + sample_weight)
        page.state[material, texel_y, texel_x] = 1
        stats["texels_new"] += int((old_confidence == 0.0).sum())
        stats["texels_written"] += len(texel_y)
        stats["texels_projected"] += len(texel_y)

    def project_triangle(
        polygon: int, material: int, triangle_uv: np.ndarray, triangle_image: np.ndarray,
        claimed: np.ndarray, row_start: int | None = None, row_end: int | None = None,
    ) -> None:
        """Rasterise one UV triangle, then gate its texels against winner cells."""

        edge_a = triangle_uv[1] - triangle_uv[0]
        edge_b = triangle_uv[2] - triangle_uv[0]
        determinant = float(edge_a[0] * edge_b[1] - edge_a[1] * edge_b[0])
        if abs(determinant) <= 1e-12:
            return
        low = np.ceil(np.min(triangle_uv, axis=0) * page.size - 0.5).astype(np.intp)
        high = np.floor(np.max(triangle_uv, axis=0) * page.size - 0.5).astype(np.intp)
        x0, y0 = np.maximum(low, 0)
        x1, y1 = np.minimum(high, page.size - 1)
        if x0 > x1 or y0 > y1:
            return
        # Large, valid UV triangles are common (a face can span an entire
        # 1024² page).  Keep rasterisation bounded on CPU: the chunks are
        # disjoint texel rows and therefore preserve the exact candidate and
        # blend semantics of one large batch without a giant temporary grid.
        if row_start is None:
            width = int(x1 - x0 + 1)
            row_batch = max(1, 65_536 // width)
            if y1 - y0 + 1 > row_batch:
                for batch_y0 in range(int(y0), int(y1) + 1, row_batch):
                    project_triangle(
                        polygon, material, triangle_uv, triangle_image, claimed,
                        batch_y0, min(int(y1), batch_y0 + row_batch - 1),
                    )
                return
        else:
            y0 = max(y0, row_start)
            y1 = min(y1, row_end if row_end is not None else y1)
            if y0 > y1:
                return
        texel_y_grid, texel_x_grid = np.mgrid[y0:y1 + 1, x0:x1 + 1]
        texel_uv = np.column_stack(((texel_x_grid.ravel() + 0.5) / page.size, (texel_y_grid.ravel() + 0.5) / page.size))
        relative = texel_uv - triangle_uv[0]
        barycentric = np.column_stack((
            1.0 - (relative[:, 0] * edge_b[1] - relative[:, 1] * edge_b[0]) / determinant
                - (edge_a[0] * relative[:, 1] - edge_a[1] * relative[:, 0]) / determinant,
            (relative[:, 0] * edge_b[1] - relative[:, 1] * edge_b[0]) / determinant,
            (edge_a[0] * relative[:, 1] - edge_a[1] * relative[:, 0]) / determinant,
        ))
        inside = (barycentric >= -1e-8).all(axis=1)
        texel_y, texel_x, texel_uv, barycentric = (
            texel_y_grid.ravel()[inside], texel_x_grid.ravel()[inside], texel_uv[inside], barycentric[inside]
        )
        if not len(texel_y):
            return
        fresh = ~claimed[texel_y, texel_x]
        texel_y, texel_x, texel_uv, barycentric = texel_y[fresh], texel_x[fresh], texel_uv[fresh], barycentric[fresh]
        if not len(texel_y):
            return
        claimed[texel_y, texel_x] = True
        stats["texels_total_candidates"] += len(texel_y)

        # Exact barycentric interpolation of authored projected corners.  Never
        # fit this mapping from sparse winner cells: grazing faces can make a
        # line-like fit explode across an unrelated UV footprint.
        projected = barycentric @ triangle_image
        model_coordinates = projected * model_scale - 0.5
        control_x = projected[:, 0]
        control_y = projected[:, 1]
        columns = np.floor(control_x).astype(np.intp)
        rows = np.floor(control_y / 2.0).astype(np.intp)
        in_frame = (columns >= 0) & (columns < maps.cols) & (rows >= 0) & (rows < maps.rows)
        source_cell = np.full(len(texel_y), -1, dtype=np.intp)
        source_cell[in_frame] = rows[in_frame] * maps.cols + columns[in_frame]
        owns = in_frame & (coverage[np.maximum(source_cell, 0)] != 0) & (maps.winner_polygon[np.maximum(source_cell, 0)] == polygon)
        stats["texels_skipped_uncovered"] += int((~owns).sum())
        stats["texels_covered"] += int(owns.sum())
        if not owns.any():
            return
        texel_y, texel_x, model_coordinates, source_cell = (
            texel_y[owns], texel_x[owns], model_coordinates[owns], source_cell[owns]
        )
        source_has_uv_plane = plane[source_cell] > 0
        source_uv_finite = np.isfinite(uv[source_cell]).all(axis=1)
        source_valid_uv = source_has_uv_plane & source_uv_finite
        stats["texels_skipped_no_uv"] += int((~source_valid_uv).sum())
        stats["texels_skipped_uv_invalid_plane"] += int((~source_has_uv_plane).sum())
        stats["texels_skipped_uv_nonfinite"] += int((source_has_uv_plane & ~source_uv_finite).sum())
        stats["texels_valid_uv"] += int(source_valid_uv.sum())
        if not source_valid_uv.any():
            return
        texel_y, texel_x, model_coordinates, source_cell = (
            texel_y[source_valid_uv], texel_x[source_valid_uv], model_coordinates[source_valid_uv], source_cell[source_valid_uv]
        )
        right_material = cell_material[source_cell] == material
        stats["texels_skipped_invalid_material"] += int((~right_material).sum())
        if not right_material.any():
            return
        texel_y, texel_x, model_coordinates, source_cell = (
            texel_y[right_material], texel_x[right_material], model_coordinates[right_material], source_cell[right_material]
        )
        colors = _bilinear_image(pixels, model_coordinates)
        finite_color = np.isfinite(colors).all(axis=1)
        stats["texels_skipped_nonfinite_color"] += int((~finite_color).sum())
        if not finite_color.any():
            return
        texel_y, texel_x, source_cell, colors = (
            texel_y[finite_color], texel_x[finite_color], source_cell[finite_color], colors[finite_color]
        )
        incidences = cell_incidence[source_cell]
        # Cells rejected for grazing/non-finite normals never reach a triangle,
        # but retain the texel-level counter for malformed maps.
        valid_incidence = np.isfinite(incidences) & (incidences >= grazing_threshold)
        stats["texels_skipped_grazing"] += int((~valid_incidence).sum())
        if not valid_incidence.any():
            return
        texel_y, texel_x, source_cell, colors, incidences = (
            texel_y[valid_incidence], texel_x[valid_incidence], source_cell[valid_incidence], colors[valid_incidence], incidences[valid_incidence]
        )
        write_samples(material, texel_y, texel_x, colors, incidences)
        cell_wrote[source_cell] = True

    if sampling == "cell":
        # This is intentionally not the default.  It preserves the pre-D0
        # measurement path so the runner and tests can demonstrate that the
        # texel path, not a changed gate, is responsible for denser coverage.
        for cell in np.flatnonzero(eligible):
            material = int(cell_material[cell])
            texel_y, texel_x, _ = _texel_for_uv(page.size, uv[cell])
            stats["texels_total_candidates"] += 1
            stats["texels_covered"] += 1
            stats["texels_valid_uv"] += 1
            write_samples(
                material,
                np.asarray([texel_y]),
                np.asarray([texel_x]),
                cell_color[cell:cell + 1],
                cell_incidence[cell:cell + 1],
            )
            cell_wrote[cell] = True
        stats["cells_projected"] = int(cell_wrote.sum())
        stats["incidence_sum"] = float(cell_incidence[cell_wrote].sum())
        return stats

    # Group eligible samples by winner polygon.  The exact source-triangle
    # sidecar is opt-in, so old generic exports retain a conservative per-cell
    # compatibility path rather than inventing a polygon from winner samples.
    groups: dict[int, np.ndarray] = {}
    for polygon in np.unique(maps.winner_polygon[eligible]):
        groups[int(polygon)] = np.flatnonzero(eligible & (maps.winner_polygon == polygon))
    stats["polygons_total"] = len(groups)
    for polygon, cells in groups.items():
        material = int(cell_material[cells[0]])
        triangles = None if maps.polygon_uv_image is None else maps.polygon_uv_image.get(polygon)
        if not triangles:
            stats["polygons_fallback_cell_sampling"] += 1
            for cell in cells:
                texel_y, texel_x, _ = _texel_for_uv(page.size, uv[cell])
                stats["texels_total_candidates"] += 1
                stats["texels_covered"] += 1
                stats["texels_valid_uv"] += 1
                write_samples(material, np.asarray([texel_y]), np.asarray([texel_x]), cell_color[cell:cell + 1], cell_incidence[cell:cell + 1])
                cell_wrote[cell] = True
            continue
        stats["polygons_reconstructed"] += 1
        claimed = np.zeros((page.size, page.size), dtype=bool)
        for triangle_uv, triangle_image in triangles:
            project_triangle(polygon, material, triangle_uv, triangle_image, claimed)

    stats["cells_projected"] = int(cell_wrote.sum())
    stats["incidence_sum"] = float(cell_incidence[cell_wrote].sum())
    return stats


def load_authored_polygon_classes(obj_path: Path, scene_path: Path) -> tuple[np.ndarray, dict[int, dict[str, Any]]]:
    """Recover every cabin OBJ face class from its authored scene declaration.

    The OBJ retains one face per source polygon in the exact atlas-layout
    order.  Its material remains the authored control colour, so no class is
    inferred from sparse winner cells.  Cabin gables/canopies are allowed to
    be triangles; they still own exactly one identity-mapped chart each.
    """

    try:
        document = json.loads(Path(scene_path).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ValueError(f"invalid authored cabin scene: {scene_path}") from error
    raw_classes = document.get("classes") if isinstance(document, Mapping) else None
    if not isinstance(document, Mapping) or document.get("schemaVersion") != "glyph-authored-cabin/v1" or not isinstance(raw_classes, list):
        raise ValueError(f"invalid authored cabin scene: {scene_path}")

    by_material: dict[str, int] = {}
    classes: dict[int, dict[str, Any]] = {}
    for entry in raw_classes:
        if not isinstance(entry, Mapping):
            raise ValueError(f"invalid authored cabin scene: {scene_path}")
        class_id, class_name, base_color, glyph = entry.get("id"), entry.get("name"), entry.get("controlColor"), entry.get("semanticGlyph")
        if (
            not isinstance(class_id, int) or class_id < 0
            or not isinstance(class_name, str) or not class_name
            or not isinstance(glyph, str) or len(glyph) != 1
            or not isinstance(base_color, str) or not base_color.startswith("#") or len(base_color) != 7
        ):
            raise ValueError(f"invalid authored cabin scene: {scene_path}")
        material = f"glyph_{base_color[1:].lower()}"
        if material in by_material or class_id in classes:
            raise ValueError(f"ambiguous authored class mapping: {mapping_path}")
        by_material[material] = class_id
        classes[class_id] = {"glyph": glyph, "name": class_name, "baseColor": base_color.lower()}

    current: int | None = None
    face_classes: list[int] = []
    for line_number, raw in enumerate(Path(obj_path).read_text(encoding="utf-8").splitlines(), start=1):
        fields = raw.strip().split()
        if not fields:
            continue
        if fields[0] == "usemtl":
            if len(fields) != 2 or fields[1].lower() not in by_material:
                raise ValueError(f"unmapped authored material at {obj_path}:{line_number}")
            current = by_material[fields[1].lower()]
        elif fields[0] == "f":
            if current is None or len(fields) < 4:
                raise ValueError(f"invalid authored face at {obj_path}:{line_number}")
            face_classes.append(current)
    if not face_classes:
        raise ValueError(f"authored OBJ has no faces: {obj_path}")
    return np.asarray(face_classes, dtype=np.int16), classes


def packed_face_class_map(size: int, face_classes: np.ndarray, atlas_layout: Mapping[str, Any]) -> np.ndarray:
    """Build a class map from the area-proportional authored cabin charts.

    ``atlas-layout.json`` records one rectangle per source face, with the
    strict identity ``face == cell``.  The whole outer rectangle is assigned
    its face class, including the chart-edge gutter, so fill never samples an
    unrelated neighbouring chart.  The layout is scale independent: a dry
    1024² repaint audit and the real 4096² page see the same topology.
    """

    if not isinstance(size, int) or size <= 0:
        raise ValueError("texture page size must be a positive integer")
    face_classes = np.asarray(face_classes)
    if face_classes.ndim != 1 or not face_classes.size or not np.issubdtype(face_classes.dtype, np.integer):
        raise ValueError("face_classes must be a non-empty integer vector")
    if (
        atlas_layout.get("schemaVersion") != "glyph-authored-atlas-layout/v1"
        or atlas_layout.get("faceToCell") != "identity"
        or not isinstance(atlas_layout.get("referenceSize"), int)
        or atlas_layout["referenceSize"] <= 0
        or not isinstance(atlas_layout.get("charts"), list)
        or len(atlas_layout["charts"]) != face_classes.size
    ):
        raise ValueError("invalid authored atlas layout")
    result = np.full((size, size), -1, dtype=np.int16)
    reference_size = int(atlas_layout["referenceSize"])
    for face, chart in enumerate(atlas_layout["charts"]):
        outer = chart.get("outer") if isinstance(chart, Mapping) else None
        if (
            not isinstance(chart, Mapping) or chart.get("face") != face or chart.get("cell") != face
            or not isinstance(outer, Mapping)
            or not all(isinstance(outer.get(key), int) for key in ("x", "y", "width", "height"))
            or outer["x"] < 0 or outer["y"] < 0 or outer["width"] <= 0 or outer["height"] <= 0
            or outer["x"] + outer["width"] > reference_size or outer["y"] + outer["height"] > reference_size
        ):
            raise ValueError("invalid authored atlas chart")
        x0 = (outer["x"] * size) // reference_size
        x1 = math.ceil((outer["x"] + outer["width"]) * size / reference_size)
        y0 = (outer["y"] * size) // reference_size
        y1 = math.ceil((outer["y"] + outer["height"]) * size / reference_size)
        result[y0:y1, x0:x1] = face_classes[face]
    return result


def fill_unknown(page: TexturePage, class_map: np.ndarray | None = None) -> dict[str, int]:
    """Fill remaining texels from the nearest observed texel in Manhattan space.

    No chart mask exists on ``TexturePage`` itself, so only materials with at
    least one observed texel are filled.  An entirely unobserved page remains
    state 0 rather than silently inventing texture data.

    When a packed authored ``class_map`` is supplied, fill with the mean of
    *observed texels in the same authored class*.  This is intentionally a
    palette-safe fill rather than a spatial flood: packed chart neighbours are
    unrelated faces, so their apparent proximity must not mix roof, wall, and
    lawn colours.  A class with no observations falls back to that material
    page's observed global mean.  ``state == 2`` still marks every invention.
    """

    from collections import deque

    if class_map is not None:
        class_map = np.asarray(class_map)
        if class_map.shape != (page.size, page.size) or not np.issubdtype(class_map.dtype, np.integer):
            raise ValueError("class_map must be an integer array with shape (page.size, page.size)")

    stats = {
        "texels_filled": 0,
        "materials_without_observations": 0,
        "classes_without_observations": 0,
        "unclassified_texels_filled": 0,
    }
    for material in range(page.material_count):
        observed = page.state[material] == 1
        if not observed.any():
            stats["materials_without_observations"] += 1
            continue
        if class_map is not None:
            unknown = page.state[material] == 0
            global_mean = page.rgb[material, observed].mean(axis=0)
            for class_id in np.unique(class_map[class_map >= 0]):
                target = unknown & (class_map == class_id)
                if not target.any():
                    continue
                class_observed = observed & (class_map == class_id)
                if class_observed.any():
                    fill_rgb = page.rgb[material, class_observed].mean(axis=0)
                else:
                    fill_rgb = global_mean
                    stats["classes_without_observations"] += 1
                count = int(target.sum())
                page.rgb[material, target] = fill_rgb
                page.state[material, target] = 2
                stats["texels_filled"] += count
            unclassified = (page.state[material] == 0) & (class_map < 0)
            if unclassified.any():
                count = int(unclassified.sum())
                page.rgb[material, unclassified] = global_mean
                page.state[material, unclassified] = 2
                stats["texels_filled"] += count
                stats["unclassified_texels_filled"] += count
            continue
        queue: deque[tuple[int, int]] = deque(map(tuple, np.argwhere(observed)))
        source_y = np.full((page.size, page.size), -1, dtype=np.int32)
        source_x = np.full((page.size, page.size), -1, dtype=np.int32)
        for y, x in queue:
            source_y[y, x] = y
            source_x[y, x] = x
        while queue:
            y, x = queue.popleft()
            for next_y, next_x in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
                if not (0 <= next_y < page.size and 0 <= next_x < page.size):
                    continue
                if source_y[next_y, next_x] != -1:
                    continue
                source_y[next_y, next_x] = source_y[y, x]
                source_x[next_y, next_x] = source_x[y, x]
                queue.append((next_y, next_x))
        unknown = page.state[material] == 0
        count = int(unknown.sum())
        if count:
            page.rgb[material, unknown] = page.rgb[material, source_y[unknown], source_x[unknown]]
            page.state[material, unknown] = 2
            stats["texels_filled"] += count
    return stats


def bake_png(page: TexturePage, out_dir: Path) -> list[Path]:
    """Write RGB texture and state-mask PNGs for every material page."""

    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    paths: list[Path] = []
    for material in range(page.material_count):
        texture_path = out_dir / f"texture-{material}.png"
        state_path = out_dir / f"state-{material}.png"
        Image.fromarray(np.rint(np.clip(page.rgb[material], 0.0, 1.0) * 255.0).astype(np.uint8), "RGB").save(texture_path)
        Image.fromarray(page.state[material], "L").save(state_path)
        paths.extend((texture_path, state_path))
    return paths

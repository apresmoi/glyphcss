#!/usr/bin/env python3
"""Run the authored-UV multi-view spray-paint proof inside the GPU container.

The renderer has already produced the control frames.  This module only routes
those frames through the existing authored-UV texture helpers and the existing
offline SDXL caller; it intentionally contains no geometric projector and no
top-level torch import.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterator


ROOT = Path(__file__).resolve().parents[1]
REPOSITORY_ROOT = ROOT.parents[1]
ANCHOR_TO_AUTHORED_RENDER_CHOICES = ("off", "seed-only", "all-views")


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def relative(path: Path, root: Path) -> str:
    return path.relative_to(root).as_posix()


def read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run the proof-only multi-view spray pass.")
    parser.add_argument("--config", type=Path, default=ROOT / "config/spray-pass.json")
    parser.add_argument("--controls-root", type=Path, default=ROOT / "reports/spray-views")
    parser.add_argument("--output-root", type=Path, default=Path("/artifacts/spray-pass"))
    parser.add_argument("--subject", action="append", dest="subjects", help="Run one configured subject; repeatable.")
    parser.add_argument(
        "--verify-repaintable", action="store_true",
        help="CPU-only schedule preflight: print every frame's regenerable mask fraction and exit.",
    )
    return parser.parse_args()


def configured_subjects(config: dict[str, Any], requested: list[str] | None) -> list[dict[str, Any]]:
    subjects = config.get("subjects")
    views = config.get("views")
    if not isinstance(subjects, list) or not subjects or not isinstance(views, list) or not views:
        raise RuntimeError("SPRAY_PASS_CONFIG_SUBJECTS_OR_VIEWS")
    selected = subjects if requested is None else [subject for subject in subjects if subject.get("key") in requested]
    if not selected or (requested is not None and {item["key"] for item in selected} != set(requested)):
        raise RuntimeError("SPRAY_PASS_SUBJECT_SELECTION")
    for subject in selected:
        if not isinstance(subject.get("seeds"), list) or len(subject["seeds"]) != len(views):
            raise RuntimeError(f"SPRAY_PASS_SEEDS: {subject.get('key')} needs exactly one seed per view")
        if not isinstance(subject.get("materials"), list) or not subject["materials"]:
            raise RuntimeError(f"SPRAY_PASS_MATERIALS: {subject.get('key')}")
    return selected


def material_by_polygon(obj_path: Path, materials: list[str]) -> list[int]:
    """Reconstruct OBJ fan-triangle material routing in parseObj's exact order."""

    indexes = {name: index for index, name in enumerate(materials)}
    current = materials[0]
    result: list[int] = []
    for raw in obj_path.read_text(encoding="utf-8").splitlines():
        stripped = raw.strip()
        if stripped.startswith("usemtl "):
            current = stripped.split(maxsplit=1)[1]
            if current not in indexes:
                raise RuntimeError(f"SPRAY_PASS_UNCONFIGURED_MATERIAL: {obj_path}:{current}")
        elif stripped.startswith("f "):
            corners = len(stripped.split()) - 1
            if corners < 3:
                raise RuntimeError(f"SPRAY_PASS_INVALID_OBJ_FACE: {obj_path}")
            result.extend([indexes[current]] * (corners - 2))
    if not result:
        raise RuntimeError(f"SPRAY_PASS_OBJ_WITHOUT_FACES: {obj_path}")
    return result


def counts(page: Any) -> dict[str, int]:
    import numpy as np

    return {
        "observedTexels": int(np.count_nonzero(page.state == 1)),
        "unknownTexels": int(np.count_nonzero(page.state == 0)),
        "filledTexels": int(np.count_nonzero(page.state == 2)),
    }


def _close_mask(mask: Any, radius: int = 2) -> Any:
    """Binary closing (dilate then erode) with a square structuring element."""

    import numpy as np

    def shift_or(source, r):
        out = np.zeros_like(source)
        for dy in range(-r, r + 1):
            for dx in range(-r, r + 1):
                out |= np.roll(np.roll(source, dy, axis=0), dx, axis=1)
        return out

    def shift_and(source, r):
        out = np.ones_like(source)
        for dy in range(-r, r + 1):
            for dx in range(-r, r + 1):
                out &= np.roll(np.roll(source, dy, axis=0), dx, axis=1)
        return out

    return shift_and(shift_or(mask, radius), radius)


def _fill_from_neighbours(rgb: Any, holes: Any) -> Any:
    """Replace hole pixels with the mean of their non-hole neighbours, iterated."""

    import numpy as np

    result = rgb.astype(np.float32).copy()
    remaining = holes.copy()
    for _ in range(4):
        if not remaining.any():
            break
        known = ~remaining
        total = np.zeros_like(result)
        count = np.zeros(result.shape[:2], dtype=np.float32)
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                if dy == 0 and dx == 0:
                    continue
                shifted = np.roll(np.roll(result, dy, axis=0), dx, axis=1)
                valid = np.roll(np.roll(known, dy, axis=0), dx, axis=1)
                total += shifted * valid[..., None]
                count += valid
        fillable = remaining & (count > 0)
        if not fillable.any():
            break
        result[fillable] = (total[fillable] / count[fillable][..., None])
        remaining &= ~fillable
    return np.rint(np.clip(result, 0, 255)).astype(np.uint8)


def write_model_inputs(
    image: Any,
    known: Any,
    covered: Any,
    image_path: Path,
    mask_path: Path,
    *,
    paint_mode: str = "fill",
    authored_render: Any | None = None,
    blend_authored_render: bool = False,
) -> dict[str, Any]:
    """Write the inpaint base image and the regenerate mask.

    A fill view uses "covered AND not yet painted"; a refine view uses its full
    covered region so a later close-up can add detail to an existing atlas.
    Background pixels are never covered and therefore were never "known", so the
    old mask marked 78-98% of every frame regenerable: the model re-hallucinated
    the whole background on all 14 views, inpaint degenerated into text2img, and
    view inheritance barely carried. Locking the background also stops the noise
    outside the silhouette, which we discard at back-projection anyway.
    """

    import numpy as np
    from PIL import Image

    image_path.parent.mkdir(parents=True, exist_ok=True)
    rgb = np.rint(np.clip(image, 0.0, 1.0) * 255.0).astype(np.uint8)
    # Locked background: a flat neutral the model has no reason to elaborate.
    rgb[~covered] = 128

    # Cells are sparse at 256x128, so "painted" is salt-and-pepper once blown up to the
    # model raster: measured 840-1849 isolated speckles and 10-26 mask runs per row where
    # a clean mask is 2-6. Handing that to inpaint forces the model to invent detail in
    # thousands of one-cell holes, which is a direct source of grain. Close the mask
    # morphologically so it becomes a few solid regions, and fill the pinholes it closes
    # from their neighbourhood so the base image has no black confetti under them.
    # Covered-but-unpainted pixels were left BLACK. That was harmless at strength 1.0
    # (the mask was regenerated from pure noise) but at a lower strength the model
    # PRESERVES the black, producing near-black views. Seed those pixels with the mean
    # colour painted so far, so the base image is a plausible starting point everywhere.
    painted = covered & known
    if authored_render is not None:
        authored_rgb = np.asarray(authored_render, dtype=np.uint8)
        if authored_rgb.shape != rgb.shape:
            raise RuntimeError("SPRAY_PASS_AUTHORED_RENDER_SHAPE")
        # The first view has no atlas samples at all.  Its covered unknown cells must
        # start from glyphcss's own shaded base colors, rather than a neutral mean.
        # On all-views, preserve the atlas signal but mix the authored material back
        # into already observed cells so a new face cannot freely change the palette.
        if blend_authored_render and painted.any():
            rgb[painted] = np.rint(
                (rgb[painted].astype(np.float32) + authored_rgb[painted].astype(np.float32)) / 2.0
            ).astype(np.uint8)
        rgb[covered & ~known] = authored_rgb[covered & ~known]
    elif painted.any():
        seed_colour = rgb[painted].reshape(-1, 3).mean(axis=0)
        rgb[covered & ~known] = np.rint(seed_colour).astype(np.uint8)
    else:
        seed_colour = np.array([128.0, 128.0, 128.0])
        rgb[covered & ~known] = np.rint(seed_colour).astype(np.uint8)

    if paint_mode == "fill":
        raw_unknown = covered & ~known
    elif paint_mode == "refine":
        raw_unknown = covered.copy()
    else:
        raise ValueError(f"SPRAY_PASS_PAINT_MODE: {paint_mode}")
    closed = _close_mask(raw_unknown, radius=2) & covered
    filled = closed & ~raw_unknown          # pinholes we just absorbed into "known"
    if filled.any():
        rgb = _fill_from_neighbours(rgb, filled)
    unknown = np.where(closed, 255, 0).astype(np.uint8)
    Image.fromarray(rgb, "RGB").save(image_path)
    Image.fromarray(unknown, "L").save(mask_path)
    return {
        "knownImage": {"path": str(image_path), "sha256": file_sha256(image_path)},
        "unknownMask": {
            "path": str(mask_path),
            "sha256": file_sha256(mask_path),
            "unknownPixels": int((unknown != 0).sum()),
            "semantics": "non-zero means regenerable",
        },
        "paintMode": paint_mode,
        "repaintablePixels": int((unknown != 0).sum()),
        "repaintableFraction": float((unknown != 0).mean()),
        "knownPixels": int(known.sum()),
        "coveredPixels": int(covered.sum()),
        "regeneratedFraction": float((unknown != 0).mean()),
        "maskRunsPerRow": float((np.diff((unknown != 0).astype(np.int8), axis=1) != 0).sum() / unknown.shape[0]),
        "pinholesFilled": int(filled.sum()),
    }


def decode_authored_render(frame_dir: Path, maps: Any) -> tuple[Any, dict[str, Any]]:
    """Decode glyphcss's little-endian ARGB cells into the x1,y2 model raster.

    ``visible-color-argb.bin`` is the renderer's shaded authored material truth.
    Its glyph cells use the same 256x128 grid as the depth map, so use depth's
    frozen nearest-cell expansion here.  ``spray_generate.py`` performs the
    existing smooth model-raster-to-SDXL resize when it reads this base PNG.
    """

    import numpy as np

    source = frame_dir / "visible-color-argb.bin"
    if not source.is_file():
        raise FileNotFoundError(f"SPRAY_PASS_AUTHORED_RENDER_MISSING: {source}")
    raw = source.read_bytes()
    expected_bytes = maps.cols * maps.rows * 4
    if len(raw) != expected_bytes:
        raise RuntimeError(
            f"SPRAY_PASS_AUTHORED_RENDER_SIZE: {source} is {len(raw)} bytes, expected {expected_bytes}"
        )
    argb = np.frombuffer(raw, dtype="<u4").reshape(maps.rows, maps.cols)
    cell_rgb = np.stack(((argb >> 16) & 0xff, (argb >> 8) & 0xff, argb & 0xff), axis=-1).astype(np.uint8)
    covered_cells = np.asarray(maps.coverage, dtype=np.uint8).reshape(maps.rows, maps.cols) != 0
    model_rgb = np.repeat(cell_rgb, 2, axis=0)
    model_covered = np.repeat(covered_cells, 2, axis=0)
    # Keep the established locked-background convention.  ARGB zero is glyphcss's
    # empty cell, not an authored black material, and must not become a black halo.
    model_rgb[~model_covered] = 128
    return model_rgb, {
        "source": str(source),
        "sha256": file_sha256(source),
        "encoding": "argb-u32-little-endian-to-rgb8",
        "cellGrid": {"width": maps.cols, "height": maps.rows},
        "modelRaster": {
            "width": maps.cols,
            "height": maps.rows * 2,
            "cellToModelRaster": "nearest x1,y2",
            "modelToGenerationResample": "lanczos",
        },
    }


def anchor_active(anchor: str, view_index: int) -> bool:
    return anchor == "all-views" or (anchor == "seed-only" and view_index == 0)


def generation_base_kind(anchor: str, view_index: int) -> str:
    if view_index == 0:
        return "authored-render" if anchor_active(anchor, view_index) else "none"
    return "texture-atlas-authored-render-blend" if anchor == "all-views" else "texture-atlas"


GENERATE_VIEW_ATTEMPTS = 5
GENERATE_VIEW_ATTEMPT_LOG: list[list[int]] = []


@contextmanager
def argv(values: list[str]) -> Iterator[None]:
    old = sys.argv
    sys.argv = values
    try:
        yield
    finally:
        sys.argv = old


class SprayGenerateWorker:
    """One JSON-lines spray generator process, retained for one subject.

    The settled GPU configuration has no cpu offload or attention slicing, and
    has proven safe for sequential generation. Keeping a subprocess boundary
    still isolates a native fault: a signal death gets a fresh worker and the
    current view consumes the established retry budget.
    """

    def __init__(self) -> None:
        self.process: subprocess.Popen[str] | None = None
        self.stderr_file: Any = None
        self.stderr_path: Path | None = None

    def __enter__(self) -> "SprayGenerateWorker":
        return self

    def __exit__(self, exc_type: Any, exc_value: Any, traceback: Any) -> None:
        self.close()

    def start(self) -> None:
        if self.process is not None:
            return
        temporary = tempfile.NamedTemporaryFile(prefix="glyph-spray-generate-", suffix=".log", delete=False)
        self.stderr_path = Path(temporary.name)
        temporary.close()
        self.stderr_file = self.stderr_path.open("w", encoding="utf-8")
        command = [sys.executable, "-B", str(Path(__file__).resolve().parent / "spray_generate.py"), "--serve"]
        # A subprocess killed by SIGSEGV mid-.pyc-write leaves truncated bytecode that
        # poisons every later import in the container's writable layer, surfacing as
        # nonsense like "Failed to import diffusers.schedulers.scheduling_ddim:
        # cannot access local variable 'a'". Never write bytecode here.
        child_env = {**os.environ, "PYTHONDONTWRITEBYTECODE": "1"}
        self.process = subprocess.Popen(
            command,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=self.stderr_file,
            text=True,
            bufsize=1,
            env=child_env,
        )

    def close(self) -> None:
        process, self.process = self.process, None
        if process is not None:
            if process.stdin is not None:
                try:
                    process.stdin.close()
                except (BrokenPipeError, OSError, ValueError):
                    pass
            if process.poll() is None:
                process.terminate()
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()
            if process.stdout is not None:
                process.stdout.close()
        if self.stderr_file is not None:
            self.stderr_file.close()
            self.stderr_file = None
        if self.stderr_path is not None:
            self.stderr_path.unlink(missing_ok=True)
            self.stderr_path = None

    def restart(self) -> None:
        self.close()
        self.start()

    def stderr_tail(self) -> str:
        if self.stderr_file is not None:
            self.stderr_file.flush()
        if self.stderr_path is None or not self.stderr_path.is_file():
            return ""
        return "\n".join(self.stderr_path.read_text(encoding="utf-8", errors="replace").strip().splitlines()[-12:])

    def request(self, values: list[str]) -> tuple[int, dict[str, Any] | None, str]:
        """Return (exit status, report, detail), reserving status 1 for protocol errors."""

        self.start()
        assert self.process is not None
        if self.process.poll() is not None:
            return self.process.returncode or 1, None, self.stderr_tail()
        try:
            assert self.process.stdin is not None and self.process.stdout is not None
            self.process.stdin.write(json.dumps({"args": values}, separators=(",", ":")) + "\n")
            self.process.stdin.flush()
            response_line = self.process.stdout.readline()
        except (BrokenPipeError, OSError, ValueError) as error:
            exit_code = self.process.wait()
            return exit_code or 1, None, f"{error}\n{self.stderr_tail()}".strip()
        if not response_line:
            exit_code = self.process.wait()
            return exit_code or 1, None, self.stderr_tail()
        try:
            response = json.loads(response_line)
        except json.JSONDecodeError as error:
            return 1, None, f"SPRAY_PASS_GENERATE_WORKER_PROTOCOL: {error}"
        if not isinstance(response, dict) or not isinstance(response.get("ok"), bool):
            return 1, None, "SPRAY_PASS_GENERATE_WORKER_PROTOCOL"
        if not response["ok"]:
            error = str(response.get("error", "SPRAY_PASS_GENERATE_WORKER_ERROR"))
            trace = response.get("traceback")
            return 1, None, f"{error}\n{trace}" if isinstance(trace, str) else error
        report = response.get("report")
        if not isinstance(report, dict):
            return 1, None, "SPRAY_PASS_GENERATE_WORKER_PROTOCOL_REPORT"
        return 0, report, ""


def generate_view(worker: SprayGenerateWorker, values: list[str]) -> dict[str, Any]:
    """Generate one view through the persistent worker with signal-only retries."""

    attempts: list[int] = []
    detail = ""
    seen: list[str] = []
    for attempt in range(GENERATE_VIEW_ATTEMPTS):
        returncode, report, detail = worker.request(values)
        attempts.append(returncode)
        if returncode == 0:
            if attempt:
                sys.stdout.write(
                    json.dumps({"sprayPassRetry": {"attempts": attempts, "recovered": True}}) + "\n"
                )
            GENERATE_VIEW_ATTEMPT_LOG.append(attempts)
            return report
        # Signal deaths (-11 = SIGSEGV) were always retried. Clean non-zero exits
        # are now retried too, because this box also corrupts a worker's imports
        # transiently - real observed examples are "Failed to import
        # diffusers.schedulers.scheduling_ddim: cannot access local variable 'a'"
        # and "... Input has cycles", neither of which is a reachable code path.
        # A genuine defect is deterministic, so an IDENTICAL error twice aborts
        # immediately: that keeps real bugs loud while surviving corruption.
        signature = f"{returncode}:{detail.strip()[-400:]}"
        if signature in seen:
            break
        seen.append(signature)
        if attempt + 1 < GENERATE_VIEW_ATTEMPTS:
            worker.restart()
    GENERATE_VIEW_ATTEMPT_LOG.append(attempts)
    raise RuntimeError(
        f"SPRAY_PASS_GENERATE_VIEW_FAILED: attempts={attempts}\n{detail}"
    )


def synchronization_options(generation: dict[str, Any], available_views: int) -> dict[str, Any]:
    """Resolve lock-step mode from the emitted control-manifest view count."""

    mode = generation.get("multiViewMode", "per-view")
    if mode not in ("per-view", "synchronized"):
        raise RuntimeError("SPRAY_PASS_MULTI_VIEW_MODE")
    view_count = int(generation.get("synchronizedViewCount", available_views))
    start_step = int(generation.get("synchronizationStartStep", 0))
    blend = float(generation.get("synchronizationBlend", 1.0))
    if not 1 <= view_count <= available_views:
        raise RuntimeError("SPRAY_PASS_SYNCHRONIZED_VIEW_COUNT")
    if start_step < 0 or start_step >= int(generation.get("steps", 0)):
        raise RuntimeError("SPRAY_PASS_SYNCHRONIZATION_START_STEP")
    if not 0.0 <= blend <= 1.0:
        raise RuntimeError("SPRAY_PASS_SYNCHRONIZATION_BLEND")
    return {"mode": mode, "viewCount": view_count, "startStep": start_step, "blend": blend}


def manifest_schedule(controls_root: Path, subject: dict[str, Any], configured_views: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Bind generation order to the emitted controls, not a duplicated count.

    The schedule config supplies prompts and seeds, while the published control
    manifest is the authority for frame ids and order.  Compare their complete
    schedule metadata before allowing the atlas to accumulate any view.
    """

    manifest_path = controls_root / subject["key"] / "views" / "manifest.json"
    manifest = read_json(manifest_path)
    frames = manifest.get("frames")
    trajectory = manifest.get("trajectory")
    emitted = trajectory.get("views") if isinstance(trajectory, dict) else None
    if not isinstance(frames, list) or not frames or not isinstance(emitted, list) or len(frames) != len(emitted):
        raise RuntimeError(f"SPRAY_PASS_CONTROL_MANIFEST_VIEWS: {manifest_path}")
    if len(configured_views) != len(frames):
        raise RuntimeError(f"SPRAY_PASS_CONFIG_MANIFEST_VIEW_COUNT: {subject['key']}")
    scheduled: list[dict[str, Any]] = []
    for index, (configured, frame, entry) in enumerate(zip(configured_views, frames, emitted, strict=True)):
        frame_id = frame.get("id") if isinstance(frame, dict) else None
        if not isinstance(configured, dict) or not isinstance(entry, dict) or not isinstance(frame_id, str):
            raise RuntimeError(f"SPRAY_PASS_CONTROL_MANIFEST_FRAME: {subject['key']}:{index}")
        configured_tier = configured.get("tier", "base")
        if entry.get("scheduleId") != configured.get("id") or entry.get("tier", "base") != configured_tier \
                or entry.get("footprint") != configured.get("footprint"):
            raise RuntimeError(f"SPRAY_PASS_CONTROL_MANIFEST_SCHEDULE: {subject['key']}:{index}")
        scheduled.append({**configured, "frameId": frame_id})
    first_detail = next((index for index, view in enumerate(scheduled) if view.get("tier") == "detail"), len(scheduled))
    if any(view.get("tier", "base") != "base" for view in scheduled[:first_detail]) \
            or any(view.get("tier", "base") != "detail" for view in scheduled[first_detail:]):
        raise RuntimeError(f"SPRAY_PASS_CONTROL_MANIFEST_TIER_ORDER: {subject['key']}")
    return scheduled


def view_paint_options(schedule: dict[str, Any], generation: dict[str, Any]) -> tuple[str, float]:
    """Resolve a view-local paint policy without changing the control manifest.

    The published control manifest establishes geometry, ordering, tier and
    footprint.  Generation policy is intentionally local to this runner: it
    cannot alter a control frame.  Detail views must explicitly opt into the
    stronger REFINE policy instead of inheriting fill-once by accident.
    """

    paint_mode = schedule.get("paintMode", "fill")
    if paint_mode not in {"fill", "refine"}:
        raise RuntimeError(f"SPRAY_PASS_PAINT_MODE: {schedule.get('id')}")
    strength = schedule.get("inpaintStrength", generation.get("inpaintStrength", 0.7))
    if not isinstance(strength, (int, float)) or isinstance(strength, bool) or not 0.0 < float(strength) <= 1.0:
        raise RuntimeError(f"SPRAY_PASS_INPAINT_STRENGTH: {schedule.get('id')}")
    if schedule.get("tier", "base") == "detail" and paint_mode != "refine":
        raise RuntimeError(f"SPRAY_PASS_DETAIL_MUST_REFINE: {schedule.get('id')}")
    if paint_mode == "refine" and float(strength) > 0.5:
        raise RuntimeError(f"SPRAY_PASS_REFINE_STRENGTH_TOO_HIGH: {schedule.get('id')}")
    return paint_mode, float(strength)


def verify_repaintable_schedule(
    subject: dict[str, Any], config: dict[str, Any], controls_root: Path,
) -> list[dict[str, Any]]:
    """CPU-only page-state simulation for the required before-GPU mask audit."""

    import numpy as np
    import spray_texture

    views = manifest_schedule(controls_root, subject, config["views"])
    # This only models whether an atlas texel has been observed; it does not
    # evaluate generated RGB. Its reduced page is enough for fill-state
    # diagnostics without making the before-GPU guard memory-heavy. REFINE
    # masks are reported directly from exact control-frame coverage.
    state_page_size = min(int(config["texturePageSize"]), 1024)
    page = spray_texture.TexturePage(state_page_size, len(subject["materials"]), state_only=True)
    material_routes = None if subject.get("source") == "authored-glyph-scene" else material_by_polygon(
        REPOSITORY_ROOT / subject["path"], subject["materials"]
    )
    records: list[dict[str, Any]] = []
    for index, schedule in enumerate(views):
        frame_dir = controls_root / subject["key"] / "views" / "frames" / schedule["frameId"]
        maps = spray_texture.load_control_maps(frame_dir)
        winners = np.asarray(maps.winner_polygon)
        if material_routes is None:
            routing = np.where(winners >= 0, 0, -1).astype(np.int32)
        else:
            routing = np.where(winners >= 0, np.asarray(material_routes, dtype=np.int32)[np.maximum(winners, 0)], -1)
        known = spray_texture.sample_page_known(page, maps, routing)
        covered = np.repeat((np.asarray(maps.coverage) != 0).reshape(maps.rows, maps.cols), 2, axis=0)
        paint_mode, strength = view_paint_options(schedule, config["generation"])
        repaintable = (covered & ~known) if paint_mode == "fill" else covered
        record = {
            "index": index, "id": schedule["id"], "tier": schedule.get("tier", "base"),
            "paintMode": paint_mode, "inpaintStrength": strength,
            "statePageSize": state_page_size,
            "maskSource": "covered-exact" if paint_mode == "refine" else "simulated-fill-state",
            "repaintablePixels": int(repaintable.sum()),
            "repaintableFraction": float(repaintable.mean()),
            "repaintablePercent": float(repaintable.mean() * 100.0),
            "coveredPercent": float(covered.mean() * 100.0),
        }
        print("SPRAY_REPAINTABLE=" + json.dumps(record, sort_keys=True), flush=True)
        records.append(record)
        # The mask depends only on whether a texel has previously been observed.
        # A neutral image gives this dry run the same exact projection/state gates
        # as the real pass without loading SDXL or pretending to measure quality.
        direction, _ = spray_texture.derive_view_direction(maps)
        spray_texture.back_project(
            page, maps, np.full((maps.rows * 2, maps.cols, 3), 0.5, dtype=np.float32),
            float(config["generation"]["backProjectionWeight"]), routing, view_direction=direction,
            prefer_new_observation=paint_mode == "refine",
        )
    bad_detail = [record for record in records if record["tier"] == "detail" and record["repaintableFraction"] < 0.10]
    if bad_detail:
        raise RuntimeError("SPRAY_PASS_DETAIL_REPAINTABLE_TOO_LOW: " + ",".join(item["id"] for item in bad_detail))
    return records


def authored_class_map(subject: dict[str, Any], controls_root: Path, page_size: int) -> Any:
    """Load the cabin's identity-mapped area-proportional atlas class map."""

    import spray_texture

    subject_root = controls_root / subject["key"]
    obj_path = subject_root / "syncmvd" / f"{subject['key']}.obj"
    layout_path = subject_root / "atlas-layout.json"
    if not obj_path.is_file() or not layout_path.is_file():
        raise FileNotFoundError(f"SPRAY_PASS_AUTHORED_CABIN_ARTIFACTS_MISSING: {subject_root}")
    face_classes, _ = spray_texture.load_authored_polygon_classes(obj_path, REPOSITORY_ROOT / subject["path"])
    try:
        layout = read_json(layout_path)
    except (OSError, json.JSONDecodeError) as error:
        raise RuntimeError(f"SPRAY_PASS_AUTHORED_CABIN_ATLAS_INVALID: {layout_path}") from error
    return spray_texture.packed_face_class_map(page_size, face_classes, layout)


def run_synchronized_subject(
    subject: dict[str, Any],
    config: dict[str, Any],
    controls_root: Path,
    output_root: Path,
    *,
    material_routes: list[int] | None,
    subject_root: Path,
    generated_root: Path,
    input_root: Path,
    texture_root: Path,
    sync: dict[str, Any],
    views: list[dict[str, Any]],
    class_map: Any | None,
) -> dict[str, Any]:
    """Ask one retained worker to lock-step all selected views, then bake final RGB."""

    import numpy as np
    from PIL import Image
    import spray_generate
    import spray_texture

    generation = config["generation"]
    model_roots = config["modelRoots"]
    control_scale = float(generation.get("controlScale", 0.7))
    depth_source = generation.get("depthSource", "frame-minmax")
    page = spray_texture.TexturePage(int(config["texturePageSize"]), len(subject["materials"]))
    contexts: list[dict[str, Any]] = []
    for view_index, schedule in enumerate(views[:sync["viewCount"]]):
        frame_dir = controls_root / subject["key"] / "views" / "frames" / schedule["frameId"]
        maps = spray_texture.load_control_maps(frame_dir)
        if maps.cols != 256 or maps.rows != 128:
            raise RuntimeError(f"SPRAY_PASS_CONTROL_GRID: {frame_dir} is {maps.cols}x{maps.rows}, expected 256x128")
        winners = np.asarray(maps.winner_polygon)
        used_winners = winners[winners >= 0]
        if material_routes is None:
            routing = np.where(winners >= 0, 0, -1).astype(np.int32)
        else:
            if used_winners.size and int(used_winners.max()) >= len(material_routes):
                raise RuntimeError(f"SPRAY_PASS_WINNER_POLYGON_MATERIAL_ROUTING: {frame_dir}")
            routing = np.where(winners >= 0, np.asarray(material_routes, dtype=np.int32)[np.maximum(winners, 0)], -1)
        direction, direction_fit = spray_texture.derive_view_direction(maps)
        generated = generated_root / f"frame-{view_index:03d}.png"
        report = generated_root / f"frame-{view_index:03d}.report.json"
        contexts.append({
            "index": view_index, "schedule": schedule, "frameDir": frame_dir, "maps": maps,
            "routing": routing, "viewDirection": direction, "viewDirectionFit": direction_fit,
            "generated": generated, "report": report,
        })

    manifest_path = input_root / "synchronized-views.json"
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(json.dumps({
        "schemaVersion": "glyph-spray-synchronized-input/v1",
        "materialCount": len(subject["materials"]),
        "views": [
            {"index": item["index"], "seed": int(subject["seeds"][item["index"]]),
             "output": str(item["generated"].resolve()), "report": str(item["report"].resolve()),
             "routing": item["routing"].tolist()}
            for item in contexts
        ],
    }, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    command = [
        "--controls-root", str(controls_root / subject["key"] / "views"), "--view-index", "0",
        "--mode", "text2img", "--prompt", str(subject["prompt"]),
        "--negative-prompt", str(subject["negativePrompt"]), "--seed", str(subject["seeds"][0]),
        "--steps", str(generation["steps"]), "--guidance", str(generation["guidance"]),
        "--control-scale", str(control_scale), "--depth-source", depth_source,
        "--output", str(contexts[0]["generated"]), "--report", str(contexts[0]["report"]),
        "--model-root", str(model_roots["base"]), "--control-root", str(model_roots["depthControl"]),
        "--multi-view-mode", "synchronized", "--synchronized-view-count", str(sync["viewCount"]),
        "--synchronization-start-step", str(sync["startStep"]),
        "--synchronization-blend", str(sync["blend"]),
        # The per-timestep consensus page is NOT the final atlas. Binding it to
        # texturePageSize (4096) made every denoising step project 24 views into a
        # 16 M-texel page on CPU: the GPU sat at 0% util and 28 W while one process
        # burned 800% CPU. Consensus operates on latents (128x128 for a 1024 image),
        # so a smaller page is ample; the final bake still uses texturePageSize.
        "--synchronized-texture-page-size",
        str(min(int(config["texturePageSize"]), int(os.environ.get("GLYPH_SYNC_CONSENSUS_PAGE", "1024")))),
        "--synchronized-manifest", str(manifest_path),
    ]
    with SprayGenerateWorker() as worker:
        generate_view(worker, command)

    records: list[dict[str, Any]] = []
    for item in contexts:
        before = counts(page)
        pixels = np.asarray(Image.open(item["generated"]).convert("RGB"), dtype=np.float32) / 255.0
        projection = spray_texture.back_project(
            page, item["maps"], pixels, float(generation["backProjectionWeight"]), item["routing"],
            view_direction=item["viewDirection"],
        )
        after = counts(page)
        generated_report = read_json(item["report"])
        records.append({
            "index": item["index"], "id": item["schedule"]["id"], "mode": "synchronized",
            "seed": subject["seeds"][item["index"]], "controlFrame": relative(item["frameDir"], controls_root),
            "coverageCells": int((item["maps"].coverage != 0).sum()),
            "viewDirection": [float(value) for value in item["viewDirection"]], "viewDirectionFit": item["viewDirectionFit"],
            "meanIncidence": float(projection["incidence_sum"]) / int(projection["cells_projected"]) if projection["cells_projected"] else None,
            "knownInput": None, "generationBase": None,
            "generatedImage": {"path": relative(item["generated"], output_root), "sha256": file_sha256(item["generated"]), "width": spray_generate.MODEL_WIDTH, "height": spray_generate.MODEL_HEIGHT},
            "generateReport": {"path": relative(item["report"], output_root), "sha256": file_sha256(item["report"]), "modeUsed": generated_report["modeUsed"], "workerReused": generated_report["runtime"]["workerReused"]},
            "backProjection": projection, "coverage": {"before": before, "after": after},
        })
    before_fill = counts(page)
    fill = spray_texture.fill_unknown(page, class_map)
    pngs = spray_texture.bake_png(page, texture_root)
    subject_report = {
        "key": subject["key"], "assetId": subject["assetId"], "path": subject["path"], "materials": subject["materials"],
        "materialTriangleCount": len(material_routes) if material_routes is not None else int(subject.get("polygonCount", 0)),
        "prompt": subject["prompt"], "negativePrompt": subject["negativePrompt"],
        "synchronization": {**sync, "manifest": relative(manifest_path, output_root)},
        "warnings": [warning for warning in (subject.get("splitWarning"), subject.get("attributionWarning")) if warning],
        "views": records, "beforeFill": before_fill, "fillUnknown": fill, "afterFill": counts(page),
        "bakedFiles": [{"path": relative(path, output_root), "sha256": file_sha256(path)} for path in pngs],
    }
    (subject_root / "subject-report.json").write_text(json.dumps(subject_report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return subject_report


def run_subject(
    subject: dict[str, Any], config: dict[str, Any], controls_root: Path, output_root: Path,
) -> dict[str, Any]:
    import numpy as np
    from PIL import Image
    import spray_generate
    import spray_texture

    configured_views = config["views"]
    views = manifest_schedule(controls_root, subject, configured_views)
    generation = config["generation"]
    sync = synchronization_options(generation, len(views))
    # Keep the proof's historical 0.65 as its explicit config value, while new
    # callers that omit it receive the literature starting point.  This makes
    # the model's conditioning weight a run-level choice rather than a hidden
    # spray_generate.py constant.
    control_scale = float(generation.get("controlScale", 0.7))
    if not 0.0 <= control_scale <= 1.0:
        raise RuntimeError("SPRAY_PASS_CONTROL_SCALE")
    depth_source = generation.get("depthSource", "frame-minmax")
    if depth_source not in ("frame-minmax", "corpus-normalized"):
        raise RuntimeError("SPRAY_PASS_DEPTH_SOURCE")
    anchor_to_authored_render = generation.get("anchorToAuthoredRender", "seed-only")
    if anchor_to_authored_render not in ANCHOR_TO_AUTHORED_RENDER_CHOICES:
        raise RuntimeError("SPRAY_PASS_ANCHOR_TO_AUTHORED_RENDER")
    model_roots = config["modelRoots"]
    # A subject may be an imported OBJ, or a scene glyphcss generated from an authored
    # ASCII grid. A generated scene has no .obj to parse material routing out of, and
    # every polygon shares one atlas, so declare that explicitly rather than inventing
    # a fake OBJ. Anything with a "path" still takes the original route unchanged.
    if subject.get("source") == "authored-glyph-scene":
        if len(subject["materials"]) != 1:
            raise RuntimeError(f"SPRAY_PASS_AUTHORED_SCENE_SINGLE_MATERIAL: {subject['key']}")
        material_routes = None                      # routing is constant; see below
        route_for_cell: Any = 0
        class_map = authored_class_map(subject, controls_root, int(config["texturePageSize"]))
    else:
        obj_path = REPOSITORY_ROOT / subject["path"]
        if not obj_path.is_file():
            raise FileNotFoundError(f"SPRAY_PASS_SUBJECT_OBJ_MISSING: {obj_path}")
        material_routes = material_by_polygon(obj_path, subject["materials"])
        route_for_cell = None
        class_map = None
    page = spray_texture.TexturePage(int(config["texturePageSize"]), len(subject["materials"]))
    subject_root = output_root / "subjects" / subject["key"]
    # Resume rather than refuse. This box faults unpredictably under sustained SDXL
    # load (SIGSEGV seen in a plain Python loop, re.compile, and import yaml), so a
    # whole-run restart would keep discarding good work. A subject that already wrote
    # a sealed report whose baked files all still exist is returned as-is; anything
    # less is rebuilt from scratch so a half-finished subject can never be mistaken
    # for a complete one.
    completed_report = subject_root / "subject-report.json"
    if completed_report.is_file():
        try:
            previous = read_json(completed_report)
        except json.JSONDecodeError:
            previous = None
        if previous and all((output_root / item["path"]).is_file() for item in previous.get("bakedFiles", [])):
            if previous.get("bakedFiles"):
                print(json.dumps({"sprayPassResume": {"subject": subject["key"], "views": len(previous.get("views", []))}}))
                return previous
    if subject_root.exists():
        shutil.rmtree(subject_root)
    generated_root = subject_root / "generated"
    input_root = subject_root / "inputs"
    texture_root = subject_root / "textures"
    if sync["mode"] == "synchronized":
        return run_synchronized_subject(
            subject, config, controls_root, output_root,
            material_routes=material_routes,
            subject_root=subject_root, generated_root=generated_root, input_root=input_root,
            texture_root=texture_root, sync=sync, views=views,
            class_map=class_map,
        )
    records: list[dict[str, Any]] = []

    with SprayGenerateWorker() as worker:
        for view_index, schedule in enumerate(views):
            frame_dir = controls_root / subject["key"] / "views" / "frames" / schedule["frameId"]
            maps = spray_texture.load_control_maps(frame_dir)
            view_direction, view_direction_fit = spray_texture.derive_view_direction(maps)
            if maps.cols != 256 or maps.rows != 128:
                raise RuntimeError(f"SPRAY_PASS_CONTROL_GRID: {frame_dir} is {maps.cols}x{maps.rows}, expected 256x128")
            winners = np.asarray(maps.winner_polygon)
            used_winners = winners[winners >= 0]
            if material_routes is None:
                # Authored glyph scene: one atlas, so every covered cell routes to
                # material 0 and uncovered stays -1. No polygon table to bounds-check.
                routing = np.where(winners >= 0, 0, -1).astype(np.int32)
            else:
                if used_winners.size and int(used_winners.max()) >= len(material_routes):
                    raise RuntimeError(f"SPRAY_PASS_WINNER_POLYGON_MATERIAL_ROUTING: {frame_dir}")
                routing = np.where(winners >= 0, np.asarray(material_routes, dtype=np.int32)[np.maximum(winners, 0)], -1)
            sampled, known = spray_texture.sample_page(page, maps, routing)
            known_image = input_root / f"frame-{view_index:03d}-known.png"
            unknown_mask = input_root / f"frame-{view_index:03d}-unknown-mask.png"
            covered_pixels = np.repeat((np.asarray(maps.coverage) != 0).reshape(maps.rows, maps.cols), 2, axis=0)
            base_kind = generation_base_kind(anchor_to_authored_render, view_index)
            use_authored_render = anchor_active(anchor_to_authored_render, view_index)
            paint_mode, inpaint_strength = view_paint_options(schedule, generation)
            authored_render, authored_render_report = (
                decode_authored_render(frame_dir, maps) if use_authored_render else (None, None)
            )
            inputs = write_model_inputs(
                sampled,
                known,
                covered_pixels,
                known_image,
                unknown_mask,
                paint_mode=paint_mode,
                authored_render=authored_render,
                blend_authored_render=anchor_to_authored_render == "all-views" and view_index > 0,
            )
            generated = generated_root / f"frame-{view_index:03d}.png"
            generated_report = generated_root / f"frame-{view_index:03d}.report.json"
            # Only view 0 was ever text2img; every later view inpainted from the
            # accumulating page, so each was seeded by a blurrier reprojection of
            # its predecessor and quality decayed along the sequence (frame-000
            # crisp, frame-045 mush). GLYPH_ALL_TEXT2IMG paints every view
            # independently: no view can inherit another's degradation. Consistency
            # then rests on the shared depth control and prompt rather than on
            # chaining, which is the trade we want while synchronized mode is broken.
            if os.environ.get("GLYPH_ALL_TEXT2IMG") == "1":
                mode = "text2img"
            else:
                mode = "inpaint" if use_authored_render else ("text2img" if view_index == 0 else "inpaint")
            command = [
                "--controls-root", str(controls_root / subject["key"] / "views"),
                "--view-index", str(view_index), "--mode", mode,
                "--anchor-to-authored-render", anchor_to_authored_render,
                "--base-kind", base_kind,
                "--prompt", str(subject["prompt"]), "--negative-prompt", str(subject["negativePrompt"]),
                "--seed", str(subject["seeds"][view_index]), "--steps", str(generation["steps"]),
                "--guidance", str(generation["guidance"]), "--control-scale", str(control_scale),
                "--inpaint-strength", str(inpaint_strength),
                "--depth-source", depth_source,
                "--multi-view-mode", sync["mode"],
                "--synchronized-view-count", str(sync["viewCount"]),
                "--synchronization-start-step", str(sync["startStep"]),
                "--synchronization-blend", str(sync["blend"]),
                # Consensus page is NOT the final atlas; see the note at the
                # synchronized call site above.
                "--synchronized-texture-page-size",
                str(min(int(config["texturePageSize"]), int(os.environ.get("GLYPH_SYNC_CONSENSUS_PAGE", "1024")))),
                "--output", str(generated), "--report", str(generated_report),
                "--model-root", str(model_roots["base"]), "--control-root", str(model_roots["depthControl"]),
            ]
            if mode == "inpaint":
                command.extend(["--known-image", str(known_image), "--known-mask", str(unknown_mask)])
            before = counts(page)
            generate_view(worker, command)
            # Keep the generation at its native model resolution.  back_project
            # maps reconstructed UV texels straight into this raster; resizing
            # here would discard the very detail texel-resolution projection is
            # intended to preserve.
            generated_pixels = np.asarray(Image.open(generated).convert("RGB"), dtype=np.float32) / 255.0
            projection = spray_texture.back_project(
                page,
                maps,
                generated_pixels,
                float(generation["backProjectionWeight"]),
                routing,
                view_direction=view_direction,
                prefer_new_observation=paint_mode == "refine",
            )
            after = counts(page)
            generate_report = read_json(generated_report)
            records.append({
                "index": view_index,
                "id": schedule["id"],
                "tier": schedule.get("tier", "base"),
                "paintMode": paint_mode,
                "inpaintStrength": inpaint_strength,
                "mode": mode,
                "seed": subject["seeds"][view_index],
                "controlFrame": relative(frame_dir, controls_root),
                "coverageCells": int((maps.coverage != 0).sum()),
                "viewDirection": [float(value) for value in view_direction],
                "viewDirectionFit": view_direction_fit,
                "meanIncidence": (
                    float(projection["incidence_sum"]) / int(projection["cells_projected"])
                    if projection["cells_projected"] else None
                ),
                "knownInput": inputs,
                "generationBase": None if base_kind == "none" else {
                    "kind": base_kind,
                    "path": inputs["knownImage"]["path"],
                    "sha256": inputs["knownImage"]["sha256"],
                    "authoredRender": authored_render_report,
                },
                "generatedImage": {
                    "path": relative(generated, output_root), "sha256": file_sha256(generated),
                    "width": spray_generate.MODEL_WIDTH, "height": spray_generate.MODEL_HEIGHT,
                },
                "generateReport": {
                    "path": relative(generated_report, output_root),
                    "sha256": file_sha256(generated_report),
                    "modeUsed": generate_report["modeUsed"],
                    "workerReused": generate_report["runtime"]["workerReused"],
                },
                "backProjection": projection,
                "coverage": {"before": before, "after": after},
            })

    before_fill = counts(page)
    fill = spray_texture.fill_unknown(page, class_map)
    pngs = spray_texture.bake_png(page, texture_root)
    subject_report = {
        "key": subject["key"], "assetId": subject["assetId"], "path": subject["path"],
        "materials": subject["materials"], "materialTriangleCount": len(material_routes) if material_routes is not None else int(subject.get("polygonCount", 0)),
        "prompt": subject["prompt"], "negativePrompt": subject["negativePrompt"],
        "warnings": [warning for warning in (subject.get("splitWarning"), subject.get("attributionWarning")) if warning],
        "views": records,
        "beforeFill": before_fill, "fillUnknown": fill, "afterFill": counts(page),
        "bakedFiles": [{"path": relative(path, output_root), "sha256": file_sha256(path)} for path in pngs],
    }
    # Seal per subject so a later crash resumes instead of rebuilding everything.
    (subject_root / "subject-report.json").write_text(
        json.dumps(subject_report, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    return subject_report


def main() -> None:
    args = parse_args()
    config_path = args.config.resolve()
    config = read_json(config_path)
    if config.get("schemaVersion") != "glyph-spray-pass/v1" or config.get("disposition") != "proof-only-not-admissible":
        raise RuntimeError("SPRAY_PASS_CONFIG_DISPOSITION")
    output_root = args.output_root.resolve()
    subjects = configured_subjects(config, args.subjects)
    if args.verify_repaintable:
        for subject in subjects:
            verify_repaintable_schedule(subject, config, args.controls_root.resolve())
        return
    output_root.mkdir(parents=True, exist_ok=True)
    reports = [run_subject(subject, config, args.controls_root.resolve(), output_root) for subject in subjects]
    report = {
        "schemaVersion": "glyph-spray-pass-report/v1",
        "id": config["id"], "disposition": "proof-only-not-admissible",
        "config": {"path": str(config_path), "sha256": file_sha256(config_path)},
        "controlsRoot": str(args.controls_root.resolve()),
        "modelRoots": config["modelRoots"], "generation": config["generation"],
        "subjects": reports,
        "warnings": [
            "Proof-only spike. This report is not admissible evidence and makes no threshold or G-gate claim.",
            "Frog is a test split; its outputs must never reach training.",
        ],
    }
    report_path = output_root / "reports" / "spray-pass.json"
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps({"report": str(report_path), "sha256": file_sha256(report_path)}, sort_keys=True))


if __name__ == "__main__":
    main()

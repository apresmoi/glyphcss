from __future__ import annotations

import hashlib
import json
import math
import os
from pathlib import Path
from typing import Any

HASH_LENGTH = 64
REPORT_SCHEMA_VERSION = "glyph-overfit-keyframe-report/v1"
CONFIG_SCHEMA_VERSION = "glyph-overfit-keyframe-config/v1"
TENSOR_CONTRACT_ID = "glyph-control-tensor-contract/mvp-v2"
METRIC_THRESHOLDS = {
    "visible-ascii-adherence": "visibleAsciiMismatch", "semantic-class-presence": "semanticClassMismatch",
    "dictionary-class-confusion": "dictionaryConfusion", "instance-surface-preservation": "instanceSurfaceMismatch",
    "depth-edge-agreement": "depthEdgeError", "unintended-additions": "unintendedAddition",
    "style-match": "styleDistance", "cross-view-identity": "crossViewIdentityMismatch",
    "reprojection-valid-error": "reprojectionValidError", "disocclusion-recovery": "disocclusionRecoveryError",
    "temporal-warp-error": "temporalWarpError", "correction-magnitude": "correctionMagnitude",
}


class OverfitContractError(RuntimeError):
    pass


def fail(code: str) -> None:
    raise OverfitContractError(code)


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def sha256_file(path: Path) -> str:
    return sha256_bytes(path.read_bytes())


def canonical(value: Any, omit: str | None = None) -> bytes:
    if omit and isinstance(value, dict):
        value = {key: item for key, item in value.items() if key != omit}
    def encode(item: Any) -> str:
        if isinstance(item, dict):
            return "{" + ",".join(f"{json.dumps(key, ensure_ascii=False)}:{encode(item[key])}" for key in sorted(item)) + "}"
        if isinstance(item, list):
            return "[" + ",".join(encode(entry) for entry in item) + "]"
        if isinstance(item, float) and item.is_integer():
            return str(int(item))
        return json.dumps(item, separators=(",", ":"), ensure_ascii=False)
    return encode(value).encode()


def canonical_sha256(value: Any, omit: str | None = None) -> str:
    return sha256_bytes(canonical(value, omit))


def read_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError) as error:
        raise OverfitContractError(f"B12_JSON_INVALID:{path}") from error
    if not isinstance(value, dict):
        fail(f"B12_JSON_OBJECT_REQUIRED:{path}")
    return value


def confined(root: Path, relative_path: str, code: str) -> Path:
    if not isinstance(relative_path, str) or not relative_path:
        fail(code)
    base = root.resolve()
    result = (base / relative_path).resolve()
    if result == base or base not in result.parents:
        fail(code)
    return result


def keyframe_slices(contract: dict[str, Any]) -> dict[str, tuple[int, int]]:
    cursor = 0
    result: dict[str, tuple[int, int]] = {}
    for channel in contract["keyframeChannels"]:
        width = channel["width"]
        result[channel["id"]] = (cursor, cursor + width)
        cursor += width
    if cursor != contract["keyframeWidth"]:
        fail("B12_TENSOR_WIDTH_MISMATCH")
    return result


def required_interventions(contract: dict[str, Any]) -> list[str]:
    result = ["correct-controls", "prompt-only", "all-controls-removed"]
    for channel in contract["keyframeChannels"]:
        result.extend((f"leave-out/{channel['id']}", f"shuffle/{channel['id']}"))
    result.extend(("wrong-camera", "wrong-dictionary"))
    return result


def validate_config(config_path: Path, repo_root: Path) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
    config = read_json(config_path)
    if config.get("schemaVersion") != CONFIG_SCHEMA_VERSION:
        fail("B12_CONFIG_SCHEMA")
    authorities = config.get("authorities", {})
    tensor_path = confined(repo_root, authorities.get("tensorContract", ""), "B12_TENSOR_PATH")
    native_path = confined(repo_root, authorities.get("nativeReferenceModel", ""), "B12_NATIVE_REFERENCE_PATH")
    preflight_path = confined(repo_root, authorities.get("nativeReferencePreflight", ""), "B12_NATIVE_PREFLIGHT_PATH")
    measurement_path = confined(repo_root, authorities.get("measurementContract", ""), "B12_MEASUREMENT_PATH")
    derivation_path = confined(repo_root, authorities.get("causalityDerivation", ""), "B12_DERIVATION_PATH")
    baseline_path = confined(repo_root, authorities.get("b10Baseline", ""), "B12_B10_BASELINE_PATH")
    tensor_value = read_json(tensor_path)
    measurement_value = read_json(measurement_path)
    if canonical_sha256(tensor_value, "contentSha256") != authorities.get("tensorContractSha256"):
        fail("B12_TENSOR_AUTHORITY_HASH")
    if sha256_file(native_path) != authorities.get("nativeReferenceModelSha256"):
        fail("B12_NATIVE_REFERENCE_AUTHORITY_HASH")
    if sha256_file(preflight_path) != authorities.get("nativeReferencePreflightSha256"):
        fail("B12_NATIVE_PREFLIGHT_HASH")
    if canonical_sha256(measurement_value) != authorities.get("measurementContractSha256"):
        fail("B12_MEASUREMENT_AUTHORITY_HASH")
    if sha256_file(baseline_path) != authorities.get("b10BaselineSha256"):
        fail("B12_B10_BASELINE_HASH")
    tensor = tensor_value
    native = read_json(native_path)
    preflight = read_json(preflight_path)
    derivation = read_json(derivation_path)
    baseline = read_json(baseline_path)
    if tensor.get("id") != TENSOR_CONTRACT_ID or tensor.get("contentSha256") != authorities["tensorContractSha256"] or canonical_sha256(tensor, "contentSha256") != tensor["contentSha256"]:
        fail("B12_TENSOR_CONTRACT")
    if tensor.get("keyframeWidth") != 17:
        fail("B12_TENSOR_WIDTH_MISMATCH")
    if config.get("architecture", {}).get("inputChannels") != tensor["keyframeWidth"]:
        fail("B12_ARCHITECTURE_WIDTH")
    if config.get("evaluation", {}).get("requiredInterventions") != required_interventions(tensor):
        fail("B12_INTERVENTION_MATRIX")
    training = config.get("training", {})
    if training.get("mixedPrecision") != "fp16" or training.get("gradientCheckpointing") is not True:
        fail("B12_MEMORY_POLICY")
    if training.get("optimizer") != "adamw8bit" or training.get("require8BitOptimizer") is not True or training.get("batchSize") != 1:
        fail("B12_OPTIMIZER_POLICY")
    if training.get("memoryEfficientAttention") != "torch-sdpa" or training.get("requireObjectiveSmoke") is not True or training.get("objectiveSmokePeakVramBytesMax") != 17179869184:
        fail("B12_NATIVE_MEMORY_POLICY")
    if training.get("foregroundLossWeight") != 1 or training.get("backgroundLossWeight") != 0 or training.get("alphaAuthority") != "coverage-channel-15-nearest":
        fail("B12_FOREGROUND_AUTHORITY")
    positive_ints = ("resolution", "gradientAccumulationSteps", "maxSteps", "checkpointEvery")
    if any(type(training.get(key)) is not int or training[key] <= 0 for key in positive_ints):
        fail("B12_TRAINING_NUMERIC_POLICY")
    if training["checkpointEvery"] % training["gradientAccumulationSteps"] != 0 or training["maxSteps"] % training["gradientAccumulationSteps"] != 0:
        fail("B12_CHECKPOINT_ACCUMULATION_POLICY")
    if type(training.get("numWorkers")) is not int or training["numWorkers"] < 0:
        fail("B12_TRAINING_NUMERIC_POLICY")
    if any(not isinstance(training.get(key), (int, float)) or not math.isfinite(training[key]) or training[key] <= 0 for key in ("learningRate", "maxGradNorm")):
        fail("B12_TRAINING_NUMERIC_POLICY")
    # Kept as a parsed object on config so the training/evaluation path cannot
    # accidentally select a different image/control resize geometry later.
    from model_raster import parse_model_raster
    config["modelRaster"] = parse_model_raster(config.get("modelRaster"), training_resolution=256, tensor=tensor)
    expected_training_raster = {
        "id": "glyph-training-raster/admission-nearest-v1", "sourceWidth": 256, "sourceHeight": 256,
        "width": 1024, "height": 1024, "targetAlgorithm": "nearest", "controlAlgorithm": "nearest",
        "coverageAlgorithm": "nearest", "coverageChannel": 15, "alphaAuthority": "coverage-only",
        "backgroundCompositing": "downstream-optional-not-training-or-causal-eval",
    }
    if config.get("trainingRaster") != expected_training_raster or training["resolution"] != 1024:
        fail("B12_TRAINING_RASTER_AUTHORITY")
    architecture = config.get("architecture", {})
    if architecture.get("id") != "sdxl-depth-controlnet-17ch/v1" or architecture.get("implementationStatus") != "ready-code-only-b11-data-required" or architecture.get("frozenBase") is not True or architecture.get("conditioningChannels") != 17 or architecture.get("stockDepthChannel") != 5:
        fail("B12_ARCHITECTURE_POLICY")
    evaluation = config.get("evaluation", {})
    if type(config.get("seed")) is not int or type(evaluation.get("seed")) is not int or type(evaluation.get("timestep")) is not int or evaluation["timestep"] < 0 or evaluation.get("scoreFormula") != "exp(-foreground_noise_prediction_mse)":
        fail("B12_EVALUATION_NUMERIC_POLICY")
    dataset = config.get("dataset", {})
    if dataset.get("selection") != "trajectory-round-robin-v1" or any(type(dataset.get(key)) is not int or dataset[key] < 2 for key in ("tinyFrames", "minimumUniqueTrajectories", "minimumUniqueCameras", "minimumUniqueClasses", "minimumUniqueSemanticGlyphs", "minimumMotionKinds")):
        fail("B12_DATASET_POLICY")
    repositories = {entry.get("role"): entry for entry in preflight.get("repositories", [])}
    configured = {entry.get("role"): entry for entry in native.get("repositories", [])}
    if preflight.get("verdict") != "pass" or set(repositories) != {"base", "depth-control"} or any(repositories[role].get("revision") != configured.get(role, {}).get("revision") for role in repositories):
        fail("B12_NATIVE_PREFLIGHT")
    if derivation.get("id") != "overfit-causality-v1" or derivation.get("contractVersion") != "v3":
        fail("B12_CAUSALITY_AUTHORITY")
    thresholds = derivation.get("thresholds", {})
    expected_thresholds = ("correctControlScoreMin", "promptOnlyScoreMax", "removedControlScoreMax", "shuffledControlScoreMax", "interventionMarginMin", "peakVramMiBMax")
    if set(thresholds) != set(expected_thresholds) or any(not isinstance(thresholds[key], (int, float)) or not math.isfinite(thresholds[key]) or thresholds[key] <= 0 for key in expected_thresholds) or any(thresholds[key] > 1 for key in expected_thresholds[:-1]) or thresholds["peakVramMiBMax"] > 16384:
        fail("B12_CAUSALITY_THRESHOLDS")
    if baseline.get("passed") is not True or baseline.get("contractVersion") != "v3":
        fail("B12_B10_BASELINE")
    runtime = config.get("runtime", {})
    expected_runtime = {
        "dockerContext": "gpu-4090",
        "artifactRoot": "/mnt/docker-data/glyphcss-ascii-image-generation",
        "containerArtifactRoot": "/artifacts",
        "containerRepoRoot": "/workspace/repo",
    }
    if any(runtime.get(key) != value for key, value in expected_runtime.items()) or not isinstance(runtime.get("image"), str) or not runtime["image"] or not isinstance(runtime.get("imageDigest"), str) or len(runtime["imageDigest"]) != 71 or not runtime["imageDigest"].startswith("sha256:") or any(char not in "0123456789abcdef" for char in runtime["imageDigest"][7:]):
        fail("B12_RUNTIME_POLICY")
    return config, tensor, derivation


def _bundle_record(corpus: dict[str, Any], trajectory_id: str) -> dict[str, Any]:
    records = [entry for entry in corpus.get("trajectories", []) if entry.get("trajectory", {}).get("controlTrajectory", {}).get("id") == trajectory_id]
    if len(records) != 1:
        fail("B12_TRAJECTORY_AUTHORITY")
    return records[0]


def _frame_record(bundle: dict[str, Any], frame_id: str) -> dict[str, Any]:
    frames = [entry for entry in bundle.get("frames", []) if entry.get("id") == frame_id]
    if len(frames) != 1:
        fail("B12_FRAME_AUTHORITY")
    return frames[0]


def verify_control_frame_files(control_root: Path, frame: dict[str, Any], control_manifest: dict[str, Any]) -> dict[str, str]:
    artifact_hashes = {}
    for relative in frame.get("files", {}).values():
        if not isinstance(relative, str):
            fail("B12_BUNDLE_FILE_HASH")
        artifact = confined(control_root, relative, "B12_CONTROL_FILE_PATH")
        actual = sha256_file(artifact)
        if control_manifest.get("files", {}).get(relative) != actual:
            fail("B12_BUNDLE_FILE_HASH")
        artifact_hashes[relative] = actual
    return artifact_hashes


def verify_evaluation_artifact(key: str, artifact: dict[str, Any], artifact_root: Path, alpha_by_sample: dict[str, bytes], Image: Any) -> None:
    path = confined(artifact_root, artifact.get("path", ""), "B12_EVALUATION_ARTIFACT_PATH")
    if sha256_file(path) != artifact.get("sha256"):
        fail("B12_EVALUATION_ARTIFACT_HASH")
    if key == "intervention-fingerprints":
        if artifact.get("width") != 0 or artifact.get("height") != 0:
            fail("B12_EVALUATION_ARTIFACT_DIMENSIONS")
        read_json(path)
        return
    with Image.open(path) as image:
        image.verify()
    with Image.open(path) as image:
        if image.size != (artifact.get("width"), artifact.get("height")):
            fail("B12_EVALUATION_ARTIFACT_DIMENSIONS")
        if key.startswith("transparent/"):
            sample_id = key.rsplit("@", 1)[-1]
            if image.mode != "RGBA" or image.getchannel("A").tobytes() != alpha_by_sample.get(sample_id):
                fail("B12_EVALUATION_ALPHA_AUTHORITY")
        elif key.startswith("raw/") and image.mode != "RGB":
            fail("B12_EVALUATION_RAW_RGB")


def _round_robin(records: list[dict[str, Any]], count: int) -> list[dict[str, Any]]:
    groups: dict[str, list[dict[str, Any]]] = {}
    for record in records:
        groups.setdefault(record["trajectoryId"], []).append(record)
    for values in groups.values():
        values.sort(key=lambda entry: entry["_frameIndex"])
    ordered: list[dict[str, Any]] = []
    cursor = 0
    keys = sorted(groups)
    while len(ordered) < count:
        advanced = False
        for key in keys:
            if cursor < len(groups[key]):
                ordered.append(groups[key][cursor])
                advanced = True
                if len(ordered) == count:
                    break
        if not advanced:
            break
        cursor += 1
    if len(ordered) != count:
        fail("B12_TINY_SELECTION_INCOMPLETE")
    return ordered


def _camera_diverse_round_robin(records: list[dict[str, Any]], count: int, minimum_cameras: int) -> list[dict[str, Any]]:
    ordered = _round_robin(records, len(records))
    selected: list[dict[str, Any]] = []
    used_cameras: set[str] = set()
    used_trajectories: set[str] = set()
    for prefer_new_camera in (True, False):
        for record in ordered:
            if record in selected:
                continue
            camera = record.get("cameraId")
            trajectory = record.get("trajectoryId")
            if camera is None:
                fail("B12_CAMERA_AUTHORITY")
            if prefer_new_camera and (camera in used_cameras or trajectory in used_trajectories):
                continue
            selected.append(record)
            used_cameras.add(camera)
            used_trajectories.add(trajectory)
            if len(selected) == count:
                break
        if len(selected) == count:
            break
    if len(selected) != count or len(used_cameras) < minimum_cameras:
        fail("B12_CAMERA_DIVERSE_SELECTION")
    return selected


def load_live_selection(config: dict[str, Any], tensor: dict[str, Any]) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    from model_raster import validate_control_metadata, validate_target_metadata
    dataset = config["dataset"]
    root = Path(dataset["root"]).resolve()
    manifest_path = confined(root, dataset["manifest"], "B12_DATASET_MANIFEST_PATH")
    balance_path = confined(root, dataset["balance"], "B12_DATASET_BALANCE_PATH")
    manifest = read_json(manifest_path)
    balance = read_json(balance_path)
    if manifest.get("schemaVersion") == "glyph-pilot-manifest/v2":
        return load_native_selection(config, tensor, root, manifest_path, balance_path, manifest, balance)
    # B12's configured authority is the native B11 manifest.  Retain the old
    # parser only for archival/teacher tooling, never as a fallback selector.
    if dataset.get("requiredTargetKind") == "native-exact-rgb/v1":
        fail("B12_LIVE_B11_DATA_REQUIRED")
    if manifest.get("schemaVersion") != "glyph-pilot-manifest/v1" or manifest.get("datasetRoot") != "/mnt/docker-data/glyphcss-ascii-image-generation/datasets/pilot":
        fail("B12_LIVE_B11_DATA_REQUIRED")
    if manifest.get("balanceReport") != dataset["balance"] or balance.get("schemaVersion") != "glyph-pilot-balance/v1" or balance.get("status") != "complete" or balance.get("admittedOnly") is not True:
        fail("B12_DATASET_BALANCE")
    if manifest.get("status") != "complete" or manifest.get("admission") != "B10":
        fail("B12_LIVE_B11_DATA_REQUIRED")
    corpus_path = root / "controls" / "manifest.json"
    corpus = read_json(corpus_path)
    if manifest.get("authoritativeCorpus", {}).get("contentSha256") != corpus.get("contentSha256") or canonical_sha256(corpus, "contentSha256") != corpus.get("contentSha256"):
        fail("B12_CORPUS_HASH")
    populations = balance.get("populations", [])
    if len(populations) != 3 or {entry.get("population") for entry in populations} != {"base", "style-a", "style-b"}:
        fail("B12_DATASET_BALANCE")
    population_balance = next((entry for entry in populations if entry.get("population") == dataset["population"]), None)
    split_balance = population_balance.get("splits", {}).get(dataset["split"]) if isinstance(population_balance, dict) else None
    balance_maps = ("classCells", "glyphCells", "instanceCells", "surfaceCells", "motionFrames")
    expected_records = [entry for entry in manifest.get("records", []) if entry.get("population") == dataset["population"] and entry.get("split") == dataset["split"]]
    if not isinstance(split_balance, dict) or split_balance.get("frames") != len(expected_records) or any(not isinstance(split_balance.get(key), dict) or not split_balance[key] or any(type(value) is not int or value <= 0 for value in split_balance[key].values()) for key in balance_maps):
        fail("B12_DATASET_BALANCE")
    candidates: list[dict[str, Any]] = []
    for entry in manifest.get("records", []):
        if entry.get("population") != dataset["population"] or entry.get("split") != dataset["split"]:
            continue
        if entry.get("providerModel") != dataset["requiredProviderModel"] or entry.get("providerModel", "").startswith("mock-"):
            fail("B12_LIVE_B11_DATA_REQUIRED")
        metadata_path = confined(root, entry["metadataPath"], "B12_TARGET_PATH")
        acceptance_path = confined(root, entry["acceptancePath"], "B12_ACCEPTANCE_PATH")
        target = read_json(metadata_path)
        acceptance = read_json(acceptance_path)
        b10 = acceptance.get("b10", {})
        if sha256_file(acceptance_path) != entry["acceptanceSha256"] or acceptance.get("schemaVersion") != "glyph-pilot-target-admission/v1" or b10.get("accepted") is not True:
            fail("B12_B10_ACCEPTANCE")
        if target.get("provider", {}).get("model") != dataset["requiredProviderModel"] or target.get("provider", {}).get("id") != "openai-images/v1":
            fail("B12_PROVIDER_PROVENANCE")
        target_style = target.get("request", {}).get("style", {})
        if target.get("targetId") != entry.get("targetId") or target.get("requestSha256") != entry.get("requestSha256") or target_style.get("id") != entry.get("styleId") or target_style.get("license") != entry.get("provenanceLicense"):
            fail("B12_PROVIDER_PROVENANCE")
        if canonical_sha256(target, "contentSha256") != target.get("contentSha256") or target.get("contentSha256") != entry.get("contentSha256"):
            fail("B12_TARGET_HASH")
        baseline = read_json(confined(Path(__file__).resolve().parents[1], config["authorities"]["b10Baseline"], "B12_B10_BASELINE_PATH"))
        if acceptance.get("targetId") != target.get("targetId") or acceptance.get("targetContentSha256") != target.get("contentSha256") or acceptance.get("targetImageSha256") != target.get("imageSha256"):
            fail("B12_B10_TARGET_BINDING")
        if b10.get("evaluator") != "admission-v1" or b10.get("contractVersion") != "v3" or b10.get("contractSha256") != config["authorities"]["measurementContractSha256"] or b10.get("baselineSha256") != config["authorities"]["b10BaselineSha256"]:
            fail("B12_B10_AUTHORITY")
        metrics = b10.get("metrics", {})
        thresholds = baseline.get("numericThresholds", {})
        if set(metrics) != set(METRIC_THRESHOLDS) or any(not isinstance(metrics[key], (int, float)) or not math.isfinite(metrics[key]) or metrics[key] < 0 or metrics[key] > thresholds.get(threshold_key, -1) for key, threshold_key in METRIC_THRESHOLDS.items()):
            fail("B12_B10_METRICS")
        image_path = confined(root, target["imagePath"], "B12_TARGET_IMAGE_PATH")
        if sha256_file(image_path) != target.get("imageSha256") or target.get("imageSha256") != entry.get("imageSha256"):
            fail("B12_TARGET_IMAGE_HASH")
        trajectory_id = entry["trajectoryId"]
        frame_id = target.get("request", {}).get("next", {}).get("frameId")
        corpus_record = _bundle_record(corpus, trajectory_id)
        trajectory = corpus_record["trajectory"]["controlTrajectory"]
        frames = [frame for frame in trajectory["frames"] if frame.get("frameId") == frame_id]
        if len(frames) != 1 or trajectory.get("sceneSeed") != entry.get("sceneSeed") or trajectory.get("split") != entry.get("split"):
            fail("B12_FRAME_LINEAGE")
        bundle_root = confined(root / "controls", corpus_record["visibleBundle"], "B12_BUNDLE_PATH")
        bundle = read_json(bundle_root / "manifest.json")
        if bundle.get("contentSha256") != corpus_record.get("visibleBundleSha256") or canonical_sha256(bundle, "contentSha256") != bundle.get("contentSha256"):
            fail("B12_BUNDLE_HASH")
        frame = _frame_record(bundle, frame_id)
        tensor_path = confined(bundle_root, frame["files"]["tensor-keyframe-f32"], "B12_TENSOR_FILE_PATH")
        spec_path = confined(bundle_root, frame["files"]["tensorSpec"], "B12_TENSOR_SPEC_PATH")
        metadata_control_path = confined(bundle_root, frame["files"]["metadata"], "B12_CONTROL_METADATA_PATH")
        expected_files = bundle.get("files", {})
        for path in (tensor_path, spec_path, metadata_control_path):
            relative = path.relative_to(bundle_root).as_posix()
            if expected_files.get(relative) != sha256_file(path):
                fail("B12_BUNDLE_FILE_HASH")
        spec = read_json(spec_path)
        metadata = read_json(metadata_control_path)
        validate_target_metadata(target, config["modelRaster"])
        validate_control_metadata(metadata, config["modelRaster"])
        if spec.get("contractSha256") != tensor["contentSha256"] or spec.get("contract") != tensor:
            fail("B12_TENSOR_SPEC")
        expected_bytes = tensor["keyframeWidth"] * metadata["cols"] * metadata["rows"] * 4
        if tensor_path.stat().st_size != expected_bytes:
            fail("B12_TENSOR_BYTES")
        class_path = confined(bundle_root, frame["files"]["class-id-i32"], "B12_CLASS_PATH")
        semantic_path = confined(bundle_root, frame["files"]["semantic"], "B12_SEMANTIC_PATH")
        if expected_files.get(class_path.relative_to(bundle_root).as_posix()) != sha256_file(class_path) or expected_files.get(semantic_path.relative_to(bundle_root).as_posix()) != sha256_file(semantic_path):
            fail("B12_BALANCE_SOURCE_HASH")
        class_bytes = class_path.read_bytes()
        classes = sorted({str(value) for index in range(0, len(class_bytes), 4) if (value := int.from_bytes(class_bytes[index:index + 4], "little", signed=True)) >= 0})
        glyphs = sorted(set(semantic_path.read_text().replace("\n", "").replace(" ", "")))
        motion = corpus_record.get("kind")
        candidates.append({**entry, "_frameIndex": frames[0]["index"], "targetPath": str(metadata_path), "imagePath": str(image_path), "tensorPath": str(tensor_path), "metadataPathControl": str(metadata_control_path), "cameraId": frames[0].get("cameraId"), "motionKind": motion, "classIds": classes, "semanticGlyphs": glyphs})
    selected = _camera_diverse_round_robin(candidates, dataset["tinyFrames"], dataset["minimumUniqueCameras"])
    trajectories = sorted({entry["trajectoryId"] for entry in selected})
    classes = sorted({item for entry in selected for item in entry["classIds"]})
    glyphs = sorted({item for entry in selected for item in entry["semanticGlyphs"]})
    motions = sorted({entry["motionKind"] for entry in selected})
    if len(trajectories) < dataset["minimumUniqueTrajectories"] or len(classes) < dataset["minimumUniqueClasses"] or len(glyphs) < dataset["minimumUniqueSemanticGlyphs"] or len(motions) < dataset["minimumMotionKinds"]:
        fail("B12_TINY_SELECTION_BALANCE")
    public_selection = [{key: value for key, value in entry.items() if not key.startswith("_")} for entry in selected]
    evidence = {
        "provenance": "live-admitted-pilot/v1",
        "manifestSha256": sha256_file(manifest_path),
        "balanceSha256": sha256_file(balance_path),
        "selectionSha256": canonical_sha256(public_selection),
        "frameCount": len(selected),
        "population": dataset["population"],
        "split": dataset["split"],
        "providerModel": dataset["requiredProviderModel"],
        "trajectoryIds": trajectories,
        "sceneSeeds": sorted({entry["sceneSeed"] for entry in selected}),
        "motionKinds": motions,
        "classIds": classes,
        "semanticGlyphs": glyphs,
    }
    return selected, evidence


def load_native_selection(config: dict[str, Any], tensor: dict[str, Any], root: Path, manifest_path: Path, balance_path: Path, manifest: dict[str, Any], balance: dict[str, Any]) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    from model_raster import validate_control_metadata, validate_target_metadata
    dataset = config["dataset"]
    if manifest.get("status") != "complete" or manifest.get("datasetRoot") != "/mnt/docker-data/glyphcss-ascii-image-generation/datasets/pilot" or manifest.get("authority", {}).get("kind") != "B43-B45-native-asset-first/v1":
        fail("B12_LIVE_B11_DATA_REQUIRED")
    if balance.get("schemaVersion") != "glyph-pilot-balance/v2" or balance.get("status") != "complete" or balance.get("targetKind") != dataset.get("requiredTargetKind"):
        fail("B12_DATASET_BALANCE")
    if canonical_sha256(manifest, "contentSha256") != manifest.get("contentSha256") or canonical_sha256(balance, "contentSha256") != balance.get("contentSha256") or manifest.get("balanceReport") != dataset["balance"]:
        fail("B12_NATIVE_MANIFEST_SEAL")
    asset_root = Path(dataset.get("assetCorpusRoot", "")).resolve()
    if not asset_root.is_dir():
        fail("B12_NATIVE_ASSET_ROOT")
    candidates: list[dict[str, Any]] = []
    for entry in manifest.get("records", []):
        if entry.get("split") != dataset["split"] or entry.get("targetKind") != dataset.get("requiredTargetKind"):
            continue
        if entry.get("contentSha256") != canonical_sha256(entry, "contentSha256") or entry.get("admission", {}).get("b10", {}).get("accepted") is not True:
            fail("B12_NATIVE_ADMISSION")
        validate_target_metadata(entry, config["modelRaster"])
        image_path = confined(asset_root, entry.get("target", {}).get("path", ""), "B12_TARGET_IMAGE_PATH")
        if sha256_file(image_path) != entry.get("target", {}).get("sha256"):
            fail("B12_TARGET_IMAGE_HASH")
        control_manifest_path = confined(asset_root, entry.get("control", {}).get("path", ""), "B12_CONTROL_MANIFEST_PATH")
        control_manifest = read_json(control_manifest_path)
        if control_manifest.get("contentSha256") != entry.get("control", {}).get("sha256") or canonical_sha256(control_manifest, "contentSha256") != control_manifest.get("contentSha256"):
            fail("B12_CONTROL_MANIFEST_HASH")
        frame = next((candidate for candidate in control_manifest.get("frames", []) if candidate.get("id") == entry.get("control", {}).get("frameId")), None)
        if frame is None:
            fail("B12_FRAME_LINEAGE")
        control_root = control_manifest_path.parent
        files = frame.get("files", {})
        artifact_hashes = verify_control_frame_files(control_root, frame, control_manifest)
        tensor_path = confined(control_root, files.get("tensor-keyframe-f32", ""), "B12_TENSOR_FILE_PATH")
        spec_path = confined(control_root, files.get("tensorSpec", ""), "B12_TENSOR_SPEC_PATH")
        metadata_control_path = confined(control_root, files.get("metadata", ""), "B12_CONTROL_METADATA_PATH")
        metadata = read_json(metadata_control_path)
        validate_control_metadata(metadata, config["modelRaster"])
        spec = read_json(spec_path)
        if spec.get("contractSha256") != tensor["contentSha256"] or spec.get("contract") != tensor:
            fail("B12_TENSOR_SPEC")
        if tensor_path.stat().st_size != tensor["keyframeWidth"] * metadata["cols"] * metadata["rows"] * 4:
            fail("B12_TENSOR_BYTES")
        semantic_path = confined(control_root, files.get("semantic", ""), "B12_SEMANTIC_PATH")
        semantic_glyphs = sorted(set(semantic_path.read_text().replace("\n", "").replace(" ", "")))
        if not semantic_glyphs:
            fail("B12_NATIVE_SEMANTIC_EMPTY")
        artifact_hashes["target"] = sha256_file(image_path)
        artifact_hashes["control-manifest"] = sha256_file(control_manifest_path)
        lineage_roles = ("surface-uv-f32", "world-position-f32", "winner-polygon-i32", "coverage-u8")
        lineage_hashes = {role: artifact_hashes[files[role]] for role in lineage_roles}
        candidates.append({**entry, "_frameIndex": entry.get("frameIndex"), "targetPath": str(image_path), "imagePath": str(image_path), "tensorPath": str(tensor_path), "metadataPathControl": str(metadata_control_path), "cameraId": entry.get("frame", {}).get("cameraId"), "motionKind": entry.get("variant", {}).get("pose", {}).get("kind"), "classIds": [str(entry.get("asset", {}).get("classId"))], "semanticGlyphs": semantic_glyphs, "artifactHashes": artifact_hashes, "lineageHashes": lineage_hashes})
    selected = _camera_diverse_round_robin(candidates, dataset["tinyFrames"], dataset["minimumUniqueCameras"])
    if not selected:
        fail("B12_LIVE_B11_DATA_REQUIRED")
    trajectories = sorted({entry["trajectoryId"] for entry in selected})
    classes = sorted({item for entry in selected for item in entry["classIds"]})
    glyphs = sorted({item for entry in selected for item in entry["semanticGlyphs"]})
    motions = sorted({entry["motionKind"] for entry in selected})
    if len(trajectories) < dataset["minimumUniqueTrajectories"] or len(classes) < dataset["minimumUniqueClasses"] or len(glyphs) < dataset["minimumUniqueSemanticGlyphs"] or len(motions) < dataset["minimumMotionKinds"]:
        fail("B12_TINY_SELECTION_BALANCE")
    public_selection = [{key: value for key, value in entry.items() if key not in {"targetPath", "imagePath", "tensorPath", "metadataPathControl"} and not key.startswith("_")} for entry in selected]
    evidence = {"provenance": "native-asset-first-pilot/v1", "manifestSha256": sha256_file(manifest_path), "balanceSha256": sha256_file(balance_path), "selectionSha256": canonical_sha256(public_selection), "frameCount": len(selected), "population": "native-exact-rgb", "split": dataset["split"], "targetKind": dataset["requiredTargetKind"], "trajectoryIds": trajectories, "sceneSeeds": sorted({entry["admission"]["b10"].get("sceneSha256", entry["control"]["sha256"]) for entry in selected}), "motionKinds": motions, "classIds": classes, "semanticGlyphs": glyphs}
    return selected, evidence


def score_evaluation(losses: dict[str, list[float]], derivation: dict[str, Any], required: list[str]) -> dict[str, Any]:
    if sorted(losses) != sorted(required) or any(not values or any(not math.isfinite(value) or value < 0 for value in values) for values in losses.values()):
        fail("B12_EVALUATION_MATRIX")
    thresholds = derivation["thresholds"]
    sample_scores = {key: [math.exp(-value) for value in values] for key, values in losses.items()}
    if len({len(values) for values in sample_scores.values()}) != 1:
        fail("B12_EVALUATION_SAMPLE_MATRIX")
    scores = {key: sum(values) / len(values) for key, values in sample_scores.items()}
    correct_samples = sample_scores["correct-controls"]
    correct = scores["correct-controls"]
    interventions = []
    for identifier in required:
        if identifier == "correct-controls":
            continue
        limit = thresholds["promptOnlyScoreMax"] if identifier == "prompt-only" else thresholds["removedControlScoreMax"] if identifier.startswith("leave-out/") or identifier == "all-controls-removed" else thresholds["shuffledControlScoreMax"]
        margins = [left - right for left, right in zip(correct_samples, sample_scores[identifier], strict=True)]
        sample_pass = [score <= limit and margin >= thresholds["interventionMarginMin"] for score, margin in zip(sample_scores[identifier], margins, strict=True)]
        margin = sum(margins) / len(margins)
        passed = all(sample_pass)
        interventions.append({"id": identifier, "score": scores[identifier], "margin": margin, "sampleLosses": losses[identifier], "sampleScores": sample_scores[identifier], "sampleMargins": margins, "samplePass": sample_pass, "pass": passed})
    return {
        "formula": "exp(-foreground_noise_prediction_mse)",
        "thresholds": thresholds,
        "correctSampleLosses": losses["correct-controls"],
        "correctSampleScores": correct_samples,
        "correctScore": correct,
        "interventions": interventions,
        "allMarginsPass": all(score >= thresholds["correctControlScoreMin"] for score in correct_samples) and all(item["pass"] for item in interventions),
    }


def inverse_projection_correspondence(selection: list[dict[str, Any]]) -> dict[str, Any]:
    roles = ("surface-uv-f32", "world-position-f32", "winner-polygon-i32", "coverage-u8")
    samples = []
    for entry in selection:
        hashes = entry.get("lineageHashes", {})
        if any(not isinstance(hashes.get(role), str) for role in roles):
            fail("B12_INVERSE_PROJECTION_LINEAGE")
        samples.append({
            "sampleId": f"{entry['trajectoryId']}--{entry['frame']['id']}",
            "surfaceUvSha256": hashes["surface-uv-f32"],
            "worldPositionSha256": hashes["world-position-f32"],
            "winnerPolygonSha256": hashes["winner-polygon-i32"],
            "coverageSha256": hashes["coverage-u8"],
        })
    return {
        "mode": "exact-control-winner-lineage/no-remesh/v1",
        "generatedPngRole": "diagnostic-one-view-rgb-not-final-3d-state",
        "final3dState": False,
        "samples": samples,
    }


def validate_report(report_path: Path, config_path: Path, repo_root: Path, artifact_root: Path | None = None) -> dict[str, Any]:
    if artifact_root is None:
        fail("B12_ARTIFACT_ROOT_REQUIRED")
    config, tensor, derivation = validate_config(config_path, repo_root)
    report = read_json(report_path)
    if report.get("schemaVersion") != REPORT_SCHEMA_VERSION or report.get("acceptanceEligible") is not True or report.get("synthetic") is not False:
        fail("B12_REPORT_NOT_ACCEPTANCE_ELIGIBLE")
    if canonical_sha256(report, "reportSha256") != report.get("reportSha256"):
        fail("B12_REPORT_HASH")
    authorities = report.get("authorities", {})
    if authorities.get("configSha256") != sha256_file(config_path):
        fail("B12_REPORT_CONFIG_HASH")
    for report_key, config_key in (
        ("tensorContractSha256", "tensorContractSha256"),
        ("nativeReferenceModelSha256", "nativeReferenceModelSha256"),
        ("nativeReferencePreflightSha256", "nativeReferencePreflightSha256"),
        ("measurementContractSha256", "measurementContractSha256"),
    ):
        if authorities.get(report_key) != config["authorities"][config_key]:
            fail("B12_REPORT_AUTHORITY_HASH")
    derivation_path = confined(repo_root, config["authorities"]["causalityDerivation"], "B12_DERIVATION_PATH")
    if authorities.get("causalityDerivationSha256") != sha256_file(derivation_path):
        fail("B12_REPORT_DERIVATION_HASH")
    if authorities.get("containerDigest") != config["runtime"]["imageDigest"]:
        fail("B12_REPORT_CONTAINER_HASH")
    live_selection, live_data = load_live_selection(config, tensor)
    reported_data = report.get("data", {})
    if {key: value for key, value in reported_data.items() if key != "rasterExpansion"} != live_data:
        fail("B12_REPORT_DATA_BINDING")
    try:
        import numpy as np
        import torch
        from PIL import Image
        from training_raster import expand_training_inputs
    except ImportError as error:
        raise OverfitContractError(f"B12_RASTER_RECONSTRUCTION_RUNTIME:{error.name}") from error
    expanded = [expand_training_inputs(entry, tensor, config["modelRaster"], config["trainingRaster"], "cpu", np, torch, Image) for entry in live_selection]
    reconstructed = [item[2] for item in expanded]
    if reported_data.get("rasterExpansion") != reconstructed:
        fail("B12_TRAINING_RASTER_RECONSTRUCTION")
    evaluation = report.get("evaluation", {})
    expected_ids = required_interventions(tensor)[1:]
    if [entry.get("id") for entry in evaluation.get("interventions", [])] != expected_ids:
        fail("B12_REPORT_INTERVENTIONS")
    sample_ids = [f"{entry['trajectoryId']}--{entry['frame']['id']}" for entry in live_selection]
    alpha_by_sample = {
        sample_id: bytes(item[0][0, 15].float().clamp(0, 1).mul(255).byte().cpu().numpy().tobytes())
        for sample_id, item in zip(sample_ids, expanded, strict=True)
    }
    expected_silhouette = [
        {"sampleId": sample_id, "coverageSha256": evidence["coverageSha256"], "score": 1}
        for sample_id, evidence in zip(sample_ids, reconstructed, strict=True)
    ]
    if evaluation.get("scoreRegion") != "coverage-foreground-only" or evaluation.get("silhouette") != expected_silhouette:
        fail("B12_SILHOUETTE_AUTHORITY")
    if evaluation.get("inverseProjection") != inverse_projection_correspondence(live_selection):
        fail("B12_INVERSE_PROJECTION_LINEAGE")
    expected_artifacts = {
        *(f"{kind}/{identifier}@{sample_id}" for kind in ("raw", "transparent") for identifier in required_interventions(tensor) for sample_id in sample_ids),
        "contact-sheet", "intervention-fingerprints",
    }
    if set(evaluation.get("artifacts", {})) != expected_artifacts:
        fail("B12_REPORT_EVALUATION_ARTIFACTS")
    from PIL import Image
    for key, artifact in evaluation["artifacts"].items():
        verify_evaluation_artifact(key, artifact, artifact_root, alpha_by_sample, Image)
    rescored = score_evaluation({"correct-controls": evaluation.get("correctSampleLosses", []), **{entry["id"]: entry["sampleLosses"] for entry in evaluation["interventions"]}}, derivation, required_interventions(tensor))
    score_fields = ("formula", "thresholds", "correctSampleLosses", "correctSampleScores", "correctScore", "interventions", "allMarginsPass")
    if any(evaluation.get(key) != rescored[key] for key in score_fields):
        fail("B12_REPORT_SCORE_RECONSTRUCTION")
    if report.get("status") != "pass" or not evaluation.get("allMarginsPass") or report.get("runtime", {}).get("peakReservedMiB", math.inf) > derivation["thresholds"]["peakVramMiBMax"]:
        fail("B12_GATE_FAILED")
    if report.get("data", {}).get("provenance") != "native-asset-first-pilot/v1" or report.get("data", {}).get("targetKind") != config["dataset"]["requiredTargetKind"]:
        fail("B12_REPORT_DATA_PROVENANCE")
    checkpoint = report.get("checkpoint", {})
    for path_key, hash_key in (("modelPath", "modelSha256"), ("statePath", "stateSha256")):
        path = confined(artifact_root, checkpoint.get(path_key, ""), "B12_CHECKPOINT_PATH")
        if sha256_file(path) != checkpoint.get(hash_key):
            fail("B12_CHECKPOINT_HASH")
    if checkpoint.get("resumeIntegrity") is not True or not report.get("commands", {}).get("resume"):
        fail("B12_RESUME_EVIDENCE")
    training = report.get("training", {})
    for report_key, config_key in (
        ("mixedPrecision", "mixedPrecision"),
        ("gradientCheckpointing", "gradientCheckpointing"),
        ("optimizer", "optimizer"),
        ("batchSize", "batchSize"),
        ("gradientAccumulationSteps", "gradientAccumulationSteps"),
        ("maxSteps", "maxSteps"),
        ("seed", None),
    ):
        expected = config["seed"] if config_key is None else config["training"][config_key]
        if training.get(report_key) != expected:
            fail("B12_REPORT_TRAINING_BINDING")
    if training.get("completedSteps") != training.get("maxSteps") or training.get("completedMicrosteps") != training.get("completedSteps") * training.get("gradientAccumulationSteps") or len(training.get("losses", [])) != training.get("completedSteps"):
        fail("B12_REPORT_TRAINING_BINDING")
    latest_path = confined(artifact_root, f"runs/{report['runId']}/latest.json", "B12_LATEST_PATH")
    latest = read_json(latest_path)
    expected_bindings = {
        "configSha256": sha256_file(config_path),
        "tensorContractSha256": tensor["contentSha256"],
        "nativeReferenceModelSha256": config["authorities"]["nativeReferenceModelSha256"],
        "nativeReferencePreflightSha256": config["authorities"]["nativeReferencePreflightSha256"],
        "measurementContractSha256": config["authorities"]["measurementContractSha256"],
        "dataManifestSha256": live_data["manifestSha256"],
        "dataSelectionSha256": live_data["selectionSha256"],
    }
    if latest.get("bindings") != expected_bindings or latest.get("optimizerStep") != training["completedSteps"] or latest.get("microstep") != training["completedMicrosteps"] or latest.get("gradientAccumulationSteps") != training["gradientAccumulationSteps"] or latest.get("modelSha256") != checkpoint.get("modelSha256") or latest.get("stateSha256") != checkpoint.get("stateSha256") or f"runs/{report['runId']}/{latest.get('modelPath', '')}" != checkpoint.get("modelPath") or f"runs/{report['runId']}/{latest.get('statePath', '')}" != checkpoint.get("statePath"):
        fail("B12_LATEST_BINDING")
    return report


def synthetic_wiring_report(config_path: Path, repo_root: Path) -> dict[str, Any]:
    config, tensor, _ = validate_config(config_path, repo_root)
    slices = keyframe_slices(tensor)
    return {
        "schemaVersion": "glyph-overfit-wiring-check/v1",
        "status": "wiring-only",
        "acceptanceEligible": False,
        "synthetic": True,
        "configSha256": sha256_file(config_path),
        "tensorContractSha256": tensor["contentSha256"],
        "channelSlices": {key: list(value) for key, value in slices.items()},
        "interventions": required_interventions(tensor),
        "note": "This contains no model, dataset, checkpoint, GPU, loss, score, or gate evidence.",
    }

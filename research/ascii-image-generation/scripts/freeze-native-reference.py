#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import json
from datetime import datetime, timezone
from pathlib import Path
import sys


BASE_REPOSITORY = "stabilityai/stable-diffusion-xl-base-1.0"
BASE_REVISION = "462165984030d82259a11f4367a4eed129e94a7b"
CONTROL_REPOSITORY = "diffusers/controlnet-depth-sdxl-1.0"
CONTROL_REVISION = "17bb97973f29801224cd66f192c5ffacf82648b4"


class NativeReferenceFreezeError(RuntimeError):
    pass


def fail(code: str) -> None:
    raise NativeReferenceFreezeError(code)


def canonical(value, omit: str | None = None) -> bytes:
    if omit and isinstance(value, dict):
        value = {key: item for key, item in value.items() if key != omit}
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def validate_config(config: dict) -> None:
    if config.get("schemaVersion") != "glyph-native-reference-model-config/v1" or config.get("status") != "awaiting-remote-freeze":
        fail("B52_CONFIG_SCHEMA")
    if config.get("pipeline") != {
        "class": "StableDiffusionXLControlNetPipeline",
        "baseRole": "native-reference-generator",
        "controlRole": "stock-depth-baseline-and-integration-authority",
        "browserSizeCriterion": None,
        "weightFiles": "default-safetensors",
        "runtimeDtype": "float16",
    }:
        fail("B52_PIPELINE_AUTHORITY")
    repositories = config.get("repositories")
    if not isinstance(repositories, list) or len(repositories) != 2:
        fail("B52_REPOSITORY_SET")
    expected = {
        "base": (BASE_REPOSITORY, BASE_REVISION, "sdxl-base-1.0"),
        "depth-control": (CONTROL_REPOSITORY, CONTROL_REVISION, "controlnet-depth-sdxl-1.0"),
    }
    for entry in repositories:
        if not isinstance(entry, dict) or entry.get("role") not in expected:
            fail("B52_REPOSITORY_SET")
        repository, revision, identifier = expected[entry["role"]]
        if (entry.get("repository"), entry.get("revision"), entry.get("id"), entry.get("variant")) != (repository, revision, identifier, "default-safetensors"):
            fail("B52_REPOSITORY_IDENTITY")
        required = entry.get("requiredFiles")
        if not isinstance(required, list) or len(required) < 3 or len({item.get("path") for item in required if isinstance(item, dict)}) != len(required):
            fail("B52_REQUIRED_FILE_SET")
        for item in required:
            path = item.get("path")
            if not isinstance(path, str) or not path or path.startswith("/") or ".." in Path(path).parts or item.get("kind") not in {"config", "model-card", "license", "tokenizer", "safetensors"}:
                fail("B52_REQUIRED_FILE_SET")
            if path.endswith((".bin", ".ckpt", ".pt", ".pth")):
                fail("B52_PICKLE_FORBIDDEN")
    base = next(entry for entry in repositories if entry["role"] == "base")
    control = next(entry for entry in repositories if entry["role"] == "depth-control")
    if not any(item["kind"] == "license" for item in base["requiredFiles"]) or not any(item["kind"] == "model-card" for item in base["requiredFiles"]) or not any(item["kind"] == "model-card" for item in control["requiredFiles"]):
        fail("B52_SOURCE_TEXTS_REQUIRED")


def safe_parameter_count(path: Path) -> int:
    try:
        from safetensors import safe_open
    except ImportError as error:
        raise NativeReferenceFreezeError("B52_SAFETENSORS_RUNTIME_REQUIRED") from error
    count = 0
    with safe_open(path, framework="pt", device="cpu") as tensors:
        for key in tensors.keys():
            shape = tensors.get_slice(key).get_shape()
            size = 1
            for dimension in shape:
                size *= dimension
            count += size
    return count


def runtime_versions() -> dict[str, str]:
    def version(package: str) -> str:
        try:
            return importlib.metadata.version(package)
        except importlib.metadata.PackageNotFoundError as error:
            raise NativeReferenceFreezeError(f"B52_RUNTIME_PACKAGE_MISSING:{package}") from error
    return {
        "python": sys.version.split()[0],
        "torch": version("torch"),
        "diffusers": version("diffusers"),
        "transformers": version("transformers"),
        "safetensors": version("safetensors"),
    }


def resolve_repository(entry: dict, cache_root: Path, download: bool) -> tuple[Path, str]:
    destination = cache_root / entry["id"] / entry["revision"]
    if download:
        try:
            from huggingface_hub import HfApi, snapshot_download
        except ImportError as error:
            raise NativeReferenceFreezeError("B52_HUGGINGFACE_RUNTIME_REQUIRED") from error
        info = HfApi().model_info(entry["repository"], revision=entry["revision"])
        if info.sha != entry["revision"]:
            fail("B52_MUTABLE_REVISION")
        snapshot_download(
            repo_id=entry["repository"],
            revision=entry["revision"],
            local_dir=destination,
            allow_patterns=[item["path"] for item in entry["requiredFiles"]],
        )
        resolved = info.sha
    else:
        resolved_file = destination / ".resolved-revision"
        if not resolved_file.is_file():
            fail(f"B52_REMOTE_CACHE_NOT_FROZEN:{entry['id']}")
        resolved = resolved_file.read_text().strip()
    if resolved != entry["revision"]:
        fail("B52_MUTABLE_REVISION")
    return destination, resolved


def freeze(config_path: Path, cache_root: Path, report_path: Path, download: bool = False, generated_at: str | None = None, versions: dict[str, str] | None = None) -> dict:
    config_bytes = config_path.read_bytes()
    config = json.loads(config_bytes)
    validate_config(config)
    repositories = []
    for entry in config["repositories"]:
        destination, resolved = resolve_repository(entry, cache_root, download)
        files = []
        parameters = 0
        for requirement in entry["requiredFiles"]:
            path = destination / requirement["path"]
            if not path.is_file() or path.is_symlink() or path.stat().st_size <= 0:
                fail(f"B52_REQUIRED_FILE_MISSING:{entry['id']}:{requirement['path']}")
            if requirement["kind"] == "safetensors":
                parameters += safe_parameter_count(path)
            files.append({
                "path": requirement["path"],
                "kind": requirement["kind"],
                "bytes": path.stat().st_size,
                "sha256": sha256_file(path),
                "url": f"https://huggingface.co/{entry['repository']}/resolve/{entry['revision']}/{requirement['path']}",
            })
        tree = sha256_bytes(canonical(files))
        repositories.append({
            "id": entry["id"], "role": entry["role"], "repository": entry["repository"],
            "revision": entry["revision"], "resolvedRevision": resolved, "variant": entry["variant"],
            "artifactRoot": f"{config['runtime']['artifactRoot']}/{entry['id']}/{entry['revision']}",
            "files": files, "treeSha256": tree, "safetensorsParameters": parameters,
        })
    report = {
        "schemaVersion": "glyph-native-reference-model-preflight/v1",
        "generatedAt": generated_at or datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "verdict": "pass",
        "configSha256": sha256_bytes(config_bytes),
        "pipeline": config["pipeline"],
        "runtime": {**config["runtime"], **(versions or runtime_versions())},
        "repositories": repositories,
        "treeSha256": sha256_bytes(canonical(repositories)),
    }
    report["contentSha256"] = sha256_bytes(canonical(report))
    report_path.parent.mkdir(parents=True, exist_ok=True)
    temporary = report_path.with_suffix(f"{report_path.suffix}.tmp")
    temporary.write_text(json.dumps(report, indent=2) + "\n")
    temporary.replace(report_path)
    return report


def verify(config_path: Path, cache_root: Path, report_path: Path, schema_path: Path) -> dict:
    try:
        from jsonschema import Draft202012Validator
    except ImportError as error:
        raise NativeReferenceFreezeError("B52_JSONSCHEMA_RUNTIME_REQUIRED") from error
    config_bytes = config_path.read_bytes()
    config = json.loads(config_bytes)
    validate_config(config)
    report = json.loads(report_path.read_text())
    errors = sorted(Draft202012Validator(json.loads(schema_path.read_text()), format_checker=None).iter_errors(report), key=lambda item: list(item.path))
    if errors:
        fail(f"B52_REPORT_SCHEMA:{errors[0].message}")
    if report["configSha256"] != sha256_bytes(config_bytes) or report["contentSha256"] != sha256_bytes(canonical(report, "contentSha256")):
        fail("B52_REPORT_SEAL")
    if report["pipeline"] != config["pipeline"]:
        fail("B52_REPORT_PIPELINE_AUTHORITY")
    if report["runtime"]["dockerContext"] != config["runtime"]["dockerContext"] or report["runtime"]["artifactRoot"] != config["runtime"]["artifactRoot"]:
        fail("B52_REPORT_RUNTIME_AUTHORITY")
    expected_by_id = {entry["id"]: entry for entry in config["repositories"]}
    if {entry["id"] for entry in report["repositories"]} != set(expected_by_id):
        fail("B52_REPORT_REPOSITORY_SET")
    for repository in report["repositories"]:
        expected = expected_by_id[repository["id"]]
        destination = cache_root / expected["id"] / expected["revision"]
        expected_artifact_root = f"{config['runtime']['artifactRoot']}/{expected['id']}/{expected['revision']}"
        if (
            repository["role"] != expected["role"]
            or repository["repository"] != expected["repository"]
            or repository["revision"] != expected["revision"]
            or repository["resolvedRevision"] != expected["revision"]
            or repository["variant"] != expected["variant"]
            or repository["artifactRoot"] != expected_artifact_root
        ):
            fail("B52_REPORT_REPOSITORY_IDENTITY")
        if [entry["path"] for entry in repository["files"]] != [entry["path"] for entry in expected["requiredFiles"]]:
            fail("B52_REPORT_FILE_SET")
        parameters = 0
        for file, required in zip(repository["files"], expected["requiredFiles"], strict=True):
            expected_url = f"https://huggingface.co/{expected['repository']}/resolve/{expected['revision']}/{required['path']}"
            if file["path"] != required["path"] or file["kind"] != required["kind"] or file["url"] != expected_url:
                fail("B52_REPORT_FILE_AUTHORITY")
            path = destination / file["path"]
            if not path.is_file() or path.is_symlink() or path.stat().st_size != file["bytes"] or sha256_file(path) != file["sha256"]:
                fail(f"B52_REPORT_FILE_HASH:{repository['id']}:{file['path']}")
            if required["kind"] == "safetensors":
                parameters += safe_parameter_count(path)
        if repository["safetensorsParameters"] != parameters:
            fail("B52_REPORT_PARAMETER_COUNT")
        if repository["treeSha256"] != sha256_bytes(canonical(repository["files"])):
            fail("B52_REPORT_TREE_HASH")
    if report["treeSha256"] != sha256_bytes(canonical(report["repositories"])):
        fail("B52_REPORT_TREE_HASH")
    return report


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", required=True, type=Path)
    parser.add_argument("--cache-root", required=True, type=Path)
    parser.add_argument("--report", required=True, type=Path)
    parser.add_argument("--schema", type=Path, default=Path(__file__).resolve().parents[1] / "schema/native-reference-model.schema.json")
    parser.add_argument("--download", action="store_true")
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    report = verify(args.config.resolve(), args.cache_root.resolve(), args.report.resolve(), args.schema.resolve()) if args.check else freeze(args.config.resolve(), args.cache_root.resolve(), args.report.resolve(), args.download)
    print(json.dumps({"verdict": report["verdict"], "report": str(args.report.resolve()), "treeSha256": report["treeSha256"]}))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"B52 native-reference freeze failed: {error}", file=sys.stderr)
        raise SystemExit(1)

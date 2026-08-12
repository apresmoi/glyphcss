#!/usr/bin/env python3
import argparse
import hashlib
import json
import os
import pathlib
import shutil
import sys
import urllib.request
from datetime import datetime, timezone
from huggingface_hub import HfApi, hf_hub_download
from safetensors import safe_open


def fail(message):
    raise RuntimeError(message)


def sha256(path):
    digest = hashlib.sha256()
    with open(path, "rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":")).encode()


def file_record(root, requirement, revision):
    path = root / requirement["path"]
    if not path.is_file() or path.is_symlink():
        fail(f"required regular file is missing: {requirement['path']}")
    if requirement["kind"] == "safetensors" and path.suffix != ".safetensors":
        fail(f"unsafe weight format selected: {requirement['path']}")
    digest = sha256(path)
    if digest != requirement["sha256"] or path.stat().st_size != requirement["bytes"]:
        fail(f"immutable file identity mismatch: {requirement['path']}")
    return {
        "path": requirement["path"], "bytes": path.stat().st_size, "sha256": digest,
        "url": f"https://huggingface.co/nota-ai/bk-sdm-small/resolve/{revision}/{requirement['path']}", "kind": requirement["kind"],
    }


def tree_hash(records):
    return hashlib.sha256(canonical(records)).hexdigest()


def safetensor_parameter_count(path):
    count = 0
    with safe_open(path, framework="pt", device="cpu") as tensors:
        for key in tensors.keys():
            if key.endswith(".position_ids"):
                continue
            shape = tensors.get_slice(key).get_shape()
            size = 1
            for dimension in shape:
                size *= dimension
            count += size
    return count


def parameter_counts(root):
    unet = safetensor_parameter_count(root / "unet/diffusion_pytorch_model.fp16.safetensors")
    text = safetensor_parameter_count(root / "text_encoder/model.fp16.safetensors")
    vae = safetensor_parameter_count(root / "vae/diffusion_pytorch_model.fp16.safetensors")
    safety = safetensor_parameter_count(root / "safety_checker/model.fp16.safetensors")
    return {"unet": unet, "generatorCore": unet + text + vae, "safetyChecker": safety, "allDownloaded": unet + text + vae + safety}


def assert_texts(config, source_root, artifact_root):
    records = []
    source_text_root = artifact_root / "source-texts"
    source_text_root.mkdir(parents=True, exist_ok=True)
    for source in config["sourceTexts"]:
        checked = source_root / source["path"]
        if not checked.is_file() or checked.is_symlink():
            fail(f"missing source-controlled {source['role']} text")
        if sha256(checked) != source["sha256"]:
            fail(f"source-controlled {source['role']} text hash drift")
        if source["role"] == "model-card":
            upstream = pathlib.Path(hf_hub_download(config["repository"], "README.md", revision=config["revision"]))
            upstream_hash = sha256(upstream)
        else:
            upstream_hash = hashlib.sha256(urllib.request.urlopen(source["url"], timeout=30).read()).hexdigest()
        if upstream_hash != source["sha256"]:
            fail(f"upstream {source['role']} text hash drift")
        destination = source_text_root / pathlib.Path(source["path"]).name
        shutil.copyfile(checked, destination)
        if sha256(destination) != source["sha256"]:
            fail(f"copied {source['role']} text hash drift")
        records.append({"role": source["role"], "path": source["path"], "url": source["url"], "sha256": source["sha256"]})
    return records


def download_round(config, destination, force_download):
    api = HfApi()
    info = api.model_info(config["repository"], revision=config["revision"], files_metadata=True)
    if info.sha != config["revision"]:
        fail(f"mutable reference resolved to {info.sha}, expected {config['revision']}")
    for requirement in config["requiredFiles"]:
        downloaded = pathlib.Path(hf_hub_download(
            repo_id=config["repository"], filename=requirement["path"], revision=config["revision"],
            local_dir=destination, force_download=force_download,
        ))
        expected = (destination / requirement["path"]).resolve()
        if downloaded.resolve() != expected:
            fail(f"download escaped immutable artifact root: {requirement['path']}")
    files = [file_record(destination, requirement, config["revision"]) for requirement in config["requiredFiles"]]
    return info.sha, files


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", required=True)
    parser.add_argument("--source-root", required=True)
    parser.add_argument("--artifact-root", required=True)
    parser.add_argument("--remote-artifact-root", required=True)
    parser.add_argument("--container-digest", required=True)
    parser.add_argument("--container-image", required=True)
    parser.add_argument("--docker-context", required=True)
    args = parser.parse_args()
    config_path = pathlib.Path(args.config)
    config = json.loads(config_path.read_text())
    if config.get("schemaVersion") != "glyph-base-model-config/v1":
        fail("unsupported base-model config")
    if len(config.get("revision", "")) != 40 or any(char not in "0123456789abcdef" for char in config["revision"]):
        fail("mutable or malformed model revision")
    execution = config["execution"]
    if args.container_image != execution["image"] or args.docker_context != execution["context"] or args.container_digest != execution["digest"]:
        fail("launcher execution identity differs from the frozen B8 contract")
    if any(entry["path"].endswith(".bin") or entry["kind"] == "pickle" for entry in config["requiredFiles"]):
        fail("pickle is forbidden while a safetensors equivalent is selected")
    artifact_root = pathlib.Path(args.artifact_root) / config["id"] / config["revision"]
    artifact_root.mkdir(parents=True, exist_ok=True)
    source_texts = assert_texts(config, pathlib.Path(args.source_root), artifact_root)
    resolved, first_files = download_round(config, artifact_root, False)
    _, second_files = download_round(config, artifact_root, True)
    first_hash = tree_hash(first_files)
    second_hash = tree_hash(second_files)
    if first_hash != second_hash or first_files != second_files:
        fail("second immutable download did not match the first content")
    counts = parameter_counts(artifact_root)
    if counts != config["parameterCount"]["exactArtifacts"]:
        fail(f"exact safetensors parameter counts drift: {counts}")
    for payload_name in ["generatorCore", "requiredLocalDemo"]:
        payload = config["expectedBrowserPayload"][payload_name]
        paths = set(payload["paths"])
        payload_bytes = sum(entry["bytes"] for entry in second_files if entry["path"] in paths)
        if payload_bytes != payload["weightsBytes"]:
            fail(f"{payload_name} payload expectation drift")
    report = {
        "schemaVersion": "glyph-base-model-preflight/v1",
        "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "verdict": "pass",
        "configSha256": hashlib.sha256(config_path.read_bytes()).hexdigest(),
        "container": {"image": args.container_image, "digest": args.container_digest, "context": args.docker_context},
        "model": {
            "id": config["id"], "repository": config["repository"], "revision": config["revision"], "resolvedRevision": resolved,
            "precision": config["precision"], "parameterCount": config["parameterCount"], "recomputedParameterCount": counts, "files": second_files,
            "browserPayload": config["expectedBrowserPayload"],
        },
        "sourceTexts": source_texts,
        "verification": {"rounds": [{"round": 1, "forceDownload": False, "treeSha256": first_hash, "files": first_files}, {"round": 2, "forceDownload": True, "treeSha256": second_hash, "files": second_files}], "identical": True, "noPickleConsumed": True},
        "disposition": config["disposition"],
        "artifactRoot": str(pathlib.PurePosixPath(args.remote_artifact_root) / config["id"] / config["revision"]),
    }
    report_path = artifact_root / "base-model-preflight.json"
    report_path.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({"verdict": report["verdict"], "report": str(report_path), "treeSha256": second_hash}))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"B34 freeze failed: {error}", file=sys.stderr)
        sys.exit(1)

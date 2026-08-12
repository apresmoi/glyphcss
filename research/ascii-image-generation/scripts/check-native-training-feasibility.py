#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path


BASE_REVISION = "462165984030d82259a11f4367a4eed129e94a7b"
CONTROL_REVISION = "17bb97973f29801224cd66f192c5ffacf82648b4"
REFERENCE_GPU = "NVIDIA GeForce RTX 4090 Laptop GPU"
REFERENCE_TOTAL_VRAM_BYTES = 16978935808


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def canonical(value: object) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()


def digest_value(report: dict) -> str:
    unsealed = {key: value for key, value in report.items() if key != "contentSha256"}
    return hashlib.sha256(canonical(unsealed)).hexdigest()


def strict_json(path: Path) -> dict:
    def reject(value: str) -> None:
        raise RuntimeError(f"B52_FEASIBILITY_NONFINITE_JSON:{value}")
    return json.loads(path.read_text(), parse_constant=reject)


def check(root: Path, config_path: Path, report_path: Path, schema_path: Path) -> dict:
    root, config_path = root.resolve(), config_path.resolve()
    config = strict_json(config_path)
    report = strict_json(report_path)
    from jsonschema import Draft202012Validator
    Draft202012Validator(strict_json(schema_path)).validate(report)
    if digest_value(report) != report["contentSha256"]:
        raise RuntimeError("B52_FEASIBILITY_CONTENT_SEAL")
    native_config = root / config["nativeReferenceConfig"]
    preflight = root / config["nativeReferencePreflight"]
    if report["authorities"]["configSha256"] != digest(config_path) or report["authorities"]["nativeReferenceConfigSha256"] != digest(native_config) or report["authorities"]["nativeReferencePreflightSha256"] != digest(preflight):
        raise RuntimeError("B52_FEASIBILITY_AUTHORITY_HASH")
    frozen = strict_json(preflight)
    repositories = {item["role"]: item for item in frozen["repositories"]}
    if report["authorities"]["baseRevision"] != repositories["base"]["revision"] or report["authorities"]["baseRevision"] != BASE_REVISION or report["authorities"]["controlRevision"] != repositories["depth-control"]["revision"] or report["authorities"]["controlRevision"] != CONTROL_REVISION:
        raise RuntimeError("B52_FEASIBILITY_MODEL_REVISION")
    if report["authorities"]["nativeReferenceTreeSha256"] != frozen["treeSha256"] or report["authorities"]["baseTreeSha256"] != repositories["base"]["treeSha256"] or report["authorities"]["controlTreeSha256"] != repositories["depth-control"]["treeSha256"]:
        raise RuntimeError("B52_FEASIBILITY_MODEL_TREE")
    if report["training"] != config["training"] or report["authorities"]["containerDigest"] != config["runtime"]["imageDigest"]:
        raise RuntimeError("B52_FEASIBILITY_POLICY_BINDING")
    runtime = report["runtime"]
    if runtime["gpu"] != REFERENCE_GPU or runtime["totalVramBytes"] != REFERENCE_TOTAL_VRAM_BYTES:
        raise RuntimeError("B52_FEASIBILITY_GPU_AUTHORITY")
    measurement = report["measurement"]
    loss = measurement["loss"]
    allocated = measurement["peakAllocatedBytes"]
    reserved = measurement["peakReservedBytes"]
    if not isinstance(loss, (int, float)) or isinstance(loss, bool) or not math.isfinite(loss):
        raise RuntimeError("B52_FEASIBILITY_LOSS_NONFINITE")
    if not isinstance(allocated, int) or isinstance(allocated, bool) or not isinstance(reserved, int) or isinstance(reserved, bool) or allocated <= 0 or reserved <= 0 or allocated > reserved:
        raise RuntimeError("B52_FEASIBILITY_MEMORY_ORDER")
    if reserved > report["training"]["maximumPeakVramBytes"] or reserved > runtime["totalVramBytes"]:
        raise RuntimeError("B52_FEASIBILITY_MEMORY_BUDGET")
    if report["verdict"] != "pass":
        raise RuntimeError("B52_FEASIBILITY_NON_PASS")
    return report


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument("--schema", type=Path, required=True)
    args = parser.parse_args()
    report = check(args.root, args.config, args.report, args.schema)
    print(json.dumps({"verdict": "pass", "contentSha256": report["contentSha256"]}))


if __name__ == "__main__":
    main()

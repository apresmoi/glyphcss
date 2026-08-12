#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path


BASE_REVISION = "462165984030d82259a11f4367a4eed129e94a7b"
CONTROL_REVISION = "17bb97973f29801224cd66f192c5ffacf82648b4"


def canonical(value: object) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()


def digest(path: Path) -> str:
    if not path.is_file() or path.is_symlink():
        raise RuntimeError(f"B52_REVIEW_ARTIFACT_INVALID:{path}")
    return hashlib.sha256(path.read_bytes()).hexdigest()


def check(root: Path, review_path: Path, schema_path: Path) -> dict:
    from jsonschema import Draft202012Validator

    review = json.loads(review_path.read_text())
    Draft202012Validator(json.loads(schema_path.read_text())).validate(review)
    unsealed = {key: value for key, value in review.items() if key != "contentSha256"}
    if hashlib.sha256(canonical(unsealed)).hexdigest() != review["contentSha256"]:
        raise RuntimeError("B52_REVIEW_CONTENT_SEAL")
    authority = review["modelAuthority"]
    if authority != {"baseRevision": BASE_REVISION, "controlRevision": CONTROL_REVISION}:
        raise RuntimeError("B52_REVIEW_MODEL_AUTHORITY")
    by_role = {item["role"]: item for item in review["comparison"]}
    if set(by_role) != {"prompt-only", "correct-control-0.65", "wrong-control"}:
        raise RuntimeError("B52_REVIEW_ROLE_SET")
    for item in review["comparison"]:
        report_path = root / item["reportPath"]
        generated_path = root / item["generatedPath"]
        control_path = root / item["controlDepthPath"]
        if digest(report_path) != item["reportSha256"] or digest(generated_path) != item["generatedSha256"] or digest(control_path) != item["controlDepthSha256"]:
            raise RuntimeError(f"B52_REVIEW_ARTIFACT_HASH:{item['role']}")
        report = json.loads(report_path.read_text())
        if report["models"]["base"]["revision"] != BASE_REVISION or report["models"]["control"]["revision"] != CONTROL_REVISION:
            raise RuntimeError(f"B52_REVIEW_REPORT_AUTHORITY:{item['role']}")
        if report["controlScale"] != item["controlScale"] or report["outputs"]["generated"]["sha256"] != item["generatedSha256"] or report["outputs"]["controlDepth"]["sha256"] != item["controlDepthSha256"]:
            raise RuntimeError(f"B52_REVIEW_REPORT_BINDING:{item['role']}")
    if by_role["prompt-only"]["controlScale"] != 0 or by_role["correct-control-0.65"]["controlScale"] != 0.65 or by_role["wrong-control"]["controlScale"] != 0.65:
        raise RuntimeError("B52_REVIEW_SCALE_COMPARISON")
    if by_role["prompt-only"]["controlDepthSha256"] != by_role["correct-control-0.65"]["controlDepthSha256"] or by_role["wrong-control"]["controlDepthSha256"] == by_role["correct-control-0.65"]["controlDepthSha256"]:
        raise RuntimeError("B52_REVIEW_CONTROL_COMPARISON")
    return review


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--review", type=Path)
    parser.add_argument("--schema", type=Path)
    args = parser.parse_args()
    root = args.root.resolve()
    review = args.review.resolve() if args.review else root / "reports/native-reference-review.json"
    schema = args.schema.resolve() if args.schema else root / "schema/native-reference-review.schema.json"
    checked = check(root, review, schema)
    print(json.dumps({"verdict": "pass", "contentSha256": checked["contentSha256"]}))


if __name__ == "__main__":
    main()

"""Strict training-side admission for B9 target/provenance records."""
from __future__ import annotations
import hashlib
import json
import re
from pathlib import Path

HASH = re.compile(r"^[a-f0-9]{64}$")
ID = re.compile(r"^[a-z][a-z0-9._/-]*$")
FRAME = re.compile(r"^[a-z0-9._-]+$")
ROLES = ["visible-ascii", "semantic-ascii", "semantic-color", "depth", "normal", "world-position", "surface-uv", "coverage", "shade"]
ROLE_BUNDLE = {role: "semantic" if role.startswith("semantic") else "visible" for role in ROLES}

def _canonical(value):
    if value is None or not isinstance(value, (dict, list)):
        return json.dumps(value, separators=(",", ":"), ensure_ascii=False)
    if isinstance(value, list):
        return "[" + ",".join(_canonical(item) for item in value) + "]"
    return "{" + ",".join(json.dumps(key, ensure_ascii=False) + ":" + _canonical(value[key]) for key in sorted(value) if key != "contentSha256") + "}"

def _hash(value):
    return hashlib.sha256(_canonical(value).encode()).hexdigest()

def _keys(value, expected, label):
    if not isinstance(value, dict) or set(value) != set(expected):
        raise ValueError(f"{label} keys invalid")

def _sha(value, label):
    if not isinstance(value, str) or not HASH.fullmatch(value):
        raise ValueError(f"{label} hash invalid")

def _id(value, label):
    if not isinstance(value, str) or not ID.fullmatch(value):
        raise ValueError(f"{label} id invalid")

def _frame(value, nullable, label):
    if value is None and nullable:
        return
    _keys(value, ["frameId", "index", "controlSha256"], label)
    if not isinstance(value["frameId"], str) or not FRAME.fullmatch(value["frameId"]) or not isinstance(value["index"], int) or isinstance(value["index"], bool) or value["index"] < 0:
        raise ValueError(f"{label} invalid")
    _sha(value["controlSha256"], label)

def _trajectory(value):
    keys = ["corpusId", "corpusSha256", "trajectoryId", "trajectorySha256", "controlTrajectorySha256", "sceneId", "sceneSha256", "dictionaryId", "dictionarySha256"]
    _keys(value, keys, "trajectory")
    for key in ["corpusId", "trajectoryId", "sceneId", "dictionaryId"]:
        _id(value[key], f"trajectory.{key}")
    for key in ["corpusSha256", "trajectorySha256", "controlTrajectorySha256", "sceneSha256", "dictionarySha256"]:
        _sha(value[key], f"trajectory.{key}")

def _bundles(value):
    _keys(value, ["visible", "semantic"], "bundles")
    for name in ["visible", "semantic"]:
        _keys(value[name], ["manifestSha256", "treeSha256", "glyphOutput"], f"bundle.{name}")
        _sha(value[name]["manifestSha256"], f"bundle.{name}.manifest")
        _sha(value[name]["treeSha256"], f"bundle.{name}.tree")
        if value[name]["glyphOutput"] != name:
            raise ValueError("bundle selector invalid")

def _reference(value, label):
    if not isinstance(value, dict) or set(value) not in ({"fileId"}, {"imageUrl"}):
        raise ValueError(f"{label} reference invalid")
    if not all(isinstance(item, str) and item for item in value.values()):
        raise ValueError(f"{label} reference type invalid")
    if "imageUrl" in value and not value["imageUrl"].startswith("https://"):
        raise ValueError(f"{label} URL invalid")

def _controls(value):
    if not isinstance(value, list) or [item.get("role") for item in value] != ROLES:
        raise ValueError("control role set invalid")
    for item in value:
        _keys(item, ["role", "bundle", "sourcePath", "sourceSha256", "pngPath", "pngSha256", "width", "height", "legend", "providerReference"], "control")
        if item["bundle"] != ROLE_BUNDLE[item["role"]] or not isinstance(item["sourcePath"], str) or item["sourcePath"].startswith("/") or ".." in Path(item["sourcePath"]).parts or not isinstance(item["pngPath"], str) or item["pngPath"].startswith("/") or ".." in Path(item["pngPath"]).parts:
            raise ValueError("control source invalid")
        _sha(item["sourceSha256"], "control.source")
        _sha(item["pngSha256"], "control.png")
        if not isinstance(item["width"], int) or isinstance(item["width"], bool) or item["width"] < 1 or not isinstance(item["height"], int) or isinstance(item["height"], bool) or item["height"] < 1 or not isinstance(item["legend"], dict):
            raise ValueError("control PNG provenance invalid")
        _reference(item["providerReference"], "control")

def _prior(value):
    if value is None:
        return
    _keys(value, ["targetId", "contentSha256", "imageSha256", "sequenceId", "frameId", "providerReference"], "prior")
    _id(value["targetId"], "prior.target"); _id(value["sequenceId"], "prior.sequence")
    if not isinstance(value["frameId"], str) or not FRAME.fullmatch(value["frameId"]):
        raise ValueError("prior frame invalid")
    _sha(value["contentSha256"], "prior.content")
    _sha(value["imageSha256"], "prior.image")
    _reference(value["providerReference"], "prior")

def _style(value):
    _keys(value, ["id", "prompt", "license", "sourceSha256"], "style")
    _id(value["id"], "style")
    if not all(isinstance(value[key], str) and value[key] for key in ["id", "prompt", "license"]):
        raise ValueError("style provenance invalid")
    if value["sourceSha256"] is not None:
        _sha(value["sourceSha256"], "style.source")

def _request(value):
    keys = ["schemaVersion", "mode", "trajectory", "bundles", "current", "next", "controls", "priorAcceptedTarget", "style", "candidates", "output", "requestSha256"]
    _keys(value, keys, "request")
    if value["schemaVersion"] != "glyph-target-provider/v2" or value["mode"] not in ("keyframe", "edit"):
        raise ValueError("request version/mode invalid")
    raw = dict(value); expected = raw.pop("requestSha256"); _sha(expected, "request")
    if _hash(raw) != expected:
        raise ValueError("request hash mismatch")
    _trajectory(value["trajectory"]); _bundles(value["bundles"]); _frame(value["current"], True, "current"); _frame(value["next"], False, "next")
    _controls(value["controls"]); _prior(value["priorAcceptedTarget"]); _style(value["style"])
    if not isinstance(value["candidates"], int) or isinstance(value["candidates"], bool) or not 1 <= value["candidates"] <= 10:
        raise ValueError("candidate count invalid")
    _keys(value["output"], ["size", "quality", "format"], "output")
    if not isinstance(value["output"]["size"], str) or not value["output"]["size"] or not isinstance(value["output"]["quality"], str) or not value["output"]["quality"] or value["output"]["format"] not in ("png", "jpeg", "webp"):
        raise ValueError("output contract invalid")
    if value["mode"] == "keyframe" and (value["current"] is not None or value["priorAcceptedTarget"] is not None or value["next"]["index"] != 0):
        raise ValueError("keyframe lineage invalid")
    if value["mode"] == "edit" and (value["current"] is None or value["priorAcceptedTarget"] is None or value["next"]["index"] != value["current"]["index"] + 1):
        raise ValueError("edit lineage invalid")

def _provider(value):
    _keys(value, ["id", "model", "apiVersion", "responseRequestId", "attempts", "reusedResponse"], "provider")
    if not all(isinstance(value[key], str) and value[key] for key in ["id", "model", "apiVersion", "responseRequestId"]) or not isinstance(value["reusedResponse"], bool):
        raise ValueError("provider provenance invalid")
    if not isinstance(value["attempts"], list) or not value["attempts"]:
        raise ValueError("attempt provenance missing")
    for attempt in value["attempts"]:
        allowed = {"attempt", "outcome", "status", "responseRequestId", "code"}
        if not isinstance(attempt, dict) or not {"attempt", "outcome", "status"} <= set(attempt) or set(attempt) - allowed:
            raise ValueError("attempt provenance invalid")
        if not isinstance(attempt["attempt"], int) or isinstance(attempt["attempt"], bool) or attempt["attempt"] < 1 or attempt["outcome"] not in ("success", "transient", "failed") or (attempt["status"] is not None and (not isinstance(attempt["status"], int) or isinstance(attempt["status"], bool) or attempt["status"] < 0)) or ("responseRequestId" in attempt and (not isinstance(attempt["responseRequestId"], str) or not attempt["responseRequestId"])) or ("code" in attempt and attempt["code"] is not None and not isinstance(attempt["code"], str)):
            raise ValueError("attempt outcome invalid")

def _provider_request(value):
    _keys(value, ["apiVersion", "operation", "endpoint", "method", "body", "prompt"], "providerRequest")
    if not all(isinstance(value[key], str) and value[key] for key in ["apiVersion", "operation", "endpoint", "method", "prompt"]) or not isinstance(value["body"], dict):
        raise ValueError("provider request provenance invalid")
    if "authorization" in json.dumps(value).lower():
        raise ValueError("provider request contains credentials")

def load_training_target(metadata_path: str | Path, artifact_root: str | Path):
    root = Path(artifact_root).resolve()
    metadata = json.loads(Path(metadata_path).read_text())
    keys = ["schemaVersion", "targetId", "imageSha256", "imagePath", "provider", "providerRequest", "requestSha256", "request", "lineage", "contentSha256"]
    _keys(metadata, keys, "target")
    if metadata["schemaVersion"] != "glyph-image-target/v2":
        raise ValueError("unsupported target schema")
    _id(metadata["targetId"], "target")
    if not isinstance(metadata["imagePath"], str) or metadata["imagePath"].startswith("/") or ".." in Path(metadata["imagePath"]).parts:
        raise ValueError("target image path invalid")
    raw = dict(metadata); expected = raw.pop("contentSha256"); _sha(expected, "content")
    if _hash(raw) != expected:
        raise ValueError("target content hash mismatch")
    _sha(metadata["imageSha256"], "image"); _sha(metadata["requestSha256"], "request")
    _provider(metadata["provider"]); _provider_request(metadata["providerRequest"]); _request(metadata["request"])
    if metadata["requestSha256"] != metadata["request"]["requestSha256"]:
        raise ValueError("request linkage mismatch")
    lineage = metadata["lineage"]
    _keys(lineage, ["trajectory", "bundles", "current", "next", "priorAcceptedTarget", "controls", "style", "candidateIndex"], "lineage")
    for key in ["trajectory", "bundles", "current", "next", "priorAcceptedTarget", "controls", "style"]:
        if lineage[key] != metadata["request"][key]:
            raise ValueError(f"lineage {key} mismatch")
    if not isinstance(lineage["candidateIndex"], int) or isinstance(lineage["candidateIndex"], bool) or not 0 <= lineage["candidateIndex"] < metadata["request"]["candidates"]:
        raise ValueError("candidate lineage invalid")
    image_path = (root / metadata["imagePath"]).resolve()
    if root not in image_path.parents or hashlib.sha256(image_path.read_bytes()).hexdigest() != metadata["imageSha256"]:
        raise ValueError("target image hash/path mismatch")
    return metadata

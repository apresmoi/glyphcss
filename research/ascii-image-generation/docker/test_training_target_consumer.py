import hashlib
import json
import pytest
from training_target_consumer import load_training_target, _hash

H = "a" * 64
ROLES = ["visible-ascii", "semantic-ascii", "semantic-color", "depth", "normal", "world-position", "surface-uv", "coverage", "shade"]

def record(root):
    image = b"training-target"; image_hash = hashlib.sha256(image).hexdigest()
    (root / "targets").mkdir(); (root / "targets" / f"{image_hash}.bin").write_bytes(image)
    trajectory = {"corpusId":"corpus/x","corpusSha256":H,"trajectoryId":"trajectory/x","trajectorySha256":H,"controlTrajectorySha256":H,"sceneId":"scene/x","sceneSha256":H,"dictionaryId":"dictionary/x","dictionarySha256":H}
    bundles = {"visible":{"manifestSha256":H,"treeSha256":H,"glyphOutput":"visible"},"semantic":{"manifestSha256":H,"treeSha256":H,"glyphOutput":"semantic"}}
    controls = [{"role":role,"bundle":"semantic" if role.startswith("semantic") else "visible","sourcePath":f"frames/f000/{role}.bin","sourceSha256":H,"pngPath":f"controls/f000/{role}.png","pngSha256":H,"width":24,"height":16,"legend":{"encoding":"fixture"},"providerReference":{"fileId":f"file-{role}"}} for role in ROLES]
    style = {"id":"style/x","prompt":"ink","license":"CC0-1.0","sourceSha256":None}
    raw_request = {"schemaVersion":"glyph-target-provider/v2","mode":"keyframe","trajectory":trajectory,"bundles":bundles,"current":None,"next":{"frameId":"f000","index":0,"controlSha256":H},"controls":controls,"priorAcceptedTarget":None,"style":style,"candidates":1,"output":{"size":"1024x1024","quality":"medium","format":"png"}}
    request = {**raw_request, "requestSha256":_hash(raw_request)}
    raw = {"schemaVersion":"glyph-image-target/v2","targetId":"target/fixture","imageSha256":image_hash,"imagePath":f"targets/{image_hash}.bin","provider":{"id":"mock","model":"mock","apiVersion":"offline/v1","responseRequestId":"mock-request","attempts":[{"attempt":1,"outcome":"success","status":0}],"reusedResponse":False},"providerRequest":{"apiVersion":"offline/v1","operation":"mock","endpoint":"offline://mock","method":"NONE","body":{},"prompt":"fixture"},"requestSha256":request["requestSha256"],"request":request,"lineage":{"trajectory":trajectory,"bundles":bundles,"current":None,"next":request["next"],"priorAcceptedTarget":None,"controls":controls,"style":style,"candidateIndex":0}}
    target = {**raw, "contentSha256":_hash(raw)}
    path = root / "targets" / f"{image_hash}.json"; path.write_text(json.dumps(target)); return path

def test_training_target_is_strictly_hash_bound(tmp_path):
    assert load_training_target(record(tmp_path), tmp_path)["targetId"] == "target/fixture"

def test_training_target_rejects_hostile_lineage(tmp_path):
    target = record(tmp_path); data = json.loads(target.read_text()); data["lineage"]["controls"].pop(); target.write_text(json.dumps(data))
    with pytest.raises(ValueError):
        load_training_target(target, tmp_path)

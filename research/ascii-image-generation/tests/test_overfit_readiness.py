from __future__ import annotations

import copy
import hashlib
import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))


def load(name: str):
    spec = importlib.util.spec_from_file_location(name, ROOT / "src" / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    assert spec.loader
    spec.loader.exec_module(module)
    return module


contract = load("overfit_contract")
eval_control = load("eval_control")
train_control = load("train_control")


class OverfitReadinessTests(unittest.TestCase):
    def setUp(self):
        self.config_path = ROOT / "config" / "overfit-keyframe.yaml"

    def test_exact_tensor_and_intervention_wiring(self):
        config, tensor, _ = contract.validate_config(self.config_path, ROOT)
        self.assertEqual(tensor["keyframeWidth"], 17)
        self.assertEqual(len(contract.required_interventions(tensor)), 25)
        self.assertEqual(config["evaluation"]["requiredInterventions"], contract.required_interventions(tensor))
        self.assertEqual(contract.keyframe_slices(tensor)["semantic-control-color"], (2, 5))

    def test_config_authority_tamper_fails_closed(self):
        value = json.loads(self.config_path.read_text())
        value["authorities"]["tensorContractSha256"] = "0" * 64
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "config.json"
            path.write_text(json.dumps(value))
            with self.assertRaisesRegex(contract.OverfitContractError, "B12_TENSOR_AUTHORITY_HASH"):
                contract.validate_config(path, ROOT)

    def test_runtime_and_numeric_policy_tamper_fails_closed(self):
        value = json.loads(self.config_path.read_text())
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "config.json"
            value["runtime"]["artifactRoot"] = "/"
            path.write_text(json.dumps(value))
            with self.assertRaisesRegex(contract.OverfitContractError, "B12_RUNTIME_POLICY"):
                contract.validate_config(path, ROOT)
            value = json.loads(self.config_path.read_text())
            value["training"]["maxGradNorm"] = float("nan")
            path.write_text(json.dumps(value))
            with self.assertRaisesRegex(contract.OverfitContractError, "B12_TRAINING_NUMERIC_POLICY"):
                contract.validate_config(path, ROOT)
            value = json.loads(self.config_path.read_text())
            value["training"]["checkpointEvery"] += 1
            path.write_text(json.dumps(value))
            with self.assertRaisesRegex(contract.OverfitContractError, "B12_CHECKPOINT_ACCUMULATION_POLICY"):
                contract.validate_config(path, ROOT)

    def test_synthetic_evidence_is_explicitly_ineligible(self):
        report = contract.synthetic_wiring_report(self.config_path, ROOT)
        self.assertIs(report["acceptanceEligible"], False)
        self.assertIs(report["synthetic"], True)
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "report.json"
            path.write_text(json.dumps(report))
            with self.assertRaisesRegex(contract.OverfitContractError, "B12_REPORT_NOT_ACCEPTANCE_ELIGIBLE"):
                contract.validate_report(path, self.config_path, ROOT, Path(directory))

    def test_scores_are_reconstructed_from_raw_losses(self):
        _, tensor, derivation = contract.validate_config(self.config_path, ROOT)
        required = contract.required_interventions(tensor)
        losses = {identifier: [0.01, 0.02] if identifier == "correct-controls" else [2.0, 2.1] for identifier in required}
        result = contract.score_evaluation(losses, derivation, required)
        self.assertEqual(result["correctSampleLosses"], losses["correct-controls"])
        self.assertTrue(result["allMarginsPass"])

    def test_causal_gate_is_per_sample_not_aggregate(self):
        _, tensor, derivation = contract.validate_config(self.config_path, ROOT)
        required = contract.required_interventions(tensor)
        losses = {identifier: [0.01, 0.01] if identifier == "correct-controls" else [4.0, 0.01] for identifier in required}
        result = contract.score_evaluation(losses, derivation, required)
        self.assertFalse(result["allMarginsPass"])
        self.assertTrue(all(len(item["sampleMargins"]) == 2 and item["samplePass"] == [True, False] for item in result["interventions"]))

    def test_camera_diverse_round_robin_reaches_later_camera(self):
        records = [
            {"trajectoryId": "a", "cameraId": "orbit-a", "_frameIndex": 0},
            {"trajectoryId": "a", "cameraId": "orbit-b", "_frameIndex": 1},
            {"trajectoryId": "b", "cameraId": "orbit-a", "_frameIndex": 0},
            {"trajectoryId": "b", "cameraId": "orbit-b", "_frameIndex": 1},
        ]
        selected = contract._camera_diverse_round_robin(records, 2, 2)
        self.assertEqual({entry["cameraId"] for entry in selected}, {"orbit-a", "orbit-b"})

    def test_training_tuple_contract_reaches_five_value_branch(self):
        sample = ("control", "latent", "prompt", "pooled", {"evidence": True})
        self.assertEqual(train_control.prepared_components([sample], 0), sample[:4])
        with self.assertRaisesRegex(Exception, "B12_PREPARED_SAMPLE_ARITY"):
            train_control.prepared_components([sample[:4]], 0)

    def test_evaluation_mask_always_uses_original_correct_control(self):
        class FakeControl:
            ndim = 3
            def __init__(self, name):
                self.name = name
            def unsqueeze(self, axis):
                return (self.name, axis)
        correct = [FakeControl("correct")]
        intervened = [FakeControl("removed")]
        self.assertEqual(eval_control.evaluation_coverage(correct, 0), ("correct", 0))
        self.assertNotEqual(eval_control.evaluation_coverage(correct, 0), eval_control.evaluation_coverage(intervened, 0))

    def test_inverse_projection_lineage_is_exact_and_not_final_3d(self):
        hashes = {role: hashlib.sha256(role.encode()).hexdigest() for role in ("surface-uv-f32", "world-position-f32", "winner-polygon-i32", "coverage-u8")}
        result = contract.inverse_projection_correspondence([{"trajectoryId": "t", "frame": {"id": "f"}, "lineageHashes": hashes}])
        self.assertFalse(result["final3dState"])
        self.assertEqual(result["generatedPngRole"], "diagnostic-one-view-rgb-not-final-3d-state")
        self.assertEqual(result["samples"][0]["winnerPolygonSha256"], hashes["winner-polygon-i32"])

    def test_wrong_camera_requires_distinct_camera_donors(self):
        samples = [{"cameraId": "a"}, {"cameraId": "b"}, {"cameraId": "c"}]
        donors = eval_control.camera_derangement(samples, 4091)
        self.assertTrue(all(samples[index]["cameraId"] != samples[donor]["cameraId"] for index, donor in enumerate(donors)))
        with self.assertRaisesRegex(eval_control.OverfitContractError, "B12_WRONG_CAMERA_DONOR_UNAVAILABLE"):
            eval_control.camera_derangement([{"cameraId": "same"}, {"cameraId": "same"}], 1)

    def test_mock_provider_is_rejected_before_training(self):
        config, tensor, _ = contract.validate_config(self.config_path, ROOT)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            value = copy.deepcopy(config)
            value["dataset"]["root"] = str(root)
            split = {"frames": 1, "classCells": {"1": 1}, "glyphCells": {"A": 1}, "instanceCells": {"i": 1}, "surfaceCells": {"s": 1}, "motionFrames": {"slow": 1}}
            populations = [{"population": population, "styleId": style, "splits": {"train": split, "validation": split, "test": split}} for population, style in (("base", "style/base"), ("style-a", "style/a"), ("style-b", "style/b"))]
            (root / "pilot-balance.json").write_text(json.dumps({"schemaVersion": "glyph-pilot-balance/v1", "status": "complete", "admittedOnly": True, "populations": populations}))
            (root / "pilot-manifest.json").write_text(json.dumps({
                "schemaVersion": "glyph-pilot-manifest/v1", "status": "complete", "datasetRoot": "/mnt/docker-data/glyphcss-ascii-image-generation/datasets/pilot", "admission": "B10", "balanceReport": "pilot-balance.json",
                "authoritativeCorpus": {"contentSha256": "0" * 64},
                "records": [{"population": "base", "split": "train", "providerModel": "mock-gpt-image-1.5"}],
            }))
            (root / "controls").mkdir()
            corpus = {"contentSha256": ""}
            corpus["contentSha256"] = contract.canonical_sha256(corpus, "contentSha256")
            (root / "controls" / "manifest.json").write_text(json.dumps(corpus))
            manifest = json.loads((root / "pilot-manifest.json").read_text())
            manifest["authoritativeCorpus"]["contentSha256"] = corpus["contentSha256"]
            (root / "pilot-manifest.json").write_text(json.dumps(manifest))
            with self.assertRaisesRegex(contract.OverfitContractError, "B12_LIVE_B11_DATA_REQUIRED"):
                contract.load_live_selection(value, tensor)

    def test_selected_control_file_same_size_tamper_fails(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "tensor.bin").write_bytes(b"abcd")
            manifest = {"files": {"tensor.bin": hashlib.sha256(b"abcd").hexdigest()}}
            frame = {"files": {"tensor-keyframe-f32": "tensor.bin"}}
            self.assertEqual(contract.verify_control_frame_files(root, frame, manifest)["tensor.bin"], manifest["files"]["tensor.bin"])
            (root / "tensor.bin").write_bytes(b"wxyz")
            with self.assertRaisesRegex(contract.OverfitContractError, "B12_BUNDLE_FILE_HASH"):
                contract.verify_control_frame_files(root, frame, manifest)

    def test_evaluation_artifact_hash_path_and_alpha_are_authoritative(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            path = root / "sample.rgba.png"
            image = Image.new("RGBA", (2, 2), (10, 20, 30, 0))
            image.putalpha(Image.frombytes("L", (2, 2), bytes([0, 255, 255, 0])))
            image.save(path)
            artifact = {"path": "sample.rgba.png", "sha256": contract.sha256_file(path), "width": 2, "height": 2}
            contract.verify_evaluation_artifact("transparent/correct-controls@sample", artifact, root, {"sample": bytes([0, 255, 255, 0])}, Image)
            rebound = {**artifact, "path": "../sample.rgba.png"}
            with self.assertRaisesRegex(contract.OverfitContractError, "B12_EVALUATION_ARTIFACT_PATH"):
                contract.verify_evaluation_artifact("transparent/correct-controls@sample", rebound, root, {"sample": bytes([0, 255, 255, 0])}, Image)
            image.putalpha(Image.frombytes("L", (2, 2), bytes([255, 0, 0, 255])))
            image.save(path)
            with self.assertRaisesRegex(contract.OverfitContractError, "B12_EVALUATION_ARTIFACT_HASH"):
                contract.verify_evaluation_artifact("transparent/correct-controls@sample", artifact, root, {"sample": bytes([0, 255, 255, 0])}, Image)


if __name__ == "__main__":
    unittest.main()

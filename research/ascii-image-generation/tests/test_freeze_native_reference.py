import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "freeze_native_reference", ROOT / "scripts/freeze-native-reference.py"
)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC.loader
SPEC.loader.exec_module(MODULE)
REVIEW_SPEC = importlib.util.spec_from_file_location(
    "check_native_reference_review", ROOT / "scripts/check-native-reference-review.py"
)
REVIEW_MODULE = importlib.util.module_from_spec(REVIEW_SPEC)
assert REVIEW_SPEC.loader
REVIEW_SPEC.loader.exec_module(REVIEW_MODULE)
FEASIBILITY_SPEC = importlib.util.spec_from_file_location(
    "check_native_training_feasibility",
    ROOT / "scripts/check-native-training-feasibility.py",
)
FEASIBILITY_MODULE = importlib.util.module_from_spec(FEASIBILITY_SPEC)
assert FEASIBILITY_SPEC.loader
FEASIBILITY_SPEC.loader.exec_module(FEASIBILITY_MODULE)


class NativeReferenceFreezeTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.config = self.root / "native-reference-model.json"
        self.config.write_bytes((ROOT / "config/native-reference-model.json").read_bytes())
        self.cache = self.root / "cache"
        self.report = self.root / "report.json"
        config = json.loads(self.config.read_text())
        for repository in config["repositories"]:
            destination = self.cache / repository["id"] / repository["revision"]
            destination.mkdir(parents=True)
            (destination / ".resolved-revision").write_text(repository["revision"] + "\n")
            for required in repository["requiredFiles"]:
                path = destination / required["path"]
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(f"{repository['id']}:{required['path']}".encode())

    def tearDown(self):
        self.temporary.cleanup()

    def freeze(self):
        with patch.object(MODULE, "safe_parameter_count", return_value=17):
            return MODULE.freeze(
                self.config,
                self.cache,
                self.report,
                generated_at="2026-07-24T00:00:00Z",
                versions={
                    "python": "3.11.10",
                    "torch": "2.5.1+cu121",
                    "diffusers": "0.35.1",
                    "transformers": "4.49.0",
                    "safetensors": "0.5.3",
                },
            )

    def verify(self):
        with patch.object(MODULE, "safe_parameter_count", return_value=17):
            return MODULE.verify(
                self.config,
                self.cache,
                self.report,
                ROOT / "schema/native-reference-model.schema.json",
            )

    def reseal(self, report):
        for repository in report["repositories"]:
            repository["treeSha256"] = MODULE.sha256_bytes(MODULE.canonical(repository["files"]))
        report["treeSha256"] = MODULE.sha256_bytes(MODULE.canonical(report["repositories"]))
        report["contentSha256"] = MODULE.sha256_bytes(MODULE.canonical(report, "contentSha256"))
        self.report.write_text(json.dumps(report, indent=2) + "\n")

    def test_freeze_and_verify_exact_local_artifacts(self):
        report = self.freeze()
        self.assertEqual(report["verdict"], "pass")
        self.assertEqual(len(report["repositories"]), 2)
        self.verify()

    def test_required_weights_match_default_loader_contract(self):
        config = json.loads(self.config.read_text())
        self.assertEqual(config["pipeline"]["weightFiles"], "default-safetensors")
        self.assertEqual(config["pipeline"]["runtimeDtype"], "float16")
        weights = [
            item["path"]
            for repository in config["repositories"]
            for item in repository["requiredFiles"]
            if item["kind"] == "safetensors"
        ]
        self.assertEqual(
            weights,
            [
                "text_encoder/model.safetensors",
                "text_encoder_2/model.safetensors",
                "unet/diffusion_pytorch_model.safetensors",
                "vae/diffusion_pytorch_model.safetensors",
                "diffusion_pytorch_model.safetensors",
            ],
        )
        self.assertFalse(any(".fp16.safetensors" in path for path in weights))

    def test_native_training_authority_is_bound_and_old_trainer_is_blocked(self):
        native_hash = hashlib.sha256((ROOT / "config/native-reference-model.json").read_bytes()).hexdigest()
        feasibility = json.loads((ROOT / "config/native-training-feasibility.json").read_text())
        overfit = json.loads((ROOT / "config/overfit-keyframe.yaml").read_text())
        self.assertEqual(feasibility["nativeReferenceConfigSha256"], native_hash)
        self.assertEqual(overfit["authorities"]["nativeReferenceModelSha256"], native_hash)
        self.assertNotIn("baseModel", overfit["authorities"])
        self.assertEqual(overfit["architecture"]["id"], "sdxl-depth-controlnet-17ch/v1")
        self.assertEqual(overfit["architecture"]["implementationStatus"], "ready-code-only-b11-data-required")

    def test_same_size_cache_corruption_rejects(self):
        report = self.freeze()
        first = report["repositories"][0]["files"][0]
        path = (
            self.cache
            / report["repositories"][0]["id"]
            / report["repositories"][0]["revision"]
            / first["path"]
        )
        path.write_bytes(b"x" * first["bytes"])
        with self.assertRaisesRegex(MODULE.NativeReferenceFreezeError, "B52_REPORT_FILE_HASH"):
            self.verify()

    def test_missing_cache_cannot_emit_report(self):
        config = json.loads(self.config.read_text())
        missing = (
            self.cache
            / config["repositories"][0]["id"]
            / config["repositories"][0]["revision"]
            / config["repositories"][0]["requiredFiles"][0]["path"]
        )
        missing.unlink()
        with patch.object(MODULE, "safe_parameter_count", return_value=17):
            with self.assertRaisesRegex(MODULE.NativeReferenceFreezeError, "B52_REQUIRED_FILE_MISSING"):
                MODULE.freeze(self.config, self.cache, self.report)
        self.assertFalse(self.report.exists())

    def test_mutable_revision_and_unsafe_file_sets_reject(self):
        original = json.loads(self.config.read_text())
        cases = []
        mutable = copy.deepcopy(original)
        mutable["repositories"][0]["revision"] = "0" * 40
        cases.append((mutable, "B52_REPOSITORY_IDENTITY"))
        no_license = copy.deepcopy(original)
        no_license["repositories"][0]["requiredFiles"] = [
            item
            for item in no_license["repositories"][0]["requiredFiles"]
            if item["kind"] != "license"
        ]
        cases.append((no_license, "B52_SOURCE_TEXTS_REQUIRED"))
        pickle = copy.deepcopy(original)
        pickle["repositories"][1]["requiredFiles"].append(
            {"path": "diffusion_pytorch_model.bin", "kind": "safetensors"}
        )
        cases.append((pickle, "B52_PICKLE_FORBIDDEN"))
        for config, code in cases:
            with self.subTest(code=code):
                with self.assertRaisesRegex(MODULE.NativeReferenceFreezeError, code):
                    MODULE.validate_config(config)

    def test_resealed_forged_parameter_count_path_and_kind_reject(self):
        original = self.freeze()
        mutations = [
            ("B52_REPORT_PARAMETER_COUNT", lambda report: report["repositories"][0].__setitem__("safetensorsParameters", 1)),
            ("B52_REPORT_FILE_SET", lambda report: report["repositories"][0]["files"][0].__setitem__("path", "forged.md")),
            ("B52_REPORT_FILE_AUTHORITY", lambda report: report["repositories"][0]["files"][0].__setitem__("kind", "config")),
        ]
        for code, mutate in mutations:
            with self.subTest(code=code):
                report = copy.deepcopy(original)
                mutate(report)
                self.reseal(report)
                with self.assertRaisesRegex(MODULE.NativeReferenceFreezeError, code):
                    self.verify()

    def test_review_sheet_is_schema_valid_and_hash_bound(self):
        review = REVIEW_MODULE.check(
            ROOT,
            ROOT / "reports/native-reference-review.json",
            ROOT / "schema/native-reference-review.schema.json",
        )
        self.assertEqual(
            [item["role"] for item in review["comparison"]],
            ["prompt-only", "correct-control-0.65", "wrong-control"],
        )

    def test_native_training_feasibility_checker_accepts_production_report(self):
        report = FEASIBILITY_MODULE.check(
            ROOT,
            ROOT / "config/native-training-feasibility.json",
            ROOT / "reports/native-training-feasibility.json",
            ROOT / "schema/native-training-feasibility.schema.json",
        )
        self.assertEqual(report["verdict"], "pass")

    def test_resealed_forged_feasibility_reports_reject(self):
        original = json.loads((ROOT / "reports/native-training-feasibility.json").read_text())
        cases = [
            ("B52_FEASIBILITY_MEMORY_BUDGET", lambda report: report["measurement"].__setitem__("peakReservedBytes", report["training"]["maximumPeakVramBytes"] + 1)),
            ("B52_FEASIBILITY_MODEL_REVISION", lambda report: report["authorities"].__setitem__("baseRevision", "0" * 40)),
            ("B52_FEASIBILITY_MEMORY_ORDER", lambda report: report["measurement"].__setitem__("peakAllocatedBytes", report["measurement"]["peakReservedBytes"] + 1)),
            ("B52_FEASIBILITY_GPU_AUTHORITY", lambda report: report["runtime"].__setitem__("gpu", "forged GPU")),
            ("B52_FEASIBILITY_GPU_AUTHORITY", lambda report: report["runtime"].__setitem__("totalVramBytes", 17179869184)),
        ]
        for code, mutate in cases:
            with self.subTest(code=code):
                report = copy.deepcopy(original)
                mutate(report)
                report["contentSha256"] = FEASIBILITY_MODULE.digest_value(report)
                path = self.root / f"forged-{len(list(self.root.glob('forged-*')))}.json"
                path.write_text(json.dumps(report) + "\n")
                with self.assertRaisesRegex(RuntimeError, code):
                    FEASIBILITY_MODULE.check(
                        ROOT,
                        ROOT / "config/native-training-feasibility.json",
                        path,
                        ROOT / "schema/native-training-feasibility.schema.json",
                    )

    def test_resealed_nonfinite_feasibility_loss_rejects_at_json_parse(self):
        original = json.loads((ROOT / "reports/native-training-feasibility.json").read_text())
        for value in (float("nan"), float("inf"), float("-inf")):
            with self.subTest(value=value):
                report = copy.deepcopy(original)
                report["measurement"]["loss"] = value
                report["contentSha256"] = FEASIBILITY_MODULE.digest_value(report)
                path = self.root / f"nonfinite-{str(value)}.json"
                path.write_text(json.dumps(report, allow_nan=True) + "\n")
                with self.assertRaisesRegex(RuntimeError, "B52_FEASIBILITY_NONFINITE_JSON"):
                    FEASIBILITY_MODULE.check(
                        ROOT,
                        ROOT / "config/native-training-feasibility.json",
                        path,
                        ROOT / "schema/native-training-feasibility.schema.json",
                    )


if __name__ == "__main__":
    unittest.main()

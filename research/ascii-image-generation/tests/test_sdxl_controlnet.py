from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
SPEC = importlib.util.spec_from_file_location("sdxl_controlnet", ROOT / "src/sdxl_controlnet.py")
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC.loader
SPEC.loader.exec_module(MODULE)
TRAIN_SPEC = importlib.util.spec_from_file_location("native_train_control", ROOT / "src/train_control.py")
TRAIN = importlib.util.module_from_spec(TRAIN_SPEC)
assert TRAIN_SPEC.loader
TRAIN_SPEC.loader.exec_module(TRAIN)
EVAL_SPEC = importlib.util.spec_from_file_location("native_eval_control", ROOT / "src/eval_control.py")
EVAL = importlib.util.module_from_spec(EVAL_SPEC)
assert EVAL_SPEC.loader
EVAL_SPEC.loader.exec_module(EVAL)
RASTER_SPEC = importlib.util.spec_from_file_location("training_raster", ROOT / "src/training_raster.py")
RASTER = importlib.util.module_from_spec(RASTER_SPEC)
assert RASTER_SPEC.loader
RASTER_SPEC.loader.exec_module(RASTER)


class SdxlControlNetTests(unittest.TestCase):
    def test_frozen_b32_channel_order_and_depth_index(self):
        contract = json.loads((ROOT / "config/control-tensor.json").read_text())
        MODULE.validate_channel_layout(contract)
        self.assertEqual(MODULE.DEPTH_CHANNEL, 5)
        self.assertEqual(MODULE.CHANNEL_IDS[3], "camera-depth")

    def test_stock_rgb_depth_stem_expands_deterministically(self):
        stock = [[[[1.0]], [[2.0]], [[3.0]]], [[[4.0]], [[5.0]], [[6.0]]]]
        expanded = MODULE.expanded_weight_values(stock)
        self.assertEqual(len(expanded[0]), 17)
        self.assertEqual(expanded[0][5], [[6.0]])
        self.assertEqual(expanded[1][5], [[15.0]])
        self.assertTrue(all(expanded[out][channel] == [[0.0]] for out in range(2) for channel in range(17) if channel != 5))

    def test_bad_width_or_stock_stem_rejects(self):
        with self.assertRaisesRegex(Exception, "B12_SDXL_DEPTH_INITIALIZATION"):
            MODULE.expanded_weight_values([[[[1.0]], [[2.0]], [[3.0]]]], channels=4)
        with self.assertRaisesRegex(Exception, "B12_STOCK_DEPTH_RGB_STEM"):
            MODULE.expanded_weight_values([[[[1.0]], [[2.0]]]])

    def test_no_toy_latent_residual_architecture_remains(self):
        config = json.loads((ROOT / "config/overfit-keyframe.yaml").read_text())
        self.assertEqual(config["architecture"]["id"], MODULE.ARCHITECTURE_ID)
        self.assertEqual(config["architecture"]["conditioningChannels"], 17)
        source = (ROOT / "src/train_control.py").read_text()
        self.assertNotIn("LatentResidualControlAdapter", source)
        self.assertNotIn("noisy + residual", source)
        self.assertIn("down_block_additional_residuals", source)

    def test_resume_authority_and_hash_fail_closed_before_state_load(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "model").write_bytes(b"model")
            (root / "state").write_bytes(b"state")
            latest = {
                "bindings": {"configSha256": "wrong"}, "step": 1,
                "modelPath": "model", "modelSha256": "0" * 64,
                "statePath": "state", "stateSha256": "0" * 64,
            }
            (root / "latest.json").write_text(json.dumps(latest))
            with self.assertRaisesRegex(Exception, "B12_RESUME_BINDING_MISMATCH"):
                TRAIN.resume_checkpoint(root, object(), object(), object(), 4, {"configSha256": "right"}, object(), object())
            latest["bindings"] = {"configSha256": "right"}
            (root / "latest.json").write_text(json.dumps(latest))
            with self.assertRaisesRegex(Exception, "B12_RESUME_HASH_MISMATCH"):
                TRAIN.resume_checkpoint(root, object(), object(), object(), 4, {"configSha256": "right"}, object(), object())

    def test_intervention_fingerprints_are_not_tautological(self):
        transformed = {
            "correct-controls": ([[1, 2, 3]], "original"),
            "prompt-only": ([[0, 0, 0]], "original"),
            "all-controls-removed": ([[0, 0, 0]], "empty"),
        }
        fingerprints = EVAL.intervention_fingerprints(transformed)
        self.assertEqual(len(set(fingerprints.values())), 3)
        with self.assertRaisesRegex(Exception, "B12_INTERVENTION_TAUTOLOGY"):
            EVAL.intervention_fingerprints({
                "a": ([[0]], "same"), "b": ([[0]], "same"), "c": ([[0]], "same")
            })

    def test_render_pipeline_reuses_base_modules_without_second_allocation(self):
        modules = {name: object() for name in ("unet", "vae", "text_encoder", "text_encoder_2")}
        base = type("Base", (), {"components": modules, **modules})()
        controlnet = object()

        class Render:
            def __init__(self, controlnet, **components):
                self.controlnet = controlnet
                self.__dict__.update(components)

        rendered = EVAL.build_render_pipeline(base, controlnet, Render)
        self.assertIs(rendered.unet, base.unet)
        self.assertIs(rendered.vae, base.vae)
        self.assertIs(rendered.controlnet, controlnet)

    def test_pipeline_control_preprocessing_preserves_17_channels(self):
        class Tensor:
            ndim = 4
            shape = (1, 17, 256, 256)

        class Pipeline:
            def prepare_image(self, **kwargs):
                self.received = kwargs
                return kwargs["image"]

        pipeline = Pipeline()
        control = Tensor()
        self.assertIs(EVAL.validate_pipeline_control_tensor(pipeline, control, "cuda", "fp16"), control)
        self.assertEqual(pipeline.received["width"], 256)
        coerced = type("Coerced", (), {"ndim": 4, "shape": (1, 3, 256, 256)})()
        pipeline.prepare_image = lambda **_: coerced
        with self.assertRaisesRegex(Exception, "B12_PIPELINE_COERCED_CONTROL_CHANNELS"):
            EVAL.validate_pipeline_control_tensor(pipeline, control, "cuda", "fp16")

    def test_nearest_coverage_expansion_is_exact_and_aligned(self):
        source = bytes([0, 255, 255, 0])
        expanded = RASTER.nearest_expand_plane_u8(source, 2, 2, 4, 4)
        self.assertEqual(expanded, bytes([
            0, 0, 255, 255, 0, 0, 255, 255,
            255, 255, 0, 0, 255, 255, 0, 0,
        ]))

    def test_foreground_loss_is_invariant_to_empty_background(self):
        target = [1.0, 7.0, 3.0, 9.0]
        coverage = [1, 0, 1, 0]
        left = RASTER.foreground_mse_values([0.0, -100.0, 1.0, 200.0], target, coverage)
        right = RASTER.foreground_mse_values([0.0, 999.0, 1.0, -999.0], target, coverage)
        self.assertEqual(left, right)


if __name__ == "__main__":
    unittest.main()

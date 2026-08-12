from __future__ import annotations

import copy
import importlib
import sys
import unittest
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))


contract = importlib.import_module("overfit_contract")
model_raster = importlib.import_module("model_raster")


class ModelRasterTests(unittest.TestCase):
    def setUp(self):
        self.config, self.tensor, _ = contract.validate_config(ROOT / "config" / "overfit-keyframe.yaml", ROOT)
        self.raster = self.config["modelRaster"]

    def test_approved_256_by_128_cells_make_a_full_admission_square_without_stretching(self):
        layout = model_raster.layout_for(self.raster)
        self.assertEqual((layout.left, layout.top, layout.width, layout.height), (0, 0, 256, 256))

    def test_target_uses_the_same_physical_cell_aspect_and_nearest_sampling(self):
        image = Image.new("RGB", (256, 128), (0, 0, 255))
        for y in range(64):
            for x in range(256):
                image.putpixel((x, y), (255, 0, 0))
        result = model_raster.target_to_model(image, self.raster, Image)
        self.assertEqual(result.size, (256, 256))
        self.assertEqual(result.getpixel((127, 127)), (255, 0, 0))
        self.assertEqual(result.getpixel((127, 128)), (0, 0, 255))

    def test_every_model_plane_uses_nearest_to_preserve_one_raw_winner(self):
        modes = model_raster.channel_sampling_modes(self.tensor, self.raster)
        self.assertEqual(len(modes), 17)
        self.assertEqual(modes, ["nearest"] * 17)
        self.assertEqual(self.raster.latent_continuous_sampling, "bilinear")

    def test_stale_grid_cell_aspect_and_target_dimensions_fail_closed(self):
        with self.assertRaisesRegex(contract.OverfitContractError, "B12_MODEL_RASTER_SOURCE_GRID_MISMATCH"):
            model_raster.validate_control_metadata({"cols": 80, "rows": 48, "cellAspect": 2}, self.raster)
        with self.assertRaisesRegex(contract.OverfitContractError, "B12_MODEL_RASTER_CELL_ASPECT_MISMATCH"):
            model_raster.validate_control_metadata({"cols": 256, "rows": 128, "cellAspect": 1}, self.raster)
        with self.assertRaisesRegex(contract.OverfitContractError, "B12_MODEL_RASTER_TARGET_DIMENSIONS_MISMATCH"):
            model_raster.target_to_model(Image.new("RGB", (256, 256)), self.raster, Image)
        with self.assertRaisesRegex(contract.OverfitContractError, "B12_MODEL_RASTER_TARGET_METADATA"):
            model_raster.validate_target_metadata({}, self.raster)
        model_raster.validate_target_metadata({"modelRaster": {
            "id": model_raster.MODEL_RASTER_ID, "width": 256, "height": 256,
            "source": {"cols": 256, "rows": 128, "cellAspect": 2.0}, "fit": "contain", "targetSampling": "nearest",
            "discreteControlSampling": "nearest", "continuousControlSampling": "nearest",
            "latentContinuousSampling": "bilinear",
        }}, self.raster)

    def test_training_raster_is_a_separate_exact_1024_nearest_contract(self):
        self.assertEqual(self.config["trainingRaster"], {
            "id": "glyph-training-raster/admission-nearest-v1",
            "sourceWidth": 256, "sourceHeight": 256, "width": 1024, "height": 1024,
            "targetAlgorithm": "nearest", "controlAlgorithm": "nearest",
            "coverageAlgorithm": "nearest", "coverageChannel": 15,
            "alphaAuthority": "coverage-only",
            "backgroundCompositing": "downstream-optional-not-training-or-causal-eval",
        })

    def test_unknown_tensor_plane_or_non_nearest_target_recipe_is_rejected(self):
        value = copy.deepcopy(self.tensor)
        value["keyframeChannels"][0]["encoding"] = "unclassified-v1"
        with self.assertRaisesRegex(contract.OverfitContractError, "B12_MODEL_RASTER_CHANNEL_SAMPLING"):
            model_raster.parse_model_raster({
                "id": model_raster.MODEL_RASTER_ID, "width": 256, "height": 256,
                "source": {"cols": 256, "rows": 128, "cellAspect": 2}, "fit": "contain",
                "targetSampling": "nearest", "discreteControlSampling": "nearest", "continuousControlSampling": "nearest",
                "latentContinuousSampling": "bilinear",
            }, training_resolution=256, tensor=value)
        with self.assertRaisesRegex(contract.OverfitContractError, "B12_MODEL_RASTER_SAMPLING"):
            model_raster.parse_model_raster({
                "id": model_raster.MODEL_RASTER_ID, "width": 256, "height": 256,
                "source": {"cols": 256, "rows": 128, "cellAspect": 2}, "fit": "contain",
                "targetSampling": "bilinear", "discreteControlSampling": "nearest", "continuousControlSampling": "nearest",
                "latentContinuousSampling": "bilinear",
            }, training_resolution=256, tensor=self.tensor)


if __name__ == "__main__":
    unittest.main()

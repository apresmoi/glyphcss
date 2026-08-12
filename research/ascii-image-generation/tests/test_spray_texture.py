from __future__ import annotations

import importlib
from pathlib import Path
import sys
import unittest

import numpy as np


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
spray = importlib.import_module("spray_texture")


def maps_for(coverage, uvs, valid, cols=None, *, normal=None, world_position=None, depth=None, polygon_uv_image=None):
    cells = len(coverage)
    cols = cells if cols is None else cols
    rows = cells // cols
    tensor = np.zeros((17, cells), dtype=np.float32)
    tensor[14] = valid
    normal = np.full((cells, 3), np.nan, dtype=np.float32) if normal is None else np.asarray(normal, dtype=np.float32)
    world_position = (
        np.full((cells, 3), np.nan, dtype=np.float32)
        if world_position is None
        else np.asarray(world_position, dtype=np.float32)
    )
    depth = np.full(cells, np.nan, dtype=np.float64) if depth is None else np.asarray(depth, dtype=np.float64)
    return spray.ControlMaps(
        cols=cols,
        rows=rows,
        coverage=np.asarray(coverage, dtype=np.uint8),
        surface_uv=np.asarray(uvs, dtype=np.float32),
        albedo_rgb=np.zeros(cells, dtype=np.uint32),
        depth_normalized=np.zeros(cells, dtype=np.float32),
        surface_id=np.zeros(cells, dtype=np.int32),
        winner_polygon=np.zeros(cells, dtype=np.int32),
        normal=normal,
        world_position=world_position,
        shade=np.full(cells, np.nan, dtype=np.float32),
        depth=depth,
        class_id=np.full(cells, -1, dtype=np.int32),
        instance_id=np.full(cells, -1, dtype=np.int32),
        tensor_keyframe=tensor,
        metadata={"cols": cols, "rows": rows},
        index_lookups={"surfaceLookup": []},
        polygon_uv_image=polygon_uv_image,
    )


class SprayTextureTests(unittest.TestCase):
    def _triangle_maps(self, *, normal=None):
        # Three winner cells form one visible authored-UV triangle.  The exact
        # source table is intentionally independent of winner-cell UV samples.
        exact_triangle = {
            0: ((
                np.asarray([[0.0, 0.0], [1.0, 0.0], [0.0, 1.0]]),
                np.asarray([[0.5, 1.0], [1.5, 1.0], [0.5, 3.0]]),
            ),),
        }
        return maps_for(
            [1, 1, 1, 0],
            [[0.0, 0.0], [1.0, 0.0], [0.0, 1.0], [np.nan, np.nan]],
            [1, 1, 1, 0], cols=2,
            normal=[[1.0, 0.0, 0.0]] * 4 if normal is None else normal,
            polygon_uv_image=exact_triangle,
        )

    def test_texel_resolution_triangle_samples_the_bilinear_generated_pixel(self):
        maps = self._triangle_maps()
        page = spray.TexturePage(4)
        image = np.zeros((8, 8, 3), dtype=np.float32)
        for y in range(8):
            for x in range(8):
                image[y, x] = (x / 7.0, y / 7.0, 0.25)
        stats = spray.back_project(
            page, maps, image, 0.5, [0, 0, 0, 0], view_direction=np.array([1.0, 0.0, 0.0]),
        )
        # UV (0.375, 0.375) is inside the triangle.  The exact table maps it
        # to control-image position (0.875, 1.75), hence model pixel centre (3, 3).
        self.assertTrue(np.allclose(page.rgb[0, 1, 1], (3.0 / 7.0, 3.0 / 7.0, 0.25), atol=1e-6))
        self.assertEqual(stats["polygons_reconstructed"], 1)
        self.assertGreater(stats["texels_written"], stats["cells_projected"])

    def test_texel_resolution_keeps_grazing_rejection(self):
        maps = self._triangle_maps(normal=[[0.0, 1.0, 0.0]] * 4)
        page = spray.TexturePage(4)
        stats = spray.back_project(
            page, maps, np.ones((8, 8, 3), dtype=np.float32), 0.5, [0, 0, 0, 0],
            view_direction=np.array([1.0, 0.0, 0.0]),
        )
        self.assertEqual(stats["cells_skipped_grazing"], 3)
        self.assertEqual(stats["texels_written"], 0)
        self.assertFalse((page.state == 1).any())

    def test_texel_resolution_blends_low_confidence_after_high_confidence(self):
        maps = self._triangle_maps()
        page = spray.TexturePage(4)
        red = np.zeros((8, 8, 3), dtype=np.float32)
        red[..., 0] = 1.0
        blue = np.zeros((8, 8, 3), dtype=np.float32)
        blue[..., 2] = 1.0
        spray.back_project(page, maps, red, 0.75, [0, 0, 0, 0], view_direction=np.array([1.0, 0.0, 0.0]))
        spray.back_project(page, maps, blue, 0.25, [0, 0, 0, 0], view_direction=np.array([1.0, 0.0, 0.0]))
        # The later, weaker observation contributes only its confidence share;
        # it cannot replace the established high-confidence texel.
        self.assertTrue(np.allclose(page.rgb[0, 1, 1], (0.75, 0.0, 0.25), atol=1e-6))

    def test_refine_observation_replaces_an_existing_texel(self):
        maps = self._triangle_maps()
        page = spray.TexturePage(4)
        red = np.zeros((8, 8, 3), dtype=np.float32)
        red[..., 0] = 1.0
        blue = np.zeros((8, 8, 3), dtype=np.float32)
        blue[..., 2] = 1.0
        spray.back_project(page, maps, red, 0.75, [0, 0, 0, 0], view_direction=np.array([1.0, 0.0, 0.0]))
        stats = spray.back_project(
            page, maps, blue, 0.25, [0, 0, 0, 0], view_direction=np.array([1.0, 0.0, 0.0]),
            prefer_new_observation=True,
        )
        self.assertTrue(np.allclose(page.rgb[0, 1, 1], (0.0, 0.0, 1.0), atol=1e-6))
        self.assertGreater(stats["texels_refined"], 0)

    def test_texel_sampling_observes_more_than_legacy_cell_sampling(self):
        maps = self._triangle_maps()
        image = np.ones((8, 8, 3), dtype=np.float32)
        texel_page = spray.TexturePage(4)
        cell_page = spray.TexturePage(4)
        texel_stats = spray.back_project(
            texel_page, maps, image, 0.5, [0, 0, 0, 0],
            view_direction=np.array([1.0, 0.0, 0.0]),
        )
        cell_stats = spray.back_project(
            cell_page, maps, image, 0.5, [0, 0, 0, 0],
            view_direction=np.array([1.0, 0.0, 0.0]), sampling="cell",
        )
        self.assertGreater(texel_stats["texels_written"], cell_stats["texels_written"])
        self.assertGreater(np.count_nonzero(texel_page.state == 1), np.count_nonzero(cell_page.state == 1))

    def test_fill_unknown_never_changes_observed_texels(self):
        maps = self._triangle_maps()
        page = spray.TexturePage(4)
        image = np.zeros((8, 8, 3), dtype=np.float32)
        image[..., 0] = np.arange(8, dtype=np.float32) / 7.0
        spray.back_project(
            page, maps, image, 0.5, [0, 0, 0, 0], view_direction=np.array([1.0, 0.0, 0.0]),
        )
        observed = page.state == 1
        before = page.rgb[observed].copy()
        spray.fill_unknown(page)
        self.assertTrue(np.array_equal(page.rgb[observed], before))
        self.assertTrue(np.all(page.state[observed] == 1))

    def test_class_aware_fill_uses_own_observed_class_not_global_mean(self):
        page = spray.TexturePage(4)
        class_map = np.array([
            [1, 1, 2, 2],
            [1, 1, 2, 2],
            [1, 1, 2, 2],
            [1, 1, 2, 2],
        ], dtype=np.int16)
        page.state[0, 0, 0] = 1
        page.rgb[0, 0, 0] = (1.0, 0.0, 0.0)
        page.state[0, 0, 2] = 1
        page.rgb[0, 0, 2] = (0.0, 0.0, 1.0)
        stats = spray.fill_unknown(page, class_map)
        self.assertTrue(np.allclose(page.rgb[0, 1, 1], (1.0, 0.0, 0.0)))
        self.assertTrue(np.allclose(page.rgb[0, 1, 3], (0.0, 0.0, 1.0)))
        self.assertEqual(int((page.state == 2).sum()), 14)
        self.assertEqual(stats["classes_without_observations"], 0)

    def test_packed_face_class_map_uses_identity_area_proportional_charts(self):
        layout = {
            "schemaVersion": "glyph-authored-atlas-layout/v1", "referenceSize": 6,
            "faceToCell": "identity", "charts": [
                {"face": 0, "cell": 0, "outer": {"x": 0, "y": 0, "width": 4, "height": 3}},
                {"face": 1, "cell": 1, "outer": {"x": 4, "y": 0, "width": 2, "height": 6}},
                {"face": 2, "cell": 2, "outer": {"x": 0, "y": 3, "width": 4, "height": 3}},
            ],
        }
        class_map = spray.packed_face_class_map(6, np.array([3, 4, 5], dtype=np.int16), layout)
        self.assertEqual(class_map[0, 0], 3)
        self.assertEqual(class_map[0, 4], 4)
        self.assertEqual(class_map[3, 0], 5)
        self.assertEqual(class_map[3, 4], 4)

    def test_large_texel_triangle_is_cpu_chunked_without_changing_coverage(self):
        maps = self._triangle_maps()
        page = spray.TexturePage(512)
        stats = spray.back_project(
            page, maps, np.ones((8, 8, 3), dtype=np.float32), 0.5, [0, 0, 0, 0],
            view_direction=np.array([1.0, 0.0, 0.0]),
        )
        self.assertEqual(stats["polygons_reconstructed"], 1)
        self.assertGreater(np.count_nonzero(page.state == 1), 100_000)

    def test_out_of_range_uvs_wrap_for_projection_and_sampling(self):
        maps = maps_for([1, 1], [[1.25, -0.25], [-0.75, 1.25]], [1, 1])
        page = spray.TexturePage(4)
        image = np.zeros((2, 2, 3), dtype=np.float32)
        image[:, 0] = (1.0, 0.0, 0.0)
        image[:, 1] = (0.0, 1.0, 0.0)
        stats = spray.back_project(page, maps, image, 0.5, np.zeros(2, dtype=np.int32), incidence_weighting=False)
        self.assertEqual(stats["uvs_wrapped"], 2)
        self.assertTrue(np.allclose(page.rgb[0, 3, 1], (1.0, 0.0, 0.0)))
        self.assertTrue(np.allclose(page.rgb[0, 1, 1], (0.0, 1.0, 0.0)))
        sampled, known = spray.sample_page(page, maps, np.zeros(2, dtype=np.int32))
        self.assertTrue(known.all())
        self.assertTrue(np.allclose(sampled[0, 0], (1.0, 0.0, 0.0)))

    def test_nan_uv_is_rejected_when_plane_14_is_valid(self):
        maps = maps_for([1], [[np.nan, 0.5]], [1])
        self.assertFalse(spray.uv_valid_mask(maps)[0])
        stats = spray.back_project(spray.TexturePage(4), maps, np.ones((2, 1, 3), dtype=np.float32), 0.5, [0], incidence_weighting=False)
        self.assertEqual(stats["cells_skipped_no_uv"], 1)
        self.assertEqual(stats["cells_skipped_uv_nonfinite"], 1)

    def test_confidence_weighted_blend_and_high_confidence_preservation(self):
        maps = maps_for([1], [[0.5, 0.5]], [1])
        page = spray.TexturePage(4)
        red = np.zeros((2, 1, 3), dtype=np.float32)
        red[..., 0] = 1.0
        spray.back_project(page, maps, red, 0.75, [0], incidence_weighting=False)
        blue = np.zeros((2, 1, 3), dtype=np.float32)
        blue[..., 2] = 1.0
        spray.back_project(page, maps, blue, 0.25, [0], incidence_weighting=False)
        # (red * .75 + blue * .25) / 1.0; the later low-confidence view does
        # not replace the strong prior observation.
        self.assertTrue(np.allclose(page.rgb[0, 2, 2], (0.75, 0.0, 0.25)))
        self.assertAlmostEqual(float(page.confidence[0, 2, 2]), 1.0)

    def test_sample_page_round_trips_a_back_projected_cell(self):
        maps = maps_for([1], [[0.5, 0.5]], [1])
        page = spray.TexturePage(4)
        image = np.zeros((2, 1, 3), dtype=np.float32)
        image[:] = (0.2, 0.4, 0.6)
        spray.back_project(page, maps, image, 0.5, [0], incidence_weighting=False)
        sampled, known = spray.sample_page(page, maps, [0])
        self.assertTrue(known[:, 0].all())
        self.assertTrue(np.allclose(sampled[:, 0], image[:, 0]))

    def test_state_only_page_tracks_the_same_inherited_mask(self):
        maps = maps_for([1], [[0.5, 0.5]], [1])
        rgb_page = spray.TexturePage(4)
        state_page = spray.TexturePage(4, state_only=True)
        image = np.full((2, 1, 3), 0.5, dtype=np.float32)
        for page in (rgb_page, state_page):
            spray.back_project(page, maps, image, 0.5, [0], incidence_weighting=False)
        self.assertTrue(np.array_equal(spray.sample_page(rgb_page, maps, [0])[1], spray.sample_page_known(state_page, maps, [0])))

    def test_every_back_projection_skip_reason_is_counted(self):
        maps = maps_for(
            [0, 1, 1, 1, 1],
            [[0.5, 0.5], [0.5, 0.5], [np.nan, 0.5], [0.5, 0.5], [0.5, 0.5]],
            [1, 0, 1, 1, 1],
        )
        image = np.ones((2, 5, 3), dtype=np.float32)
        image[:, 4] = np.nan
        stats = spray.back_project(spray.TexturePage(4), maps, image, 0.5, [0, 0, 0, 9, 0], incidence_weighting=False)
        self.assertEqual(stats["cells_skipped_uncovered"], 1)
        self.assertEqual(stats["cells_skipped_uv_invalid_plane"], 1)
        self.assertEqual(stats["cells_skipped_uv_nonfinite"], 1)
        self.assertEqual(stats["cells_skipped_no_uv"], 2)
        self.assertEqual(stats["cells_skipped_invalid_material"], 1)
        self.assertEqual(stats["cells_skipped_nonfinite_color"], 1)
        self.assertEqual(stats["cells_projected"], 0)

    def test_derive_view_direction_recovers_known_orthographic_direction(self):
        rng = np.random.default_rng(7)
        positions = rng.normal(size=(96, 3)).astype(np.float32)
        coefficients = np.array([2.0, -3.0, 0.5, 4.0])
        depth = positions @ coefficients[:3] + coefficients[3]
        maps = maps_for(
            np.ones(96, dtype=np.uint8), np.full((96, 2), 0.5), np.ones(96),
            world_position=positions, depth=depth,
        )
        direction, diagnostics = spray.derive_view_direction(maps)
        self.assertTrue(np.allclose(direction, coefficients[:3] / np.linalg.norm(coefficients[:3]), atol=1e-7))
        self.assertEqual(diagnostics["sampleCount"], 96)
        self.assertLess(diagnostics["residualRms"], 1e-6)

    def test_derive_view_direction_rejects_insufficient_and_degenerate_data(self):
        insufficient = maps_for(
            np.ones(63, dtype=np.uint8), np.full((63, 2), 0.5), np.ones(63),
            world_position=np.zeros((63, 3)), depth=np.zeros(63),
        )
        with self.assertRaises(ValueError):
            spray.derive_view_direction(insufficient)
        degenerate = maps_for(
            np.ones(64, dtype=np.uint8), np.full((64, 2), 0.5), np.ones(64),
            world_position=np.zeros((64, 3)), depth=np.zeros(64),
        )
        with self.assertRaises(ValueError):
            spray.derive_view_direction(degenerate)

    def test_grazing_cells_are_skipped_and_counted(self):
        maps = maps_for([1], [[0.5, 0.5]], [1], normal=[[0.0, 1.0, 0.0]])
        stats = spray.back_project(
            spray.TexturePage(4), maps, np.ones((2, 1, 3), dtype=np.float32), 0.5, [0],
            view_direction=np.array([1.0, 0.0, 0.0]),
        )
        self.assertEqual(stats["cells_skipped_grazing"], 1)
        self.assertEqual(stats["cells_projected"], 0)

    def test_face_on_samples_outweigh_oblique_samples_for_the_same_texel(self):
        maps = maps_for(
            [1, 1], [[0.5, 0.5], [0.5, 0.5]], [1, 1],
            normal=[[1.0, 0.0, 0.0], [0.2, np.sqrt(0.96), 0.0]],
        )
        image = np.zeros((2, 2, 3), dtype=np.float32)
        image[:, 0, 0] = 1.0
        image[:, 1, 2] = 1.0
        page = spray.TexturePage(4)
        spray.back_project(page, maps, image, 0.5, [0, 0], view_direction=np.array([1.0, 0.0, 0.0]))
        self.assertTrue(np.allclose(page.rgb[0, 2, 2], (1.0 / 1.2, 0.0, 0.2 / 1.2)))

    def test_nonfinite_normals_are_skipped(self):
        maps = maps_for([1], [[0.5, 0.5]], [1], normal=[[np.nan, 0.0, 0.0]])
        stats = spray.back_project(
            spray.TexturePage(4), maps, np.ones((2, 1, 3), dtype=np.float32), 0.5, [0],
            view_direction=np.array([1.0, 0.0, 0.0]),
        )
        self.assertEqual(stats["cells_skipped_no_normal"], 1)
        self.assertEqual(stats["cells_projected"], 0)


if __name__ == "__main__":
    unittest.main()

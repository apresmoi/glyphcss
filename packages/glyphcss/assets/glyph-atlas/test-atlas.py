#!/usr/bin/env python3
"""Verify checked-in font metrics/cmap with fontTools: python3 test-atlas.py.

Uses the same Python/fontTools installation as build-atlas.py; no browser.
"""
import base64
import importlib.util
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

from fontTools.ttLib import TTFont

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("build_atlas", HERE / "build-atlas.py")
build = importlib.util.module_from_spec(spec)
spec.loader.exec_module(build)


class AtlasFontTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.manifest = json.loads((HERE / "atlas.json").read_text())
        payload = json.loads((HERE / "atlas-font.json").read_text())["woff2Base64"]
        cls.font = TTFont(io.BytesIO(base64.b64decode(payload)))
        cls.cmap = cls.font.getBestCmap()

    def test_built_font_cmap_layers_and_common_advance(self):
        m, font = self.manifest, self.font
        self.assertEqual(m["extension"], {"glyphOffset": 212, "puaStart": 0xF0000})
        self.assertEqual(m["maxPaletteSize"], 30)
        self.assertEqual(len(font["CPAL"].palettes[0]), 30)
        self.assertTrue(any(table.format == 12 for table in font["cmap"].tables))
        at_index = m["glyphs"].index("@")
        advance = font["hmtx"][self.cmap[0xE000 + at_index]][0]
        self.assertGreater(advance, 0)
        self.assertEqual(advance, font["hmtx"][self.cmap[0x20]][0])
        expected_cmap = {0x20}
        self.assertEqual(set(map(chr, range(0x2800, 0x2900))) & set(m["glyphs"]),
                         set(map(chr, range(0x2800, 0x2900))))
        for index, glyph in enumerate(m["glyphs"]):
            for slot in range(30):
                cp = (0xE000 + slot * 212 + index if index < 212 else
                      0xF0000 + slot * 248 + index - 212)
                expected_cmap.add(cp)
                with self.subTest(glyph=glyph, slot=slot):
                    base = self.cmap[cp]
                    self.assertEqual(font["hmtx"][base][0], advance)
                    layers = font["COLR"].ColorLayers[base]
                    self.assertEqual(len(layers), 1)
                    self.assertEqual(layers[0].colorID, slot)
                    self.assertEqual(layers[0].name, f"shape{index}")
                    self.assertEqual(font["hmtx"][layers[0].name][0], advance)
                    # Blank braille has no ink; every other pattern must paint.
                    if 0x2800 <= ord(glyph) <= 0x28FF:
                        self.assertEqual(font["glyf"][layers[0].name].numberOfContours > 0,
                                         glyph != "\u2800")
        self.assertEqual(set(self.cmap), expected_cmap)

    def test_braille_masks_keep_all_eight_dot_positions(self):
        def contours(glyph):
            coordinates, ends, _ = glyph.getCoordinates(self.font["glyf"])
            start, result = 0, set()
            for end in ends:
                result.add(tuple(coordinates[start:end + 1]))
                start = end + 1
            return result

        shapes = {cp: self.font["glyf"][f"shape{self.manifest['glyphs'].index(chr(cp))}"]
                  for cp in range(0x2800, 0x2900)}
        dots = [contours(shapes[0x2800 + (1 << bit)]) for bit in range(8)]
        self.assertTrue(all(len(dot) == 1 for dot in dots))
        self.assertEqual(len(set.union(*dots)), 8)
        for mask in range(256):
            expected = set.union(set(), *(dots[bit] for bit in range(8) if mask & (1 << bit)))
            with self.subTest(mask=mask):
                self.assertEqual(contours(shapes[0x2800 + mask]), expected)

    def test_fallback_import_forces_monospace_advance_for_every_braille(self):
        source = TTFont(build.SRC, fontNumber=0)
        cmap = source.getBestCmap()
        advance = source["hmtx"][cmap[ord("M")]][0]
        fallbacks = []
        for path in build.FALLBACK_SRCS:
            face = TTFont(path)
            fallbacks.append((path, face, face.getBestCmap(), face.getGlyphSet()))
        for cp in range(0x2800, 0x2900):
            if cp in cmap:
                continue
            with self.subTest(cp=hex(cp)):
                _, metrics = build._import_fallback_glyph(
                    chr(cp), cp, fallbacks, source["head"].unitsPerEm,
                    advance, source["hhea"].ascent, source["hhea"].descent)
                self.assertEqual(metrics[0], advance)


class BrailleDotsAtlasTests(unittest.TestCase):
    """The braille-dots variant: 256 patterns + space, molty's dot rects, a
    1000 x 1600 cell, the universal atlas's 30 slots in Supplementary PUA-A."""

    @classmethod
    def setUpClass(cls):
        cls.manifest = json.loads((HERE / "braille-dots-atlas.json").read_text())
        payload = json.loads((HERE / "braille-dots-atlas-font.json").read_text())["woff2Base64"]
        cls.font = TTFont(io.BytesIO(base64.b64decode(payload)))
        cls.cmap = cls.font.getBestCmap()

    def test_glyph_axis_is_every_braille_mask_in_order(self):
        m = self.manifest
        self.assertEqual(m["family"], "GlyphCssAtlasBrailleDots")
        self.assertEqual(m["glyphs"], [chr(0x2800 + mask) for mask in range(256)])
        self.assertEqual((m["glyphCount"], m["maxPaletteSize"], m["puaStart"]), (256, 30, 0xF0000))
        self.assertNotIn("extension", m)
        self.assertEqual(m["codepointRange"], [0xF0000, 0xF0000 + 30 * 256 - 1])

    def test_cell_metrics_are_the_fluid_cell(self):
        font = self.font
        self.assertEqual(font["head"].unitsPerEm, 1600)
        self.assertEqual((font["hhea"].ascent, font["hhea"].descent, font["hhea"].lineGap), (1600, 0, 0))
        self.assertEqual((font["OS/2"].sTypoAscender, font["OS/2"].sTypoDescender), (1600, 0))
        self.assertEqual((font["OS/2"].usWinAscent, font["OS/2"].usWinDescent), (1600, 0))
        # Every glyph, space and .notdef included, advances exactly one cell.
        self.assertEqual({adv for adv, _ in font["hmtx"].metrics.values()}, {1000})
        self.assertEqual(self.manifest["dotGeometry"]["unitsPerEm"], 1600)
        self.assertEqual(self.manifest["dotGeometry"]["advance"], 1000)

    def test_cmap_is_space_plus_every_slot_and_mask(self):
        expected = {0x20} | {0xF0000 + slot * 256 + mask for slot in range(30) for mask in range(256)}
        self.assertEqual(set(self.cmap), expected)
        self.assertEqual(len(self.font["CPAL"].palettes[0]), 30)
        for slot in range(30):
            for mask in range(256):
                with self.subTest(slot=slot, mask=mask):
                    base = self.cmap[0xF0000 + slot * 256 + mask]
                    layers = self.font["COLR"].ColorLayers[base]
                    self.assertEqual(len(layers), 1)
                    self.assertEqual(layers[0].colorID, slot)
                    self.assertEqual(layers[0].name, f"shape{mask}")
                    self.assertEqual(self.font["glyf"][base].numberOfContours, 0)

    def test_outlines_are_exactly_the_manifest_dot_rects(self):
        rects = [tuple(r) for r in self.manifest["dotGeometry"]["dots"]]
        self.assertEqual(len(rects), 8)
        glyf = self.font["glyf"]
        for mask in range(256):
            with self.subTest(mask=mask):
                glyph = glyf[f"shape{mask}"]
                coords, ends, _ = glyph.getCoordinates(glyf)
                start, boxes = 0, []
                for end in ends:
                    pts = coords[start:end + 1]
                    xs, ys = [p[0] for p in pts], [p[1] for p in pts]
                    self.assertEqual(len(pts), 4)
                    self.assertEqual(len(set(xs)), 2)
                    self.assertEqual(len(set(ys)), 2)
                    boxes.append((min(xs), min(ys), max(xs), max(ys)))
                    start = end + 1
                self.assertEqual(sorted(boxes), sorted(rects[b] for b in range(8) if mask & (1 << b)))
                lsb = self.font["hmtx"][f"shape{mask}"][1]
                self.assertEqual(lsb, min((b[0] for b in boxes), default=0))

    def test_dot_rects_are_molty_canvas_geometry(self):
        # render.js: centres x = 0.3 | 0.7 cell, y = 0.14 + 0.24 * row from the top,
        # size 0.26 x 0.15 cell; Unicode bits 1-2-3/7 left, 4-5-6/8 right.
        bit_dots = [(0, 0), (0, 1), (0, 2), (1, 0), (1, 1), (1, 2), (0, 3), (1, 3)]
        for bit, (x0, y0, x1, y1) in enumerate(self.manifest["dotGeometry"]["dots"]):
            col, row = bit_dots[bit]
            with self.subTest(bit=bit):
                self.assertAlmostEqual((x0 + x1) / 2 / 1000, 0.3 if col == 0 else 0.7)
                self.assertAlmostEqual(1 - (y0 + y1) / 2 / 1600, 0.14 + 0.24 * row)
                self.assertAlmostEqual((x1 - x0) / 1000, 0.26)
                self.assertAlmostEqual((y1 - y0) / 1600, 0.15)

    def test_build_reproduces_the_checked_in_geometry(self):
        self.assertEqual([list(r) for r in build.braille_dot_rects()], self.manifest["dotGeometry"]["dots"])


def _font_of(path):
    return TTFont(io.BytesIO(base64.b64decode(json.loads(Path(path).read_text())["woff2Base64"])))


@unittest.skipUnless(os.path.exists(build.SRC), "the legacy atlases need Menlo")
class LegacyRegenerationTests(unittest.TestCase):
    """Rebuilding the universal and ASCII atlases with today's build-atlas.py must
    reproduce the checked-in fonts table for table (only head's build timestamps
    and checksum may differ): the braille-dots variant shares their assembly code."""

    def test_universal_and_ascii_rebuild_identically(self):
        with tempfile.TemporaryDirectory() as tmp:
            for name in ("build-atlas.py", "sources"):
                src = HERE / name
                (shutil.copytree if src.is_dir() else shutil.copy)(src, Path(tmp) / name)
            for variant, prefix in ((None, ""), ("ascii", "ascii-")):
                subprocess.run([sys.executable, "build-atlas.py", *([variant] if variant else [])],
                               cwd=tmp, check=True, capture_output=True)
                with self.subTest(variant=variant or "universal"):
                    self.assertEqual((Path(tmp) / f"{prefix}atlas.json").read_bytes(),
                                     (HERE / f"{prefix}atlas.json").read_bytes())
                    built, checked_in = _font_of(Path(tmp) / f"{prefix}atlas-font.json"), _font_of(HERE / f"{prefix}atlas-font.json")
                    self.assertEqual(sorted(built.keys()), sorted(checked_in.keys()))
                    for font in (built, checked_in):
                        font["head"].created = font["head"].modified = font["head"].checkSumAdjustment = 0
                    for tag in built.keys():
                        if tag != "GlyphOrder":
                            self.assertEqual(built.getTableData(tag), checked_in.getTableData(tag), tag)


if __name__ == "__main__":
    unittest.main()

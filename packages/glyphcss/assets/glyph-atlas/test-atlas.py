#!/usr/bin/env python3
"""Verify checked-in font metrics/cmap with fontTools: python3 test-atlas.py.

Uses the same Python/fontTools installation as build-atlas.py; no browser.
"""
import base64
import importlib.util
import io
import json
from pathlib import Path
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


if __name__ == "__main__":
    unittest.main()

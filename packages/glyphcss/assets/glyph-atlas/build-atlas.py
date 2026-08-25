#!/usr/bin/env python3
"""Build the checked-in COLR/CPAL colour-font atlas for `colorEncoding: "atlas"`.

This is the ONE place the universal glyph set is enumerated. It mirrors, by
hand, the real glyph sources in the TypeScript renderer:

  packages/glyphcss/src/render/ramps.ts      -- DEFAULT_RAMP / WIREFRAME_PALETTES
  packages/glyphcss/src/render/rasterize.ts  -- JUNCTION_GLYPHS, inkGlyphForTangent

Scope (see bench/color-font-atlas.md and AGENTS.md "colorEncoding" for the
measurement this follows):

  - full printable ASCII (0x20..0x7E) -- covers any free-form field-synth
    `glyphs` ramp typed in ASCII, plus every ASCII-only named palette.
  - the 24 Greek capital letters (U+0391..U+03A9, excluding the unassigned
    U+03A2 slot between Rho and Sigma) -- not just the 8 an individual scene
    happens to use (e.g. `/examples/parthenon`'s "ΠΑΡΘΕΝΩΝΑΘΗΝΑ" ramp): the
    full alphabet is the useful general unit, and per the BMP PUA headroom
    check in this module's own `main()` output it's free (166 -> 190 glyphs
    still leaves `maxPaletteSize` capped by `MAX_PALETTE_SIZE_CAP`, not by
    the BMP PUA budget).
  - the SOLID ramp of every named `WIREFRAME_PALETTES` entry (solid mode's
    `glyphPalette` can select any of them).
  - the wireframe THIN/NORMAL/CORE tiers of only the "default" and "ascii"
    palettes -- the two the spike's own viability table measured ("both
    wireframe palettes"). The other 11 named palettes' wireframe tiers
    (dots/lines/blocks/solid/stars/arrows/braille/runes/math/binary/hex) are
    NOT in the universal atlas; a scene using one of them under `mode:
    "wireframe"` falls back to the span encoder, same as any other
    out-of-atlas glyph.
  - ink mode's fixed 10-glyph oriented set.
  - the wireframe-junctions 11-glyph box-drawing set.

Deliberately EXCLUDED: `charMode: "braille"`/`"quadrant"`/`"halfblock"`
glyphs. Braille's 255 dot-pattern glyphs and quadrant/halfblock's two-colour-
per-cell encoding both need their own atlas design (two colours per code
point, or a different PUA budget) -- out of scope for this foundation; those
modes always render through the existing span encoder regardless of
`colorEncoding`.

Every base glyph carries exactly ONE COLR layer (solid single colour) --
verified in the spike as the cheapest possible COLR case, and a COLR-blind
fallback renders silent blanks instead of masquerading as correct output
(the base outline is deliberately empty).

Usage: python3 build-atlas.py
Writes: atlas.json (checked in; consumed by ../../src/render/fontAtlas.ts)
"""
import base64
import json
import os

from fontTools.fontBuilder import FontBuilder
from fontTools.pens.recordingPen import DecomposingRecordingPen
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib import TTFont

SRC = "/System/Library/Fonts/Menlo.ttc"
PUA_START = 0xE000
BMP_PUA_SIZE = 0xF8FF - 0xE000 + 1  # 6400
MAX_PALETTE_SIZE_CAP = 31  # bench/color-font-atlas.md: N=31 is the practical
                           # ceiling for a single universal one-colour atlas.
FAMILY = "GlyphCssAtlas"

ASCII_PRINTABLE = "".join(chr(c) for c in range(0x20, 0x7F))

# Greek capital alphabet, U+0391 (Alpha) .. U+03A9 (Omega). U+03A2 is an
# unassigned Unicode code point (there is no separate capital final-sigma --
# only lowercase sigma has the medial/final sigma/varsigma distinction), so
# it's skipped rather than probed against the source face.
GREEK_CAPITALS = "".join(chr(c) for c in range(0x0391, 0x03AA) if c != 0x03A2)

DEFAULT_RAMP = " .:-=+*#%@"

QUAKE_DETAIL_SOLID = list(reversed(
    "$@B%8&WM#*oahkbdpqwmZO0QLCJUYXzcvunxrjft/\\|()1{}[]?-_+~<>i!lI;:,\"^`'. "
))

WIREFRAME_PALETTES = {
    "detail": {"thin": ".'", "normal": "+*x", "core": "#@", "solid": "".join(QUAKE_DETAIL_SOLID)},
    "default": {"thin": "·⋅∙˙·⋅∙", "normal": "╋╬┼╳◆◇◊▲△▼▽◈⬡⬢∴∵⊥⊕⊗⊙⊚⊛", "core": "✦✧✩◉⊙◎", "solid": " .:-=+*#%@"},
    "ascii": {"thin": ".'", "normal": "+*x", "core": "#@", "solid": " .,:;!+=*xX#@"},
    "dots": {"thin": "·⋅", "normal": "•●", "core": "◉◎", "solid": " ·⋅∘•●◉◎⬤"},
    "lines": {"thin": "─│", "normal": "═║", "core": "█", "solid": " ─═╬║█▓▒░"},
    "blocks": {"thin": "░▁", "normal": "▒▓▌▐▀▄", "core": "█", "solid": " ░▒▓▌▐█▀▄■"},
    "solid": {"thin": "█", "normal": "█", "core": "█", "solid": "██"},
    "stars": {"thin": "·⋆", "normal": "✦✧✩✪", "core": "✫✬✭★", "solid": " ·⋆∗✦✧✩✪✫★"},
    "arrows": {"thin": "·∙", "normal": "←↑→↓", "core": "↖↗↘↙⤡⤢", "solid": " ·∙↑↗→↘↓↙←↖"},
    "braille": {"thin": "⠁⠂⠄⠈", "normal": "⠃⠅⠆⠉⠊⠋⠌⠍⠎⠏", "core": "⠿⣿", "solid": " ⠁⠃⠇⠧⠷⠿⡿⣿"},
    "runes": {"thin": ".·", "normal": "ᚠᚡᚢᚣᚤᚦᚨᚱᚲᚳᚷᚹᛃᛇᛉ", "core": "ᛞᛟᛡᛢᛣ", "solid": " ·ᚠᚣᚤᚨᚱᚷᛞᛢ"},
    "math": {"thin": "∙∘", "normal": "∑∏∫√∞≈≠≤≥⊂⊃⊆⊇", "core": "∮∯∰∂", "solid": " ∙∘∑∫√∞≈⊕⊗"},
    "binary": {"thin": "·.", "normal": "01", "core": "█", "solid": " .:01██"},
    "hex": {"thin": "·∙", "normal": "0123456789ABCDEF", "core": "FFAA", "solid": " 0123456789AF"},
}

INK_GLYPHS = "·‾▔-_\\▏|▕/"
JUNCTION_GLYPHS = "│─└┘┌┐├┤┬┴┼"
WIREFRAME_TIER_PALETTES = ("default", "ascii")


def universal_glyph_set(src_cmap):
    chars = set(ASCII_PRINTABLE)
    chars.add(" ")  # kept in the set logically; handled specially at encode time
    chars.update(GREEK_CAPITALS)
    for palette in WIREFRAME_PALETTES.values():
        chars.update(palette["solid"])
    for name in WIREFRAME_TIER_PALETTES:
        p = WIREFRAME_PALETTES[name]
        chars.update(p["thin"])
        chars.update(p["normal"])
        chars.update(p["core"])
    chars.update(INK_GLYPHS)
    chars.update(JUNCTION_GLYPHS)
    chars.discard(" ")  # space is free (U+0020 direct, no colour layer, no PUA slot)

    # The source face (Menlo) doesn't cover every symbol a named palette's
    # `.solid` ramp uses (Futhark runes, some math operators). A glyph absent
    # from the atlas's source face is dropped from the universal set; a scene
    # that actually renders it (an exotic named `glyphPalette`) falls back to
    # the span encoder, same as any other out-of-atlas glyph -- documented,
    # not silently patched over with a second source face.
    missing = sorted((c for c in chars if ord(c) not in src_cmap), key=ord)
    if missing:
        print(f"dropping {len(missing)} glyph(s) not in source face: "
              f"{' '.join(f'{c!r}(U+{ord(c):04X})' for c in missing)}")
    chars -= set(missing)
    return sorted(chars, key=ord)


def build_font(glyphs, palette_size, out_path):
    src = TTFont(SRC, fontNumber=0)
    src_cmap = src.getBestCmap()
    src_glyphs = src.getGlyphSet()
    upem = src["head"].unitsPerEm
    advance = src["hmtx"][src_cmap[ord("M")]][0]

    glyf_source = {}
    metrics = {}
    glyph_order = [".notdef", "space"]
    glyf_source[".notdef"] = TTGlyphPen(None).glyph()
    metrics[".notdef"] = (advance, 0)
    glyf_source["space"] = TTGlyphPen(None).glyph()
    metrics["space"] = (advance, 0)

    shape_names = []
    for gi, ch in enumerate(glyphs):
        name = f"shape{gi}"
        cp = ord(ch)
        if cp not in src_cmap:
            raise SystemExit(f"source font is missing outline for {ch!r} (U+{cp:04X})")
        # Decompose composite glyphs (e.g. accented spacing modifiers built
        # from a base + combining-mark component) so the subset font never
        # needs the component glyph itself -- only its outline.
        rec = DecomposingRecordingPen(src_glyphs)
        src_glyphs[src_cmap[cp]].draw(rec)
        pen = TTGlyphPen(None)
        rec.replay(pen)
        glyf_source[name] = pen.glyph()
        metrics[name] = (advance, src["hmtx"][src_cmap[cp]][1])
        glyph_order.append(name)
        shape_names.append(name)

    def hue_palette(n):
        out = []
        for i in range(n):
            t = i / max(1, n - 1)
            if i % 2 == 0:
                r, g, b = 0.10 + 0.85 * t, 0.95 - 0.55 * t, 0.35 + 0.40 * t
            else:
                r, g, b = 0.95 - 0.60 * t, 0.20 + 0.70 * t, 0.85 - 0.35 * t
            out.append((round(r, 4), round(g, 4), round(b, 4), 1.0))
        return out

    colors = hue_palette(palette_size)
    color_layers = {}
    cmap = {0x0020: "space"}
    codepoints = []
    for ci in range(palette_size):
        for gi in range(len(glyphs)):
            base = f"c{ci}g{gi}"
            glyph_order.append(base)
            glyf_source[base] = TTGlyphPen(None).glyph()
            metrics[base] = (advance, 0)
            color_layers[base] = [(shape_names[gi], ci)]
            cp = PUA_START + ci * len(glyphs) + gi
            if cp > 0xF8FF:
                raise SystemExit(f"atlas overflows the BMP PUA (needs {cp:#x})")
            cmap[cp] = base
            codepoints.append(cp)

    fb = FontBuilder(upem, isTTF=True)
    fb.setupGlyphOrder(glyph_order)
    fb.setupCharacterMap(cmap)
    fb.setupGlyf(glyf_source)
    fb.setupHorizontalMetrics(metrics)
    fb.setupHorizontalHeader(ascent=src["hhea"].ascent, descent=src["hhea"].descent)
    fb.setupNameTable({"familyName": FAMILY, "styleName": "Regular", "psName": f"{FAMILY}-Regular"})
    fb.setupOS2(
        sTypoAscender=src["hhea"].ascent,
        sTypoDescender=src["hhea"].descent,
        usWinAscent=src["hhea"].ascent,
        usWinDescent=-src["hhea"].descent,
        achVendID="GLPH",
    )
    fb.setupPost()
    fb.setupCPAL([colors])
    fb.setupCOLR(color_layers, version=0)
    fb.save(out_path)
    return codepoints


def main():
    probe = TTFont(SRC, fontNumber=0)
    glyphs = universal_glyph_set(probe.getBestCmap())
    glyph_count = len(glyphs)
    max_palette_size = min(MAX_PALETTE_SIZE_CAP, BMP_PUA_SIZE // glyph_count)
    if max_palette_size < 2:
        raise SystemExit(f"universal glyph set ({glyph_count}) leaves no room for a usable palette")

    out_dir = os.path.dirname(os.path.abspath(__file__))
    ttf_path = os.path.join(out_dir, "_atlas.ttf")
    codepoints = build_font(glyphs, max_palette_size, ttf_path)

    font = TTFont(ttf_path)
    font.flavor = "woff2"
    woff2_path = os.path.join(out_dir, "_atlas.woff2")
    font.save(woff2_path)
    with open(woff2_path, "rb") as fh:
        woff2_bytes = fh.read()
    woff2_b64 = base64.b64encode(woff2_bytes).decode("ascii")

    manifest = {
        "family": FAMILY,
        "glyphs": glyphs,
        "puaStart": PUA_START,
        "glyphCount": glyph_count,
        "maxPaletteSize": max_palette_size,
        "codepointRange": [min(codepoints), max(codepoints)],
        "woff2Base64": woff2_b64,
    }
    manifest_path = os.path.join(out_dir, "atlas.json")
    with open(manifest_path, "w") as fh:
        json.dump(manifest, fh, indent=1, ensure_ascii=False)
        fh.write("\n")

    os.remove(ttf_path)
    os.remove(woff2_path)

    print(f"glyphs: {glyph_count}, maxPaletteSize: {max_palette_size}, "
          f"codepoints: {min(codepoints):#x}..{max(codepoints):#x}, "
          f"woff2: {len(woff2_bytes)} bytes, base64: {len(woff2_b64)} chars")
    print(f"wrote {manifest_path}")


if __name__ == "__main__":
    main()

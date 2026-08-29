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
    full alphabet is the useful general unit.
  - the SOLID ramp of every named `WIREFRAME_PALETTES` entry, including
    "dots"/"braille"/"runes" (solid mode's `glyphPalette` can select any of
    them) -- ALL of it, not just the glyphs Menlo happens to contain (see
    "Source faces" below).
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
`colorEncoding`. Also excluded: the wireframe tiers of the 11 named palettes
other than "default"/"ascii" (see above) -- a scene using one of those under
`mode: "wireframe"` falls back to spans, same as any other out-of-atlas
glyph. Neither exclusion is a source-face limitation; both are documented
scope cuts and widening either is a scope decision, not a bug fix.

Source faces: Menlo (`SRC`, a macOS system font -- NOT vendored, NOT
redistributable; building this script therefore still requires running on a
Mac, or copying Menlo.ttc onto the build machine) is the primary source for
every glyph it covers, resolved first and unchanged in effect from before
this fallback mechanism existed. Menlo does not cover every glyph the scope
above asks for (Futhark runes, several math/geometric symbols the "default"
palette and the "runes"/"dots"/"braille" solid ramps use) -- those 22 glyphs
resolve from two vendored, redistributable fallback faces under
`sources/`, tried in order after Menlo: DejaVu Sans (`sources/dejavu/`,
Bitstream Vera License) and Noto Sans Runic (`sources/noto-sans-runic/`, SIL
Open Font License). A glyph in scope that resolves from NONE of the three
source faces is a hard build error naming the glyph -- see
`universal_glyph_set` -- not a silent drop; this whole fallback mechanism
exists because a silent drop is exactly what let 22 in-scope glyphs rot out
of a checked-in atlas.json for an unknown number of revisions before anyone
noticed.

Because DejaVu Sans and Noto Sans Runic are proportional faces and Menlo's
own advance width is the atlas's monospace grid unit, `_import_fallback_glyph`
scales every fallback outline into Menlo's em square (source UPM -> Menlo's
UPM) and then, only if it would still overflow, further shrinks it
(preserving aspect ratio, centered on Menlo's advance) to fit inside a
90%-of-advance x 90%-of-line-height box -- and unconditionally forces its
`hmtx` advance to Menlo's own, exactly like every Menlo-sourced glyph
already gets. A fallback outline that kept its native proportional advance
would desync the character grid the moment it landed in a cell.

Every base glyph carries exactly ONE COLR layer (solid single colour) --
verified in the spike as the cheapest possible COLR case, and a COLR-blind
fallback renders silent blanks instead of masquerading as correct output
(the base outline is deliberately empty).

Usage: python3 build-atlas.py [ascii]
Writes (all checked in):
  default (no argument) -- the UNIVERSAL atlas, byte-identical to before the
  `ascii` variant existed:
    atlas.json      -- metadata only; imported STATICALLY by ../../src/render/fontAtlas.ts
    atlas-font.json -- base64 WOFF2 only; imported LAZILY via ../../src/render/fontAtlasPayload.ts
  `ascii` -- the ASCII-ONLY variant (family "GlyphCssAtlasAscii"): printable
  ASCII minus space, 94 glyphs, which frees the BMP PUA budget for
  6400 // 94 = 68 palette slots instead of the universal atlas's 30. The
  point is COLOUR resolution: a scene whose glyphs are all ASCII (a solid
  `detail`-ramp render, e.g.) trades the never-used glyph axis for ~2.3x the
  palette axis, which is where median-cut quantization error actually lives.
  The 31-slot practical cap documented for the universal atlas is a
  budget-division consequence (6400 / 212 = 30), not a CPAL or
  `override-colors` engine limit, so this variant does not carry it.
    ascii-atlas.json      -- metadata; imported statically alongside atlas.json
    ascii-atlas-font.json -- base64 WOFF2; imported lazily via fontAtlasAsciiPayload.ts
See `main()` for why each payload is a separate file.
"""
import base64
import json
import os
import sys

from fontTools.fontBuilder import FontBuilder
from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.recordingPen import DecomposingRecordingPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib import TTFont

_HERE = os.path.dirname(os.path.abspath(__file__))

SRC = "/System/Library/Fonts/Menlo.ttc"
FALLBACK_SRCS = [
    os.path.join(_HERE, "sources/dejavu/DejaVuSans.ttf"),
    os.path.join(_HERE, "sources/noto-sans-runic/NotoSansRunic-Regular.ttf"),
]
# How much of Menlo's advance / line-height a fallback-imported outline may
# fill before it gets shrunk to fit -- keeps an imported glyph off the cell
# edges instead of touching or overflowing into a neighbour cell.
FALLBACK_FIT_MARGIN = 0.90
PUA_START = 0xE000
BMP_PUA_SIZE = 0xF8FF - 0xE000 + 1  # 6400
MAX_PALETTE_SIZE_CAP = 31  # bench/color-font-atlas.md: N=31 is the practical
                           # ceiling for a single universal one-colour atlas.
                           # The BMP PUA budget (glyph-count-dependent, see
                           # `main()`) is the actual binding constraint today
                           # (30 at 212 glyphs); this cap stays as the upper
                           # bound it always was.
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


def universal_glyph_set(available_cmaps):
    """`available_cmaps`: ordered `[(source_name, cmap), ...]` -- every face
    this build can resolve a glyph from (Menlo first, then the fallbacks).

    Every character enumerated here is IN SCOPE by definition (this function
    mirrors the TypeScript glyph sources named in the module docstring) --
    unlike the old Menlo-only version, a glyph missing from every available
    face is a hard build error naming the glyph, not a silent drop. A silent
    drop is exactly the defect that let 22 in-scope glyphs (default palette's
    `normal` tier, dots/braille/runes' `solid` ramps) rot out of the checked-
    in atlas: nothing failed, so nothing forced a fix.
    """
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

    covered = set()
    for _, cmap in available_cmaps:
        covered.update(cmap.keys())
    missing = sorted((c for c in chars if ord(c) not in covered), key=ord)
    if missing:
        names = ", ".join(name for name, _ in available_cmaps)
        raise SystemExit(
            f"atlas glyph set includes {len(missing)} in-scope character(s) not "
            f"covered by any source face ({names}): "
            + " ".join(f"{c!r}(U+{ord(c):04X})" for c in missing)
        )
    return sorted(chars, key=ord)


def _import_fallback_glyph(ch, cp, fallback_faces, target_upem, target_advance, target_ascent, target_descent):
    """Resolve `ch` from the first vendored fallback face that covers it,
    scaling/positioning the outline into Menlo's advance box and em square.

    `fallback_faces`: `[(name, TTFont, cmap, glyphset), ...]`, tried in order.
    Returns `(glyf, (advance, lsb))`. Raises `SystemExit` naming the glyph if
    none of the fallback faces cover it either (this is the hard-fail path
    `universal_glyph_set` already guarantees can't be reached for an in-scope
    glyph -- reached only if the two module-level lists ever drift apart).
    """
    for name, font, cmap, glyphset in fallback_faces:
        if cp not in cmap:
            continue
        gname = cmap[cp]
        src_upem = font["head"].unitsPerEm
        em_scale = target_upem / src_upem

        # Decompose composite glyphs, same discipline as the Menlo path.
        rec = DecomposingRecordingPen(glyphset)
        glyphset[gname].draw(rec)

        # Pass 1: measure the glyph's natural size in Menlo's UPM (em-square
        # scale only, no fit-to-advance shrink yet, no centering).
        em_bounds = BoundsPen(None)
        rec.replay(TransformPen(em_bounds, (em_scale, 0, 0, em_scale, 0, 0)))
        if em_bounds.bounds is None:
            # Blank outline (e.g. a mark with no ink of its own) -- still a
            # legitimate, if invisible, glyph.
            return TTGlyphPen(None).glyph(), (target_advance, 0)
        xmin, ymin, xmax, ymax = em_bounds.bounds
        nat_w, nat_h = xmax - xmin, ymax - ymin

        # Shrink (never enlarge) to fit inside the advance/line-height box,
        # preserving aspect ratio -- a proportional face's outline is not
        # already sized to a fixed-width cell the way Menlo's own is.
        max_w = target_advance * FALLBACK_FIT_MARGIN
        max_h = (target_ascent - target_descent) * FALLBACK_FIT_MARGIN
        fit_scale = 1.0
        if nat_w > 0:
            fit_scale = min(fit_scale, max_w / nat_w)
        if nat_h > 0:
            fit_scale = min(fit_scale, max_h / nat_h)
        combined_scale = em_scale * fit_scale

        # Center horizontally on Menlo's advance; leave the baseline (y=0)
        # untouched so the glyph sits on the same baseline as everything else.
        tx = target_advance / 2 - (xmin * fit_scale + xmax * fit_scale) / 2
        final_transform = (combined_scale, 0, 0, combined_scale, tx, 0)

        final_bounds = BoundsPen(None)
        rec.replay(TransformPen(final_bounds, final_transform))
        final_lsb = round(final_bounds.bounds[0]) if final_bounds.bounds else 0

        ttpen = TTGlyphPen(None)
        rec.replay(TransformPen(ttpen, final_transform))
        return ttpen.glyph(), (target_advance, final_lsb)
    raise SystemExit(f"atlas glyph {ch!r} (U+{cp:04X}) not found in Menlo or any vendored fallback face")


def build_font(glyphs, palette_size, out_path, family=FAMILY):
    src = TTFont(SRC, fontNumber=0)
    src_cmap = src.getBestCmap()
    src_glyphs = src.getGlyphSet()
    upem = src["head"].unitsPerEm
    advance = src["hmtx"][src_cmap[ord("M")]][0]
    ascent = src["hhea"].ascent
    descent = src["hhea"].descent

    fallback_faces = []
    for path in FALLBACK_SRCS:
        font = TTFont(path)
        fallback_faces.append((os.path.basename(path), font, font.getBestCmap(), font.getGlyphSet()))

    glyf_source = {}
    metrics = {}
    glyph_order = [".notdef", "space"]
    glyf_source[".notdef"] = TTGlyphPen(None).glyph()
    metrics[".notdef"] = (advance, 0)
    glyf_source["space"] = TTGlyphPen(None).glyph()
    metrics["space"] = (advance, 0)

    shape_names = []
    fallback_used = []
    for gi, ch in enumerate(glyphs):
        name = f"shape{gi}"
        cp = ord(ch)
        if cp in src_cmap:
            # Decompose composite glyphs (e.g. accented spacing modifiers built
            # from a base + combining-mark component) so the subset font never
            # needs the component glyph itself -- only its outline.
            rec = DecomposingRecordingPen(src_glyphs)
            src_glyphs[src_cmap[cp]].draw(rec)
            pen = TTGlyphPen(None)
            rec.replay(pen)
            glyf_source[name] = pen.glyph()
            metrics[name] = (advance, src["hmtx"][src_cmap[cp]][1])
        else:
            glyf, glyph_metrics = _import_fallback_glyph(ch, cp, fallback_faces, upem, advance, ascent, descent)
            glyf_source[name] = glyf
            metrics[name] = glyph_metrics
            fallback_used.append(ch)
        glyph_order.append(name)
        shape_names.append(name)

    if fallback_used:
        print(f"imported {len(fallback_used)} glyph(s) from vendored fallback faces (not in Menlo): "
              f"{' '.join(f'{c!r}(U+{ord(c):04X})' for c in fallback_used)}")

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
    fb.setupNameTable({"familyName": family, "styleName": "Regular", "psName": f"{family}-Regular"})
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


def ascii_glyph_set():
    """The ASCII variant's glyph axis: printable ASCII minus space (94 glyphs).

    A superset of every all-ASCII solid ramp (the `detail` ramp included) AND
    of any ASCII text a `transformCells` hook stamps into the grid, so an
    all-ASCII scene never trips the whole-grid span fallback. All 94 resolve
    from Menlo directly; the fallback faces are never consulted. Space is
    handled the same way as the universal build: U+0020 direct, no PUA slot.
    """
    chars = set(ASCII_PRINTABLE)
    chars.discard(" ")
    return sorted(chars, key=ord)


def main():
    variant = sys.argv[1] if len(sys.argv) > 1 else "universal"
    if variant not in ("universal", "ascii"):
        raise SystemExit(f"unknown atlas variant {variant!r} (expected nothing or 'ascii')")

    probe = TTFont(SRC, fontNumber=0)
    available_cmaps = [("Menlo", probe.getBestCmap())]
    for path in FALLBACK_SRCS:
        available_cmaps.append((os.path.basename(path), TTFont(path).getBestCmap()))

    if variant == "ascii":
        glyphs = ascii_glyph_set()
        family = f"{FAMILY}Ascii"
        prefix = "ascii-"
        # No 31 cap: it documented the universal atlas's budget division
        # (6400 / 212 = 30), not an engine limit -- see the module docstring.
        cap = BMP_PUA_SIZE
    else:
        glyphs = universal_glyph_set(available_cmaps)
        family = FAMILY
        prefix = ""
        cap = MAX_PALETTE_SIZE_CAP
    glyph_count = len(glyphs)
    max_palette_size = min(cap, BMP_PUA_SIZE // glyph_count)
    if max_palette_size < 2:
        raise SystemExit(f"{variant} glyph set ({glyph_count}) leaves no room for a usable palette")

    out_dir = os.path.dirname(os.path.abspath(__file__))
    ttf_path = os.path.join(out_dir, "_atlas.ttf")
    codepoints = build_font(glyphs, max_palette_size, ttf_path, family=family)

    font = TTFont(ttf_path)
    font.flavor = "woff2"
    woff2_path = os.path.join(out_dir, "_atlas.woff2")
    font.save(woff2_path)
    with open(woff2_path, "rb") as fh:
        woff2_bytes = fh.read()
    woff2_b64 = base64.b64encode(woff2_bytes).decode("ascii")

    # TWO artifacts, deliberately: the metadata (small, ~1.8KB) is imported
    # statically by `fontAtlas.ts` because the PUA encode/decode path needs it
    # synchronously on every frame; the base64 WOFF2 (~49KB) is imported only
    # through a dynamic `import()` so it never enters a consumer's main chunk
    # unless a scene actually turns `colorEncoding: "atlas"` on. Merging them
    # back into one file would put the payload back in every bundle -- the
    # split IS the lazy-load mechanism, not a cosmetic file layout.
    manifest = {
        "family": family,
        "glyphs": glyphs,
        "puaStart": PUA_START,
        "glyphCount": glyph_count,
        "maxPaletteSize": max_palette_size,
        "codepointRange": [min(codepoints), max(codepoints)],
    }
    manifest_path = os.path.join(out_dir, f"{prefix}atlas.json")
    with open(manifest_path, "w") as fh:
        json.dump(manifest, fh, indent=1, ensure_ascii=False)
        fh.write("\n")

    font_path = os.path.join(out_dir, f"{prefix}atlas-font.json")
    with open(font_path, "w") as fh:
        json.dump({"woff2Base64": woff2_b64}, fh, indent=1, ensure_ascii=False)
        fh.write("\n")

    os.remove(ttf_path)
    os.remove(woff2_path)

    print(f"glyphs: {glyph_count}, maxPaletteSize: {max_palette_size}, "
          f"codepoints: {min(codepoints):#x}..{max(codepoints):#x}, "
          f"woff2: {len(woff2_bytes)} bytes, base64: {len(woff2_b64)} chars")
    print(f"wrote {manifest_path} and {font_path}")


if __name__ == "__main__":
    main()

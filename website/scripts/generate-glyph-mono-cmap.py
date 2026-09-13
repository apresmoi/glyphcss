#!/usr/bin/env python3
"""Regenerates `glyphMonoCmap.json` — the checked-in codepoint list this
package's cmap-coverage test (`TargetPreview/glyphMonoCmap.test.ts`)
compares `GLYPH_CANVAS_TIERS`' own emittable glyphs against, without needing
fontTools installed at test time (CI has no Python toolchain of its own).

Requires fontTools (`pip install fonttools`, or `pip install fonttools` inside
a scratch venv) — not a repo dependency, since nothing else here needs a
Python environment; this script is a manual regen step, run only when
`website/public/fonts/glyph-mono.woff2` changes.

    python3 website/scripts/generate-glyph-mono-cmap.py

`glyph-mono-bold.woff2` is NOT dumped separately: both files are built from
the same subset pass over the same source and share an identical cmap (the
regular/bold *weight* differs, not which characters exist) — verified by
this repo's own font-update process, not assumed.
"""
import json
import pathlib

from fontTools.ttLib import TTFont

ROOT = pathlib.Path(__file__).resolve().parents[1]
FONT_PATH = ROOT / "public" / "fonts" / "glyph-mono.woff2"
OUT_PATH = ROOT / "src" / "components" / "TargetPreview" / "glyphMonoCmap.json"


def main() -> None:
    font = TTFont(str(FONT_PATH))
    cmap = font.getBestCmap()
    codepoints = sorted(cmap.keys())
    OUT_PATH.write_text(json.dumps({"codepoints": codepoints}, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {len(codepoints)} codepoints to {OUT_PATH.relative_to(ROOT.parent)}")


if __name__ == "__main__":
    main()

/**
 * glyphcss base stylesheet — injected once per Document.
 * Provides minimal positioning and monospace rendering for the ASCII output.
 * Full terminal aesthetic CSS lands in Phase 5.
 */
const GLYPH_STYLE_ID = "glyph-styles";

export function injectGlyphBaseStyles(doc?: Document): void {
  const target = doc ?? (typeof document !== "undefined" ? document : undefined);
  if (!target || target.getElementById(GLYPH_STYLE_ID)) return;
  const style = target.createElement("style");
  style.id = GLYPH_STYLE_ID;
  style.textContent = CORE_BASE_STYLES;
  target.head.appendChild(style);
}

const CORE_BASE_STYLES = `
/* ── Glyphcss scene container ───────────────────────────────────────── */

.glyph-scene {
  position: relative;
  display: block;
  overflow: hidden;
  line-height: 1;
}

/* ── ASCII output <pre> ──────────────────────────────────────────────── */

.glyph-scene .glyph-output {
  /* inline-block so the box shrinks to the text's natural width. With display:
     block the pre inherits parent width, leaving empty space on the right, and
     cellW = preRect.width / cols overshoots the actual character cell — placing
     hotspots to the right of the rasterized glyph they're supposed to anchor. */
  display: inline-block;
  margin: 0;
  padding: 0;
  font-family: monospace;
  font-size: inherit;
  line-height: 1;
  white-space: pre;
  overflow: hidden;
  user-select: none;
  -webkit-user-select: none;
}

/* ── Hotspot overlay ─────────────────────────────────────────────────── */

.glyph-scene .glyph-hotspot-layer {
  position: absolute;
  inset: 0;
  pointer-events: none;
  /* Isolate the stacking context so per-hotspot z-index values (derived from
     camera depth, sometimes negative) stay scoped INSIDE the layer. Without
     this, a negative-z-index hotspot would render below the sibling <pre>,
     hidden behind the rasterized glyphs. */
  isolation: isolate;
}

.glyph-scene .glyph-hotspot {
  position: absolute;
  pointer-events: all;
  cursor: pointer;
  /* Center the label on the projected anchor point rather than anchoring its
     top-left corner there. Without this, padding / label width visually offset
     the content from the 3D vertex being labelled. */
  transform: translate(-50%, -50%);
}
`;

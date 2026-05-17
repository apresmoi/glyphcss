/**
 * glyphcss base stylesheet — injected once per Document.
 * Provides minimal positioning and monospace rendering for the ASCII output.
 * Full terminal aesthetic CSS lands in Phase 5.
 */
const GLYPHCSS_STYLE_ID = "glyphcss-styles";

export function injectGlyphcssBaseStyles(doc?: Document): void {
  const target = doc ?? (typeof document !== "undefined" ? document : undefined);
  if (!target || target.getElementById(GLYPHCSS_STYLE_ID)) return;
  const style = target.createElement("style");
  style.id = GLYPHCSS_STYLE_ID;
  style.textContent = CORE_BASE_STYLES;
  target.head.appendChild(style);
}

const CORE_BASE_STYLES = `
/* ── Glyphcss scene container ───────────────────────────────────────── */

.glyphcss-scene {
  position: relative;
  display: block;
  overflow: hidden;
  line-height: 1;
}

/* ── ASCII output <pre> ──────────────────────────────────────────────── */

.glyphcss-scene .glyphcss-output {
  display: block;
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

.glyphcss-scene .glyphcss-hotspot-layer {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.glyphcss-scene .glyphcss-hotspot {
  position: absolute;
  pointer-events: all;
  cursor: pointer;
}
`;

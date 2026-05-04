const POLYCSS_STYLE_ID = "polycss-styles";

export function injectBaseStyles(doc: Document = typeof document !== "undefined" ? document : (null as unknown as Document)): void {
  if (!doc || doc.getElementById(POLYCSS_STYLE_ID)) return;
  const style = doc.createElement("style");
  style.id = POLYCSS_STYLE_ID;
  style.textContent = CORE_BASE_STYLES;
  doc.head.appendChild(style);
}

const CORE_BASE_STYLES = `
/* ── Scene container ────────────────────────────────────────────────────── */

.polycss-scene {
  position: relative;
  transform-style: preserve-3d;
  perspective: var(--polycss-perspective, 1000px);
}

/* ── Camera wrapper (perspective + interactive drag) ────────────────────── */

.polycss-camera {
  display: flex;
  width: 100%;
  justify-content: center;
  align-items: center;
  perspective: 8000px;
  min-height: inherit;
  height: 100%;
  position: relative;
  overflow: hidden;
  contain: paint;
  isolation: isolate;
}
.polycss-camera * {
  transform-style: preserve-3d;
  position: absolute;
}

/* ── Polygon leaf element ───────────────────────────────────────────────── */

/*
 * .polycss-poly — applied to every <img> or <svg> rendered by <Poly>.
 * The element is positioned absolutely within the scene root; its
 * transform: matrix3d(...) carries the full world-space placement.
 */
.polycss-poly {
  position: absolute;
  left: 0;
  top: 0;
  transform-style: preserve-3d;
}

/* State modifier classes applied by <Poly> during texture lifecycle. */
.polycss-poly-loading {
  /* Brief state while the UV-mapped texture blob is being generated. */
  opacity: 0;
}

.polycss-poly-error {
  /* Applied when <img>.onerror fires; polygon falls back to color fill. */
  opacity: 0.5;
  outline: 1px dashed rgba(255, 0, 0, 0.6);
}

/* ── Debug back-face overlay ─────────────────────────────────────────────── */

/*
 * .polycss-debug-backface — applied to the orange overlay SVG rendered
 * behind every polygon when <PolyScene debugShowBackfaces> is set.
 * The overlay faces the opposite direction so it's only visible when
 * the camera looks at the polygon's back side.
 */
.polycss-debug-backface {
  position: absolute;
  left: 0;
  top: 0;
}
`;

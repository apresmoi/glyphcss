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
 * .polycss-poly — applied to every polygon face rendered by <Poly>.
 * The element is positioned absolutely within the scene root; its
 * transform: matrix3d(...) carries the full world-space placement.
 */
.polycss-poly {
  position: absolute;
  left: 0;
  top: 0;
  transform-origin: 0 0;
  transform-style: preserve-3d;
  backface-visibility: hidden;
  background-repeat: no-repeat;
}

/* State modifier classes applied while an atlas page is being generated. */
.polycss-poly-loading {
  /* Brief state while the atlas sprite is being generated. */
  opacity: 0;
}

.polycss-poly-error {
  /* Applied when atlas rasterization fails. */
  opacity: 0.5;
  outline: 1px dashed rgba(255, 0, 0, 0.6);
}
`;

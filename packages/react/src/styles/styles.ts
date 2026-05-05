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
 * Polygon faces render as internal <i> elements inside .polycss-scene.
 * The element is positioned absolutely within the scene root; its
 * transform: matrix3d(...) carries the full world-space placement.
 */
.polycss-scene i {
  display: block;
  position: absolute;
  left: 0;
  top: 0;
  font-style: normal;
  transform-origin: 0 0;
  transform-style: preserve-3d;
  backface-visibility: hidden;
  background-repeat: no-repeat;
}
`;

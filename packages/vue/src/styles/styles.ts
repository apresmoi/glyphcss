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

/* ── Dynamic lighting cascade vars (scene root → polygons) ─────────────── */

/*
 * Dynamic mode: PolyScene writes the directional + ambient light setup to
 * these custom properties on the scene root. Each polygon's <i> bakes its
 * own normal directly into an inline calc() that reads these vars to
 * resolve the Lambert dot product and per-channel tint. Sliding the light
 * only writes these scene-root vars — no JS, no atlas redraw.
 *
 * Registering with @property forces the browser to parse the values as
 * <number>s instead of opaque token streams; that makes the polygon-level
 * calc() expressions resolve reliably across engines.
 */

@property --polycss-lx { syntax: "<number>"; inherits: true; initial-value: 0; }
@property --polycss-ly { syntax: "<number>"; inherits: true; initial-value: 0; }
@property --polycss-lz { syntax: "<number>"; inherits: true; initial-value: 1; }
@property --polycss-lr { syntax: "<number>"; inherits: true; initial-value: 1; }
@property --polycss-lg { syntax: "<number>"; inherits: true; initial-value: 1; }
@property --polycss-lb { syntax: "<number>"; inherits: true; initial-value: 1; }
@property --polycss-li { syntax: "<number>"; inherits: true; initial-value: 1; }
@property --polycss-ar { syntax: "<number>"; inherits: true; initial-value: 1; }
@property --polycss-ag { syntax: "<number>"; inherits: true; initial-value: 1; }
@property --polycss-ab { syntax: "<number>"; inherits: true; initial-value: 1; }
@property --polycss-ai { syntax: "<number>"; inherits: true; initial-value: 0.4; }

/* Per-polygon surface normal — set inline by the renderer. inherits:false
   because each <i> has its own normal (no cascade). */
@property --polycss-nx { syntax: "<number>"; inherits: false; initial-value: 0; }
@property --polycss-ny { syntax: "<number>"; inherits: false; initial-value: 0; }
@property --polycss-nz { syntax: "<number>"; inherits: false; initial-value: 1; }

/* Calc-driven Lambert + tint, scoped to dynamic-lighting scenes. Lives
   here (not inline per polygon) so each <i> only carries its tiny normal
   declarations — ~12× smaller per-polygon style payload on big meshes. */
.polycss-scene[data-polycss-lighting="dynamic"] i {
  background-color: rgb(
    calc(255 * (var(--polycss-ar) * var(--polycss-ai)
         + var(--polycss-lr) * var(--polycss-li) * max(0,
           var(--polycss-nx) * var(--polycss-lx) +
           var(--polycss-ny) * var(--polycss-ly) +
           var(--polycss-nz) * var(--polycss-lz))))
    calc(255 * (var(--polycss-ag) * var(--polycss-ai)
         + var(--polycss-lg) * var(--polycss-li) * max(0,
           var(--polycss-nx) * var(--polycss-lx) +
           var(--polycss-ny) * var(--polycss-ly) +
           var(--polycss-nz) * var(--polycss-lz))))
    calc(255 * (var(--polycss-ab) * var(--polycss-ai)
         + var(--polycss-lb) * var(--polycss-li) * max(0,
           var(--polycss-nx) * var(--polycss-lx) +
           var(--polycss-ny) * var(--polycss-ly) +
           var(--polycss-nz) * var(--polycss-lz))))
  );
  background-blend-mode: multiply;
}
`;

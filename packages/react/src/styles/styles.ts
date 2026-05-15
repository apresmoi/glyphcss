const POLYCSS_STYLE_ID = "polycss-styles";

export function injectPolyBaseStyles(doc: Document = typeof document !== "undefined" ? document : (null as unknown as Document)): void {
  if (!doc || doc.getElementById(POLYCSS_STYLE_ID)) return;
  const style = doc.createElement("style");
  style.id = POLYCSS_STYLE_ID;
  style.textContent = CORE_BASE_STYLES;
  doc.head.appendChild(style);
}

const CORE_BASE_STYLES = `
/* ── Scene container ────────────────────────────────────────────────────── */

.polycss-scene,
.polycss-scene *,
.polycss-scene *::before,
.polycss-scene *::after {
  box-sizing: border-box;
}

.polycss-scene {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 0;
  height: 0;
  transform-style: preserve-3d;
  perspective: none;
  transform: var(--scene-transform);
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
 * Polygon faces render as internal leaf elements inside .polycss-scene.
 * The element is positioned absolutely within the scene root; its
 * transform: matrix3d(...) carries the full world-space placement.
 */
.polycss-scene b,
.polycss-scene i,
.polycss-scene s,
.polycss-scene u {
  position: absolute;
  display: block;
  transform-origin: 0 0;
  transform-style: preserve-3d;
  margin: 0;
  padding: 0;
  font: inherit;
  font-weight: normal;
  font-style: normal;
  line-height: 0;
  quotes: none;
  text-decoration: none;
  backface-visibility: hidden;
  background-repeat: no-repeat;
}

.polycss-scene b,
.polycss-scene i,
.polycss-scene u {
  color: var(--polycss-paint, currentColor);
}

.polycss-scene b {
  background: currentColor;
}

.polycss-scene i {
  border-style: solid;
  border-width: 1px;
  border-color: currentColor;
}

.polycss-scene s {
}

.polycss-scene u {
  width: 0;
  height: 0;
  background: transparent;
  box-sizing: content-box;
  border: 0 solid transparent;
  border-color: transparent transparent currentColor transparent;
}

/* ── Gizmo override ─────────────────────────────────────────────────────── */

/*
 * <TransformControls> renders 3D arrows using the same polygon pipeline
 * as user content, but the gizmo is a UI affordance — both faces of
 * every polygon should remain visible regardless of which way the
 * camera is looking. Otherwise the cuboid shafts and pyramid heads end
 * up half-culled (you see only the side faces, not the caps), and the
 * arrow looks like a flat strip instead of a 3D bar.
 *
 * Transitions on color, border-color, and background-color smooth the
 * idle → hover → drag alpha changes across rect, border-shape, triangle,
 * and atlas paths.
 */
.polycss-transform-controls i,
.polycss-transform-controls b,
.polycss-transform-controls s,
.polycss-transform-controls u {
  backface-visibility: visible;
  transition: color 150ms ease-out, border-color 150ms ease-out, background-color 150ms ease-out;
}

/* ── Dynamic lighting cascade vars (scene root → polygons) ─────────────── */

/*
 * Dynamic mode: PolyScene writes the directional + ambient light setup to
 * these custom properties on the scene root. Each polygon leaf bakes its
 * own normal directly into an inline calc() that reads these vars to
 * resolve the Lambert dot product and per-channel tint. Sliding the light
 * only writes these scene-root vars — no JS, no atlas redraw.
 *
 * Registering with @property forces the browser to parse the values as
 * <number>s instead of opaque token streams; that makes the polygon-level
 * calc() expressions resolve reliably across engines.
 */

@property --plx { syntax: "<number>"; inherits: true; initial-value: 0; }
@property --ply { syntax: "<number>"; inherits: true; initial-value: 0; }
@property --plz { syntax: "<number>"; inherits: true; initial-value: 1; }
@property --plr { syntax: "<number>"; inherits: true; initial-value: 1; }
@property --plg { syntax: "<number>"; inherits: true; initial-value: 1; }
@property --plb { syntax: "<number>"; inherits: true; initial-value: 1; }
@property --pli { syntax: "<number>"; inherits: true; initial-value: 1; }
@property --par { syntax: "<number>"; inherits: true; initial-value: 1; }
@property --pag { syntax: "<number>"; inherits: true; initial-value: 1; }
@property --pab { syntax: "<number>"; inherits: true; initial-value: 1; }
@property --pai { syntax: "<number>"; inherits: true; initial-value: 0.4; }

/* Per-polygon surface normal — set inline by the renderer. Base RGB channels
   may be hoisted to a mesh wrapper, so they inherit unless overridden inline. */
@property --pnx { syntax: "<number>"; inherits: false; initial-value: 0; }
@property --pny { syntax: "<number>"; inherits: false; initial-value: 0; }
@property --pnz { syntax: "<number>"; inherits: false; initial-value: 1; }
@property --psr { syntax: "<number>"; inherits: true; initial-value: 1; }
@property --psg { syntax: "<number>"; inherits: true; initial-value: 1; }
@property --psb { syntax: "<number>"; inherits: true; initial-value: 1; }

/* Calc-driven Lambert + tint, scoped to dynamic-lighting scenes. Lives
   here (not inline per polygon) so each leaf only carries its tiny normal
   declarations — ~12× smaller per-polygon style payload on big meshes. */
.polycss-scene[data-polycss-lighting="dynamic"] s {
  background-color: rgb(
    calc(255 * (var(--par) * var(--pai)
         + var(--plr) * var(--pli) * max(0,
           var(--pnx) * var(--plx) +
           var(--pny) * var(--ply) +
           var(--pnz) * var(--plz))))
    calc(255 * (var(--pag) * var(--pai)
         + var(--plg) * var(--pli) * max(0,
           var(--pnx) * var(--plx) +
           var(--pny) * var(--ply) +
           var(--pnz) * var(--plz))))
    calc(255 * (var(--pab) * var(--pai)
         + var(--plb) * var(--pli) * max(0,
           var(--pnx) * var(--plx) +
           var(--pny) * var(--ply) +
           var(--pnz) * var(--plz))))
  );
  background-blend-mode: multiply;
}

.polycss-scene[data-polycss-lighting="dynamic"] b,
.polycss-scene[data-polycss-lighting="dynamic"] u {
  color: rgb(
    calc(255 * var(--psr) * (var(--par) * var(--pai)
         + var(--plr) * var(--pli) * max(0,
           var(--pnx) * var(--plx) +
           var(--pny) * var(--ply) +
           var(--pnz) * var(--plz))))
    calc(255 * var(--psg) * (var(--pag) * var(--pai)
         + var(--plg) * var(--pli) * max(0,
           var(--pnx) * var(--plx) +
           var(--pny) * var(--ply) +
           var(--pnz) * var(--plz))))
    calc(255 * var(--psb) * (var(--pab) * var(--pai)
         + var(--plb) * var(--pli) * max(0,
           var(--pnx) * var(--plx) +
           var(--pny) * var(--ply) +
           var(--pnz) * var(--plz))))
  );
}
`;

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
  width: 64px;
  height: 64px;
}

.polycss-scene i {
  width: 64px;
  height: 64px;
  border-color: currentColor;
}

.polycss-scene s {
  width: 1px;
  height: 1px;
}

.polycss-scene u {
  width: 0;
  height: 0;
  background: transparent;
  box-sizing: content-box;
  border: 0 solid transparent;
  border-color: transparent transparent currentColor transparent;
  border-width: 0 64px 64px 64px;
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

/* CSS-space light components (world-Y→cssX, world-X→cssY, world-Z→cssZ).
   Used by the shadow projection matrix. --clz is clamped away from 0 in JS
   to avoid divide-by-zero when the light is near-horizontal. */
@property --clx { syntax: "<number>"; inherits: true; initial-value: 0.01; }
@property --cly { syntax: "<number>"; inherits: true; initial-value: 0; }
@property --clz { syntax: "<number>"; inherits: true; initial-value: 1; }

/* Ground-plane position in CSS pixels along the CSS-Z axis (= world-Z, the
   up axis in polycss's world convention). Stored as a <number> so it can be
   used directly inside matrix3d() calc() expressions (matrix3d requires
   dimensionless entries — no px units).
   Set by PolyScene from the min world-Z of casting meshes. */
@property --shadow-ground-cssz { syntax: "<number>"; inherits: true; initial-value: 0; }
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

/* <q> — dedicated shadow leaf. Same border-shape rendering trick as <i>
   (border-color: currentColor fills the polygon outline) but with its
   own tag so we don't have to thread :not(.polycss-shadow) exclusions
   through every dynamic-mode color rule. backface-visibility must be
   visible because the projection matrix is near-rank-deficient and the
   resulting plane's normal can read as back-facing under some camera
   angles; the leaf is intentionally always painted. Strip the UA's
   default ::before/::after open-/close-quote so the element is just a
   styled box. */
.polycss-scene q {
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
  text-decoration: none;
  backface-visibility: visible;
  border-color: currentColor;
  pointer-events: none;
  will-change: transform;
}
.polycss-scene q::before,
.polycss-scene q::after {
  content: none;
}

/* ── Cast shadows (dynamic mode only) ──────────────────────────────────── */

/*
 * Shadow projection matrix. Projects any 3D point P onto the horizontal
 * ground plane (cssZ ≈ G) along the CSS-space light direction (--clx/y/z).
 *
 * In polycss's world convention world Z is up (red-green plane is the
 * floor in the axes helper). After the world→CSS swap (Y↔X), world Z stays
 * as CSS Z, so the ground plane normal in CSS space is +cssZ.
 *
 * The strict projection formula would set m22=0 (output.z is a constant G,
 * the polygon is exactly flat). But Chromium SKIPS rendering elements
 * whose composed transform matrix is non-invertible (singular). m22=0
 * makes the matrix singular, so the shadow paints nothing even though it
 * has a valid layout box. The fix: collapse along z by a near-zero
 * scale (Z_SQUASH = 0.01) instead of exactly zero — output.z is then
 * approximately G with ~1% drift from the input, full-rank and renderable.
 * The shadow still looks flat to the eye (the drift is sub-pixel for
 * any realistic scene size).
 *
 *   out.cssX = P.cssX - (--clx/--clz) * (P.cssZ - G)
 *   out.cssY = P.cssY - (--cly/--clz) * (P.cssZ - G)
 *   out.cssZ = Z_SQUASH * P.cssZ + (1 - Z_SQUASH) * G
 *
 * As column-major 4×4 (CSS matrix3d order):
 *   col1: [1, 0, 0, 0]
 *   col2: [0, 1, 0, 0]
 *   col3: [-(--clx/--clz), -(--cly/--clz), Z_SQUASH, 0]
 *   col4: [G*(--clx/--clz), G*(--cly/--clz), G*(1-Z_SQUASH), 1]
 */
.polycss-scene[data-polycss-lighting="dynamic"] {
  --shadow-proj: matrix3d(
    1, 0, 0, 0,
    0, 1, 0, 0,
    calc(-1 * var(--clx) / var(--clz)),
    calc(-1 * var(--cly) / var(--clz)),
    0.01,
    0,
    calc(var(--shadow-ground-cssz) * var(--clx) / var(--clz)),
    calc(var(--shadow-ground-cssz) * var(--cly) / var(--clz)),
    calc(var(--shadow-ground-cssz) * 0.99),
    1
  );
}

/* <q> shadow leaf — Lambert-gated opacity. Polygons facing the light cast
   full shadow; polygons facing away cast zero shadow (their projection
   would stack inside the silhouette and produce ugly overdraw). The
   * 10 multiplier sharpens the cutoff so small positive Lambert values
   jump quickly to 1, giving a near-binary visibility decision with a
   smooth edge transition. Pure CSS calc — no JS at light-change time. */
.polycss-scene q {
  opacity: clamp(0, calc((var(--pnx) * var(--clx) + var(--pny) * var(--cly) + var(--pnz) * var(--clz)) * 10), 1);
}
`;

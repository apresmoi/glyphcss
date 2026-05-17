/**
 * polycss base stylesheet — injected once per Document. Mirrors the React
 * package's `injectPolyBaseStyles` so a vanilla scene gets the same default
 * 3D viewport behavior without users wiring up CSS by hand.
 */
const POLYCSS_STYLE_ID = "polycss-styles";

export function injectPolyBaseStyles(doc?: Document): void {
  const target =
    doc ?? (typeof document !== "undefined" ? document : undefined);
  if (!target || target.getElementById(POLYCSS_STYLE_ID)) return;
  const style = target.createElement("style");
  style.id = POLYCSS_STYLE_ID;
  style.textContent = CORE_BASE_STYLES;
  target.head.appendChild(style);
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
  perspective: 8000px;
  /* Pin the scene as a composited layer. Without this, mobile Chrome
     re-rasterizes every descendant tile when the scene transform changes
     each animation frame, which overruns the raster budget on textured
     meshes (faces drop, fragments float). With will-change, the GPU
     reuses the cached layer pixels and only re-composites. */
  will-change: transform;
}

/* ── First-person controls perspective context ──────────────────────────── */

/* PolyFirstPersonControls toggles this class on its host element (vanilla:
   scene.host; react/vue: the camera wrapper). FPV needs a real perspective
   context so scene Z translation produces visible depth motion - without
   it, walking forward looks like a planar pan. The class wins over inline
   perspective styles (e.g. PolyOrthographicCamera's perspective: none)
   via !important. The actual perspective value is set inline by the
   controls as the --polycss-fpv-perspective custom property; the default
   of 2000px matches the controls' lookOffset fallback so the FPV math and
   visual perspective stay in sync. */
.polycss-fpv-host {
  perspective: var(--polycss-fpv-perspective, 2000px) !important;
  transform-style: preserve-3d !important;
}

/* ── Mesh wrapper ───────────────────────────────────────────────────────── */

.polycss-mesh {
  position: absolute;
  transform-style: preserve-3d;
  transform-origin: var(--origin);
}

/* ── Polygon leaf element ───────────────────────────────────────────────── */

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
  width: 1px;
  height: 1px;
}

.polycss-scene i {
  width: 16px;
  height: 16px;
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
  border-width: 0 1px 1px 1px;
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

/* ── Gizmo override (createTransformControls) ───────────────────────────── */

/*
 * Translate arrows + rotate rings render through the same polygon
 * pipeline as user content but the gizmo is a UI affordance — both
 * faces of every polygon should remain visible regardless of camera
 * orientation, otherwise the cuboid shafts and pyramid heads end up
 * half-culled. Transitions on color, border-color, and background-color
 * smooth the idle / hover / drag alpha changes.
 */
.polycss-mesh.polycss-transform-gizmo i,
.polycss-mesh.polycss-transform-gizmo b,
.polycss-mesh.polycss-transform-gizmo s,
.polycss-mesh.polycss-transform-gizmo u {
  backface-visibility: visible;
  transition: color 150ms ease-out, border-color 150ms ease-out, background-color 150ms ease-out;
}

/*
 * Rotate rings are rendered as a single square quad per ring, then masked
 * to a donut via a radial-gradient. The --ring-inner-ratio CSS var is set
 * inline by createTransformControls (= innerR / outerR, where outerR maps
 * to the quad's edge at 50%). Hit-testing has to use the donut shape too.
 * Single DOM node per ring instead of N segment quads.
 */
.polycss-mesh.polycss-transform-ring i,
.polycss-mesh.polycss-transform-ring b,
.polycss-mesh.polycss-transform-ring s,
.polycss-mesh.polycss-transform-ring u {
  --ring-inner-r: calc(var(--ring-inner-ratio, 0.92) * 50%);
  --ring-outer-r: calc(var(--ring-outer-ratio, 1) * 50%);
  -webkit-mask: radial-gradient(circle at 50% 50%,
    transparent 0%,
    transparent var(--ring-inner-r),
    black var(--ring-inner-r),
    black var(--ring-outer-r),
    transparent var(--ring-outer-r));
          mask: radial-gradient(circle at 50% 50%,
    transparent 0%,
    transparent var(--ring-inner-r),
    black var(--ring-inner-r),
    black var(--ring-outer-r),
    transparent var(--ring-outer-r));
}

/* ── Dynamic lighting cascade vars (scene root → polygons) ─────────────── */

/*
 * Dynamic mode: the scene root carries the directional + ambient light
 * setup as custom properties. Each polygon leaf bakes its own normal
 * directly into an inline calc() that reads these vars to resolve the
 * Lambert dot product and per-channel tint. Sliding the light only
 * writes these scene-root vars — no JS, no atlas redraw.
 *
 * Registering with @property forces the browser to parse the values as
 * <number>s instead of opaque token streams; that makes the polygon-level
 * calc() expressions resolve reliably across engines.
 */

@property --plx { syntax: "<number>"; inherits: true; initial-value: 0; }
@property --ply { syntax: "<number>"; inherits: true; initial-value: 0; }
@property --plz { syntax: "<number>"; inherits: true; initial-value: 1; }

/* CSS-space light components (world-Y→cssX, world-X→cssY, world-Z→cssZ).
   Used by the shadow projection matrix. --clx is clamped away from 0 in JS
   to avoid divide-by-zero when the light is near-horizontal. */
@property --clx { syntax: "<number>"; inherits: true; initial-value: 0.01; }
@property --cly { syntax: "<number>"; inherits: true; initial-value: 0; }
@property --clz { syntax: "<number>"; inherits: true; initial-value: 1; }

/* Ground-plane position in CSS pixels along the CSS-Z axis (= world-Z, the
   up axis in polycss's world convention). Stored as a <number> so it can be
   used directly inside matrix3d() calc() expressions (matrix3d requires
   dimensionless entries — no px units).
   Set by recomputeShadowGround() from the min world-Z of casting meshes. */
@property --shadow-ground-cssz { syntax: "<number>"; inherits: true; initial-value: 0; }
@property --plr { syntax: "<number>"; inherits: true; initial-value: 1; }
@property --plg { syntax: "<number>"; inherits: true; initial-value: 1; }
@property --plb { syntax: "<number>"; inherits: true; initial-value: 1; }
@property --pli { syntax: "<number>"; inherits: true; initial-value: 1; }
@property --par { syntax: "<number>"; inherits: true; initial-value: 1; }
@property --pag { syntax: "<number>"; inherits: true; initial-value: 1; }
@property --pab { syntax: "<number>"; inherits: true; initial-value: 1; }
@property --pai { syntax: "<number>"; inherits: true; initial-value: 0.4; }

/* Per-polygon surface normal — set inline by the renderer per leaf, OR by
   a .polycss-bucket wrapper that groups axis-aligned polys sharing the
   same face direction. inherits:true so polys inside a bucket pick up
   the wrapper's normal automatically; polys outside any bucket still
   override it inline. */
@property --pnx { syntax: "<number>"; inherits: true; initial-value: 0; }
@property --pny { syntax: "<number>"; inherits: true; initial-value: 0; }
@property --pnz { syntax: "<number>"; inherits: true; initial-value: 1; }
@property --psr { syntax: "<number>"; inherits: true; initial-value: 1; }
@property --psg { syntax: "<number>"; inherits: true; initial-value: 1; }
@property --psb { syntax: "<number>"; inherits: true; initial-value: 1; }

/* Hoisted Lambert dot product — computed once per element it's set on.
   inherits:true so a bucket wrapper computes lambert ONCE for its whole
   group (one calc per bucket, not per polygon). Solo polys still set it
   themselves via the per-poly rule below. */
@property --plam { syntax: "<number>"; inherits: true; initial-value: 0; }

/* Calc-driven Lambert + tint, scoped to dynamic-lighting scenes. Lives
   here (not inline per polygon) so each leaf only carries its tiny normal
   declarations — ~12× smaller per-polygon style payload on big meshes.
   --plam is computed once and reused 3× (one per channel),
   cutting the dot-product calc count from 3 → 1 per polygon per frame. */
/* Lambert-bucket wrapper: createPolyScene groups axis-aligned polys
   sharing one face direction inside a .polycss-bucket div with the
   bucket's normal as inline CSS vars. Lambert is computed ONCE per
   bucket (inherits:true on --plam propagates the value to
   every leaf child). For voxel meshes this collapses thousands of
   per-frame dot products into a few dozen. */
.polycss-bucket {
  position: absolute;
  transform-style: preserve-3d;
}

/* Per-bucket lambert calc — runs once per bucket per frame. */
.polycss-scene[data-polycss-lighting="dynamic"] .polycss-bucket {
  --plam: max(0, calc(
    var(--pnx) * var(--plx) +
    var(--pny) * var(--ply) +
    var(--pnz) * var(--plz)
  ));
}

/* Per-poly lambert calc — applies to any leaf whose direct parent is NOT
   a .polycss-bucket. Covers:
     - vanilla createPolyScene polys not inside a bucket (e.g. off-axis
       curved polys that didn't make a bucket group)
     - React <PolyScene polygons> path (leaves are direct children of
       .polycss-scene; no <PolyMesh> wrapper)
     - React <PolyScene><PolyMesh polygons></PolyMesh> path (leaves are
       direct children of .polycss-mesh)
   Bucketed leaves are skipped — their parent IS .polycss-bucket so they
   inherit the bucket's hoisted lambert (one calc per bucket, not per
   leaf). */
.polycss-scene[data-polycss-lighting="dynamic"] :not(.polycss-bucket) > i,
.polycss-scene[data-polycss-lighting="dynamic"] :not(.polycss-bucket) > b,
.polycss-scene[data-polycss-lighting="dynamic"] :not(.polycss-bucket) > s,
.polycss-scene[data-polycss-lighting="dynamic"] :not(.polycss-bucket) > u {
  --plam: max(0, calc(
    var(--pnx) * var(--plx) +
    var(--pny) * var(--ply) +
    var(--pnz) * var(--plz)
  ));
}

/* Atlas polys: containment + background-color from lambert (inherited or
   own) and the scene-level light vars. Splitting this from the lambert
   calc above lets bucketed polys skip the dot-product entirely. */
.polycss-scene[data-polycss-lighting="dynamic"] s {
  /* Isolate each leaf's layout/style/paint walks from siblings. Works
     because the leaf transform-style:preserve-3d was dropped above —
     the 3D context lives on .polycss-scene / .polycss-mesh, not the
     leaves, so there's nothing inside a leaf that needs to participate
     in 3D compositing across the contain boundary. */
  contain: strict;
  background-color: rgb(
    calc(255 * (var(--par) * var(--pai)
         + var(--plr) * var(--pli) * var(--plam)))
    calc(255 * (var(--pag) * var(--pai)
         + var(--plg) * var(--pli) * var(--plam)))
    calc(255 * (var(--pab) * var(--pai)
         + var(--plb) * var(--pli) * var(--plam)))
  );
  background-blend-mode: multiply;
}

.polycss-scene[data-polycss-lighting="dynamic"] b,
.polycss-scene[data-polycss-lighting="dynamic"] i,
.polycss-scene[data-polycss-lighting="dynamic"] u {
  color: rgb(
    calc(255 * var(--psr) * (var(--par) * var(--pai)
         + var(--plr) * var(--pli) * var(--plam)))
    calc(255 * var(--psg) * (var(--pag) * var(--pai)
         + var(--plg) * var(--pli) * var(--plam)))
    calc(255 * var(--psb) * (var(--pab) * var(--pai)
         + var(--plb) * var(--pli) * var(--plam)))
  );
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
   smooth edge transition. Pure CSS calc — no JS at light-change time.

   The base layout / positioning / pseudo-element-strip rules for <q>
   live in the polygon-leaf section above. This rule only adds the
   dynamic-light Lambert gating, separated so it's easy to disable the
   gate for debugging by commenting out a single block. */
.polycss-scene q {
  opacity: clamp(0, calc((var(--pnx) * var(--clx) + var(--pny) * var(--cly) + var(--pnz) * var(--clz)) * 10), 1);
}
`;

/**
 * polycss base stylesheet — injected once per Document. Mirrors the React
 * package's `injectBaseStyles` so a vanilla scene gets the same default
 * 3D viewport behavior without users wiring up CSS by hand.
 */
const POLYCSS_STYLE_ID = "polycss-styles";

export function injectBaseStyles(doc?: Document): void {
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

.polycss-scene {
  position: relative;
  transform-style: preserve-3d;
}

/* ── Mesh wrapper ───────────────────────────────────────────────────────── */

.polycss-mesh {
  position: absolute;
  transform-style: preserve-3d;
}

/* ── Polygon leaf element ───────────────────────────────────────────────── */

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

/* ── Gizmo override (createTransformControls) ───────────────────────────── */

/*
 * Translate arrows + rotate rings render through the same polygon
 * pipeline as user content but the gizmo is a UI affordance — both
 * faces of every polygon should remain visible regardless of camera
 * orientation, otherwise the cuboid shafts and pyramid heads end up
 * half-culled. Transitions on border-color and background-color smooth
 * the idle / hover / drag alpha changes.
 */
.polycss-mesh.polycss-transform-gizmo i {
  backface-visibility: visible;
  transition: border-color 150ms ease-out, background-color 150ms ease-out;
}

/* ── Dynamic lighting cascade vars (scene root → polygons) ─────────────── */

/*
 * Dynamic mode: the scene root carries the directional + ambient light
 * setup as custom properties. Each polygon's <i> bakes its own normal
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
@property --plr { syntax: "<number>"; inherits: true; initial-value: 1; }
@property --plg { syntax: "<number>"; inherits: true; initial-value: 1; }
@property --plb { syntax: "<number>"; inherits: true; initial-value: 1; }
@property --pli { syntax: "<number>"; inherits: true; initial-value: 1; }
@property --par { syntax: "<number>"; inherits: true; initial-value: 1; }
@property --pag { syntax: "<number>"; inherits: true; initial-value: 1; }
@property --pab { syntax: "<number>"; inherits: true; initial-value: 1; }
@property --pai { syntax: "<number>"; inherits: true; initial-value: 0.4; }

/* Per-polygon surface normal — set inline by the renderer per <i>, OR by
   a .polycss-bucket wrapper that groups axis-aligned polys sharing the
   same face direction. inherits:true so polys inside a bucket pick up
   the wrapper's normal automatically; polys outside any bucket still
   override it inline. */
@property --pnx { syntax: "<number>"; inherits: true; initial-value: 0; }
@property --pny { syntax: "<number>"; inherits: true; initial-value: 0; }
@property --pnz { syntax: "<number>"; inherits: true; initial-value: 1; }
@property --psr { syntax: "<number>"; inherits: false; initial-value: 1; }
@property --psg { syntax: "<number>"; inherits: false; initial-value: 1; }
@property --psb { syntax: "<number>"; inherits: false; initial-value: 1; }

/* Hoisted Lambert dot product — computed once per element it's set on.
   inherits:true so a bucket wrapper computes lambert ONCE for its whole
   group (one calc per bucket, not per polygon). Solo polys still set it
   themselves via the per-poly rule below. */
@property --plam { syntax: "<number>"; inherits: true; initial-value: 0; }

/* Calc-driven Lambert + tint, scoped to dynamic-lighting scenes. Lives
   here (not inline per polygon) so each <i> only carries its tiny normal
   declarations — ~12× smaller per-polygon style payload on big meshes.
   --plam is computed once and reused 3× (one per channel),
   cutting the dot-product calc count from 3 → 1 per polygon per frame. */
/* Lambert-bucket wrapper: createPolyScene groups axis-aligned polys
   sharing one face direction inside a .polycss-bucket div with the
   bucket's normal as inline CSS vars. Lambert is computed ONCE per
   bucket (inherits:true on --plam propagates the value to
   every <i> child). For voxel meshes this collapses thousands of
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

/* Per-poly lambert calc — applies to any <i> whose direct parent is NOT
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
.polycss-scene[data-polycss-lighting="dynamic"] :not(.polycss-bucket) > i {
  --plam: max(0, calc(
    var(--pnx) * var(--plx) +
    var(--pny) * var(--ply) +
    var(--pnz) * var(--plz)
  ));
}

/* All polys: containment + background-color from lambert (inherited or
   own) and the scene-level light vars. Splitting this from the lambert
   calc above lets bucketed polys skip the dot-product entirely. */
.polycss-scene[data-polycss-lighting="dynamic"] i {
  /* Isolate each <i>'s layout/style/paint walks from siblings. Works
     because the leaf transform-style:preserve-3d was dropped above —
     the 3D context lives on .polycss-scene / .polycss-mesh, not the
     leaves, so there's nothing inside an <i> that needs to participate
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

.polycss-scene[data-polycss-lighting="dynamic"] i.polycss-solid-css {
  background-color: rgb(
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
  background-blend-mode: normal;
}
`;

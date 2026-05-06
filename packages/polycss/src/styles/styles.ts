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
  backface-visibility: hidden;
  background-repeat: no-repeat;
}

/* Direction-binned face culling: scene element gets a polycss-cull-DIR
   class for each face direction pointing AWAY from the camera; the matching
   .polycss-dir-DIR elements are removed from compositing entirely (not
   just visually hidden). Recomputed on every camera update. */
.polycss-cull-px .polycss-dir-px,
.polycss-cull-nx .polycss-dir-nx,
.polycss-cull-py .polycss-dir-py,
.polycss-cull-ny .polycss-dir-ny,
.polycss-cull-pz .polycss-dir-pz,
.polycss-cull-nz .polycss-dir-nz { display: none; }

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
@property --polycss-sr { syntax: "<number>"; inherits: false; initial-value: 1; }
@property --polycss-sg { syntax: "<number>"; inherits: false; initial-value: 1; }
@property --polycss-sb { syntax: "<number>"; inherits: false; initial-value: 1; }

/* Hoisted Lambert dot product — computed once per polygon, reused for all
   three color channels. inherits:false because each <i> has its own normal. */
@property --polycss-lambert { syntax: "<number>"; inherits: false; initial-value: 0; }

/* Calc-driven Lambert + tint, scoped to dynamic-lighting scenes. Lives
   here (not inline per polygon) so each <i> only carries its tiny normal
   declarations — ~12× smaller per-polygon style payload on big meshes.
   --polycss-lambert is computed once and reused 3× (one per channel),
   cutting the dot-product calc count from 3 → 1 per polygon per frame. */
.polycss-scene[data-polycss-lighting="dynamic"] i {
  /* Isolate each <i>'s layout/style/paint walks from siblings. Works
     because the leaf transform-style:preserve-3d was dropped above —
     the 3D context lives on .polycss-scene / .polycss-mesh, not the
     leaves, so there's nothing inside an <i> that needs to participate
     in 3D compositing across the contain boundary. */
  contain: strict;
  --polycss-lambert: max(0, calc(
    var(--polycss-nx) * var(--polycss-lx) +
    var(--polycss-ny) * var(--polycss-ly) +
    var(--polycss-nz) * var(--polycss-lz)
  ));
  background-color: rgb(
    calc(255 * (var(--polycss-ar) * var(--polycss-ai)
         + var(--polycss-lr) * var(--polycss-li) * var(--polycss-lambert)))
    calc(255 * (var(--polycss-ag) * var(--polycss-ai)
         + var(--polycss-lg) * var(--polycss-li) * var(--polycss-lambert)))
    calc(255 * (var(--polycss-ab) * var(--polycss-ai)
         + var(--polycss-lb) * var(--polycss-li) * var(--polycss-lambert)))
  );
  background-blend-mode: multiply;
}

.polycss-scene[data-polycss-lighting="dynamic"] i.polycss-solid-css {
  background-color: rgb(
    calc(255 * var(--polycss-sr) * (var(--polycss-ar) * var(--polycss-ai)
         + var(--polycss-lr) * var(--polycss-li) * max(0,
           var(--polycss-nx) * var(--polycss-lx) +
           var(--polycss-ny) * var(--polycss-ly) +
           var(--polycss-nz) * var(--polycss-lz))))
    calc(255 * var(--polycss-sg) * (var(--polycss-ag) * var(--polycss-ai)
         + var(--polycss-lg) * var(--polycss-li) * max(0,
           var(--polycss-nx) * var(--polycss-lx) +
           var(--polycss-ny) * var(--polycss-ly) +
           var(--polycss-nz) * var(--polycss-lz))))
    calc(255 * var(--polycss-sb) * (var(--polycss-ab) * var(--polycss-ai)
         + var(--polycss-lb) * var(--polycss-li) * max(0,
           var(--polycss-nx) * var(--polycss-lx) +
           var(--polycss-ny) * var(--polycss-ly) +
           var(--polycss-nz) * var(--polycss-lz))))
  );
  background-blend-mode: normal;
}
`;

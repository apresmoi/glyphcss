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
`;

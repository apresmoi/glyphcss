import { STYLE_ID, OCCLUSION_DIR_BINS } from "@layoutit/voxcss-core";

export function injectBaseStyles(doc: Document): void {
  if (!doc || doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement("style");
  style.id = STYLE_ID;
  style.textContent = CORE_BASE_STYLES + buildOcclusionCullRules();
  doc.head.appendChild(style);
}

/**
 * Generate one CSS rule per camera-direction bin. The `~=` attribute selector
 * matches voxels whose `data-occluded-dirs` token list contains the bin index.
 * On rotation, the scene root toggles a single `voxcss-cull-dir-N` class —
 * pure CSS, zero React re-render, zero per-frame JS.
 *
 * Also generates "debug-show-culled" overrides: when the scene root has both
 * `voxcss-debug-show-culled` and the active `voxcss-cull-dir-N` class, we
 * override `display: none` with `block` + a red outline. Higher selector
 * specificity (2 classes on root vs 1) wins without !important.
 */
function buildOcclusionCullRules(): string {
  let css = "\n/* Camera-direction occlusion cull rules (one per direction bin). */\n";
  for (let i = 0; i < OCCLUSION_DIR_BINS; i++) {
    css += `.voxcss-cull-dir-${i} [data-occluded-dirs~="${i}"] { display: none; }\n`;
  }
  // Use a DIFFERENT color (blue) than the face-level occlusion debug (red)
  // so the two kinds of culling are visually distinguishable when both
  // overlays are showing.
  css += "\n/* Debug: when voxcss-debug-show-culled is on, render dir-culled cells\n";
  css += "   with the same orange dashed style as the triangle back-face debug,\n";
  css += "   so the unified \"show back-faces\" toggle looks consistent across\n";
  css += "   cube/ramp/wedge/spike voxels and triangle/polygon voxels. */\n";
  for (let i = 0; i < OCCLUSION_DIR_BINS; i++) {
    css +=
      `.voxcss-debug-show-culled.voxcss-cull-dir-${i} [data-occluded-dirs~="${i}"] ` +
      `{ display: block; outline: 2px dashed rgba(249, 115, 22, 0.9); outline-offset: -2px; opacity: 0.55; }\n`;
  }
  return css;
}

const CORE_BASE_STYLES = `
.voxcss-layer {
  display: grid;
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  z-index: 1;
  grid-template-columns: repeat(var(--voxcss-cols, 8), 50px);
  grid-template-rows: repeat(var(--voxcss-rows, 8), 50px);
}
.voxcss-layer > * {
  pointer-events: all;
}
.voxcss-layer:first-of-type {
  pointer-events: all;
}

.voxcss-floor-x,
.voxcss-floor-y {
  position: absolute;
  top: 0;
  left: 0;
  transform-style: preserve-3d;
  pointer-events: none;
  z-index: 1;
  transform-origin: 0 0;
}

.voxcss-floor-x {
  transform: rotateX(90deg);
}

.voxcss-floor-y {
  transform: rotateY(-90deg);
}

.voxcss-floor-z {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  transform-style: preserve-3d;
  background: var(--voxcss-floor-base, #c2c2f3);
  background-image: var(--voxcss-floor-grid-image, var(--voxcss-floor-grid, none));
  background-repeat: repeat;
  background-size: var(--voxcss-grid-x, 50px) var(--voxcss-grid-y, 50px);
  z-index: 0;
}

.voxcss-ceiling {
  position: absolute;
  inset: 0;
  transform-style: preserve-3d;
  pointer-events: none;
  background: var(--voxcss-ceiling-base, #c2c2f3);
  background-image: var(--voxcss-ceiling-grid-image, var(--voxcss-ceiling-grid, none));
  background-repeat: repeat;
  background-size: 50px 50px;
  opacity: var(--voxcss-ceiling-opacity, 0.35);
  z-index: 0;
}
  .voxcss-wall--frontRight,
.voxcss-wall--backRight {
  right: 0;
}
.voxcss-wall {
  position: absolute;
  background-image: var(--voxcss-wall-grid, none);
  background-repeat: repeat;
  background-size: 50px var(--voxcss-layer-elevation, 50px);
}
.voxcss-wall--backLeft,
.voxcss-wall--frontRight {
  background-size: var(--voxcss-layer-elevation, 50px) 50px;
}
.voxcss-brush {
  position: relative;
  inset: 0;
  display: block;
  pointer-events: none;
  overflow: visible;
  transform: translateZ(var(--vox-z, 0px));
  transform-origin: 0 0;
}
.voxcss-cube {
  position: relative;
  display: block;
  width: 100%;
  height: 100%;
  transform-style: preserve-3d;
  --voxcss-layer-half: calc(var(--voxcss-layer-elevation, 50px) / 2);
  transform: translateZ(var(--voxcss-layer-half));
}
.voxcss-projection--dimetric .voxcss-cube {
  --voxcss-layer-half: var(--voxcss-layer-elevation, 50px);
  transform: translateZ(var(--voxcss-layer-half));
}
.voxcss-cube-face,
.voxcss-plane {
  position: absolute;
  inset: 0;
  box-sizing: border-box;
  outline: 1px solid rgba(0, 0, 0, 0.08);
  outline-offset: -1px;
  pointer-events: auto;
  width: 100%;
  height: 100%;
  background-size: cover;
  overflow: visible;
}

.voxcss-cube-face--t {
  transform: translateZ(var(--voxcss-layer-half));
}
.voxcss-projection--dimetric .voxcss-cube-face--t {
  transform: translateZ(0);
}
.voxcss-cube-face--b {
  transform: translateZ(calc(-1 * var(--voxcss-layer-half)));
}
.voxcss-cube-face--fr {
  width: var(--voxcss-layer-elevation, 50px);
  transform:
    translateX(calc(var(--voxcss-side-offset-y, 25px) - var(--voxcss-layer-elevation, 50px) / 2))
    rotateY(90deg)
    translateZ(var(--voxcss-side-offset-y, 25px));
}
.voxcss-cube-face--fl {
  height: var(--voxcss-layer-elevation, 50px);
  transform:
    translateY(calc(var(--voxcss-side-offset-x, 25px) - var(--voxcss-layer-elevation, 50px) / 2))
    rotateX(90deg)
    translateZ(calc(-1 * var(--voxcss-side-offset-x, 25px)));
}
.voxcss-projection--dimetric .voxcss-cube-face--fl {
  height: var(--voxcss-layer-elevation, 50px);
  transform-origin: bottom;
  transform: rotateX(90deg) translateZ(calc(-1 * var(--voxcss-side-offset-x, 25px)));
}
.voxcss-cube-face--bl {
  width: var(--voxcss-layer-elevation, 50px);
  transform:
    translateX(calc(var(--voxcss-side-offset-y, 25px) - var(--voxcss-layer-elevation, 50px) / 2))
    rotateY(90deg)
    translateZ(calc(-1 * var(--voxcss-side-offset-y, 25px)));
}
.voxcss-projection--dimetric .voxcss-cube-face--bl {
  transform: rotateY(90deg) translateZ(0px);
  width: var(--voxcss-layer-elevation, 50px);
  transform-origin: bottom left;
}
.voxcss-cube-face--br {
  height: var(--voxcss-layer-elevation, 50px);
  transform:
    translateY(calc(var(--voxcss-side-offset-x, 25px) - var(--voxcss-layer-elevation, 50px) / 2))
    rotateX(90deg)
    translateZ(var(--voxcss-side-offset-x, 25px));
}
.voxcss-projection--dimetric .voxcss-cube-face--br {
  height: var(--voxcss-layer-elevation, 50px);
  transform-origin: bottom;
  transform: rotateX(90deg) translateZ(var(--voxcss-side-offset-x, 25px));
}
.voxcss-projection--dimetric .voxcss-cube-face--fr {
  transform: rotateY(90deg) translateZ(var(--voxcss-fr-offset, var(--voxcss-side-offset-y, 25px)));
  transform-origin: bottom left;
  width: var(--voxcss-layer-elevation, 50px);
}
.voxcss-camera {
  display: flex;
  --voxcss-layer-elevation: 50px;
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
.voxcss-camera * {
  transform-style: preserve-3d;
  position: absolute;
}

.voxcss-projection--dimetric {
  --voxcss-layer-elevation: 25px;
}

.voxcss-shape-inner {
  position: absolute;
  inset: 0;
  transform-style: preserve-3d;
  pointer-events: none;
}

.voxcss-shape-inner > * {
  position: absolute;
  inset: 0;
  transform-style: preserve-3d;
}

.voxcss-east {
  --voxcss-shape-rotation: 0deg;
}

.voxcss-south {
  --voxcss-shape-rotation: 90deg;
}

.voxcss-west {
  --voxcss-shape-rotation: 180deg;
}

.voxcss-north {
  --voxcss-shape-rotation: 270deg;
}

.voxcss-ramp .voxcss-ramp-slope,
.voxcss-ramp .voxcss-ramp-bottom,
.voxcss-wedge .voxcss-wedge-bottom,
.voxcss-spike .voxcss-spike-bottom {
  background-size: cover;
  background-repeat: no-repeat;
  background-position: center;
}
.voxcss-ramp .voxcss-ramp-slope {
  background-size: 70px 50px;
}

.voxcss-ramp .voxcss-ramp-bottom,
.voxcss-wedge .voxcss-wedge-bottom,
.voxcss-spike .voxcss-spike-bottom {
  position: absolute;
  inset: 0;
  transform-style: preserve-3d;
  pointer-events: auto;
  outline: 1px solid rgba(0, 0, 0, 0.08);
  outline-offset: -1px;
  backface-visibility: hidden;
  transform: translateZ(calc(-1 * var(--voxcss-layer-elevation, 50px)))
    rotateX(180deg);
}

.voxcss-ramp,
.voxcss-wedge,
.voxcss-spike {
  position: relative;
  transform-style: preserve-3d;
  backface-visibility: hidden;
  pointer-events: none;
  transform: translateZ(var(--voxcss-layer-elevation, 50px))
    rotate(var(--voxcss-shape-rotation, 0deg));
}

.voxcss-triangle {
  position: relative;
  transform-style: preserve-3d;
  pointer-events: none;
  /* No translateZ here — the SVG's matrix3d places vertices in absolute
     wrapper-local coords; any extra wrapper transform would offset everything. */
}

.voxcss-ramp .voxcss-ramp-slope {
  position: absolute;
  inset: 0;
  transform-style: preserve-3d;
  pointer-events: auto;
  outline: 1px solid rgba(0, 0, 0, 0.08);
  outline-offset: -1px;
  background: transparent;
  backface-visibility: hidden;
}

.voxcss-wedge .voxcss-wedge-slope,
.voxcss-spike .voxcss-spike-slope {
  position: absolute;
  inset: 0;
  transform-style: preserve-3d;
  pointer-events: auto;
  background: transparent;
  backface-visibility: hidden;
}

.voxcss-ramp {
  --voxcss-ramp-offset: 21px;
  --voxcss-ramp-angle: 45deg;
}

.voxcss-projection--dimetric .voxcss-ramp {
  --voxcss-ramp-offset: 6px;
  --voxcss-ramp-angle: 26.565deg;
}

/* Y-ramp: slope along container CSS X (= voxcss Y axis). Default behavior. */
.voxcss-ramp .voxcss-ramp-slope {
  width: calc(100% + var(--voxcss-ramp-offset, 21px));
  right: calc(-1 * var(--voxcss-ramp-offset, 21px));
  transform-origin: top left;
  transform: rotateY(var(--voxcss-ramp-angle, 45deg));
}

/* X-ramp: slope along container CSS Y (= voxcss X axis).
   Swaps width/height and uses rotateX instead of rotateY so multi-cell merged
   ramps with rot=90/270 render correctly. The parent rotation is constrained
   to 0° (east) or 180° (west) by VoxShape's orientation remapping, so the
   axis swap here doesn't fight an unexpected parent rotate. */
.voxcss-ramp.voxcss-ramp-x .voxcss-ramp-slope {
  width: 100%;
  height: calc(100% + var(--voxcss-ramp-offset, 21px));
  bottom: calc(-1 * var(--voxcss-ramp-offset, 21px));
  right: auto;
  transform-origin: top left;
  transform: rotateX(calc(-1 * var(--voxcss-ramp-angle, 45deg)));
}

.voxcss-wedge {
  --voxcss-wedge-offset: 21px;
  --voxcss-wedge-angle: 45deg;
  --voxcss-wedge-bottom-offset: 21px;
  --voxcss-wedge-secondary-angle: 45deg;
}

.voxcss-projection--dimetric .voxcss-wedge {
  --voxcss-wedge-offset: 6px;
  --voxcss-wedge-angle: 26.565deg;
  --voxcss-wedge-bottom-offset: 6px;
  --voxcss-wedge-secondary-angle: 26.565deg;
}

.voxcss-wedge .voxcss-wedge-slope--primary {
  width: calc(100% + var(--voxcss-wedge-offset, 21px));
  right: calc(-1 * var(--voxcss-wedge-offset, 21px));
  transform-origin: bottom left;
  transform: rotateY(var(--voxcss-wedge-angle, 45deg));
}

.voxcss-wedge .voxcss-wedge-slope--secondary {
  bottom: calc(-1 * var(--voxcss-wedge-bottom-offset, 21px));
  transform-origin: top left;
  transform: translateZ(calc(-1 * var(--voxcss-layer-elevation, 50px)))
    rotateX(var(--voxcss-wedge-secondary-angle, 45deg));
}

.voxcss-spike {
  --voxcss-spike-offset: 21px;
  --voxcss-spike-angle: 45deg;
  --voxcss-spike-bottom-offset: 21px;
  --voxcss-spike-secondary-angle: 45deg;
}

.voxcss-projection--dimetric .voxcss-spike {
  --voxcss-spike-offset: 6px;
  --voxcss-spike-angle: 26.565deg;
  --voxcss-spike-bottom-offset: 6px;
  --voxcss-spike-secondary-angle: 26.565deg;
}

.voxcss-spike .voxcss-spike-slope--primary {
  width: calc(100% + var(--voxcss-spike-offset, 21px));
  right: calc(-1 * var(--voxcss-spike-offset, 21px));
  transform-origin: bottom left;
  transform: rotateY(var(--voxcss-spike-angle, 45deg));
}

.voxcss-spike .voxcss-spike-slope--secondary {
  bottom: calc(-1 * var(--voxcss-spike-bottom-offset, 21px));
  transform-origin: top left;
  transform: translateZ(calc(-1 * var(--voxcss-layer-elevation, 50px)))
    rotateX(var(--voxcss-spike-secondary-angle, 45deg));
}


/* Wall mask visibility — applied via CSS classes on .voxcss-scene root.
   Camera rotation toggles these classes directly (no React re-render). */
/* Cube faces */
.voxcss-mask-t .voxcss-cube-face--t { display: none; }
.voxcss-mask-b .voxcss-cube-face--b,
.voxcss-mask-b .voxcss-ramp-bottom,
.voxcss-mask-b .voxcss-wedge-bottom,
.voxcss-mask-b .voxcss-spike-bottom { display: none; }
.voxcss-mask-bl .voxcss-cube-face--bl { display: none; }
.voxcss-mask-br .voxcss-cube-face--br { display: none; }
.voxcss-mask-fl .voxcss-cube-face--fl { display: none; }
.voxcss-mask-fr .voxcss-cube-face--fr { display: none; }

/* Slice renderer brushes */
.voxcss-mask-t .voxcss-brush--t { display: none; }
.voxcss-mask-b .voxcss-brush--b { display: none; }
.voxcss-mask-bl .voxcss-brush--bl { display: none; }
.voxcss-mask-br .voxcss-brush--br { display: none; }
.voxcss-mask-fl .voxcss-brush--fl { display: none; }
.voxcss-mask-fr .voxcss-brush--fr { display: none; }

/* Shell elements: show when mask bit is set (inverted from faces) */
/* Floor: hide background only, never display:none (it contains layers/cubes) */
.voxcss-scene:not(.voxcss-mask-b) .voxcss-floor-z { background: none !important; background-image: none !important; }
.voxcss-scene:not(.voxcss-mask-t) .voxcss-ceiling { display: none; }
.voxcss-scene:not(.voxcss-mask-bl) .voxcss-wall--backLeft { display: none; }
.voxcss-scene:not(.voxcss-mask-br) .voxcss-wall--backRight { display: none; }
.voxcss-scene:not(.voxcss-mask-fl) .voxcss-wall--frontLeft { display: none; }
.voxcss-scene:not(.voxcss-mask-fr) .voxcss-wall--frontRight { display: none; }

/* Debug: faces that would normally be occluded but are rendered to expose
   visibility-culling. Outlined in red and tinted so they're easy to spot. */
.voxcss-debug-occluded {
  outline: 2px solid rgba(255, 0, 0, 0.85);
  outline-offset: -2px;
  background-color: rgba(255, 0, 0, 0.25) !important;
  background-image: none !important;
}

/* Debug: shapes that would normally be hidden by isCovered (a voxel above
   them) — kept rendered with an orange outline so you can see they exist but
   are being culled. */
.voxcss-debug-covered {
  outline: 2px dashed rgba(255, 165, 0, 0.9);
  outline-offset: -2px;
  opacity: 0.6;
}
.voxcss-debug-covered svg path {
  fill: rgba(255, 165, 0, 0.5) !important;
}

/* Debug: when "show back-faces" is on, the slope wrappers go two-sided so
   their inner front/back render layers can both render. For Wedge/Spike the
   inner SVGs (front + back-debug) handle their own per-side culling via
   backface-visibility: hidden inside SvgSlope. For Ramp the slope is a
   plain div with a background-color, so we use ::before for the front
   color and ::after for the orange back debug overlay. */
.voxcss-debug-show-backfaces .voxcss-wedge-slope,
.voxcss-debug-show-backfaces .voxcss-spike-slope,
.voxcss-debug-show-backfaces .voxcss-ramp-slope {
  backface-visibility: visible;
}

.voxcss-debug-show-backfaces .voxcss-ramp-slope {
  /* Suppress the wrapper's own background so it doesn't paint on both sides;
     ::before below handles the front color (per-side culled). */
  background-color: transparent !important;
}
.voxcss-debug-show-backfaces .voxcss-ramp-slope::before {
  content: "";
  position: absolute;
  inset: 0;
  background-color: var(--voxcss-ramp-slope-color, #888);
  backface-visibility: hidden;
}
.voxcss-debug-show-backfaces .voxcss-ramp-slope::after {
  content: "";
  position: absolute;
  inset: 0;
  background-color: rgba(249, 115, 22, 0.55);
  outline: 2px dashed rgba(249, 115, 22, 0.9);
  outline-offset: -2px;
  /* Flip Z (normal) without mirroring X/Y — the orange ::after stays in the
     same visible position as the slope's front, just facing the opposite
     direction so backface-visibility shows it from behind. */
  transform: scale3d(1, 1, -1);
  transform-origin: center;
  backface-visibility: hidden;
}

`;

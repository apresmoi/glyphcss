import { STYLE_ID } from "@layoutit/voxcss-core";

export function injectBaseStyles(doc: Document): void {
  if (!doc || doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement("style");
  style.id = STYLE_ID;
  style.textContent = CORE_BASE_STYLES;
  doc.head.appendChild(style);
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
  transform: rotateY(90deg) translateZ(var(--voxcss-side-offset-y, 25px));
}
.voxcss-cube-face--fl {
  height: var(--voxcss-layer-elevation, 50px);
  transform: rotateX(90deg) translateZ(calc(-1 * var(--voxcss-side-offset-x, 25px)));
}
.voxcss-projection--dimetric .voxcss-cube-face--fl {
  height: var(--voxcss-layer-elevation, 50px);
  transform-origin: bottom;
  transform: rotateX(90deg) translateZ(calc(-1 * var(--voxcss-side-offset-x, 25px)));
}
.voxcss-cube-face--bl {
  width: var(--voxcss-layer-elevation, 50px);
  transform: rotateY(90deg) translateZ(calc(-1 * var(--voxcss-layer-half)));
}
.voxcss-projection--dimetric .voxcss-cube-face--bl {
  transform: rotateY(90deg) translateZ(0px);
  width: var(--voxcss-layer-elevation, 50px);
  transform-origin: bottom left;
}
.voxcss-cube-face--br {
  height: var(--voxcss-layer-elevation, 50px);
  transform: rotateX(90deg) translateZ(var(--voxcss-layer-half));
}
.voxcss-projection--dimetric .voxcss-cube-face--br {
  height: var(--voxcss-layer-elevation, 50px);
  transform-origin: bottom;
  transform: rotateX(90deg) translateZ(var(--voxcss-layer-half));
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

.voxcss-ramp .voxcss-ramp-slope {
  width: calc(100% + var(--voxcss-ramp-offset, 21px));
  right: calc(-1 * var(--voxcss-ramp-offset, 21px));
  transform-origin: top left;
  transform: rotateY(var(--voxcss-ramp-angle, 45deg));
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
.voxcss-scene:not(.voxcss-mask-b) .voxcss-floor-z { display: none; }
.voxcss-scene:not(.voxcss-mask-t) .voxcss-ceiling { display: none; }
.voxcss-scene:not(.voxcss-mask-bl) .voxcss-wall--backLeft { display: none; }
.voxcss-scene:not(.voxcss-mask-br) .voxcss-wall--backRight { display: none; }
.voxcss-scene:not(.voxcss-mask-fl) .voxcss-wall--frontLeft { display: none; }
.voxcss-scene:not(.voxcss-mask-fr) .voxcss-wall--frontRight { display: none; }
`;

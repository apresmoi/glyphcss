/* Base stylesheet injector for voxcss scenes. */
import { STYLE_ID } from "./types";

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

.voxcss-floor {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  transform-style: preserve-3d;
  background: var(--voxcss-floor-base, #c2c2f3);
  background-image:
    repeating-linear-gradient(
      to right,
      rgba(0, 0, 0, 0.2) 0,
      rgba(0, 0, 0, 0.2) 1px,
      transparent 1px,
      transparent 50px
    ),
    repeating-linear-gradient(
      to bottom,
      rgba(0, 0, 0, 0.2) 0,
      rgba(0, 0, 0, 0.2) 1px,
      transparent 1px,
      transparent 50px
    );
  z-index: 0;
}

.voxcss-ceiling {
  position: absolute;
  inset: 0;
  transform-style: preserve-3d;
  pointer-events: none;
  background: var(--voxcss-ceiling-base, #c2c2f3);
  background-image:
    repeating-linear-gradient(
      to right,
      rgba(0, 0, 0, 0.15) 0,
      rgba(0, 0, 0, 0.15) 1px,
      transparent 1px,
      transparent 50px
    ),
    repeating-linear-gradient(
      to bottom,
      rgba(0, 0, 0, 0.15) 0,
      rgba(0, 0, 0, 0.15) 1px,
      transparent 1px,
      transparent 50px
    );
  opacity: var(--voxcss-ceiling-opacity, 0.35);
  z-index: 0;
}
  .voxcss-wall--frontRight,
.voxcss-wall--backRight {
  right: 0;
}
.voxcss-wall {
  position: absolute;
  background-image: linear-gradient(
      to right,
      rgba(0, 0, 0, 0.1) 1px,
      transparent 1px
    ),
    linear-gradient(to bottom, rgba(0, 0, 0, 0.1) 1px, transparent 1px);
  background-size: 50px var(--voxcss-layer-elevation, 50px);
}
.voxcss-wall--backLeft,
.voxcss-wall--frontRight {
  background-size: var(--voxcss-layer-elevation, 50px) 50px;
}
.voxcss-cube {
  position: relative;
  display: block;
  width: 100%;
  height: 100%;
  transform-style: preserve-3d;
  transform: translateZ(25px);
}
.voxcss-cube__inner {
  position: absolute;
  inset: 0;
  transform-style: preserve-3d;
}
.voxcss-cube-face {
  position: absolute;
  inset: 0;
  box-sizing: border-box;
  outline: 1px solid rgba(0, 0, 0, 0.08);
  outline-offset: -1px;
  pointer-events: auto;
  width: 100%;
  height: 100%;
  background-size: cover;
}
.voxcss-cube-face--t {
  transform: translateZ(25px);
}
.voxcss-projection--dimetric .voxcss-cube-face--t {
  transform: translateZ(0);
}
.voxcss-cube-face--b {
  transform: translateZ(-25px);
}
.voxcss-cube-face--fr {
  transform: rotateY(90deg) translateZ(25px);
}
.voxcss-cube-face--fl {
  transform: rotateX(90deg) translateZ(-25px);
}
.voxcss-projection--dimetric .voxcss-cube-face--fl {
  height: 25px;
  transform-origin: bottom;
  transform: rotateX(90deg) translateZ(-25px);
}
.voxcss-cube-face--bl {
  transform: rotateY(90deg) translateZ(-25px);
}
.voxcss-projection--dimetric .voxcss-cube-face--bl {
  transform: rotateY(90deg) translateZ(0px);
  width: 25px;
  transform-origin: bottom left;
}
.voxcss-cube-face--br {
  transform: rotateX(90deg) translateZ(25px);
}
.voxcss-projection--dimetric .voxcss-cube-face--br {
  height: 25px;
  transform-origin: bottom;
  transform: rotateX(90deg) translateZ(25px);
}
.voxcss-projection--dimetric .voxcss-cube-face--fr {
  transform: rotateY(90deg) translateZ(50px);
  transform-origin: bottom left;
  width: 25px;
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

`;

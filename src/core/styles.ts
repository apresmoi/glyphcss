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
.voxcss-voxel {
  position: relative;
  display: block;
  width: 100%;
  height: 100%;
  pointer-events: none;
}
.voxcss-floor {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  transform-style: preserve-3d;
  background: #c2c2f3;
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
  background: #c2c2f3;
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
  opacity: 0.35;
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
  background-size: 50px 50px;
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
  outline: 1px solid rgba(0, 0, 0, 0.03);
  outline-offset: -1px;
  pointer-events: auto;
  width: 100%;
  height: 100%;
  background-size: cover;
}
.voxcss-cube-face--t {
  transform: translateZ(25px);
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
.voxcss-cube-face--bl {
  transform: rotateY(90deg) translateZ(-25px);
}
.voxcss-cube-face--br {
  transform: rotateX(90deg) translateZ(25px);
}
.voxcss-camera {
  display: flex;
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

.voxcss-dimetric-shape {
  position: absolute;
  inset: 0;
  transform-style: preserve-3d;
  backface-visibility: hidden;
  pointer-events: none;
}

.voxcss-dimetric-pointer-surface {
  pointer-events: auto;
  background: transparent;
  z-index: 10;
}

.voxcss-dimetric-flat,
.voxcss-dimetric-ramp,
.voxcss-dimetric-wedge,
.voxcss-dimetric-spike {
  transform: translateZ(var(--tile-elevation, 25px)) rotate(var(--tile-rotation, 0deg));
}

.voxcss-dimetric-inner {
  position: absolute;
  inset: 0;
  transform-style: preserve-3d;
  pointer-events: none;
}

.voxcss-dimetric-inner > *,
.voxcss-dimetric-flat > *,
.voxcss-dimetric-ramp > *,
.voxcss-dimetric-wedge > *,
.voxcss-dimetric-spike > * {
  position: absolute;
  inset: 0;
  transform-style: preserve-3d;
}

.voxcss-flat-surface {
  background: var(--voxcss-dim-surface-top, var(--voxcss-dim-color, #63c74d));
  outline: 1px solid rgba(0, 0, 0, 0.1);
  outline-offset: -1px;
}

.voxcss-ramp-slope {
  background: var(--voxcss-dim-surface-slope, var(--voxcss-dim-color, #63c74d));
  transform-origin: top left;
  width: calc(100% + 6px);
  inset: 0;
  right: -6px;
  outline: 1px solid rgba(0, 0, 0, 0.1);
  outline-offset: -1px;
  transform: rotateY(26.565deg);
}

.voxcss-spike-slope,
.voxcss-wedge-slope {
  background: transparent;
  inset: 0;
}

.voxcss-dimetric-spike .voxcss-spike-slope--secondary,
.voxcss-dimetric-wedge .voxcss-wedge-slope--secondary {
  background: var(--voxcss-dim-surface-secondary, var(--voxcss-dim-color, #63c74d));
}

.voxcss-dimetric-spike .voxcss-spike-slope--primary {
  transform-origin: bottom left;
  width: calc(100% + 6px);
  right: -6px;
  transform: rotateY(26.565deg) translateZ(0);
  background: var(--voxcss-dim-surface-primary, var(--voxcss-dim-color, #63c74d));
}

.voxcss-dimetric-wedge .voxcss-wedge-slope--primary {
  transform-origin: bottom left;
  width: calc(100% + 6px);
  right: -6px;
  transform: rotateY(26.565deg) translateZ(0);
  background: var(--voxcss-dim-surface-primary, var(--voxcss-dim-color, #63c74d));
}

.voxcss-dimetric-spike .voxcss-spike-slope--secondary {
  transform-origin: top left;
  bottom: -6px;
  transform: translateZ(calc(-1 * var(--tile-elevation, 25px))) rotateX(26.565deg);
}

.voxcss-dimetric-wedge .voxcss-wedge-slope--secondary {
  transform-origin: top left;
  bottom: -6px;
  transform: translateZ(calc(-1 * var(--tile-elevation, 25px))) rotateX(26.565deg);
}
`;

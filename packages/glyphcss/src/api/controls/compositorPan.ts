import type { Vec3 } from "@glyphcss/core";
import type { GlyphProjectionMetrics } from "../createGlyphCamera";
import type { GlyphSceneHandle } from "../createGlyphScene";

/**
 * Compositor pan: an orthographic pan is a pure translation of the picture,
 * so a pan gesture renders ONCE on a grid with a margin on every side and
 * then moves the scene element with a CSS `transform`. A frame that only
 * translates writes no `<pre>` and runs no rasterizer; the next real render
 * happens when the slide nears the margin, when anything else renders the
 * scene, or when the gesture ends. The settle render runs on the original
 * grid at the live camera, so what a gesture leaves behind is byte-identical
 * to a plain render of that pose.
 *
 * The camera is mutated by the controls exactly as without this, so `change`
 * events and every reader of the camera see the true pose throughout.
 */
export interface CompositorPan {
  /** Show the camera's current pose: a translation when one is enough, else a render. */
  render(): void;
  /** Leave the margin grid and render the live pose on the scene's own grid. No-op when idle. */
  settle(): void;
  destroy(): void;
}

/** Margin on each side, as a fraction of the grid (the same quarter `@glyphcss/maps` uses). */
const MARGIN_FRACTION = 0.25;
/**
 * Margins are whole multiples of this. The solid shader's ordered dither is
 * keyed to `(row & 3, col & 3)`, so a margin that is not would shift the
 * stipple of the whole picture when a gesture starts and again when it ends.
 */
const LATTICE_PERIOD = 4;
/** Re-anchor once the slide has used this much of the margin. */
const REFRESH_FRACTION = 0.8;
/** Projects straight to CSS pixels from the viewport centre. */
const PIXELS: GlyphProjectionMetrics = { cellWidth: 1, cellHeight: 1, centerCol: 0, centerRow: 0 };

interface Frame {
  marginX: number;
  marginY: number;
  cols: number;
  rows: number;
  autoSize: boolean;
  center: [number, number];
  sceneStyle: string;
  hostOverflow: string;
  target: Vec3;
  rotX: number;
  rotY: number;
  zoom: number;
  fovScale: number;
  mat: number[] | null;
  useMat: boolean;
}

export function createCompositorPan(scene: GlyphSceneHandle): CompositorPan {
  const host = scene.host;
  let frame: Frame | null = null;

  // Any render that is not ours (a texture arriving, an option change, an
  // orbit or zoom mid-gesture) draws the live pose into the margin grid, so
  // the frame is now anchored there: keeping the old translation would apply
  // the pan twice.
  const sceneRerender = scene.rerender;
  const wrapped = ((scheduled?: true) => {
    (sceneRerender as (scheduled?: true) => void)(scheduled);
    if (frame) anchor(frame);
  }) as GlyphSceneHandle["rerender"];
  scene.rerender = wrapped;

  function anchor(f: Frame): void {
    const camera = scene.camera;
    f.target = [...camera.target] as Vec3;
    f.rotX = camera.rotX; f.rotY = camera.rotY;
    f.zoom = camera.zoom; f.fovScale = camera.fovScale;
    f.mat = camera.mat; f.useMat = camera.useMat;
    sceneElement().style.transform = `translate(${-f.marginX}px, ${-f.marginY}px)`;
  }

  const sceneElement = (): HTMLElement => scene.output.parentElement as HTMLElement;

  function begin(): boolean {
    const camera = scene.camera;
    const o = scene.getOptions();
    // A perspective pan is not a translation, `interactiveDownscale` already
    // owns the grid for the length of a gesture, and `temporalBlend` carries
    // one grid's history into the next frame.
    if (camera.kind !== "orthographic" || (o.interactiveDownscale ?? 1) > 1 || (o.temporalBlend ?? 0) > 0) return false;
    const cols = o.cols ?? 80, rows = o.rows ?? 24;
    const output = scene.output.getBoundingClientRect();
    const cellWidth = output.width / cols, cellHeight = output.height / rows;
    if (!(cellWidth > 0) || !(cellHeight > 0)) return false; // not laid out: nothing to translate
    const margin = (cells: number): number => Math.ceil((cells * MARGIN_FRACTION) / LATTICE_PERIOD) * LATTICE_PERIOD;
    const marginCols = margin(cols), marginRows = margin(rows);
    const hostBox = host.getBoundingClientRect();
    const autoSize = o.autoSize ?? false;
    // `autoSize` centres the projection on the host, not on the grid; the
    // margin grid is not auto-sized, so that offset moves into `center`.
    const centerCol = cols * camera.center[0] + (autoSize && hostBox.width > 0 ? (hostBox.width - cols * cellWidth) / (2 * cellWidth) : 0);
    const centerRow = rows * camera.center[1] + (autoSize && hostBox.height > 0 ? (hostBox.height - rows * cellHeight) / (2 * cellHeight) : 0);
    const el = sceneElement();
    const wideCols = cols + 2 * marginCols, wideRows = rows + 2 * marginRows;
    frame = {
      marginX: marginCols * cellWidth, marginY: marginRows * cellHeight,
      cols, rows, autoSize, center: [camera.center[0], camera.center[1]],
      sceneStyle: el.style.cssText, hostOverflow: host.style.overflow,
      target: [0, 0, 0], rotX: 0, rotY: 0, zoom: 0, fovScale: 0, mat: null, useMat: false,
    };
    camera.center = [(centerCol + marginCols) / wideCols, (centerRow + marginRows) / wideRows];
    host.style.overflow = "hidden";
    el.style.width = `${wideCols * cellWidth}px`;
    el.style.height = `${wideRows * cellHeight}px`;
    el.style.willChange = "transform";
    scene.setOptions({ cols: wideCols, rows: wideRows, autoSize: false });
    scene.rerender();
    return true;
  }

  function render(): void {
    const f = frame;
    if (!f) {
      if (!begin()) scene.rerender();
      return;
    }
    const camera = scene.camera;
    const samePose = camera.kind === "orthographic" && camera.rotX === f.rotX && camera.rotY === f.rotY
      && camera.zoom === f.zoom && camera.fovScale === f.fovScale && camera.useMat === f.useMat
      && (!camera.useMat || camera.mat === f.mat);
    if (samePose) {
      // Where the anchor render's centre point sits now, in CSS pixels.
      const p = camera.project(f.target, 0, 0, 1, PIXELS);
      if (Math.abs(p[0]) <= f.marginX * REFRESH_FRACTION && Math.abs(p[1]) <= f.marginY * REFRESH_FRACTION) {
        sceneElement().style.transform = `translate(${p[0] - f.marginX}px, ${p[1] - f.marginY}px)`;
        return;
      }
    }
    scene.rerender();
  }

  function settle(): void {
    const f = frame;
    if (!f) return;
    frame = null;
    scene.camera.center = f.center;
    sceneElement().style.cssText = f.sceneStyle;
    host.style.overflow = f.hostOverflow;
    scene.setOptions({ cols: f.cols, rows: f.rows, autoSize: f.autoSize });
    scene.rerender();
  }

  return {
    render,
    settle,
    destroy(): void {
      settle();
      if (scene.rerender === wrapped) scene.rerender = sceneRerender;
    },
  };
}

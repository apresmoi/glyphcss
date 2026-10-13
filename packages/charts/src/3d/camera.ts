/**
 * A pure camera-fitting helper for `GlyphSceneObject` bounds (PLAN-3d.md
 * §11's C2 row, "auto-fit the zoom to the object's bounds so the whole
 * surface, all three axes and their labels are on-screen at the default
 * camera"). `renderGlyphChart3d` is ITS OWN caller — the static-frame exit
 * needs a legible default framing with no explicit camera — but the
 * function takes only a `bounds` (any `GlyphSceneObject.bounds`) and a
 * viewport shape, so ANY scene consumer mounting a chart object (or any
 * other object) can reach for the identical math rather than re-deriving it
 * (P1-4: the default showcase framing — `zoom: 0.65`, an untransformed
 * object — used to render one lonely tick mark and no surface at all;
 * `object.test.ts`'s own mounted-scene gate dodges this with `zoom: 24` and
 * a 20x mesh scale, which is a REAL scene's own escape hatch, not a fix).
 *
 * Uses the REAL `glyphcss` orthographic camera's own `project()` (never a
 * re-derived rotation formula) at a reference `zoom: 1`, so the fitted zoom
 * is exact for whatever the real renderer will do with it — including a
 * `useMat`/trackball rotation, which this function honours transparently by
 * accepting a `mat`/`useMat` pair instead of `rotX`/`rotY`.
 */
import { createGlyphOrthographicCamera } from "glyphcss";
import type { Vec3 } from "glyphcss";

export interface GlyphChart3dBounds {
  readonly min: Vec3;
  readonly max: Vec3;
}

export interface GlyphChart3dFitCameraOptions {
  readonly bounds: GlyphChart3dBounds;
  /** Euler rotation, degrees — ignored when `useMat` is `true`. */
  readonly rotX?: number;
  readonly rotY?: number;
  /** A 9-element row-major 3x3 rotation matrix (trackball path). */
  readonly mat?: number[];
  readonly useMat?: boolean;
  readonly cols: number;
  readonly rows: number;
  /**
   * Fix round 4 (coordinator root-cause finding): `glyphcss`'s OWN
   * `cellHeight / cellWidth` convention — the exact INVERSE of this
   * package's own public `cellAspect` (`cellWidth / cellHeight`,
   * `GLYPH_CHART_TARGET_DEFAULTS.web.cellAspect = 0.5859375`). This
   * function calls straight into `createGlyphOrthographicCamera().project()`,
   * so it needs the SAME value a live scene's own `createGlyphScene({
   * cellAspect })`/`scene.getOptions().cellAspect` already uses (`/charts`'
   * own live viewport — this function's real caller — passes exactly that,
   * `Charts3dViewport.tsx`'s `SCENE_DEFAULT_CELL_ASPECT = 2.0`) — NEVER
   * this package's own public option verbatim, which squashed every fit by
   * `(1/0.586)/0.586 ≈ 2.9x` before this fix (`render.ts`'s
   * `renderObjectFrame` doc has the full derivation).
   */
  readonly sceneCellAspect: number;
  /**
   * Extra outward allowance, as a fraction of each axis's own extent, for
   * what the box's own overlay pushes OUTSIDE its geometric bounds — tick
   * marks, tick labels and axis titles (`object.ts`'s own
   * `AXIS_TICK_LABEL_CELLS`/`AXIS_TITLE_MARGIN` push-out, plus slack for the label TEXT's own
   * width/height, which this function has no glyph metrics to measure
   * exactly). Default `0.65` (C2 fix round 8: raised from `0.45`, which sat
   * BELOW `object.ts`'s own real `AXIS_TITLE_MARGIN` of `0.6` — at some
   * rotations, including round 8's own new default `rotY: 235`, the title
   * push-out this cheap pre-fit reserves for was smaller than the push-out
   * the real overlay actually applies, and a title's own row could clip
   * off the fitted viewport entirely. `0.65` clears the real `0.6` with a
   * small margin; this function stays an approximate, camera-agnostic
   * pre-fit, never a promise as exact as `render.ts`'s own closed-form
   * `fitStaticCamera`, which reads the real label anchors directly).
   */
  readonly margin?: number;
  /**
   * Fraction of the viewport's own half-extent actually used, leaving the
   * rest as breathing room so a fitted label's own text doesn't touch the
   * frame edge. Default `0.92`.
   */
  readonly safety?: number;
}

export interface GlyphChart3dFitCameraResult {
  readonly target: Vec3;
  readonly zoom: number;
}

const DEFAULT_MARGIN = 0.65;
const DEFAULT_SAFETY = 0.92;

function boundsCenter(bounds: GlyphChart3dBounds): Vec3 {
  return [
    (bounds.min[0] + bounds.max[0]) / 2,
    (bounds.min[1] + bounds.max[1]) / 2,
    (bounds.min[2] + bounds.max[2]) / 2,
  ];
}

/**
 * Fits an orthographic camera's `target`/`zoom` to `bounds` at the given
 * rotation and viewport shape: probes the 8 AABB corners (each pushed
 * outward by `margin`) through a reference `zoom: 1` camera and picks the
 * largest zoom that keeps every probed corner within `safety` of the
 * viewport's own half-extent, in both columns and rows.
 */
export function glyphChart3dFitCamera(options: GlyphChart3dFitCameraOptions): GlyphChart3dFitCameraResult {
  const { bounds, cols, rows, sceneCellAspect } = options;
  const margin = options.margin ?? DEFAULT_MARGIN;
  const safety = options.safety ?? DEFAULT_SAFETY;
  const center = boundsCenter(bounds);
  const halfExtent: Vec3 = [
    ((bounds.max[0] - bounds.min[0]) / 2) * (1 + margin),
    ((bounds.max[1] - bounds.min[1]) / 2) * (1 + margin),
    ((bounds.max[2] - bounds.min[2]) / 2) * (1 + margin),
  ];

  const probe = createGlyphOrthographicCamera({
    rotX: options.rotX,
    rotY: options.rotY,
    zoom: 1,
    ...(options.mat ? { mat: options.mat, useMat: options.useMat ?? true } : {}),
  });
  probe.target = center;

  let maxAbsCol = 0, maxAbsRow = 0;
  const centerCol = cols / 2, centerRow = rows / 2;
  for (const sx of [-1, 1] as const) {
    for (const sy of [-1, 1] as const) {
      for (const sz of [-1, 1] as const) {
        const p: Vec3 = [
          center[0] + sx * halfExtent[0],
          center[1] + sy * halfExtent[1],
          center[2] + sz * halfExtent[2],
        ];
        const [col, row] = probe.project(p, cols, rows, sceneCellAspect);
        maxAbsCol = Math.max(maxAbsCol, Math.abs(col - centerCol));
        maxAbsRow = Math.max(maxAbsRow, Math.abs(row - centerRow));
      }
    }
  }

  const availCol = centerCol * safety;
  const availRow = centerRow * safety;
  const zoomCol = maxAbsCol > 0 ? availCol / maxAbsCol : Number.POSITIVE_INFINITY;
  const zoomRow = maxAbsRow > 0 ? availRow / maxAbsRow : Number.POSITIVE_INFINITY;
  const zoom = Math.min(zoomCol, zoomRow);
  return { target: center, zoom: Number.isFinite(zoom) && zoom > 0 ? zoom : 1 };
}

/**
 * The default 3D chart camera: `rotX` is `90 - elevation` (90 is side-on),
 * so 69 is a low ~21 degree eye, turned to 318 so the origin corner sits
 * on the left. Picked by eye on Maunga Whau. At this yaw the far axis
 * lines can run behind tall terrain; the low eye keeps a height-field's
 * own relief readable, which matters more.
 */
export const GLYPH_CHART_3D_DEFAULT_CAMERA = { rotX: 69, rotY: 318 } as const;

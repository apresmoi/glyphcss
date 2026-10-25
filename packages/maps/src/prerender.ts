import type { GlyphCamera, Vec3 } from "glyphcss";

/**
 * Everything `camera.project` and `camera.eyeDepth` read from the camera, by
 * value. A pose is what a prepared stroke plan or outline surface is computed
 * AT: preparation runs over several frames while the live camera has moved on,
 * so each slice installs the pose, works, and puts the live one back.
 *
 * `kind`, `project` and `eyeDepth` are not here: they are fixed by the camera
 * object and are part of {@link cameraKey} instead, which is what makes a plan
 * built against another camera object unusable.
 */
export interface GlyphMapCameraPose {
  readonly rotX: number;
  readonly rotY: number;
  readonly center: readonly [number, number];
  readonly mat: readonly number[] | null;
  readonly useMat: boolean;
  readonly distance: number;
  readonly perspective: number;
  readonly zoom: number;
  readonly stretch: number;
  readonly fovScale: number;
  readonly target: Readonly<Vec3>;
  readonly eyeMode: boolean;
}

/** Copies the arrays: the live camera may mutate or replace its own later. */
export function snapshotCameraPose(camera: GlyphCamera): GlyphMapCameraPose {
  return {
    rotX: camera.rotX, rotY: camera.rotY, center: [camera.center[0], camera.center[1]],
    mat: camera.mat ? camera.mat.slice() : null, useMat: camera.useMat,
    distance: camera.distance, perspective: camera.perspective, zoom: camera.zoom,
    stretch: camera.stretch, fovScale: camera.fovScale,
    target: [camera.target[0], camera.target[1], camera.target[2]], eyeMode: camera.eyeMode,
  };
}

/** Poses compare field by field; `ignoreCenter` for a rest pose, whose centre is the hypothetical overscanned frame's. */
export function sameCameraPose(a: GlyphMapCameraPose, b: GlyphMapCameraPose, ignoreCenter = false): boolean {
  const list = (p: GlyphMapCameraPose): unknown[] => [p.rotX, p.rotY, ...(ignoreCenter ? [] : p.center), p.useMat, p.mat?.length ?? -1,
    ...(p.mat ?? []), p.distance, p.perspective, p.zoom, p.stretch, p.fovScale, ...p.target, p.eyeMode];
  return sameKey(list(a), list(b));
}

/** Installs `pose` for the duration of `fn` and restores the exact live values, references included, in `finally`. */
export function withCameraPose<T>(camera: GlyphCamera, pose: GlyphMapCameraPose, fn: () => T): T {
  const { rotX, rotY, center, mat, useMat, distance, perspective, zoom, stretch, fovScale, target, eyeMode } = camera;
  camera.rotX = pose.rotX; camera.rotY = pose.rotY; camera.center = [pose.center[0], pose.center[1]];
  camera.mat = pose.mat ? pose.mat.slice() : null; camera.useMat = pose.useMat;
  camera.distance = pose.distance; camera.perspective = pose.perspective; camera.zoom = pose.zoom;
  camera.stretch = pose.stretch; camera.fovScale = pose.fovScale;
  camera.target = [pose.target[0], pose.target[1], pose.target[2]]; camera.eyeMode = pose.eyeMode;
  try {
    return fn();
  } finally {
    camera.rotX = rotX; camera.rotY = rotY; camera.center = center; camera.mat = mat; camera.useMat = useMat;
    camera.distance = distance; camera.perspective = perspective; camera.zoom = zoom;
    camera.stretch = stretch; camera.fovScale = fovScale; camera.target = target; camera.eyeMode = eyeMode;
  }
}

/** The camera's whole projection state as a flat comparable list (see {@link sameKey}). */
export function cameraKey(camera: GlyphCamera): unknown[] {
  return [camera, camera.kind, camera.project, camera.eyeDepth, camera.rotX, camera.rotY, camera.center[0], camera.center[1],
    camera.useMat, camera.mat?.length ?? -1, ...(camera.mat ?? []), camera.distance, camera.perspective, camera.zoom,
    camera.stretch, camera.fovScale, camera.target[0], camera.target[1], camera.target[2], camera.eyeMode];
}

/** Exact equality, element by element: a prepared result is reusable only on this, never on "close enough". */
export function sameKey(a: readonly unknown[], b: readonly unknown[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (!Object.is(a[i], b[i])) return false;
  return true;
}

/**
 * Scheduling knobs for pre-rendering, a module value so a test can make a
 * slice unbounded (and so deterministic) without a public option.
 */
export const glyphMapPrerenderTuning = {
  /** Main-thread budget for one preparation slice inside a motion frame, which also has a render and input to serve. */
  sliceMs: 4,
  /** The same for a slice of idle time at rest, capped further by the browser's idle deadline. */
  restSliceMs: 8,
  /** Share of the compositor margin (or of the drift allowance) at which a pan starts preparing its next anchor. */
  startFraction: 0.375,
  /** Prepare the compositor frame at rest, in idle time, so a drag's first frame reuses it. */
  restPrepare: true,
};

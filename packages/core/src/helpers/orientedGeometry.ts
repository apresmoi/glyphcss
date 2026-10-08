/**
 * Oriented "sweep a thin box/pyramid between two 3D points" primitives —
 * lifted out of `@glyphcss/diagrams/3d`'s `glyphDiagramObject.ts` (D2 round
 * 7: "edges and arrowheads are real MESH GEOMETRY... never a stamped
 * box-drawing/bar glyph, which staircases the instant the segment it traces
 * isn't screen-axis-aligned") into core so a second caller — `@glyphcss/charts/3d`'s
 * axis-triad lines (C2 fix round 7, "axes from one origin corner") — draws
 * the identical smooth-at-any-angle line/arrowhead geometry with no
 * duplicated math. Pure: no `Glyph` prefix (the same naming exception
 * `boxPolygons`/`gridSurfacePolygons` take, AGENTS.md's "Naming").
 */
import type { Polygon, Vec3 } from "../types";

function normalizeVec3(v: Vec3): Vec3 {
  const len = Math.hypot(v[0], v[1], v[2]);
  if (len === 0) return [0, 0, 1];
  return [v[0] / len, v[1] / len, v[2] / len];
}

function crossVec3(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

/**
 * A stable camera-style orthonormal frame from a forward direction:
 * `right = normalize(cross(worldUp, forward))`, `up = cross(forward, right)`
 * — the standard "look-at" construction, chosen because it gives
 * `cross(right, up) === forward` EXACTLY (proof: `cross(right, cross(forward,
 * right)) = forward*(right.right) - right*(right.forward) = forward`, since
 * `right` is unit length and already perpendicular to `forward`), which is
 * what keeps a ribbon/pyramid built from it winding CCW-from-outside in
 * `boxPolygons`'s own convention (`X=right, Y=up, Z=forward` there).
 * `worldUp` swaps to avoid the degenerate case where `forward` is nearly
 * parallel to the usual Z reference.
 */
export function frameFromForward(forward: Vec3): { readonly right: Vec3; readonly up: Vec3 } {
  const worldUp: Vec3 = Math.abs(forward[2]) > 0.9 ? [1, 0, 0] : [0, 0, 1];
  const right = normalizeVec3(crossVec3(worldUp, forward));
  const up = crossVec3(forward, right);
  return { right, up };
}

/**
 * A thin oriented box swept from `a` to `b` — an edge's own ribbon segment,
 * a group's own outline edge, or (`@glyphcss/charts/3d`) an axis-triad
 * line. Mirrors `boxPolygons`'s exact face/winding table (X=right axis,
 * Y=up axis, Z=forward here) with the "top"/"bottom" caps at `b`/`a`
 * respectively. Degenerates to zero-area faces (never thrown) when
 * `a === b`; a caller building from real, distinct endpoints never hits
 * this.
 */
export function orientedRibbonPolygons(a: Vec3, b: Vec3, halfWidth: number, color: string): Polygon[] {
  const forward = normalizeVec3([b[0] - a[0], b[1] - a[1], b[2] - a[2]]);
  const { right, up } = frameFromForward(forward);
  const at = (base: Vec3, sr: number, su: number): Vec3 => [
    base[0] + right[0] * sr * halfWidth + up[0] * su * halfWidth,
    base[1] + right[1] * sr * halfWidth + up[1] * su * halfWidth,
    base[2] + right[2] * sr * halfWidth + up[2] * su * halfWidth,
  ];
  const v0 = at(a, -1, -1), v1 = at(a, 1, -1), v2 = at(a, 1, 1), v3 = at(a, -1, 1);
  const v4 = at(b, -1, -1), v5 = at(b, 1, -1), v6 = at(b, 1, 1), v7 = at(b, -1, 1);
  const faces: readonly (readonly [Vec3, Vec3, Vec3, Vec3])[] = [
    [v4, v5, v6, v7], // +forward (b) cap
    [v1, v0, v3, v2], // -forward (a) cap
    [v5, v1, v2, v6], // +right side
    [v0, v4, v7, v3], // -right side
    [v7, v6, v2, v3], // +up side
    [v0, v1, v5, v4], // -up side
  ];
  return faces.map((vertices) => ({ vertices: [...vertices], color }));
}

/**
 * A pyramid with its APEX at `tip` (a face point on the target, "pointing
 * into" it) and a square base pulled back toward `source` by `length` — an
 * edge's own arrowhead. Same frame/winding discipline as
 * `orientedRibbonPolygons`; each side quad DEGENERATES to a triangle since
 * the "top" cap collapses to one point.
 */
export function orientedPyramidPolygons(source: Vec3, tip: Vec3, halfWidth: number, length: number, color: string): Polygon[] {
  const forward = normalizeVec3([tip[0] - source[0], tip[1] - source[1], tip[2] - source[2]]);
  const { right, up } = frameFromForward(forward);
  const base: Vec3 = [tip[0] - forward[0] * length, tip[1] - forward[1] * length, tip[2] - forward[2] * length];
  const at = (sr: number, su: number): Vec3 => [
    base[0] + right[0] * sr * halfWidth + up[0] * su * halfWidth,
    base[1] + right[1] * sr * halfWidth + up[1] * su * halfWidth,
    base[2] + right[2] * sr * halfWidth + up[2] * su * halfWidth,
  ];
  const b0 = at(-1, -1), b1 = at(1, -1), b2 = at(1, 1), b3 = at(-1, 1);
  return [
    { vertices: [b1, b0, b3, b2], color }, // base cap (-forward, viewed from outside)
    { vertices: [tip, b1, b2], color }, // +right side
    { vertices: [b0, tip, b3], color }, // -right side
    { vertices: [tip, b2, b3], color }, // +up side
    { vertices: [b0, b1, tip], color }, // -up side
  ];
}

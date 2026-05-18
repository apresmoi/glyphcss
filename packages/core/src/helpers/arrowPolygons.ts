/**
 * Geometry for a single 3D arrow: a thin axis-aligned cuboid shaft
 * stretching from the origin along one signed axis, capped with a
 * 4-sided pyramid head pointing further in that direction. Used as the
 * drag handle for `<TransformControls>` — same primitive recipe as
 * `axesHelperPolygons`, plus an arrowhead.
 *
 * Returned polygons are in standard glyphcss world space and intended
 * to be wrapped in the framework's PolyMesh equivalent for rendering.
 */
import type { Polygon, Vec3 } from "../types";

export interface ArrowPolygonsOptions {
  /** World axis the arrow extends along: 0=X, 1=Y, 2=Z. */
  axis: 0 | 1 | 2;
  /** Direction along the axis: +1 (positive) or -1 (negative). Default +1. */
  sign?: 1 | -1;
  /** Length of the rectangular shaft along the axis. */
  shaftLength?: number;
  /** Half cross-section of the shaft (perpendicular to the axis). */
  shaftHalfThickness?: number;
  /** Length of the pyramid head along the axis (extends past the shaft). */
  headLength?: number;
  /** Half-extent of the pyramid base. */
  headHalfThickness?: number;
  /** Fill color. */
  color?: string;
  /** Emit the rectangular shaft polygons. Default `true`. Set `false` to
   *  render just the pyramid head — used by transform-control gizmos to
   *  declutter back-facing axes (only the head still identifies direction
   *  while the shaft would visually overlap the front-facing arrow). */
  shaft?: boolean;
}

function makeAxisVec(axis: 0 | 1 | 2, along: number, sideA: number, sideB: number): Vec3 {
  const v: Vec3 = [0, 0, 0];
  v[axis] = along;
  v[(axis + 1) % 3] = sideA;
  v[(axis + 2) % 3] = sideB;
  return v;
}

function shaftPolygons(
  axis: 0 | 1 | 2,
  from: number,
  to: number,
  half: number,
  color: string,
): Polygon[] {
  const m = (along: number, sideA: number, sideB: number): Vec3 =>
    makeAxisVec(axis, along, sideA, sideB);
  // Vertex layout matches axesHelperPolygons' axisBox: 4 corners at
  // each end of the box, 6 quad faces. Same winding so the cuboid
  // renders front-faces-out under glyphcss's backface-visibility:hidden.
  const c0 = m(from, -half, -half);
  const c1 = m(from,  half, -half);
  const c2 = m(from,  half,  half);
  const c3 = m(from, -half,  half);
  const c4 = m(to,   -half, -half);
  const c5 = m(to,    half, -half);
  const c6 = m(to,    half,  half);
  const c7 = m(to,   -half,  half);
  return [
    { vertices: [c0, c1, c2, c3], color },
    { vertices: [c4, c5, c6, c7], color },
    { vertices: [c0, c1, c5, c4], color },
    { vertices: [c1, c2, c6, c5], color },
    { vertices: [c2, c3, c7, c6], color },
    { vertices: [c3, c0, c4, c7], color },
  ];
}

function pyramidPolygons(
  axis: 0 | 1 | 2,
  baseAt: number,
  apexAt: number,
  halfBase: number,
  color: string,
): Polygon[] {
  const m = (along: number, sideA: number, sideB: number): Vec3 =>
    makeAxisVec(axis, along, sideA, sideB);
  const b0 = m(baseAt, -halfBase, -halfBase);
  const b1 = m(baseAt,  halfBase, -halfBase);
  const b2 = m(baseAt,  halfBase,  halfBase);
  const b3 = m(baseAt, -halfBase,  halfBase);
  const apex = m(apexAt, 0, 0);
  return [
    { vertices: [b0, b1, b2, b3], color },
    { vertices: [b0, b1, apex], color },
    { vertices: [b1, b2, apex], color },
    { vertices: [b2, b3, apex], color },
    { vertices: [b3, b0, apex], color },
  ];
}

/** Reverse vertex winding on every polygon. Used to keep face normals
 *  pointing outward when the arrow points along the -axis: the
 *  vertex layout in `pyramidPolygons` assumes apex-at-+axis ordering;
 *  for sign=-1 the apex sits at lower axis-coord than the base, which
 *  inverts every cross-product unless we mirror the winding too. */
function reverseWinding(polygons: Polygon[]): Polygon[] {
  return polygons.map((p) => ({ ...p, vertices: [...p.vertices].reverse() }));
}

/** Build the polygons for one signed-axis arrow. */
export function arrowPolygons(options: ArrowPolygonsOptions): Polygon[] {
  const axis = options.axis;
  const sign = options.sign ?? 1;
  const shaftLength = options.shaftLength ?? 4;
  const shaftHalf = options.shaftHalfThickness ?? 0.05;
  const headLength = options.headLength ?? 0.8;
  const headHalf = options.headHalfThickness ?? 0.2;
  const color = options.color ?? "#ffffff";
  const includeShaft = options.shaft ?? true;

  // Shaft spans from origin to ±shaftLength along the axis. Use min/max
  // so the cuboid is built with from < to (axisBox convention) — the
  // box itself is symmetric, sign only matters for the head's apex.
  const shaftEnd = shaftLength * sign;
  const shaftMin = Math.min(0, shaftEnd);
  const shaftMax = Math.max(0, shaftEnd);
  // Head sits past the far end of the shaft, apex pointing outward.
  const headBase = shaftEnd;
  const headApex = (shaftLength + headLength) * sign;

  const head = pyramidPolygons(axis, headBase, headApex, headHalf, color);
  const headPolys = sign === -1 ? reverseWinding(head) : head;
  if (!includeShaft) return headPolys;
  return [
    ...shaftPolygons(axis, shaftMin, shaftMax, shaftHalf, color),
    ...headPolys,
  ];
}

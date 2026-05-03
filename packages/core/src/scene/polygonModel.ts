/**
 * Polygon model — translates a voxel into the list of 3D polygons that make
 * up its rendered surface in voxcss. Used by:
 *   - The canvas validator (visually compare against voxcss render)
 *   - The manifold gap check (count edges to verify the surface is closed)
 *
 * Each polygon's vertices are in world voxel coords and ordered CCW from
 * the OUTSIDE of the shape (i.e., the face's outward normal direction).
 */
import type { Voxel, Vec3 } from "../types";

export interface Polygon {
  v: Vec3[];
  voxelKey: string;
  face: string;
  color?: string;
}

function key(v: Voxel): string {
  return `${v.x}:${v.y}:${v.z}`;
}

function bounds(v: Voxel) {
  return {
    x: v.x, y: v.y, z: v.z,
    x2: v.x2 ?? v.x + 1,
    y2: v.y2 ?? v.y + 1,
    z2: v.z2 ?? v.z + 1,
  };
}

function cubePolys(v: Voxel): Polygon[] {
  const { x, y, z, x2, y2, z2 } = bounds(v);
  const k = key(v);
  return [
    { v: [[x, y, z2], [x2, y, z2], [x2, y2, z2], [x, y2, z2]], voxelKey: k, color: v.color, face: "top" },
    { v: [[x, y2, z], [x2, y2, z], [x2, y, z], [x, y, z]], voxelKey: k, color: v.color, face: "bot" },
    { v: [[x2, y, z], [x2, y2, z], [x2, y2, z2], [x2, y, z2]], voxelKey: k, color: v.color, face: "+x" },
    { v: [[x, y2, z], [x, y, z], [x, y, z2], [x, y2, z2]], voxelKey: k, color: v.color, face: "-x" },
    { v: [[x2, y2, z], [x, y2, z], [x, y2, z2], [x2, y2, z2]], voxelKey: k, color: v.color, face: "+y" },
    { v: [[x, y, z], [x2, y, z], [x2, y, z2], [x, y, z2]], voxelKey: k, color: v.color, face: "-y" },
  ];
}

function rampPolys(v: Voxel): Polygon[] {
  const { x, y, z, x2, y2, z2 } = bounds(v);
  const k = key(v);
  const rot = v.rot ?? 0;
  let highEdgeA: Vec3, highEdgeB: Vec3;
  let lowEdgeA: Vec3, lowEdgeB: Vec3;
  let highWall: Vec3[];
  let triA: Vec3[];
  let triB: Vec3[];
  if (rot === 0) {
    highEdgeA = [x, y, z2]; highEdgeB = [x2, y, z2];
    lowEdgeA = [x, y2, z];  lowEdgeB = [x2, y2, z];
    highWall = [[x, y, z], [x2, y, z], [x2, y, z2], [x, y, z2]];
    triA = [[x, y, z], [x, y, z2], [x, y2, z]];
    triB = [[x2, y, z], [x2, y2, z], [x2, y, z2]];
  } else if (rot === 90) {
    highEdgeA = [x, y, z2]; highEdgeB = [x, y2, z2];
    lowEdgeA = [x2, y, z];  lowEdgeB = [x2, y2, z];
    highWall = [[x, y, z], [x, y, z2], [x, y2, z2], [x, y2, z]];
    triA = [[x, y, z], [x2, y, z], [x, y, z2]];
    triB = [[x, y2, z], [x, y2, z2], [x2, y2, z]];
  } else if (rot === 180) {
    highEdgeA = [x, y2, z2]; highEdgeB = [x2, y2, z2];
    lowEdgeA = [x, y, z];    lowEdgeB = [x2, y, z];
    highWall = [[x, y2, z], [x, y2, z2], [x2, y2, z2], [x2, y2, z]];
    triA = [[x, y, z], [x, y2, z], [x, y2, z2]];
    triB = [[x2, y, z], [x2, y2, z2], [x2, y2, z]];
  } else {
    highEdgeA = [x2, y, z2]; highEdgeB = [x2, y2, z2];
    lowEdgeA = [x, y, z];    lowEdgeB = [x, y2, z];
    highWall = [[x2, y, z], [x2, y2, z], [x2, y2, z2], [x2, y, z2]];
    triA = [[x, y, z], [x2, y, z], [x2, y, z2]];
    triB = [[x, y2, z], [x2, y2, z2], [x2, y2, z]];
  }
  const slope: Vec3[] = [highEdgeA, highEdgeB, lowEdgeB, lowEdgeA];
  const bot: Vec3[] = [[x, y, z], [x, y2, z], [x2, y2, z], [x2, y, z]];
  return [
    { v: slope, voxelKey: k, color: v.color, face: "slope" },
    { v: bot, voxelKey: k, color: v.color, face: "bot" },
    { v: highWall, voxelKey: k, color: v.color, face: "wall" },
    { v: triA, voxelKey: k, color: v.color, face: "tri-a" },
    { v: triB, voxelKey: k, color: v.color, face: "tri-b" },
  ];
}

/**
 * Wedge geometry — best-effort match for voxcss's CSS wedge renderer.
 *
 * A wedge is a corner pyramid: one "high corner" lifted to z2, with two
 * sloped triangle faces meeting at that corner and a square floor below.
 * Unlike a spike (4 slopes meeting at apex), a wedge has only 2 slopes
 * because the other two sides of the corner are bounded by the two
 * vertical walls of the cell that the wedge sits against.
 *
 * High corner per rotation:
 *   rot=0   → (x2, y,  z2)   (peak at +x, -y, top)
 *   rot=90  → (x,  y,  z2)
 *   rot=180 → (x,  y2, z2)
 *   rot=270 → (x2, y2, z2)
 *
 * Slopes connect the high corner to the two diagonally-opposite floor
 * corners (the two NOT adjacent in the bbox); the two adjacent floor
 * corners are below the wedge's two vertical walls.
 */
function wedgePolys(v: Voxel): Polygon[] {
  const { x, y, z, x2, y2, z2 } = bounds(v);
  const k = key(v);
  const rot = v.rot ?? 0;
  let apex: Vec3;
  let wallA1: Vec3, wallA2: Vec3;   // base corners of the two vertical walls
  let lowFar: Vec3;                 // floor corner diagonally opposite the apex base
  if (rot === 0) {
    apex = [x2, y, z2];
    wallA1 = [x2, y2, z]; wallA2 = [x, y, z];
    lowFar = [x, y2, z];
  } else if (rot === 90) {
    apex = [x, y, z2];
    wallA1 = [x, y2, z]; wallA2 = [x2, y, z];
    lowFar = [x2, y2, z];
  } else if (rot === 180) {
    apex = [x, y2, z2];
    wallA1 = [x, y, z]; wallA2 = [x2, y2, z];
    lowFar = [x2, y, z];
  } else {
    apex = [x2, y2, z2];
    wallA1 = [x2, y, z]; wallA2 = [x, y2, z];
    lowFar = [x, y, z];
  }
  const apexBase: Vec3 = [apex[0], apex[1], z];
  const bot: Vec3[] = [[x, y, z], [x, y2, z], [x2, y2, z], [x2, y, z]];
  return [
    { v: bot, voxelKey: k, color: v.color, face: "bot" },
    // Two sloped triangle faces meeting at the apex.
    { v: [apex, wallA1, lowFar], voxelKey: k, color: v.color, face: "slope-a" },
    { v: [apex, lowFar, wallA2], voxelKey: k, color: v.color, face: "slope-b" },
    // Two vertical wall triangles bounding the two non-sloped sides.
    { v: [apex, apexBase, wallA1], voxelKey: k, color: v.color, face: "wall-a" },
    { v: [apex, wallA2, apexBase], voxelKey: k, color: v.color, face: "wall-b" },
  ];
}

function spikePolys(v: Voxel): Polygon[] {
  const { x, y, z, x2, y2, z2 } = bounds(v);
  const k = key(v);
  const rot = v.rot ?? 0;
  let apex: Vec3;
  if (rot === 0) apex = [x2, y, z2];
  else if (rot === 90) apex = [x, y, z2];
  else if (rot === 180) apex = [x, y2, z2];
  else apex = [x2, y2, z2];
  const B1: Vec3 = [x, y, z];
  const B2: Vec3 = [x2, y, z];
  const B3: Vec3 = [x2, y2, z];
  const B4: Vec3 = [x, y2, z];
  return [
    { v: [B1, B4, B3, B2], voxelKey: k, color: v.color, face: "bot" },
    { v: [apex, B1, B2], voxelKey: k, color: v.color, face: "t-yneg" },
    { v: [apex, B2, B3], voxelKey: k, color: v.color, face: "t-xpos" },
    { v: [apex, B3, B4], voxelKey: k, color: v.color, face: "t-ypos" },
    { v: [apex, B4, B1], voxelKey: k, color: v.color, face: "t-xneg" },
  ];
}

function trianglePolys(v: Voxel): Polygon[] {
  if (!v.vertices) return [];
  const [a, b, c] = v.vertices;
  return [{
    v: [a as Vec3, b as Vec3, c as Vec3],
    voxelKey: key(v),
    color: v.color,
    face: "tri",
  }];
}

export function voxelToPolygons(v: Voxel): Polygon[] {
  const shape = v.shape ?? "cube";
  if (shape === "ramp") return rampPolys(v);
  if (shape === "wedge") return wedgePolys(v);
  if (shape === "spike") return spikePolys(v);
  if (shape === "triangle") return trianglePolys(v);
  return cubePolys(v);
}

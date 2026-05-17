import type { Polygon } from "@layoutit/polycss-react";

export function meshBbox(polygons: Polygon[]): {
  span: number;
  midX: number;
  midY: number;
  midZ: number;
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
} {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const p of polygons) {
    for (const v of p.vertices) {
      if (v[0] < minX) minX = v[0]; if (v[0] > maxX) maxX = v[0];
      if (v[1] < minY) minY = v[1]; if (v[1] > maxY) maxY = v[1];
      if (v[2] < minZ) minZ = v[2]; if (v[2] > maxZ) maxZ = v[2];
    }
  }
  const finite = Number.isFinite(minX);
  return {
    span: Math.max(maxX - minX, maxY - minY, maxZ - minZ, 0),
    midX: finite ? (minX + maxX) / 2 : 0,
    midY: finite ? (minY + maxY) / 2 : 0,
    midZ: finite ? (minZ + maxZ) / 2 : 0,
    minX: finite ? minX : 0,
    minY: finite ? minY : 0,
    minZ: finite ? minZ : 0,
    maxX: finite ? maxX : 0,
    maxY: finite ? maxY : 0,
    maxZ: finite ? maxZ : 0,
  };
}

import type { Polygon } from "@layoutit/polycss";

export function buildFloor(polygons: Polygon[]): Polygon | null {
  if (polygons.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const polygon of polygons) {
    for (const [x, y] of polygon.vertices) {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null;
  const padX = Math.max(2, (maxX - minX) * 0.18);
  const padY = Math.max(2, (maxY - minY) * 0.18);
  return {
    vertices: [
      [minX - padX, minY - padY, 0],
      [maxX + padX, minY - padY, 0],
      [maxX + padX, maxY + padY, 0],
      [minX - padX, maxY + padY, 0],
    ],
    color: "#252a2d",
  };
}

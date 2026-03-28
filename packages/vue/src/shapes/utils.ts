import type { GridContext, Voxel } from "@layoutit/voxcss-core";
import { getVoxelBounds } from "@layoutit/voxcss-core";
import type { ShapeSurfaceLighting } from "@layoutit/voxcss-core";

export const ORIENTATION_MAP: Record<number, string> = {
  0: "east",
  90: "south",
  180: "west",
  270: "north",
};

export function normalizeRotation(value: number | undefined): number {
  if (!Number.isFinite(value)) return 0;
  const snapped = Math.round((value as number) / 90) * 90;
  return ((snapped % 360) + 360) % 360;
}

export function isCovered(voxel: Voxel, context: GridContext): boolean {
  const { x2, y2 } = getVoxelBounds(voxel);
  const layerAbove = Math.max(0, Math.floor((voxel.z ?? 0) + 1));
  for (let row = voxel.x; row < x2; row += 1) {
    for (let col = voxel.y; col < y2; col += 1) {
      if (context.getVoxel(row, col, layerAbove)) return true;
    }
  }
  return false;
}

export function isBottomOccluded(voxel: Voxel, context: GridContext): boolean {
  const targetZ = Math.floor((voxel.z ?? 0) - 1);
  if (targetZ < 0) return false;
  const { x2, y2 } = getVoxelBounds(voxel);
  for (let x = voxel.x; x < x2; x += 1) {
    for (let y = voxel.y; y < y2; y += 1) {
      if (!context.getVoxel(x, y, targetZ)) return false;
    }
  }
  return true;
}

export function shouldRenderBottom(voxel: Voxel, context: GridContext): boolean {
  if (context.walls?.b) return false;
  return !isBottomOccluded(voxel, context);
}

export function getSurfaceColor(lighting: ShapeSurfaceLighting[], surfaceId: string, fallback: string): string {
  return lighting.find((s) => s.id === surfaceId)?.color ?? fallback;
}

export function getSurfaceDelta(lighting: ShapeSurfaceLighting[], surfaceId: string): number {
  return lighting.find((s) => s.id === surfaceId)?.delta ?? 0;
}

export function resolveSurfaceTexture(
  voxel: Voxel,
  surfaceId: string,
  context: GridContext
): string | undefined {
  const textureKey = voxel.texture;
  if (!textureKey || textureKey.startsWith("#")) return undefined;
  const resolved = context.resolveTexture?.(textureKey, surfaceId);
  if (resolved) return resolved;
  if (
    textureKey.startsWith("/") ||
    textureKey.startsWith("./") ||
    textureKey.startsWith("../") ||
    textureKey.startsWith("http://") ||
    textureKey.startsWith("https://") ||
    textureKey.startsWith("data:") ||
    textureKey.includes(".")
  ) {
    return textureKey;
  }
  return undefined;
}

export function textureBrightnessFilter(delta: number): string | undefined {
  const brightness = Math.max(0, 1 + delta / 200);
  if (Math.abs(brightness - 1) < 0.001) return undefined;
  const rounded = Math.round(brightness * 1000) / 1000;
  return `brightness(${rounded})`;
}

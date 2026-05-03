import type { GridContext, Voxel, ShapeSurfaceLighting } from "@layoutit/voxcss-core";
export { isCovered, isBottomOccluded, shouldRenderBottom } from "@layoutit/voxcss-core";

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


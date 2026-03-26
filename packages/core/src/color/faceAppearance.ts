import type { CubeFace, GridContext, Voxel } from "../types";
import { shadeCubeFace, getCubeFaceLightDelta } from "./lighting";

export interface CubeFaceAppearance {
  backgroundImage: string;
  backgroundColor: string;
  filter: string;
}

export function computeCubeFaceAppearance(
  voxel: Voxel,
  face: CubeFace,
  context: GridContext
): CubeFaceAppearance {
  const textureUrl = resolveTextureUrl(voxel, face, context);
  const hasTexture = Boolean(textureUrl);

  let backgroundImage = hasTexture && textureUrl ? `url(${textureUrl})` : "";
  let backgroundColor = "";
  let filter = "";

  let customColorApplied = false;
  let customFilterApplied = false;
  const custom = context.lighting?.(voxel, face);
  if (custom) {
    if (custom.backgroundImage !== undefined) {
      backgroundImage = custom.backgroundImage ?? "";
    }
    if (custom.backgroundColor !== undefined) {
      backgroundColor = custom.backgroundColor ?? "";
      customColorApplied = true;
    }
    if (custom.filter !== undefined) {
      filter = custom.filter ?? "";
      customFilterApplied = true;
    }
  }

  if (hasTexture && !customFilterApplied) {
    filter = getTextureLightingFilter(face);
  } else if (!customFilterApplied) {
    filter = "";
  }

  if (!customColorApplied) {
    if (hasTexture) {
      backgroundColor = "";
    } else {
      const baseColor = voxel.color ?? "#cccccc";
      backgroundColor = shadeCubeFace(baseColor, face);
    }
  }

  return { backgroundImage, backgroundColor, filter };
}

export function getCubeFaceAppearanceSignature(
  voxel: Voxel,
  face: CubeFace,
  context: GridContext
): string {
  const appearance = computeCubeFaceAppearance(voxel, face, context);
  return JSON.stringify([appearance.backgroundImage, appearance.backgroundColor, appearance.filter]);
}


function resolveTextureUrl(voxel: Voxel, face: CubeFace, context: GridContext): string | undefined {
  const textureKey = voxel.texture;
  if (!textureKey || textureKey.startsWith("#")) return undefined;
  const resolved = context.resolveTexture?.(textureKey, face);
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

function getTextureLightingFilter(face: CubeFace): string {
  const delta = getCubeFaceLightDelta(face);
  const brightness = Math.max(0, 1 + delta / 200);
  if (Math.abs(brightness - 1) < 0.001) {
    return "";
  }
  const rounded = Math.round(brightness * 1000) / 1000;
  return `brightness(${rounded})`;
}

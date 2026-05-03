/**
 * Compute the dynamic CSS custom-property overrides a multi-cell shape
 * (ramp / wedge / spike) needs in order to size its slope and elevation
 * correctly. Pure function — returns a plain Record<string, string> of CSS
 * variable names → values. Each renderer is responsible for converting this
 * map into its own inline-style format.
 *
 * Returns {} for 1×1×1 voxels (no overrides needed) and for cubes (which
 * only need the elevation override when spanZ > 1; that branch is included
 * here as well so cubes can share the same helper).
 */
import type { GridContext, Voxel } from "../types";
import { getVoxelBounds, getVoxelZBounds } from "../scene/context";

interface SlopeParams {
  angle: string;
  offset: string;
}

function slopeParams(span: number, tileSize: number, elevation: number): SlopeParams {
  const width = span * tileSize;
  const angle = Math.atan(elevation / width) * (180 / Math.PI);
  const hyp = Math.sqrt(width * width + elevation * elevation);
  const offset = hyp - width;
  return {
    angle: `${Math.round(angle * 1000) / 1000}deg`,
    offset: `${Math.round(offset * 100) / 100}px`,
  };
}

export function computeShapeStyle(voxel: Voxel, context: GridContext): Record<string, string> {
  const { x2, y2 } = getVoxelBounds(voxel);
  const { z, z2 } = getVoxelZBounds(voxel);
  const spanX = x2 - voxel.x;
  const spanY = y2 - voxel.y;
  const spanZ = z2 - z;

  if (spanX <= 1 && spanY <= 1 && spanZ <= 1) return {};

  const { tileSize, layerElevation } = context;
  const effectiveElevation = spanZ * layerElevation;
  const style: Record<string, string> = {};

  if (spanZ > 1) {
    style["--voxcss-layer-elevation"] = `${effectiveElevation}px`;
  }

  const shape = voxel.shape;
  if (!shape || shape === "cube") {
    return style;
  }

  const prefix = `--voxcss-${shape}`;

  // Ramp slope direction depends on rotation:
  //   rot=0/180 → slope along Y axis (use spanY for the slope length)
  //   rot=90/270 → slope along X axis (use spanX for the slope length)
  // Without this correction, perpendicular merge of a rot=90 ramp (which
  // increases spanY) would incorrectly trigger a shallow-angle calc.
  const rotNorm = (((voxel.rot ?? 0) % 360) + 360) % 360;
  const rampUsesSpanX = rotNorm === 90 || rotNorm === 270;

  if (shape === "ramp") {
    const slopeSpan = rampUsesSpanX ? spanX : spanY;
    if (slopeSpan > 1 || spanZ > 1) {
      const p = slopeParams(slopeSpan, tileSize, effectiveElevation);
      style[`${prefix}-angle`] = p.angle;
      style[`${prefix}-offset`] = p.offset;
    }
  } else if (shape === "wedge" || shape === "spike") {
    // Wedges and spikes have two slope surfaces (primary + secondary),
    // perpendicular to each other. Their span axes also swap with rotation.
    const primarySpan = rampUsesSpanX ? spanX : spanY;
    const secondarySpan = rampUsesSpanX ? spanY : spanX;
    if (primarySpan > 1 || spanZ > 1) {
      const p = slopeParams(primarySpan, tileSize, effectiveElevation);
      style[`${prefix}-angle`] = p.angle;
      style[`${prefix}-offset`] = p.offset;
    }
    if (secondarySpan > 1 || spanZ > 1) {
      const s = slopeParams(secondarySpan, tileSize, effectiveElevation);
      style[`${prefix}-secondary-angle`] = s.angle;
      style[`${prefix}-bottom-offset`] = s.offset;
    }
  }

  return style;
}

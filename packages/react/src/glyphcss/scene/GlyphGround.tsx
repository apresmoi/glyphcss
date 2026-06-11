/**
 * GlyphGround — convenience wrapper around `planePolygons` that registers
 * a horizontal ground plane with the parent GlyphScene.
 *
 * Mirrors voxcss's `<PolyGround>` component prop surface.
 */
import { memo, useMemo } from "react";
import type { CSSProperties } from "react";
import type { Vec3 } from "@glyphcss/core";
import { planePolygons } from "@glyphcss/core";
import { GlyphMesh } from "./GlyphMesh";

export interface GlyphGroundProps {
  /** Half-extent of the ground plane in world units. Default 5. */
  size?: number;
  /** Fill color. Default "#444444". */
  color?: string;
  /** World-space position. Default [0, -0.5, 0]. */
  position?: Vec3;
  /** World-space rotation in radians (Euler XYZ). */
  rotation?: Vec3;
  /** String id forwarded to the underlying mesh handle. */
  id?: string;
  /**
   * This ground plane casts shadows onto other `receiveShadow` surfaces.
   * Default false — ground planes typically only receive shadows, matching PolyGround.
   */
  castShadow?: boolean;
  /**
   * This ground plane receives (displays) shadows from `castShadow` meshes.
   * Default true — ground planes are the primary shadow receivers, matching PolyGround.
   */
  receiveShadow?: boolean;
  className?: string;
  style?: CSSProperties;
}

function GlyphGroundInner({
  size = 5,
  color = "#444444",
  position = [0, -0.5, 0],
  rotation,
  id,
  castShadow = false,
  receiveShadow = true,
  className,
  style,
}: GlyphGroundProps) {
  // XZ plane (axis=1 → normal along Y)
  const polygons = useMemo(
    () =>
      planePolygons({
        axis: 1,
        size,
        offset: 0,
        color,
      }),
    [size, color],
  );

  return (
    <GlyphMesh
      id={id}
      polygons={polygons}
      position={position}
      rotation={rotation}
      castShadow={castShadow}
      receiveShadow={receiveShadow}
      className={className}
      style={style}
    />
  );
}

export const GlyphGround = memo(GlyphGroundInner);

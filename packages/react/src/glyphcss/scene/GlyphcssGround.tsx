/**
 * GlyphcssGround — convenience wrapper around `planePolygons` that registers
 * a horizontal ground plane with the parent GlyphcssScene.
 *
 * Mirrors voxcss's `<PolyGround>` component prop surface.
 */
import { memo, useMemo } from "react";
import type { CSSProperties } from "react";
import type { Vec3 } from "@glyphcss/core";
import { planePolygons } from "@glyphcss/core";
import { GlyphcssMesh } from "./GlyphcssMesh";

export interface GlyphcssGroundProps {
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
  className?: string;
  style?: CSSProperties;
}

function GlyphcssGroundInner({
  size = 5,
  color = "#444444",
  position = [0, -0.5, 0],
  rotation,
  id,
  className,
  style,
}: GlyphcssGroundProps) {
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
    <GlyphcssMesh
      id={id}
      polygons={polygons}
      position={position}
      rotation={rotation}
      className={className}
      style={style}
    />
  );
}

export const GlyphcssGround = memo(GlyphcssGroundInner);

import { useMemo } from "react";
import { axesHelperPolygons } from "@polycss/core";
import { PolyMesh } from "../scene";

export interface PolyAxesHelperProps {
  /** Length of each axis bar in world units. */
  size?: number;
  /** Bar cross-section width as a fraction of `size`. */
  thickness?: number;
  /** When true, also draws bars in the −X / −Y / −Z direction. */
  negative?: boolean;
  /** X-axis bar color. Mirrors three.js's red/green/blue convention. */
  xColor?: string;
  yColor?: string;
  zColor?: string;
}

/**
 * PolyAxesHelper — three colored bars from world origin along +X / +Y / +Z.
 * Mirrors three.js's `AxesHelper`: red=X, green=Y, blue=Z.
 *
 * Renders inside the parent scene's transform, so it inherits camera
 * rotation and zoom automatically.
 */
export function PolyAxesHelper({
  size,
  thickness,
  negative,
  xColor,
  yColor,
  zColor,
}: PolyAxesHelperProps) {
  const polygons = useMemo(
    () => axesHelperPolygons({ size, thickness, negative, xColor, yColor, zColor }),
    [size, thickness, negative, xColor, yColor, zColor],
  );
  return <PolyMesh polygons={polygons} />;
}

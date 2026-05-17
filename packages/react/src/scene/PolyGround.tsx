/**
 * `<PolyGround>` — a flat ground-plane quad that shadow-casting meshes can
 * render their `<q>` shadows onto. Pure convenience over `<PolyMesh>`:
 * generates a 4-vertex polygon in the world XY plane at `z` and renders it
 * with `castShadow: false` (the floor doesn't cast onto itself).
 *
 *   <PolyScene>
 *     <PolyMesh polygons={chickenPolys} castShadow />
 *     <PolyGround size={6} />
 *   </PolyScene>
 *
 * Sized in WORLD units (1 unit ≈ 50 CSS px at the standard tile). The default
 * 6-unit quad is sized to match a typical normalized-fit mesh footprint;
 * callers that place multiple meshes typically widen it.
 */
import { useMemo } from "react";
import type { Polygon, Vec3 } from "@layoutit/polycss-core";
import { PolyMesh } from "./PolyMesh";

export interface PolyGroundProps {
  /** Side length of the ground quad in world units. Default `6`. */
  size?: number;
  /** World-space Z (floor height). Default `0`. */
  z?: number;
  /** World-space XY center. Default `[0, 0]`. */
  center?: [number, number];
  /** Fill color. Default `#7d848e` — medium gray, chosen so the 25% black
   *  `<q>` shadow leaves on top have visible contrast against it. */
  color?: string;
  className?: string;
}

export function PolyGround({
  size = 6,
  z = 0,
  center = [0, 0],
  color = "#7d848e",
  className,
}: PolyGroundProps) {
  const polygons = useMemo<Polygon[]>(() => {
    const half = size / 2;
    const [cx, cy] = center;
    const vertices: [Vec3, Vec3, Vec3, Vec3] = [
      [cx - half, cy - half, z],
      [cx + half, cy - half, z],
      [cx + half, cy + half, z],
      [cx - half, cy + half, z],
    ];
    return [{ vertices, color }];
  }, [size, z, center, color]);

  return (
    <PolyMesh
      polygons={polygons}
      castShadow={false}
      className={className ? `polycss-ground ${className}` : "polycss-ground"}
    />
  );
}

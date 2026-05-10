import { useMemo } from "react";
import type { PolyDirectionalLight, Vec3 } from "@layoutit/polycss-core";
import { octahedronPolygons } from "@layoutit/polycss-core";
import { PolyMesh } from "../scene";

export interface PolyDirectionalLightHelperProps {
  /** Light to visualize. */
  light: PolyDirectionalLight;
  /**
   * Point the marker orbits around, in world coords. Mirrors three.js's
   * `DirectionalLight.target.position` — usually the mesh's bbox center.
   * Defaults to the world origin.
   */
  target?: Vec3;
  /** Distance from `target` to render the source marker, in world units. */
  distance?: number;
  /** Marker half-extent in world units. */
  size?: number;
  /** Marker color override. Defaults to `light.color`. */
  color?: string;
}

// World units → CSS pixels conversion used by PolyMesh's `position` prop.
// Matches the default tileSize / layerElevation in PolyScene; if the scene
// ever exposes custom values we'd thread them through here.
const TILE = 50;

/**
 * PolyDirectionalLightHelper — small octahedron placed along the light's
 * direction vector. Mirrors three.js's `DirectionalLightHelper`.
 *
 * `light.direction` is in CSS-pixel space (axis convention used by the
 * shader). Polygon vertices are in world space, which the renderer remaps
 * via `[v[1], v[0], v[2]]`. The helper reverses that swap so the marker
 * lands where the light visibly comes from on screen.
 *
 * The octahedron is built at LOCAL origin once; the world position is
 * applied via PolyMesh's `position` prop (a CSS transform on the wrapper).
 * That keeps the polygons array reference-stable across light-direction
 * changes — the atlas does not rebuild and the marker glides smoothly.
 */
export function PolyDirectionalLightHelper({
  light,
  target,
  distance = 5,
  size = 0.35,
  color,
}: PolyDirectionalLightHelperProps) {
  const swatch = color ?? light.color ?? "#ffd54a";

  const polygons = useMemo(
    () => octahedronPolygons([0, 0, 0], size, swatch),
    [size, swatch],
  );

  const meshPosition = useMemo<Vec3>(() => {
    const [dx, dy, dz] = light.direction;
    const len = Math.hypot(dx, dy, dz) || 1;
    const tx = target?.[0] ?? 0;
    const ty = target?.[1] ?? 0;
    const tz = target?.[2] ?? 0;
    const worldX = tx + (dy / len) * distance;
    const worldY = ty + (dx / len) * distance;
    const worldZ = tz + (dz / len) * distance;
    return [worldY * TILE, worldX * TILE, worldZ * TILE];
  }, [light.direction, target, distance]);

  return <PolyMesh polygons={polygons} position={meshPosition} />;
}

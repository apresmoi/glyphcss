import type { Vec3 } from "@layoutit/polycss-react";

const BASE_TILE = 50;

/**
 * Wrapper translate (CSS px) that lands the mesh's visible bbox center at
 * `desiredWorld` (XY) and its lowest visible vertex at Z=0.
 *
 * PolyMesh sets transform-origin to the bbox center, so for any vertex `v`:
 *   visible(v) = T + O + S*(v - O) = T + O*(1-S) + S*v
 * At v = bbox center, the (1-S)*O term collapses to leaving the center at
 * `T + O`. So to land the center at `desired*tile`, set `T = desired*tile - O`.
 * For Z we want the BOTTOM (v = minZ) at 0, which gives the closed form below.
 */
export function placeMeshOnFloor(
  desiredWorldX: number,
  desiredWorldY: number,
  bbox: { midX: number; midY: number; midZ: number; minZ: number },
  scale: number,
  /** Surface elevation in world units (default 0 = floor). Pass the
   *  heightmap-sampled value to land the mesh on top of an elevated
   *  cell instead of the floor. */
  surfaceZ: number = 0,
): Vec3 {
  return [
    // CSS X = worldY · tile; origin X = midY · tile
    (desiredWorldY - bbox.midY) * BASE_TILE,
    // CSS Y = worldX · tile; origin Y = midX · tile
    (desiredWorldX - bbox.midX) * BASE_TILE,
    // CSS Z in scene-local coords maps directly to world Z (the cssPoints
    // axis swap is identity for Z). To lift the mesh so its lowest vertex
    // sits at world z = surfaceZ, ADD surfaceZ * tile to the CSS Z that
    // would land the bottom at world z = 0.
    -BASE_TILE * (bbox.midZ * (1 - scale) + scale * bbox.minZ) + BASE_TILE * surfaceZ,
  ];
}

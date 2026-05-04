import type * as React from "react";
import { memo } from "react";
// Phase 3.0: type imports route through the local shim in `./types` until
// Phase 3 deletes this file. The runtime helpers (getVoxelBounds, etc.) are
// also pre-Phase-2 surfaces — Phase 3 strips the cube path entirely, so we
// keep the broken imports here as TODO markers; this file's only Phase-3.0
// edit is the wrapper-style branch for triangle/polygon shapes (below).
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — Phase-3 will delete @layoutit/voxcss-core entirely.
import { getVoxelBounds, getVoxelZBounds, computeShapeLighting, computeShapeStyle } from "@layoutit/voxcss-core";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — Phase-3 will delete @layoutit/voxcss-core entirely.
import type { ShapeType } from "@layoutit/voxcss-core";
import type { GridContext, Voxel } from "./types";
import { Ramp, Wedge, Spike, Triangle, normalizeRotation, ORIENTATION_MAP, isCovered, shouldRenderBottom } from "./index";

interface VoxShapeProps {
  voxel: Voxel;
  context: GridContext;
}

function VoxShapeInner({ voxel, context }: VoxShapeProps) {
  const shapeKey = voxel.shape ?? "cube";
  if (shapeKey === "cube") return null;
  const shape = shapeKey as ShapeType;

  // In debug mode, render covered shapes anyway with a debug class so we can
  // see where shapes exist but are being hidden by the isCovered check.
  // Triangles opt out: isCovered is bbox-based, but a triangle is a sparse
  // surface — for dense triangle meshes (geodesic spheres, OBJ imports) most
  // triangles have other triangles in the layer above their bbox, so the
  // check falsely culls them. Until isCovered becomes shape-aware, treat
  // triangles as always visible and rely on backface-visibility for culling.
  const covered = shape === "triangle" || shape === "polygon" ? false : isCovered(voxel, context);
  if (covered && !context.debugShowOccluded) return null;

  const { x2, y2 } = getVoxelBounds(voxel);
  const rawRotation = Number.isFinite(voxel.rot as number) ? Number(voxel.rot) : 0;
  const rotation = normalizeRotation(rawRotation);
  const orientation = ORIENTATION_MAP[rotation] ?? "east";
  const baseColor = voxel.color ?? "#cccccc";
  const lighting = computeShapeLighting(shape, rawRotation, baseColor);
  const showBottom = shouldRenderBottom(voxel, context);

  let shapeClass: string;
  let ShapeComponent: typeof Ramp | typeof Wedge | typeof Spike | typeof Triangle;
  let effectiveOrientation = orientation;
  if (shape === "ramp") {
    if (rotation === 90 || rotation === 270) {
      effectiveOrientation = rotation === 90 ? "east" : "west";
      shapeClass = "voxcss-ramp voxcss-ramp-x";
    } else {
      shapeClass = "voxcss-ramp voxcss-ramp-y";
    }
    ShapeComponent = Ramp;
  } else if (shape === "wedge") {
    shapeClass = "voxcss-wedge";
    ShapeComponent = Wedge;
  } else if (shape === "triangle" || shape === "polygon") {
    // Both shape names route to the same renderer. "triangle" expects exactly
    // 3 vertices (TS-typeable as a 3-tuple); "polygon" accepts any N >= 3.
    // The single CSS class keeps the wrapper styling identical.
    shapeClass = "voxcss-triangle";
    ShapeComponent = Triangle;
  } else {
    shapeClass = "voxcss-spike";
    ShapeComponent = Spike;
  }

  const shapeStyle = computeShapeStyle(voxel, context);

  const dataAttrs: Record<string, string> = {};
  if (voxel.data) {
    for (const [k, v] of Object.entries(voxel.data)) {
      dataAttrs[`data-${k}`] = String(v);
    }
  }
  // When debugShowLabels is on, expose voxel identity in a single readable
  // string so the user can copy-paste it to refer to a specific element.
  // Format: `shape (x,y,z)→(x2,y2,z2) rot=R`.
  if (context.debugShowLabels) {
    const { z, z2 } = getVoxelZBounds(voxel);
    dataAttrs["data-debug"] = `${shape} (${voxel.x},${voxel.y},${z})→(${x2},${y2},${z2}) rot=${rotation}`;
  }

  // Camera-direction occlusion list (see VoxCube).
  const { z: vz } = getVoxelZBounds(voxel);
  const occlDirs = context.occlusionMap?.get(`${voxel.x}:${voxel.y}:${vz}`);

  // POLYCSS PHASE 3.0 — triangle / polygon shapes render in scene-root
  // space; their wrapper drops `gridArea` and pins to (0, 0) absolutely.
  // The inner Triangle's matrix3d carries the full scene-space translation.
  // Cube-era shapes (cube/ramp/wedge/spike) still use CSS Grid for now;
  // Phase 3 strips them entirely.
  const isPolygon = shape === "triangle" || shape === "polygon";
  const wrapperStyle: React.CSSProperties = isPolygon
    ? { position: "absolute", left: 0, top: 0, ...shapeStyle }
    : { gridArea: `${voxel.x} / ${voxel.y} / ${x2} / ${y2}`, ...shapeStyle };

  return (
    <div
      className={`voxcss-${effectiveOrientation} ${shapeClass}${covered ? " voxcss-debug-covered" : ""}`}
      data-occluded-dirs={occlDirs}
      style={wrapperStyle}
      {...dataAttrs}
    >
      <ShapeComponent
        voxel={voxel}
        context={context}
        baseColor={baseColor}
        lighting={lighting}
        showBottom={showBottom}
      />
    </div>
  );
}

export const VoxShape = memo(VoxShapeInner);

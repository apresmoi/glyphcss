import { memo } from "react";
import type { GridContext, Voxel } from "@layoutit/voxcss-core";
import { getVoxelBounds, getVoxelZBounds, computeShapeLighting, computeShapeStyle } from "@layoutit/voxcss-core";
import type { ShapeType } from "@layoutit/voxcss-core";
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
  const covered = shape === "triangle" ? false : isCovered(voxel, context);
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
  } else if (shape === "triangle") {
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

  return (
    <div
      className={`voxcss-${effectiveOrientation} ${shapeClass}${covered ? " voxcss-debug-covered" : ""}`}
      data-occluded-dirs={occlDirs}
      style={{ gridArea: `${voxel.x} / ${voxel.y} / ${x2} / ${y2}`, ...shapeStyle }}
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

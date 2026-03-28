import { useRef } from "react";
import type { Voxel, GridContext } from "@layoutit/voxcss-core";
import type { PlaneAxis } from "@layoutit/voxcss-core";
import { shadeColor } from "@layoutit/voxcss-core";
import { buildGridSvgDataUrl } from "./VoxScene";
import { VoxLayer } from "./VoxLayer";
import { useSliceBrushes, SliceZBrushes, SliceAxisHost } from "../slice/VoxSliceRenderer";
import type { SceneStore } from "../store/sceneStore";

const FLOOR_BASE_DELTA = 120;
const FLOOR_GRID_ALPHA = 0.12;

const X_AXES = new Set<PlaneAxis>(["x"]);
const Y_AXES = new Set<PlaneAxis>(["y"]);

export interface FloorProps {
  layers: Voxel[][];
  context: GridContext;
  dimensions: { rows: number; cols: number; depth: number };
  showFloor: boolean;
  wallMask: { b: boolean; t: boolean };
  wallColor: string;
  tileSize: number;
  layerElevation: number;
  disableGrid: boolean;
  is3d: boolean;
  store: SceneStore;
}

export function Floor({
  layers,
  context,
  dimensions,
  showFloor,
  wallMask,
  wallColor,
  tileSize,
  layerElevation,
  disableGrid,
  is3d,
  store,
}: FloorProps) {
  const floorVisible = showFloor && wallMask.b;
  const floorColor = floorVisible ? shadeColor(wallColor, FLOOR_BASE_DELTA) : undefined;
  const floorGrid = floorVisible && !disableGrid
    ? buildGridSvgDataUrl(tileSize, tileSize, FLOOR_GRID_ALPHA)
    : undefined;

  const floorRef = useRef<HTMLDivElement>(null);
  const sliceBrushes = useSliceBrushes(
    is3d ? layers : [],
    context,
  );

  return (
    <>
      <div
        ref={floorRef}
        className="voxcss-floor-z"
        style={
          {
            "--voxcss-floor-base": floorColor,
            "--voxcss-grid-x": floorVisible ? `${tileSize}px` : undefined,
            "--voxcss-grid-y": floorVisible ? `${tileSize}px` : undefined,
            "--voxcss-floor-grid": floorGrid,
            background: floorVisible ? undefined : "none",
            pointerEvents: "none",
            ...(is3d ? {
              display: "grid",
              gridTemplateColumns: `repeat(${dimensions.cols}, ${tileSize}px)`,
              gridTemplateRows: `repeat(${dimensions.rows}, ${tileSize}px)`,
            } : undefined),
          } as React.CSSProperties
        }
      >
        {is3d ? (
          <SliceZBrushes
            floorRef={floorRef}
            plans={sliceBrushes.plans}
            store={store}
            tileSize={tileSize}
            layerElevation={layerElevation}
          />
        ) : (
          layers.map((layerVoxels, i) => (
            <VoxLayer key={i} layerIndex={i} voxels={layerVoxels} context={context} />
          ))
        )}
      </div>
      {is3d && (
        <>
          <SliceAxisHost
            className="voxcss-floor-x"
            style={{
              width: `${dimensions.cols * tileSize}px`,
              height: `${dimensions.depth * layerElevation}px`,
              display: "grid",
              gridTemplateColumns: `repeat(${dimensions.cols}, ${tileSize}px)`,
              gridTemplateRows: `repeat(${dimensions.depth}, ${layerElevation}px)`,
            }}
            plans={sliceBrushes.plans}
            store={store}
            tileSize={tileSize}
            layerElevation={layerElevation}
            axes={X_AXES}
          />
          <SliceAxisHost
            className="voxcss-floor-y"
            style={{
              width: `${dimensions.depth * layerElevation}px`,
              height: `${dimensions.rows * tileSize}px`,
              display: "grid",
              gridTemplateColumns: `repeat(${dimensions.depth}, ${layerElevation}px)`,
              gridTemplateRows: `repeat(${dimensions.rows}, ${tileSize}px)`,
            }}
            plans={sliceBrushes.plans}
            store={store}
            tileSize={tileSize}
            layerElevation={layerElevation}
            axes={Y_AXES}
          />
        </>
      )}
    </>
  );
}

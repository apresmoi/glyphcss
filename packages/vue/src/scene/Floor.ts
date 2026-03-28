import { h, computed, ref } from "vue";
import type { Ref, VNode } from "vue";
import type { Voxel, GridContext, PlaneAxis } from "@layoutit/voxcss-core";
import { shadeColor } from "@layoutit/voxcss-core";
import { buildGridSvgDataUrl } from "./VoxScene";
import { VoxLayer } from "./VoxLayer";
import { useSliceBrushes, SliceZBrushes, SliceAxisHost } from "../slice";
import type { SceneStore } from "../store";

const FLOOR_BASE_DELTA = 120;
const FLOOR_GRID_ALPHA = 0.12;

const X_AXES = new Set<PlaneAxis>(["x"]);
const Y_AXES = new Set<PlaneAxis>(["y"]);

export interface FloorOptions {
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
  sliceBrushes: { plans: Ref<any[]> };
  floorRef: Ref<HTMLElement | null>;
}

export function renderFloor(opts: FloorOptions): VNode[] {
  const {
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
    sliceBrushes,
    floorRef,
  } = opts;

  const floorVisible = showFloor && wallMask.b;
  const floorColor = floorVisible ? shadeColor(wallColor, FLOOR_BASE_DELTA) : undefined;
  const floorGrid = floorVisible && !disableGrid
    ? buildGridSvgDataUrl(tileSize, tileSize, FLOOR_GRID_ALPHA)
    : undefined;

  const sceneChildren: VNode[] = [];

  // Floor div children
  const floorChildren: any[] = [];
  if (is3d) {
    floorChildren.push(
      h(SliceZBrushes, {
        key: "slice-z",
        floorRef,
        plans: sliceBrushes.plans.value,
        store: store as SceneStore,
        tileSize,
        layerElevation,
      })
    );
  } else {
    for (let i = 0; i < layers.length; i++) {
      floorChildren.push(
        h(VoxLayer, { key: i, layerIndex: i, voxels: layers[i], context })
      );
    }
  }

  const floorStyle: Record<string, string | undefined> = {
    "--voxcss-floor-base": floorColor,
    "--voxcss-grid-x": floorVisible ? `${tileSize}px` : undefined,
    "--voxcss-grid-y": floorVisible ? `${tileSize}px` : undefined,
    "--voxcss-floor-grid": floorGrid,
    background: floorVisible ? undefined : "none",
    pointerEvents: "none",
  };

  if (is3d) {
    floorStyle.display = "grid";
    floorStyle.gridTemplateColumns = `repeat(${dimensions.cols}, ${tileSize}px)`;
    floorStyle.gridTemplateRows = `repeat(${dimensions.rows}, ${tileSize}px)`;
  }

  sceneChildren.push(
    h("div", {
      ref: floorRef,
      class: "voxcss-floor-z",
      style: floorStyle,
    }, floorChildren)
  );

  // X/Y slice hosts for 3d mode
  if (is3d) {
    sceneChildren.push(
      h(SliceAxisHost, {
        key: "slice-x",
        className: "voxcss-floor-x",
        hostStyle: {
          width: `${dimensions.cols * tileSize}px`,
          height: `${dimensions.depth * layerElevation}px`,
          display: "grid",
          gridTemplateColumns: `repeat(${dimensions.cols}, ${tileSize}px)`,
          gridTemplateRows: `repeat(${dimensions.depth}, ${layerElevation}px)`,
        },
        plans: sliceBrushes.plans.value,
        store: store as SceneStore,
        tileSize,
        layerElevation,
        axes: X_AXES,
      })
    );
    sceneChildren.push(
      h(SliceAxisHost, {
        key: "slice-y",
        className: "voxcss-floor-y",
        hostStyle: {
          width: `${dimensions.depth * layerElevation}px`,
          height: `${dimensions.rows * tileSize}px`,
          display: "grid",
          gridTemplateColumns: `repeat(${dimensions.depth}, ${layerElevation}px)`,
          gridTemplateRows: `repeat(${dimensions.rows}, ${tileSize}px)`,
        },
        plans: sliceBrushes.plans.value,
        store: store as SceneStore,
        tileSize,
        layerElevation,
        axes: Y_AXES,
      })
    );
  }

  return sceneChildren;
}

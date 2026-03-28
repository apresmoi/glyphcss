import { h } from "vue";
import type { VNode } from "vue";
import type { WallsMask } from "@layoutit/voxcss-core";
import { shadeWallFace } from "@layoutit/voxcss-core";
import { buildGridSvgDataUrl } from "./VoxScene";

const WALL_GRID_ALPHA = 0.1;

export const WALL_DEFINITIONS: Array<{
  key: keyof WallsMask;
  className: string;
  useAltGrid: boolean;
  getSize: (rows: number, cols: number, depth: number, tile: number) => [number, number];
  getTransform: (rows: number, cols: number, depth: number, halfTile: number) => string;
}> = [
  {
    key: "bl",
    className: "voxcss-wall voxcss-wall--backLeft",
    useAltGrid: true,
    getSize: (rows, _cols, depth, tile) => [depth * tile, rows * tile],
    getTransform: (_rows, _cols, depth, halfTile) =>
      `rotateY(-90deg) translateZ(${halfTile * depth}px) translateX(${halfTile * depth}px)`,
  },
  {
    key: "fr",
    className: "voxcss-wall voxcss-wall--frontRight",
    useAltGrid: true,
    getSize: (rows, _cols, depth, tile) => [depth * tile, rows * tile],
    getTransform: (_rows, _cols, depth, halfTile) =>
      `rotateY(-90deg) translateZ(-${halfTile * depth}px) translateX(${halfTile * depth}px)`,
  },
  {
    key: "br",
    className: "voxcss-wall voxcss-wall--backRight",
    useAltGrid: false,
    getSize: (_rows, cols, depth, tile) => [cols * tile, depth * tile],
    getTransform: (_rows, _cols, depth, halfTile) =>
      `rotateX(90deg) translateZ(${halfTile * depth}px) translateY(${halfTile * depth}px)`,
  },
  {
    key: "fl",
    className: "voxcss-wall voxcss-wall--frontLeft",
    useAltGrid: false,
    getSize: (_rows, cols, depth, tile) => [cols * tile, depth * tile],
    getTransform: (rows, _cols, depth, halfTile) =>
      `rotateX(-90deg) translateZ(${halfTile * (2 * rows - depth)}px) translateY(-${halfTile * depth}px)`,
  },
];

export interface WallsOptions {
  walls: WallsMask;
  wallColor: string;
  dimensions: { rows: number; cols: number; depth: number };
  tileSize: number;
  disableGrid: boolean;
  layerElevation: number;
}

export function renderWalls(opts: WallsOptions): VNode[] {
  const { walls, wallColor, dimensions, tileSize, disableGrid, layerElevation } = opts;
  const halfTile = tileSize / 2;
  const { rows, cols, depth } = dimensions;
  const wallGridUrl = disableGrid ? undefined : buildGridSvgDataUrl(tileSize, layerElevation, WALL_GRID_ALPHA);
  const wallGridAltUrl = disableGrid ? undefined
    : tileSize === layerElevation ? wallGridUrl
    : buildGridSvgDataUrl(layerElevation, tileSize, WALL_GRID_ALPHA);

  const children: VNode[] = [];
  for (const def of WALL_DEFINITIONS) {
    if (!walls[def.key]) continue;
    const [width, height] = def.getSize(rows, cols, depth, tileSize);
    const transform = def.getTransform(rows, cols, depth, halfTile);
    const bgColor = shadeWallFace(wallColor, def.key);
    const gridUrl = def.useAltGrid ? wallGridAltUrl : wallGridUrl;

    children.push(
      h("div", {
        key: def.key,
        class: def.className,
        style: {
          width: `${width}px`,
          height: `${height}px`,
          transform,
          backgroundColor: bgColor,
          "--voxcss-wall-grid": gridUrl,
        },
      })
    );
  }
  return children;
}

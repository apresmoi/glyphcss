import { h } from "vue";
import type { VNode } from "vue";
import { shadeColor } from "@layoutit/voxcss-core";

const FLOOR_BASE_DELTA = 120;

export interface CeilingOptions {
  wallColor: string;
  dimensions: { rows: number; cols: number; depth: number };
  tileSize: number;
}

export function renderCeiling(opts: CeilingOptions): VNode {
  const { wallColor, dimensions, tileSize } = opts;
  const ceilingColor = shadeColor(wallColor, FLOOR_BASE_DELTA);
  return h("div", {
    key: "ceiling",
    class: "voxcss-ceiling",
    style: {
      width: `${dimensions.cols * tileSize}px`,
      height: `${dimensions.rows * tileSize}px`,
      transform: `translateZ(${dimensions.depth * tileSize}px)`,
      "--voxcss-ceiling-base": ceilingColor,
      "--voxcss-ceiling-opacity": "0.35",
    },
  });
}

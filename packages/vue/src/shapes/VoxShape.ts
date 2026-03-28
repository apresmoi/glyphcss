import { defineComponent, h } from "vue";
import type { PropType } from "vue";
import type { GridContext, Voxel, ShapeType } from "@layoutit/voxcss-core";
import { getVoxelBounds, computeShapeLighting } from "@layoutit/voxcss-core";
import { normalizeRotation, ORIENTATION_MAP, isCovered, shouldRenderBottom } from "./utils";
import { renderRamp } from "./Ramp";
import { renderWedge } from "./Wedge";
import { renderSpike } from "./Spike";

export const VoxShape = defineComponent({
  name: "VoxShape",
  props: {
    voxel: { type: Object as PropType<Voxel>, required: true },
    context: { type: Object as PropType<GridContext>, required: true },
  },
  setup(props) {
    return () => {
      const shapeKey = props.voxel.shape ?? "cube";
      if (shapeKey === "cube") return null;
      const shape = shapeKey as ShapeType;

      if (isCovered(props.voxel, props.context)) return null;

      const { x2, y2 } = getVoxelBounds(props.voxel);
      const rawRotation = Number.isFinite(props.voxel.rot as number) ? Number(props.voxel.rot) : 0;
      const rotation = normalizeRotation(rawRotation);
      const orientation = ORIENTATION_MAP[rotation] ?? "east";
      const baseColor = props.voxel.color ?? "#cccccc";
      const lighting = computeShapeLighting(shape, rawRotation, baseColor);
      const showBottom = shouldRenderBottom(props.voxel, props.context);

      const innerProps = { voxel: props.voxel, context: props.context, baseColor, lighting, showBottom };

      let shapeClass: string;
      let children: any[];
      if (shape === "ramp") {
        shapeClass = "voxcss-ramp";
        children = renderRamp(innerProps);
      } else if (shape === "wedge") {
        shapeClass = "voxcss-wedge";
        children = renderWedge(innerProps);
      } else {
        shapeClass = "voxcss-spike";
        children = renderSpike(innerProps);
      }

      return h(
        "div",
        {
          class: `voxcss-${orientation} ${shapeClass}`,
          style: { gridArea: `${props.voxel.x} / ${props.voxel.y} / ${x2} / ${y2}` },
        },
        children
      );
    };
  },
});

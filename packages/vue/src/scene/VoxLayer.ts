import { defineComponent, h } from "vue";
import type { PropType } from "vue";
import type { GridContext, Voxel } from "@layoutit/voxcss-core";
import { VoxCube } from "../shapes/VoxCube";
import { VoxShape } from "../shapes/VoxShape";

function voxelKey(voxel: Voxel, index: number): string {
  return `${voxel.x}:${voxel.y}:${voxel.z}:${index}`;
}

export const VoxLayer = defineComponent({
  name: "VoxLayer",
  props: {
    layerIndex: { type: Number, required: true },
    voxels: { type: Array as PropType<Voxel[]>, required: true },
    context: { type: Object as PropType<GridContext>, required: true },
  },
  setup(props) {
    return () => {
      const elevation = props.context.layerElevation ?? props.context.tileSize;
      const transform = `translateZ(${props.layerIndex * elevation}px)`;

      return h(
        "div",
        { class: "voxcss-layer", style: { transform } },
        props.voxels.map((voxel, i) => {
          if (!voxel) return null;
          const shape = voxel.shape ?? "cube";
          if (shape === "cube") {
            return h(VoxCube, { key: voxelKey(voxel, i), voxel, context: props.context });
          }
          return h(VoxShape, { key: voxelKey(voxel, i), voxel, context: props.context });
        })
      );
    };
  },
});

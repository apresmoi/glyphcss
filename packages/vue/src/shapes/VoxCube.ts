import { defineComponent, h } from "vue";
import type { PropType } from "vue";
import type { CubeFace, GridContext, Voxel } from "@layoutit/voxcss-core";
import { computeVisibleFaces, computeCubeFaceAppearance, getVoxelBounds } from "@layoutit/voxcss-core";

const CubeFaceDiv = defineComponent({
  name: "CubeFaceDiv",
  props: {
    voxel: { type: Object as PropType<Voxel>, required: true },
    face: { type: String as PropType<CubeFace>, required: true },
    context: { type: Object as PropType<GridContext>, required: true },
  },
  setup(props) {
    return () => {
      const appearance = computeCubeFaceAppearance(props.voxel, props.face, props.context);
      return h("div", {
        class: `voxcss-cube-face voxcss-cube-face--${props.face}`,
        style: {
          backgroundColor: appearance.backgroundColor || undefined,
          backgroundImage: appearance.backgroundImage || undefined,
          filter: appearance.filter || undefined,
        },
      });
    };
  },
});

export const VoxCube = defineComponent({
  name: "VoxCube",
  props: {
    voxel: { type: Object as PropType<Voxel>, required: true },
    context: { type: Object as PropType<GridContext>, required: true },
  },
  setup(props) {
    return () => {
      const faces = computeVisibleFaces(props.voxel, props.context);
      if (faces.length === 0) return null;

      const { x2, y2 } = getVoxelBounds(props.voxel);
      const tileSize = props.context.tileSize;
      const halfTile = tileSize / 2;
      const spanX = x2 - props.voxel.x;
      const spanY = y2 - props.voxel.y;

      return h(
        "div",
        {
          class: "voxcss-cube",
          style: {
            gridArea: `${props.voxel.x} / ${props.voxel.y} / ${x2} / ${y2}`,
            "--voxcss-side-offset-x": `${spanX * halfTile}px`,
            "--voxcss-side-offset-y": `${spanY * halfTile}px`,
            "--voxcss-fr-offset": `${spanY * tileSize}px`,
          },
        },
        faces.map((face) =>
          h(CubeFaceDiv, {
            key: face,
            voxel: props.voxel,
            face,
            context: props.context,
          })
        )
      );
    };
  },
});

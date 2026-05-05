/**
 * PolyAxesHelper — three colored bars from world origin along +X / +Y / +Z.
 * Vue port of @polycss/react's `<PolyAxesHelper>`. Mirrors three.js's
 * AxesHelper convention (red=X, green=Y, blue=Z).
 */
import { defineComponent, h, computed } from "vue";
import type { PropType } from "vue";
import { axesHelperPolygons } from "@polycss/core";
import { PolyMesh } from "../scene/PolyMesh";

export interface PolyAxesHelperProps {
  size?: number;
  thickness?: number;
  negative?: boolean;
  xColor?: string;
  yColor?: string;
  zColor?: string;
}

export const PolyAxesHelper = defineComponent({
  name: "PolyAxesHelper",
  props: {
    size: { type: Number, default: undefined },
    thickness: { type: Number, default: undefined },
    negative: { type: Boolean, default: undefined },
    xColor: { type: String as PropType<string>, default: undefined },
    yColor: { type: String as PropType<string>, default: undefined },
    zColor: { type: String as PropType<string>, default: undefined },
  },
  setup(props) {
    const polygons = computed(() =>
      axesHelperPolygons({
        size: props.size,
        thickness: props.thickness,
        negative: props.negative,
        xColor: props.xColor,
        yColor: props.yColor,
        zColor: props.zColor,
      }),
    );
    return () => h(PolyMesh, { polygons: polygons.value });
  },
});

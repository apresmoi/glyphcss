/**
 * GlyphGround — Vue 3 convenience wrapper around `planePolygons` that
 * registers a horizontal ground plane with the parent GlyphScene.
 *
 * Mirrors voxcss's `<PolyGround>` component prop surface.
 */
import { defineComponent, h, computed } from "vue";
import type { PropType } from "vue";
import type { Vec3 } from "@glyphcss/core";
import { planePolygons } from "@glyphcss/core";
import { GlyphMesh } from "./GlyphMesh";

export interface GlyphGroundProps {
  /** Half-extent of the ground plane in world units. Default 5. */
  size?: number;
  /** Fill color. Default "#444444". */
  color?: string;
  /** World-space position. Default [0, -0.5, 0]. */
  position?: Vec3;
  /** World-space rotation in radians (Euler XYZ). */
  rotation?: Vec3;
  /** String id forwarded to the underlying mesh handle. */
  id?: string;
  class?: string;
}

export const GlyphGround = defineComponent({
  name: "GlyphGround",
  props: {
    size: { type: Number, default: 5 },
    color: { type: String, default: "#444444" },
    position: { type: Array as unknown as PropType<Vec3>, default: (): Vec3 => [0, -0.5, 0] },
    rotation: { type: Array as unknown as PropType<Vec3>, default: undefined },
    id: { type: String, default: undefined },
    class: { type: String, default: undefined },
  },
  setup(props, { slots }) {
    // XZ plane (axis=1 → normal along Y)
    const polygons = computed(() =>
      planePolygons({
        axis: 1,
        size: props.size,
        offset: 0,
        color: props.color,
      }),
    );

    return () =>
      h(
        GlyphMesh,
        {
          id: props.id,
          polygons: polygons.value,
          position: props.position,
          rotation: props.rotation ?? undefined,
          class: props.class,
        },
        slots,
      );
  },
});

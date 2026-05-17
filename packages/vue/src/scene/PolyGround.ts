/**
 * `<PolyGround>` (Vue) — flat ground-plane quad that shadow-casting meshes
 * render their `<q>` shadows onto. Convenience over `<PolyMesh>` — generates
 * a 4-vertex polygon in the world XY plane at `z` and renders it with
 * `castShadow: false` (the floor doesn't cast onto itself). Mirrors the React
 * `<PolyGround>` API surface 1:1.
 *
 * Sized in WORLD units (1 unit ≈ 50 CSS px at the standard tile).
 */
import { defineComponent, h, computed } from "vue";
import type { PropType } from "vue";
import type { Polygon, Vec3 } from "@layoutit/polycss-core";
import { PolyMesh } from "./PolyMesh";

export interface PolyGroundProps {
  /** Side length of the ground quad in world units. Default `6`. */
  size?: number;
  /** World-space Z (floor height). Default `0`. */
  z?: number;
  /** World-space XY center. Default `[0, 0]`. */
  center?: [number, number];
  /** Fill color. Default `#7d848e` — medium gray, chosen so 25% black `<q>`
   *  shadow leaves on top have visible contrast against it. */
  color?: string;
  class?: string;
}

export const PolyGround = defineComponent({
  name: "PolyGround",
  props: {
    size: { type: Number, default: 6 },
    z: { type: Number, default: 0 },
    center: { type: Array as unknown as PropType<[number, number]>, default: () => [0, 0] },
    color: { type: String, default: "#7d848e" },
    class: { type: String, default: undefined },
  },
  setup(props) {
    const polygons = computed<Polygon[]>(() => {
      const half = props.size / 2;
      const [cx, cy] = props.center;
      const vertices: [Vec3, Vec3, Vec3, Vec3] = [
        [cx - half, cy - half, props.z],
        [cx + half, cy - half, props.z],
        [cx + half, cy + half, props.z],
        [cx - half, cy + half, props.z],
      ];
      return [{ vertices, color: props.color }];
    });

    return () =>
      h(PolyMesh, {
        polygons: polygons.value,
        castShadow: false,
        class: props.class ? `polycss-ground ${props.class}` : "polycss-ground",
      });
  },
});

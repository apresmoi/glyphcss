/**
 * PolyDirectionalLightHelper — small octahedron placed along the light's
 * direction vector. Vue port of @polycss/react's helper. Mirrors three.js's
 * DirectionalLightHelper.
 *
 * The octahedron is built at LOCAL origin once; the world position is
 * applied via PolyMesh's `position` prop (a CSS transform on the wrapper).
 * That keeps the polygons reference-stable across light-direction changes
 * — the atlas does not rebuild and the marker glides smoothly.
 */
import { defineComponent, h, computed } from "vue";
import type { PropType } from "vue";
import type { DirectionalLight, Vec3 } from "@polycss/core";
import { octahedronPolygons } from "@polycss/core";
import { PolyMesh } from "../scene/PolyMesh";

export interface PolyDirectionalLightHelperProps {
  light: DirectionalLight;
  target?: Vec3;
  distance?: number;
  size?: number;
  color?: string;
}

// World units → CSS pixels conversion used by PolyMesh's `position` prop.
const TILE = 50;

export const PolyDirectionalLightHelper = defineComponent({
  name: "PolyDirectionalLightHelper",
  props: {
    light: { type: Object as PropType<DirectionalLight>, required: true },
    target: { type: Array as unknown as PropType<Vec3>, default: undefined },
    distance: { type: Number, default: 5 },
    size: { type: Number, default: 0.35 },
    color: { type: String as PropType<string>, default: undefined },
  },
  setup(props) {
    const swatch = computed(
      () => props.color ?? props.light.color ?? "#ffd54a",
    );

    const polygons = computed(() =>
      octahedronPolygons([0, 0, 0], props.size, swatch.value),
    );

    const meshPosition = computed<Vec3>(() => {
      const dir = props.light.direction;
      const dx = dir[0], dy = dir[1], dz = dir[2];
      const len = Math.hypot(dx, dy, dz) || 1;
      const tx = props.target?.[0] ?? 0;
      const ty = props.target?.[1] ?? 0;
      const tz = props.target?.[2] ?? 0;
      const worldX = tx + (dy / len) * props.distance;
      const worldY = ty + (dx / len) * props.distance;
      const worldZ = tz + (dz / len) * props.distance;
      return [worldY * TILE, worldX * TILE, worldZ * TILE];
    });

    return () =>
      h(PolyMesh, {
        polygons: polygons.value,
        position: meshPosition.value,
      });
  },
});

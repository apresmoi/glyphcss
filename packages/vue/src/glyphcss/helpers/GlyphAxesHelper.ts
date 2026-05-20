/**
 * GlyphAxesHelper — Vue 3 ASCII-mode axes helper.
 */
import { defineComponent, inject, onMounted, onBeforeUnmount, watch, computed, shallowRef } from "vue";
import type { GlyphMeshHandle } from "glyphcss";
import type { Vec3, Polygon } from "@glyphcss/core";
import { GlyphSceneContextKey } from "../scene/context";

export interface GlyphAxesHelperProps {
  size?: number;
}

function axisPolygons(size: number): Polygon[] {
  const s = size;
  const t = s * 0.05;
  const polygons: Polygon[] = [];
  function addBar(a: Vec3, b: Vec3, color: string): void {
    const v0: Vec3 = [a[0] - t, a[1] - t, a[2]];
    const v1: Vec3 = [b[0] - t, b[1] - t, b[2]];
    const v2: Vec3 = [b[0] + t, b[1] + t, b[2]];
    const v3: Vec3 = [a[0] + t, a[1] + t, a[2]];
    polygons.push({ vertices: [v0, v1, v2], color });
    polygons.push({ vertices: [v0, v2, v3], color });
  }
  addBar([0, 0, 0], [s, 0, 0], "#ff0000");
  addBar([0, 0, 0], [0, s, 0], "#00ff00");
  addBar([0, 0, 0], [0, 0, s], "#0000ff");
  return polygons;
}

export const GlyphAxesHelper = defineComponent({
  name: "GlyphAxesHelper",
  props: {
    size: { type: Number, default: 1 },
  },
  setup(props) {
    const sceneCtx = inject(GlyphSceneContextKey);
    if (!sceneCtx) {
      throw new Error("glyphcss: GlyphAxesHelper must be used inside a GlyphScene.");
    }
    const { sceneRef } = sceneCtx;
    const meshRef = shallowRef<GlyphMeshHandle | null>(null);

    const polygons = computed(() => axisPolygons(props.size ?? 1));

    function register(): void {
      const scene = sceneRef.value;
      if (!scene) return;
      meshRef.value = scene.add(polygons.value);
    }

    onMounted(register);
    onBeforeUnmount(() => {
      meshRef.value?.dispose();
      meshRef.value = null;
    });

    watch(polygons, () => {
      meshRef.value?.dispose();
      meshRef.value = null;
      register();
    });

    return () => null;
  },
});

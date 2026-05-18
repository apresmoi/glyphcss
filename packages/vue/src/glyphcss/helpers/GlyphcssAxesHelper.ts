/**
 * GlyphcssAxesHelper — Vue 3 ASCII-mode axes helper.
 */
import { defineComponent, inject, onMounted, onBeforeUnmount, watch, computed, shallowRef } from "vue";
import type { GlyphcssMeshHandle } from "glyphcss";
import type { Vec3, Polygon } from "@glyphcss/core";
import { GlyphcssSceneContextKey } from "../scene/context";

export interface GlyphcssAxesHelperProps {
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

export const GlyphcssAxesHelper = defineComponent({
  name: "GlyphcssAxesHelper",
  props: {
    size: { type: Number, default: 1 },
  },
  setup(props) {
    const sceneCtx = inject(GlyphcssSceneContextKey);
    if (!sceneCtx) {
      throw new Error("glyphcss: GlyphcssAxesHelper must be used inside a GlyphcssScene.");
    }
    const { sceneRef } = sceneCtx;
    const meshRef = shallowRef<GlyphcssMeshHandle | null>(null);

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

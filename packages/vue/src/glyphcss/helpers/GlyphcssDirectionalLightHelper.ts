/**
 * GlyphcssDirectionalLightHelper — Vue 3 directional light helper for the ASCII backend.
 */
import { defineComponent, inject, onMounted, onBeforeUnmount, watch, computed, shallowRef } from "vue";
import type { PropType } from "vue";
import type { Vec3 } from "@layoutit/polycss-core";
import type { GlyphcssMeshHandle, GlyphcssTriangle } from "glyphcss";
import { GlyphcssSceneContextKey } from "../scene/context";

export interface GlyphcssDirectionalLightHelperProps {
  position?: Vec3;
  color?: string;
  size?: number;
}

function lightMarkerTriangles(position: Vec3, color: string, size: number): GlyphcssTriangle[] {
  const [px, py, pz] = position;
  const s = size;
  const top: Vec3 = [px, py, pz + s];
  const bot: Vec3 = [px, py, pz - s];
  const right: Vec3 = [px + s, py, pz];
  const left: Vec3 = [px - s, py, pz];
  const front: Vec3 = [px, py + s, pz];
  const back: Vec3 = [px, py - s, pz];
  return [
    { vertices: [top, right, front], color },
    { vertices: [top, front, left], color },
    { vertices: [top, left, back], color },
    { vertices: [top, back, right], color },
    { vertices: [bot, front, right], color },
    { vertices: [bot, left, front], color },
    { vertices: [bot, back, left], color },
    { vertices: [bot, right, back], color },
  ];
}

export const GlyphcssDirectionalLightHelper = defineComponent({
  name: "GlyphcssDirectionalLightHelper",
  props: {
    position: { type: Array as unknown as PropType<Vec3>, default: () => [1, 1, 1] },
    color: { type: String, default: "#ffff00" },
    size: { type: Number, default: 0.1 },
  },
  setup(props) {
    const sceneCtx = inject(GlyphcssSceneContextKey);
    if (!sceneCtx) {
      throw new Error("glyphcss: GlyphcssDirectionalLightHelper must be used inside a GlyphcssScene.");
    }
    const { sceneRef } = sceneCtx;
    const meshRef = shallowRef<GlyphcssMeshHandle | null>(null);

    const triangles = computed(() =>
      lightMarkerTriangles(props.position ?? [1, 1, 1], props.color ?? "#ffff00", props.size ?? 0.1),
    );

    function register(): void {
      const scene = sceneRef.value;
      if (!scene) return;
      meshRef.value = scene.add(triangles.value);
    }

    onMounted(register);
    onBeforeUnmount(() => {
      meshRef.value?.dispose();
      meshRef.value = null;
    });

    watch(triangles, () => {
      meshRef.value?.dispose();
      meshRef.value = null;
      register();
    });

    return () => null;
  },
});

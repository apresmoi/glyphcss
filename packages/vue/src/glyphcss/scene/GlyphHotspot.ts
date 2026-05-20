/**
 * GlyphHotspot — Vue 3 wrapper for scene.addHotspot().
 * Mirrors React's GlyphHotspot.
 */
import { defineComponent, inject, onMounted, onBeforeUnmount, watch, shallowRef } from "vue";
import type { PropType } from "vue";
import type { Vec3 } from "@glyphcss/core";
import type { GlyphHotspotHandle } from "glyphcss";
import { GlyphSceneContextKey } from "./context";

export interface GlyphHotspotProps {
  id: string;
  at: Vec3;
  size?: [number, number];
}

export const GlyphHotspot = defineComponent({
  name: "GlyphHotspot",
  props: {
    id: { type: String, required: true },
    at: { type: Array as unknown as PropType<Vec3>, required: true },
    size: { type: Array as unknown as PropType<[number, number]>, default: undefined },
  },
  emits: ["click"],
  setup(props, { emit }) {
    const ctx = inject(GlyphSceneContextKey);
    if (!ctx) {
      throw new Error("glyphcss: GlyphHotspot must be used inside a GlyphScene.");
    }
    const { sceneRef } = ctx;
    const hotspotRef = shallowRef<GlyphHotspotHandle | null>(null);

    function register(): void {
      const scene = sceneRef.value;
      if (!scene) return;
      const handle = scene.addHotspot(
        { id: props.id, at: props.at, size: props.size },
        () => emit("click"),
      );
      hotspotRef.value = handle;
    }

    function unregister(): void {
      hotspotRef.value?.remove();
      hotspotRef.value = null;
    }

    onMounted(register);
    onBeforeUnmount(unregister);

    watch(() => ({ id: props.id, at: props.at, size: props.size }), () => {
      unregister();
      register();
    }, { deep: false });

    return () => null;
  },
});

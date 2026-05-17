/**
 * GlyphcssHotspot — Vue 3 wrapper for scene.addHotspot().
 * Mirrors React's GlyphcssHotspot.
 */
import { defineComponent, inject, onMounted, onBeforeUnmount, watch, shallowRef } from "vue";
import type { PropType } from "vue";
import type { Vec3 } from "@glyphcss/core";
import type { GlyphcssHotspotHandle } from "glyphcss";
import { GlyphcssSceneContextKey } from "./context";

export interface GlyphcssHotspotProps {
  id: string;
  at: Vec3;
  size?: [number, number];
}

export const GlyphcssHotspot = defineComponent({
  name: "GlyphcssHotspot",
  props: {
    id: { type: String, required: true },
    at: { type: Array as unknown as PropType<Vec3>, required: true },
    size: { type: Array as unknown as PropType<[number, number]>, default: undefined },
  },
  emits: ["click"],
  setup(props, { emit }) {
    const ctx = inject(GlyphcssSceneContextKey);
    if (!ctx) {
      throw new Error("glyphcss: GlyphcssHotspot must be used inside a GlyphcssScene.");
    }
    const { sceneRef } = ctx;
    const hotspotRef = shallowRef<GlyphcssHotspotHandle | null>(null);

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

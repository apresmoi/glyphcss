/**
 * GlyphHotspot — Vue 3 wrapper for scene.addHotspot().
 * Mirrors React's GlyphHotspot.
 *
 * Children are rendered via Vue Teleport into the absolutely-positioned
 * overlay div so they track the hotspot as the camera moves.
 */
import { defineComponent, inject, onBeforeUnmount, watch, shallowRef, watchEffect, h, Teleport } from "vue";
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
  setup(props, { emit, slots }) {
    const ctx = inject(GlyphSceneContextKey);
    if (!ctx) {
      throw new Error("glyphcss: GlyphHotspot must be used inside a GlyphScene.");
    }
    const { sceneRef } = ctx;
    const hotspotRef = shallowRef<GlyphHotspotHandle | null>(null);
    // Track the overlay DOM element so we can teleport children into it.
    const overlayEl = shallowRef<HTMLElement | null>(null);

    function register(): void {
      const scene = sceneRef.value;
      if (!scene) return;
      const handle = scene.addHotspot(
        { id: props.id, at: props.at, size: props.size },
        () => emit("click"),
      );
      hotspotRef.value = handle;
      overlayEl.value = handle.el;
    }

    function unregister(): void {
      hotspotRef.value?.remove();
      hotspotRef.value = null;
      overlayEl.value = null;
    }

    // In Vue 3, child onMounted fires before parent onMounted, so sceneRef.value
    // is null at mount time. Watch for the scene to become available.
    const stopWatch = watchEffect(() => {
      if (!sceneRef.value || hotspotRef.value) return;
      register();
    });

    onBeforeUnmount(() => {
      stopWatch();
      unregister();
    });

    watch(() => ({ id: props.id, at: props.at, size: props.size }), () => {
      unregister();
      register();
    }, { deep: false });

    return () => {
      const el = overlayEl.value;
      const slotContent = slots.default?.();
      // Teleport children into the positioned overlay div when it exists.
      if (el && slotContent) {
        return h(Teleport, { to: el }, slotContent);
      }
      return null;
    };
  },
});

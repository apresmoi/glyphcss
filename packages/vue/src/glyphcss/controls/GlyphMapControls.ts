/**
 * GlyphMapControls — Vue 3 map/pan controls for GlyphScene.
 */
import { defineComponent, inject, onMounted, onBeforeUnmount, watch, shallowRef } from "vue";
import type { GlyphMapControlsHandle, GlyphMapControlsOptions } from "glyphcss";
import { createGlyphMapControls } from "glyphcss";
import { GlyphSceneContextKey } from "../scene/context";

export interface GlyphMapControlsProps {
  drag?: boolean;
  wheel?: boolean;
  invert?: boolean | number;
  animate?: false | { speed?: number; axis?: "x" | "y"; pauseOnInteraction?: boolean };
}

export const GlyphMapControls = defineComponent({
  name: "GlyphMapControls",
  props: {
    drag: { type: Boolean, default: true },
    wheel: { type: Boolean, default: true },
    invert: { type: [Boolean, Number] as unknown as () => boolean | number, default: false },
    animate: { type: [Boolean, Object] as unknown as () => false | { speed?: number; axis?: "x" | "y"; pauseOnInteraction?: boolean }, default: false },
  },
  setup(props) {
    const sceneCtx = inject(GlyphSceneContextKey);
    if (!sceneCtx) {
      throw new Error("glyphcss: GlyphMapControls must be used inside a GlyphScene.");
    }
    const { sceneRef } = sceneCtx;
    const controlsRef = shallowRef<GlyphMapControlsHandle | null>(null);

    onMounted(() => {
      const scene = sceneRef.value;
      if (!scene) return;
      const opts: GlyphMapControlsOptions = {
        drag: props.drag,
        wheel: props.wheel,
        invert: props.invert,
        animate: props.animate === false ? false : props.animate,
      };
      controlsRef.value = createGlyphMapControls(scene, opts);
    });

    onBeforeUnmount(() => {
      controlsRef.value?.destroy();
      controlsRef.value = null;
    });

    watch(
      () => ({ drag: props.drag, wheel: props.wheel, invert: props.invert, animate: props.animate }),
      (next) => {
        controlsRef.value?.update({
          drag: next.drag,
          wheel: next.wheel,
          invert: next.invert,
          animate: next.animate === false ? false : next.animate,
        });
      },
    );

    return () => null;
  },
});

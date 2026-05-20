/**
 * GlyphOrbitControls — Vue 3 orbit controls for GlyphScene.
 */
import { defineComponent, inject, onMounted, onBeforeUnmount, watch, shallowRef } from "vue";
import type { GlyphOrbitControlsHandle, GlyphOrbitControlsOptions } from "glyphcss";
import { createGlyphOrbitControls } from "glyphcss";
import { GlyphSceneContextKey } from "../scene/context";

export interface GlyphOrbitControlsProps {
  drag?: boolean;
  wheel?: boolean;
  invert?: boolean | number;
  animate?: false | { speed?: number; axis?: "x" | "y"; pauseOnInteraction?: boolean };
}

export const GlyphOrbitControls = defineComponent({
  name: "GlyphOrbitControls",
  props: {
    drag: { type: Boolean, default: true },
    wheel: { type: Boolean, default: true },
    invert: { type: [Boolean, Number] as unknown as () => boolean | number, default: false },
    animate: { type: [Boolean, Object] as unknown as () => false | { speed?: number; axis?: "x" | "y"; pauseOnInteraction?: boolean }, default: false },
  },
  setup(props) {
    const sceneCtx = inject(GlyphSceneContextKey);
    if (!sceneCtx) {
      throw new Error("glyphcss: GlyphOrbitControls must be used inside a GlyphScene.");
    }
    const { sceneRef } = sceneCtx;
    const controlsRef = shallowRef<GlyphOrbitControlsHandle | null>(null);

    onMounted(() => {
      const scene = sceneRef.value;
      if (!scene) return;
      const opts: GlyphOrbitControlsOptions = {
        drag: props.drag,
        wheel: props.wheel,
        invert: props.invert,
        animate: props.animate === false ? false : props.animate,
      };
      controlsRef.value = createGlyphOrbitControls(scene, opts);
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

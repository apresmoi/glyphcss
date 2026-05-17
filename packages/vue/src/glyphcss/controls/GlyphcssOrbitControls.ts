/**
 * GlyphcssOrbitControls — Vue 3 orbit controls for GlyphcssScene.
 */
import { defineComponent, inject, onMounted, onBeforeUnmount, watch, shallowRef } from "vue";
import type { GlyphcssOrbitControlsHandle, GlyphcssOrbitControlsOptions } from "glyphcss";
import { createGlyphcssOrbitControls } from "glyphcss";
import { GlyphcssSceneContextKey } from "../scene/context";

export interface GlyphcssOrbitControlsProps {
  drag?: boolean;
  wheel?: boolean;
  invert?: boolean | number;
  animate?: false | { speed?: number; axis?: "x" | "y"; pauseOnInteraction?: boolean };
}

export const GlyphcssOrbitControls = defineComponent({
  name: "GlyphcssOrbitControls",
  props: {
    drag: { type: Boolean, default: true },
    wheel: { type: Boolean, default: true },
    invert: { type: [Boolean, Number] as unknown as () => boolean | number, default: false },
    animate: { type: [Boolean, Object] as unknown as () => false | { speed?: number; axis?: "x" | "y"; pauseOnInteraction?: boolean }, default: false },
  },
  setup(props) {
    const sceneCtx = inject(GlyphcssSceneContextKey);
    if (!sceneCtx) {
      throw new Error("glyphcss: GlyphcssOrbitControls must be used inside a GlyphcssScene.");
    }
    const { sceneRef } = sceneCtx;
    const controlsRef = shallowRef<GlyphcssOrbitControlsHandle | null>(null);

    onMounted(() => {
      const scene = sceneRef.value;
      if (!scene) return;
      const opts: GlyphcssOrbitControlsOptions = {
        drag: props.drag,
        wheel: props.wheel,
        invert: props.invert,
        animate: props.animate === false ? false : props.animate,
      };
      controlsRef.value = createGlyphcssOrbitControls(scene, opts);
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

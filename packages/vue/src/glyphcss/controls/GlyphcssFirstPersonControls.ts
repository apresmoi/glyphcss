/**
 * GlyphcssFirstPersonControls — Vue 3 first-person controls for GlyphcssScene.
 */
import { defineComponent, inject, onMounted, onBeforeUnmount, watch, shallowRef } from "vue";
import type { GlyphcssFirstPersonControlsHandle, GlyphcssFirstPersonControlsOptions } from "glyphcss";
import { createGlyphcssFirstPersonControls } from "glyphcss";
import { GlyphcssSceneContextKey } from "../scene/context";

export interface GlyphcssFirstPersonControlsProps {
  drag?: boolean;
  keyboard?: boolean;
  moveSpeed?: number;
  lookSpeed?: number;
  invert?: boolean | number;
}

export const GlyphcssFirstPersonControls = defineComponent({
  name: "GlyphcssFirstPersonControls",
  props: {
    drag: { type: Boolean, default: true },
    keyboard: { type: Boolean, default: true },
    moveSpeed: { type: Number, default: 0.05 },
    lookSpeed: { type: Number, default: 0.004 },
    invert: { type: [Boolean, Number] as unknown as () => boolean | number, default: false },
  },
  setup(props) {
    const sceneCtx = inject(GlyphcssSceneContextKey);
    if (!sceneCtx) {
      throw new Error("glyphcss: GlyphcssFirstPersonControls must be used inside a GlyphcssScene.");
    }
    const { sceneRef } = sceneCtx;
    const controlsRef = shallowRef<GlyphcssFirstPersonControlsHandle | null>(null);

    onMounted(() => {
      const scene = sceneRef.value;
      if (!scene) return;
      const opts: GlyphcssFirstPersonControlsOptions = {
        drag: props.drag,
        keyboard: props.keyboard,
        moveSpeed: props.moveSpeed,
        lookSpeed: props.lookSpeed,
        invert: props.invert,
      };
      controlsRef.value = createGlyphcssFirstPersonControls(scene, opts);
    });

    onBeforeUnmount(() => {
      controlsRef.value?.destroy();
      controlsRef.value = null;
    });

    watch(
      () => ({ drag: props.drag, keyboard: props.keyboard, moveSpeed: props.moveSpeed, lookSpeed: props.lookSpeed, invert: props.invert }),
      (next) => {
        controlsRef.value?.update(next);
      },
    );

    return () => null;
  },
});

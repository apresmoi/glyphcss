/**
 * GlyphFirstPersonControls — Vue 3 first-person controls for GlyphScene.
 */
import { defineComponent, inject, onBeforeUnmount, watch, shallowRef, watchEffect } from "vue";
import type { GlyphFirstPersonControlsHandle, GlyphFirstPersonControlsOptions } from "glyphcss";
import { createGlyphFirstPersonControls } from "glyphcss";
import { GlyphSceneContextKey } from "../scene/context";

export interface GlyphFirstPersonControlsProps {
  drag?: boolean;
  keyboard?: boolean;
  moveSpeed?: number;
  lookSpeed?: number;
  invert?: boolean | number;
}

export const GlyphFirstPersonControls = defineComponent({
  name: "GlyphFirstPersonControls",
  props: {
    drag: { type: Boolean, default: true },
    keyboard: { type: Boolean, default: true },
    moveSpeed: { type: Number, default: 0.05 },
    lookSpeed: { type: Number, default: 0.004 },
    invert: { type: [Boolean, Number] as unknown as () => boolean | number, default: false },
  },
  setup(props) {
    const sceneCtx = inject(GlyphSceneContextKey);
    if (!sceneCtx) {
      throw new Error("glyphcss: GlyphFirstPersonControls must be used inside a GlyphScene.");
    }
    const { sceneRef } = sceneCtx;
    const controlsRef = shallowRef<GlyphFirstPersonControlsHandle | null>(null);

    // In Vue 3, child onMounted hooks fire before parent onMounted, so
    // sceneRef.value is null when this runs. Watch for the scene to appear.
    const stopWatch = watchEffect(() => {
      const scene = sceneRef.value;
      if (!scene || controlsRef.value) return;
      const opts: GlyphFirstPersonControlsOptions = {
        drag: props.drag,
        keyboard: props.keyboard,
        moveSpeed: props.moveSpeed,
        lookSpeed: props.lookSpeed,
        invert: props.invert,
      };
      controlsRef.value = createGlyphFirstPersonControls(scene, opts);
    });

    onBeforeUnmount(() => {
      stopWatch();
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

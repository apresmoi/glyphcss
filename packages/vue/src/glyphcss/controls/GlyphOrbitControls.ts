/**
 * GlyphOrbitControls — Vue 3 orbit controls for GlyphScene.
 */
import { defineComponent, inject, onBeforeUnmount, watch, shallowRef, watchEffect } from "vue";
import type { PropType } from "vue";
import type { GlyphOrbitControlsHandle, GlyphOrbitControlsMode, GlyphOrbitControlsOptions } from "glyphcss";
import { createGlyphOrbitControls } from "glyphcss";
import { GlyphSceneContextKey } from "../scene/context";

export interface GlyphOrbitControlsProps {
  drag?: boolean;
  wheel?: boolean;
  invert?: boolean | number;
  /**
   * Turntable-mode pitch clamp, `[min, max]` degrees, or `null` for
   * unrestricted tumbling (views from below the equator included; the
   * up-vector never rolls). Default `[-90, 90]`. No-op in `"trackball"` mode.
   */
  pitchRange?: [number, number] | null;
  /**
   * `"turntable"` (default) — Euler orbit, up-vector locked. `"trackball"` —
   * free rotation about the screen axis perpendicular to the drag, reaching
   * any orientation including roll; a two-finger twist rolls.
   */
  mode?: GlyphOrbitControlsMode;
  animate?: false | { speed?: number; axis?: "x" | "y"; pauseOnInteraction?: boolean };
  /**
   * Wheel/pinch zoom clamp, `[min, max]`, or `null` to disable clamping.
   * Omitted (default): resolved once at mount from the camera's own
   * starting `zoom` — see `createGlyphOrbitControls`'s own doc.
   */
  zoomRange?: [number, number] | null;
  /**
   * Middle/right-button drag, Shift+left drag, or a two-finger touch drag
   * pans `camera.target` in the screen plane. Default true.
   */
  pan?: boolean;
}

export const GlyphOrbitControls = defineComponent({
  name: "GlyphOrbitControls",
  props: {
    drag: { type: Boolean, default: true },
    wheel: { type: Boolean, default: true },
    invert: { type: [Boolean, Number] as unknown as () => boolean | number, default: false },
    pitchRange: { type: null as unknown as PropType<[number, number] | null>, default: () => [-90, 90] },
    mode: { type: String as unknown as () => GlyphOrbitControlsMode, default: "turntable" },
    animate: { type: [Boolean, Object] as unknown as () => false | { speed?: number; axis?: "x" | "y"; pauseOnInteraction?: boolean }, default: false },
    zoomRange: { type: null as unknown as PropType<[number, number] | null | undefined>, default: undefined },
    pan: { type: Boolean, default: true },
  },
  setup(props) {
    const sceneCtx = inject(GlyphSceneContextKey);
    if (!sceneCtx) {
      throw new Error("glyphcss: GlyphOrbitControls must be used inside a GlyphScene.");
    }
    const { sceneRef } = sceneCtx;
    const controlsRef = shallowRef<GlyphOrbitControlsHandle | null>(null);

    // In Vue 3, child onMounted hooks fire before parent onMounted, so
    // sceneRef.value is null when this runs. Watch for the scene to appear.
    const stopWatch = watchEffect(() => {
      const scene = sceneRef.value;
      if (!scene || controlsRef.value) return;
      const opts: GlyphOrbitControlsOptions = {
        drag: props.drag,
        wheel: props.wheel,
        invert: props.invert,
        pitchRange: props.pitchRange,
        mode: props.mode,
        animate: props.animate === false ? false : props.animate,
        zoomRange: props.zoomRange,
        pan: props.pan,
      };
      controlsRef.value = createGlyphOrbitControls(scene, opts);
    });

    onBeforeUnmount(() => {
      stopWatch();
      controlsRef.value?.destroy();
      controlsRef.value = null;
    });

    watch(
      () => ({ drag: props.drag, wheel: props.wheel, invert: props.invert, pitchRange: props.pitchRange, mode: props.mode, animate: props.animate, zoomRange: props.zoomRange, pan: props.pan }),
      (next) => {
        controlsRef.value?.update({
          drag: next.drag,
          wheel: next.wheel,
          invert: next.invert,
          pitchRange: next.pitchRange,
          mode: next.mode,
          animate: next.animate === false ? false : next.animate,
          zoomRange: next.zoomRange,
          pan: next.pan,
        });
      },
    );

    return () => null;
  },
});

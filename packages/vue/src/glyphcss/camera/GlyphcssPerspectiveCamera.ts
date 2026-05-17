/**
 * GlyphcssPerspectiveCamera — Vue 3 camera component for the ASCII backend.
 * Must be placed inside <GlyphcssScene>.
 */
import { defineComponent, inject, provide, shallowRef, watch, onMounted } from "vue";
import type { PropType } from "vue";
import type { GlyphcssCamera, GlyphcssPerspectiveCameraOptions } from "glyphcss";
import { createGlyphcssPerspectiveCamera } from "glyphcss";
import { GlyphcssSceneContextKey } from "../scene/context";
import { GlyphcssCameraContextKey } from "./context";

export interface GlyphcssPerspectiveCameraProps {
  rotX?: number;
  rotY?: number;
  distance?: number;
  scale?: number;
  stretch?: number;
  center?: [number, number];
}

export const GlyphcssPerspectiveCamera = defineComponent({
  name: "GlyphcssPerspectiveCamera",
  props: {
    rotX: { type: Number, default: undefined },
    rotY: { type: Number, default: undefined },
    distance: { type: Number, default: undefined },
    scale: { type: Number, default: undefined },
    stretch: { type: Number, default: undefined },
    center: { type: Array as unknown as PropType<[number, number]>, default: undefined },
  },
  setup(props, { slots }) {
    const sceneCtx = inject(GlyphcssSceneContextKey);
    if (!sceneCtx) {
      throw new Error("glyphcss: GlyphcssPerspectiveCamera must be used inside a GlyphcssScene.");
    }
    const { sceneRef } = sceneCtx;

    const cameraRef = shallowRef<GlyphcssCamera | null>(null);

    function rerender(): void {
      sceneRef.value?.rerender();
    }

    provide(GlyphcssCameraContextKey, { cameraRef, rerender });

    onMounted(() => {
      const opts: GlyphcssPerspectiveCameraOptions = {};
      if (props.rotX !== undefined) opts.rotX = props.rotX;
      if (props.rotY !== undefined) opts.rotY = props.rotY;
      if (props.distance !== undefined) opts.distance = props.distance;
      if (props.scale !== undefined) opts.scale = props.scale;
      if (props.stretch !== undefined) opts.stretch = props.stretch;
      if (props.center !== undefined) opts.center = props.center;
      const camera = createGlyphcssPerspectiveCamera(opts);
      cameraRef.value = camera;
      const scene = sceneRef.value;
      if (scene) {
        scene.setOptions({ camera });
        scene.rerender();
      }
    });

    // Sync prop changes
    watch(
      () => ({ rotX: props.rotX, rotY: props.rotY, distance: props.distance, scale: props.scale, stretch: props.stretch }),
      (next) => {
        const camera = cameraRef.value;
        if (!camera) return;
        let dirty = false;
        if (next.rotX !== undefined && camera.rotX !== next.rotX) { camera.rotX = next.rotX; dirty = true; }
        if (next.rotY !== undefined && camera.rotY !== next.rotY) { camera.rotY = next.rotY; dirty = true; }
        if (next.distance !== undefined && camera.distance !== next.distance) { camera.distance = next.distance; dirty = true; }
        if (next.scale !== undefined && camera.scale !== next.scale) { camera.scale = next.scale; dirty = true; }
        if (next.stretch !== undefined && camera.stretch !== next.stretch) { camera.stretch = next.stretch; dirty = true; }
        if (dirty) sceneRef.value?.rerender();
      },
    );

    return () => slots.default?.() ?? null;
  },
});

/**
 * GlyphcssOrthographicCamera — Vue 3 orthographic camera for the ASCII backend.
 */
import { defineComponent, inject, provide, shallowRef, watch, onMounted } from "vue";
import type { PropType } from "vue";
import type { GlyphcssCamera, GlyphcssOrthographicCameraOptions } from "glyphcss";
import { createGlyphcssOrthographicCamera } from "glyphcss";
import { GlyphcssSceneContextKey } from "../scene/context";
import { GlyphcssCameraContextKey } from "./context";

export interface GlyphcssOrthographicCameraProps {
  rotX?: number;
  rotY?: number;
  zoom?: number;
  center?: [number, number];
}

export const GlyphcssOrthographicCamera = defineComponent({
  name: "GlyphcssOrthographicCamera",
  props: {
    rotX: { type: Number, default: undefined },
    rotY: { type: Number, default: undefined },
    zoom: { type: Number, default: undefined },
    center: { type: Array as unknown as PropType<[number, number]>, default: undefined },
  },
  setup(props, { slots }) {
    const sceneCtx = inject(GlyphcssSceneContextKey);
    if (!sceneCtx) {
      throw new Error("glyphcss: GlyphcssOrthographicCamera must be used inside a GlyphcssScene.");
    }
    const { sceneRef } = sceneCtx;
    const cameraRef = shallowRef<GlyphcssCamera | null>(null);

    function rerender(): void {
      sceneRef.value?.rerender();
    }

    provide(GlyphcssCameraContextKey, { cameraRef, rerender });

    onMounted(() => {
      const opts: GlyphcssOrthographicCameraOptions = {};
      if (props.rotX !== undefined) opts.rotX = props.rotX;
      if (props.rotY !== undefined) opts.rotY = props.rotY;
      if (props.zoom !== undefined) opts.zoom = props.zoom;
      if (props.center !== undefined) opts.center = props.center;
      const camera = createGlyphcssOrthographicCamera(opts);
      cameraRef.value = camera;
      const scene = sceneRef.value;
      if (scene) {
        scene.setOptions({ camera });
        scene.rerender();
      }
    });

    watch(
      () => ({ rotX: props.rotX, rotY: props.rotY, zoom: props.zoom }),
      (next) => {
        const camera = cameraRef.value;
        if (!camera) return;
        let dirty = false;
        if (next.rotX !== undefined && camera.rotX !== next.rotX) { camera.rotX = next.rotX; dirty = true; }
        if (next.rotY !== undefined && camera.rotY !== next.rotY) { camera.rotY = next.rotY; dirty = true; }
        if (next.zoom !== undefined && camera.zoom !== next.zoom) { camera.zoom = next.zoom; dirty = true; }
        if (dirty) sceneRef.value?.rerender();
      },
    );

    return () => slots.default?.() ?? null;
  },
});

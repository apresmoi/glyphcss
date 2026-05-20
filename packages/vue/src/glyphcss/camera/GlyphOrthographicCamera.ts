/**
 * GlyphOrthographicCamera — Vue 3 orthographic camera for the ASCII backend.
 */
import { defineComponent, inject, provide, shallowRef, watch, onMounted } from "vue";
import type { PropType } from "vue";
import type { GlyphCamera, GlyphOrthographicCameraOptions } from "glyphcss";
import { createGlyphOrthographicCamera } from "glyphcss";
import { GlyphSceneContextKey } from "../scene/context";
import { GlyphCameraContextKey } from "./context";

export interface GlyphOrthographicCameraProps {
  rotX?: number;
  rotY?: number;
  zoom?: number;
  center?: [number, number];
}

export const GlyphOrthographicCamera = defineComponent({
  name: "GlyphOrthographicCamera",
  props: {
    rotX: { type: Number, default: undefined },
    rotY: { type: Number, default: undefined },
    zoom: { type: Number, default: undefined },
    center: { type: Array as unknown as PropType<[number, number]>, default: undefined },
  },
  setup(props, { slots }) {
    const sceneCtx = inject(GlyphSceneContextKey);
    if (!sceneCtx) {
      throw new Error("glyphcss: GlyphOrthographicCamera must be used inside a GlyphScene.");
    }
    const { sceneRef } = sceneCtx;
    const cameraRef = shallowRef<GlyphCamera | null>(null);

    function rerender(): void {
      sceneRef.value?.rerender();
    }

    provide(GlyphCameraContextKey, { cameraRef, rerender });

    onMounted(() => {
      const opts: GlyphOrthographicCameraOptions = {};
      if (props.rotX !== undefined) opts.rotX = props.rotX;
      if (props.rotY !== undefined) opts.rotY = props.rotY;
      if (props.zoom !== undefined) opts.zoom = props.zoom;
      if (props.center !== undefined) opts.center = props.center;
      const camera = createGlyphOrthographicCamera(opts);
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

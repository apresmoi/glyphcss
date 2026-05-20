/**
 * GlyphPerspectiveCamera — Vue 3 camera component for the ASCII backend.
 * Must be placed inside <GlyphScene>.
 */
import { defineComponent, inject, provide, shallowRef, watch, onMounted } from "vue";
import type { PropType } from "vue";
import type { GlyphCamera, GlyphPerspectiveCameraOptions } from "glyphcss";
import { createGlyphPerspectiveCamera } from "glyphcss";
import { GlyphSceneContextKey } from "../scene/context";
import { GlyphCameraContextKey } from "./context";

export interface GlyphPerspectiveCameraProps {
  rotX?: number;
  rotY?: number;
  distance?: number;
  zoom?: number;
  stretch?: number;
  center?: [number, number];
}

export const GlyphPerspectiveCamera = defineComponent({
  name: "GlyphPerspectiveCamera",
  props: {
    rotX: { type: Number, default: undefined },
    rotY: { type: Number, default: undefined },
    distance: { type: Number, default: undefined },
    zoom: { type: Number, default: undefined },
    stretch: { type: Number, default: undefined },
    center: { type: Array as unknown as PropType<[number, number]>, default: undefined },
  },
  setup(props, { slots }) {
    const sceneCtx = inject(GlyphSceneContextKey);
    if (!sceneCtx) {
      throw new Error("glyphcss: GlyphPerspectiveCamera must be used inside a GlyphScene.");
    }
    const { sceneRef } = sceneCtx;

    const cameraRef = shallowRef<GlyphCamera | null>(null);

    function rerender(): void {
      sceneRef.value?.rerender();
    }

    provide(GlyphCameraContextKey, { cameraRef, rerender });

    onMounted(() => {
      const opts: GlyphPerspectiveCameraOptions = {};
      if (props.rotX !== undefined) opts.rotX = props.rotX;
      if (props.rotY !== undefined) opts.rotY = props.rotY;
      if (props.distance !== undefined) opts.distance = props.distance;
      if (props.zoom !== undefined) opts.zoom = props.zoom;
      if (props.stretch !== undefined) opts.stretch = props.stretch;
      if (props.center !== undefined) opts.center = props.center;
      const camera = createGlyphPerspectiveCamera(opts);
      cameraRef.value = camera;
      const scene = sceneRef.value;
      if (scene) {
        scene.setOptions({ camera });
        scene.rerender();
      }
    });

    // Sync prop changes
    watch(
      () => ({ rotX: props.rotX, rotY: props.rotY, distance: props.distance, zoom: props.zoom, stretch: props.stretch }),
      (next) => {
        const camera = cameraRef.value;
        if (!camera) return;
        let dirty = false;
        if (next.rotX !== undefined && camera.rotX !== next.rotX) { camera.rotX = next.rotX; dirty = true; }
        if (next.rotY !== undefined && camera.rotY !== next.rotY) { camera.rotY = next.rotY; dirty = true; }
        if (next.distance !== undefined && camera.distance !== next.distance) { camera.distance = next.distance; dirty = true; }
        if (next.zoom !== undefined && camera.zoom !== next.zoom) { camera.zoom = next.zoom; dirty = true; }
        if (next.stretch !== undefined && camera.stretch !== next.stretch) { camera.stretch = next.stretch; dirty = true; }
        if (dirty) sceneRef.value?.rerender();
      },
    );

    return () => slots.default?.() ?? null;
  },
});

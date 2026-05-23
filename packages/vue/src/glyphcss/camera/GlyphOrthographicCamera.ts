/**
 * GlyphOrthographicCamera — outer wrapper that creates an orthographic camera
 * handle and provides it via GlyphCameraContextKey. <GlyphScene> must be
 * placed inside this component.
 */
import { defineComponent, h, provide, shallowRef, watch } from "vue";
import type { PropType, ShallowRef, CSSProperties } from "vue";
import type { GlyphCamera, GlyphOrthographicCameraOptions } from "glyphcss";
import { createGlyphOrthographicCamera } from "glyphcss";
import { GlyphCameraContextKey } from "./context";

export interface GlyphOrthographicCameraProps {
  rotX?: number;
  rotY?: number;
  zoom?: number;
  center?: [number, number];
  class?: string;
  style?: CSSProperties | string;
}

export const GlyphOrthographicCamera = defineComponent({
  name: "GlyphOrthographicCamera",
  props: {
    rotX: { type: Number, default: undefined },
    rotY: { type: Number, default: undefined },
    zoom: { type: Number, default: undefined },
    center: { type: Array as unknown as PropType<[number, number]>, default: undefined },
    class: { type: String, default: undefined },
    style: { type: [Object, String] as unknown as PropType<CSSProperties | string>, default: undefined },
  },
  setup(props, { slots }) {
    const opts: GlyphOrthographicCameraOptions = {};
    if (props.rotX !== undefined) opts.rotX = props.rotX;
    if (props.rotY !== undefined) opts.rotY = props.rotY;
    if (props.zoom !== undefined) opts.zoom = props.zoom;
    if (props.center !== undefined) opts.center = props.center;

    const cameraRef = shallowRef<GlyphCamera | null>(createGlyphOrthographicCamera(opts));
    // The child GlyphScene will set this to trigger rerenders when camera props change.
    const sceneRerenderRef: ShallowRef<(() => void) | null> = shallowRef(null);

    function rerender(): void {
      sceneRerenderRef.value?.();
    }

    provide(GlyphCameraContextKey, { cameraRef, rerender, sceneRerenderRef });

    watch(
      () => ({ rotX: props.rotX, rotY: props.rotY, zoom: props.zoom }),
      (next) => {
        const camera = cameraRef.value;
        if (!camera) return;
        let dirty = false;
        if (next.rotX !== undefined && camera.rotX !== next.rotX) { camera.rotX = next.rotX; dirty = true; }
        if (next.rotY !== undefined && camera.rotY !== next.rotY) { camera.rotY = next.rotY; dirty = true; }
        if (next.zoom !== undefined && camera.zoom !== next.zoom) { camera.zoom = next.zoom; dirty = true; }
        if (dirty) sceneRerenderRef.value?.();
      },
    );

    return () => h(
      "div",
      {
        class: props.class,
        style: props.style,
      },
      slots.default?.() ?? [],
    );
  },
});

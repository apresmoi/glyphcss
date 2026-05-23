/**
 * GlyphPerspectiveCamera — outer wrapper that creates a perspective camera
 * handle and provides it via GlyphCameraContextKey. <GlyphScene> must be
 * placed inside this component.
 */
import { defineComponent, h, provide, shallowRef, watch } from "vue";
import type { PropType, ShallowRef, CSSProperties } from "vue";
import type { GlyphCamera, GlyphPerspectiveCameraOptions } from "glyphcss";
import { createGlyphPerspectiveCamera } from "glyphcss";
import { GlyphCameraContextKey } from "./context";

export interface GlyphPerspectiveCameraProps {
  rotX?: number;
  rotY?: number;
  distance?: number;
  zoom?: number;
  stretch?: number;
  center?: [number, number];
  class?: string;
  style?: CSSProperties | string;
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
    class: { type: String, default: undefined },
    style: { type: [Object, String] as unknown as PropType<CSSProperties | string>, default: undefined },
  },
  setup(props, { slots }) {
    const opts: GlyphPerspectiveCameraOptions = {};
    if (props.rotX !== undefined) opts.rotX = props.rotX;
    if (props.rotY !== undefined) opts.rotY = props.rotY;
    if (props.distance !== undefined) opts.distance = props.distance;
    if (props.zoom !== undefined) opts.zoom = props.zoom;
    if (props.stretch !== undefined) opts.stretch = props.stretch;
    if (props.center !== undefined) opts.center = props.center;

    const cameraRef = shallowRef<GlyphCamera | null>(createGlyphPerspectiveCamera(opts));
    // The child GlyphScene will set this to trigger rerenders when camera props change.
    const sceneRerenderRef: ShallowRef<(() => void) | null> = shallowRef(null);

    function rerender(): void {
      sceneRerenderRef.value?.();
    }

    provide(GlyphCameraContextKey, { cameraRef, rerender, sceneRerenderRef });

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

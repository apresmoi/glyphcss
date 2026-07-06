import { defineComponent, h, provide, shallowRef, watch } from "vue";
import type { CSSProperties, PropType, ShallowRef } from "vue";
import type { GlyphCamera } from "glyphcss";
import { OrthographicCamera } from "@glyphcss/core/three";
import type { Vector3Tuple } from "@glyphcss/core/three";
import { GlyphCameraContextKey } from "../glyphcss/camera/context";

export interface GlyphThreeOrthographicCameraProps {
  left?: number;
  right?: number;
  top?: number;
  bottom?: number;
  near?: number;
  far?: number;
  zoom?: number;
  center?: [number, number];
  position?: Vector3Tuple;
  lookAt?: Vector3Tuple;
  up?: Vector3Tuple;
  class?: string;
  style?: CSSProperties | string;
}

export const GlyphThreeOrthographicCamera = defineComponent({
  name: "GlyphThreeOrthographicCamera",
  props: {
    left: { type: Number, default: -1 },
    right: { type: Number, default: 1 },
    top: { type: Number, default: 1 },
    bottom: { type: Number, default: -1 },
    near: { type: Number, default: 0.1 },
    far: { type: Number, default: 2000 },
    zoom: { type: Number, default: undefined },
    center: { type: Array as unknown as PropType<[number, number]>, default: undefined },
    position: { type: Array as unknown as PropType<Vector3Tuple>, default: undefined },
    lookAt: { type: Array as unknown as PropType<Vector3Tuple>, default: undefined },
    up: { type: Array as unknown as PropType<Vector3Tuple>, default: undefined },
    class: { type: String, default: undefined },
    style: { type: [Object, String] as unknown as PropType<CSSProperties | string>, default: undefined },
  },
  setup(props, { slots }) {
    const cameraRef = shallowRef<GlyphCamera | null>(
      new OrthographicCamera(props.left, props.right, props.top, props.bottom, props.near, props.far),
    );
    const sceneRerenderRef: ShallowRef<(() => void) | null> = shallowRef(null);

    function rerender(): void {
      sceneRerenderRef.value?.();
    }

    provide(GlyphCameraContextKey, { cameraRef, rerender, sceneRerenderRef });

    watch(
      () => ({
        left: props.left,
        right: props.right,
        top: props.top,
        bottom: props.bottom,
        near: props.near,
        far: props.far,
        zoom: props.zoom,
        center: props.center,
        position: props.position,
        lookAt: props.lookAt,
        up: props.up,
      }),
      (next) => {
        const camera = cameraRef.value as OrthographicCamera | null;
        if (!camera) return;
        camera.left = next.left;
        camera.right = next.right;
        camera.top = next.top;
        camera.bottom = next.bottom;
        camera.near = next.near;
        camera.far = next.far;
        if (next.zoom !== undefined) camera.zoom = next.zoom;
        if (next.center !== undefined) camera.center = next.center;
        if (next.position !== undefined) camera.position.set(next.position[0], next.position[1], next.position[2]);
        if (next.up !== undefined) camera.up.set(next.up[0], next.up[1], next.up[2]);
        if (next.lookAt !== undefined) camera.lookAt(next.lookAt[0], next.lookAt[1], next.lookAt[2]);
        sceneRerenderRef.value?.();
      },
      { immediate: true },
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

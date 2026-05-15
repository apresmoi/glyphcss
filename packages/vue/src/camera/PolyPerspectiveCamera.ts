/**
 * PolyPerspectiveCamera — Vue camera component with CSS perspective projection.
 * Mirrors React's PolyPerspectiveCamera.
 *
 * Uses `perspective: <n>px` on the wrapper element (defaults to 8000px).
 * Prefer this over the generic PolyCamera alias for explicit three.js-style naming.
 */
import { defineComponent, h, provide, computed } from "vue";
import type { PropType } from "vue";
import type { Vec3 } from "@layoutit/polycss-core";
import { usePolyCamera } from "./useCamera";
import { PolyCameraContextKey } from "./context";

const DEFAULT_PERSPECTIVE = 8000;

export interface PolyPerspectiveCameraProps {
  zoom?: number;
  target?: Vec3;
  rotX?: number;
  rotY?: number;
  /** Camera pull-back in CSS pixels (dolly). Default 0. */
  distance?: number;
  /** CSS perspective distance in pixels. Defaults to 8000. */
  perspective?: number;
  class?: string;
}

export const PolyPerspectiveCamera = defineComponent({
  name: "PolyPerspectiveCamera",
  props: {
    zoom: { type: Number },
    target: { type: Array as unknown as PropType<Vec3> },
    rotX: { type: Number },
    rotY: { type: Number },
    distance: { type: Number },
    perspective: { type: Number, default: undefined },
    class: { type: String },
  },
  setup(props, { slots }) {
    const cameraOptions = computed(() => ({
      zoom: props.zoom,
      target: props.target,
      rotX: props.rotX,
      rotY: props.rotY,
      distance: props.distance,
    }));

    const {
      store,
      cameraRef,
      sceneElRef,
      cameraElRef,
      autoCenterOffset,
      applyTransformDirect,
    } = usePolyCamera(cameraOptions);

    provide(PolyCameraContextKey, { store, cameraRef, sceneElRef, cameraElRef, autoCenterOffset, applyTransformDirect });

    return () => {
      const perspectiveValue = `${typeof props.perspective === "number" ? props.perspective : DEFAULT_PERSPECTIVE}px`;

      return h(
        "div",
        {
          ref: cameraElRef,
          class: `polycss-camera${props.class ? ` ${props.class}` : ""}`,
          style: { perspective: perspectiveValue },
        },
        slots.default?.()
      );
    };
  },
});

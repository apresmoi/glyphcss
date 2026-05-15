/**
 * PolyOrthographicCamera — Vue camera component with no CSS perspective.
 * Mirrors React's PolyOrthographicCamera.
 *
 * Sets `perspective: none` on the wrapper element, yielding an isometric-style
 * flat projection. Prefer this over PolyCamera with perspective=false for
 * explicit three.js-style naming.
 */
import { defineComponent, h, provide, computed } from "vue";
import type { PropType } from "vue";
import type { Vec3 } from "@layoutit/polycss-core";
import { usePolyCamera } from "./useCamera";
import { PolyCameraContextKey } from "./context";

export interface PolyOrthographicCameraProps {
  zoom?: number;
  target?: Vec3;
  rotX?: number;
  rotY?: number;
  /** Camera pull-back in CSS pixels (dolly). Default 0. */
  distance?: number;
  class?: string;
}

export const PolyOrthographicCamera = defineComponent({
  name: "PolyOrthographicCamera",
  props: {
    zoom: { type: Number },
    target: { type: Array as unknown as PropType<Vec3> },
    rotX: { type: Number },
    rotY: { type: Number },
    distance: { type: Number },
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
      return h(
        "div",
        {
          ref: cameraElRef,
          class: `polycss-camera${props.class ? ` ${props.class}` : ""}`,
          style: { perspective: "none" },
        },
        slots.default?.()
      );
    };
  },
});

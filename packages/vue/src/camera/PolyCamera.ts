import { defineComponent, h, provide, computed } from "vue";
import type { PropType } from "vue";
import { useCamera } from "./useCamera";
import { PolyCameraContextKey } from "./context";

const DEFAULT_PERSPECTIVE = 8000;

export interface PolyCameraProps {
  zoom?: number;
  pan?: number;
  tilt?: number;
  rotX?: number;
  rotY?: number;
  perspective?: number | boolean;
  class?: string;
}

export const PolyCamera = defineComponent({
  name: "PolyCamera",
  props: {
    zoom: { type: Number },
    pan: { type: Number },
    tilt: { type: Number },
    rotX: { type: Number },
    rotY: { type: Number },
    perspective: { type: [Number, Boolean] as PropType<number | boolean>, default: undefined },
    class: { type: String },
  },
  setup(props, { slots }) {
    const cameraOptions = computed(() => ({
      zoom: props.zoom,
      pan: props.pan,
      tilt: props.tilt,
      rotX: props.rotX,
      rotY: props.rotY,
    }));

    const {
      store,
      cameraRef,
      sceneElRef,
      cameraElRef,
      applyTransformDirect,
    } = useCamera(cameraOptions);

    // Provide context — stable identity (refs + applyTransformDirect)
    provide(PolyCameraContextKey, { store, cameraRef, sceneElRef, cameraElRef, applyTransformDirect });

    return () => {
      const perspectiveValue =
        props.perspective === false
          ? "none"
          : `${typeof props.perspective === "number" ? props.perspective : DEFAULT_PERSPECTIVE}px`;

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

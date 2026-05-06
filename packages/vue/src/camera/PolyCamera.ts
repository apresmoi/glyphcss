import { defineComponent, h, provide, computed } from "vue";
import type { PropType } from "vue";
import type { AutoRotateOption } from "@polycss/core";
import { useCamera } from "./useCamera";
import { PolyCameraContextKey } from "./context";

const DEFAULT_PERSPECTIVE = 8000;

export interface PolyCameraProps {
  zoom?: number;
  pan?: number;
  tilt?: number;
  rotX?: number;
  rotY?: number;
  interactive?: boolean;
  invert?: boolean | number;
  animate?: AutoRotateOption | false;
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
    interactive: { type: Boolean },
    invert: { type: [Boolean, Number] as PropType<boolean | number> },
    animate: { type: [Boolean, Number, Object] as PropType<AutoRotateOption | false> },
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
      interactive: props.interactive,
      invert: props.invert,
      animate: props.animate,
    }));

    const {
      store,
      cameraRef,
      sceneElRef,
      cameraElRef,
      applyTransformDirect,
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel,
      cursor,
    } = useCamera(cameraOptions);

    // Provide context — stable identity (refs + applyTransformDirect)
    provide(PolyCameraContextKey, { store, cameraRef, sceneElRef, cameraElRef, applyTransformDirect });

    return () => {
      const perspectiveValue =
        props.perspective === false
          ? "none"
          : `${typeof props.perspective === "number" ? props.perspective : DEFAULT_PERSPECTIVE}px`;

      const cameraStyle: Record<string, string | undefined> = {
        perspective: perspectiveValue,
        cursor: props.interactive ? cursor.value : undefined,
        touchAction: props.interactive ? "none" : undefined,
        userSelect: props.interactive ? "none" : undefined,
      };

      return h(
        "div",
        {
          ref: cameraElRef,
          class: `polycss-camera${props.class ? ` ${props.class}` : ""}`,
          style: cameraStyle,
          onPointerdown: props.interactive ? onPointerDown : undefined,
          onPointermove: props.interactive ? onPointerMove : undefined,
          onPointerup: props.interactive ? onPointerUp : undefined,
          onPointercancel: props.interactive ? onPointerCancel : undefined,
        },
        slots.default?.()
      );
    };
  },
});

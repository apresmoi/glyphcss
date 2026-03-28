import { defineComponent, h, provide, computed } from "vue";
import type { PropType } from "vue";
import type { AutoRotateOption } from "@layoutit/voxcss-core";
import { useCamera } from "./useCamera";
import { VoxCameraContextKey } from "./context";

const DEFAULT_PERSPECTIVE = 8000;

export const VoxCamera = defineComponent({
  name: "VoxCamera",
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
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel,
      cursor,
    } = useCamera(cameraOptions);

    // Provide context — stable identity
    provide(VoxCameraContextKey, { store, cameraRef, sceneElRef });

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
          class: `voxcss-camera${props.class ? ` ${props.class}` : ""}`,
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

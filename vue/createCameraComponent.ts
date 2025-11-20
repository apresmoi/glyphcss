import { defineComponent, h, computed, provide } from "vue";
import type { PropType } from "vue";
import type { AutoRotateOption } from "@voxcss/core/camera";
import {
  CAMERA_HOST_CLASS,
  createCameraBindingProps,
  resolveCameraSlotProps
} from "@voxcss/controller/createCameraComponentCore";
import { useCameraBinding } from "./bindings";
import { CONTROLLER_KEY } from "./controllerKey";

export function createCameraComponent() {
  return defineComponent({
    name: "VoxCamera",
    props: {
      zoom: { type: Number },
      pan: { type: Number },
      tilt: { type: Number },
      rotX: { type: Number },
      rotY: { type: Number },
      invert: { type: [Boolean, Number] },
      perspective: { type: [Number, Boolean] },
      interactive: { type: Boolean },
      animate: { type: [Boolean, Number, Object] as PropType<AutoRotateOption | false> }
    },
    setup(props, { slots, expose }) {
      const bindingProps = () =>
        createCameraBindingProps({
          interactive: props.interactive,
          perspective: props.perspective,
          zoom: props.zoom,
          pan: props.pan,
          tilt: props.tilt,
          rotX: props.rotX,
          rotY: props.rotY,
          invert: props.invert,
          animate: props.animate
        });
      const { elementRef, controller, snapshot, startAutoRotate, stopAutoRotate } = useCameraBinding(bindingProps);
      provide(CONTROLLER_KEY, controller);

      const slotProps = computed(() => resolveCameraSlotProps(controller.value, snapshot.value));
      const cursorStyle = computed(() => slotProps.value?.cursor ?? "default");

      expose({
        get controller() {
          if (!controller.value) {
            throw new Error("voxcss: controller is not ready yet.");
          }
          return controller.value;
        },
        startAutoRotate(config?: AutoRotateOption) {
          startAutoRotate(config ?? props.animate);
        },
        stopAutoRotate() {
          stopAutoRotate();
        }
      });

      return () => {
        const currentSlot = slotProps.value;
        const children = currentSlot && slots.default ? slots.default(currentSlot) : undefined;

        return h(
          "div",
          {
            class: CAMERA_HOST_CLASS,
            ref: elementRef,
            style: { cursor: cursorStyle.value }
          },
          children
        );
      };
    }
  });
}

export type { CameraComponentProps } from "@voxcss/controller/createCameraComponentCore";

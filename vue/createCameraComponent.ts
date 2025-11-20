import { defineComponent, h, computed, provide } from "vue";
import type { AutoRotateOption } from "@voxcss/core/camera";
import {
  CAMERA_HOST_CLASS,
  createCameraBindingProps,
  type CameraSlotProps
} from "@voxcss/controller/createCameraComponentCore";
import { useCameraBinding } from "./bindings";
import { CONTROLLER_KEY } from "./controllerKey";
import { cameraPropOptions } from "./propOptions";

export function createCameraComponent() {
  return defineComponent({
    name: "VoxCamera",
    props: cameraPropOptions,
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
      const { elementRef, controller, slotProps, startAutoRotate, stopAutoRotate } = useCameraBinding(bindingProps);
      provide(CONTROLLER_KEY, controller);

      const resolvedSlotProps = computed(() => slotProps.value);
      const cursorStyle = computed(() => resolvedSlotProps.value?.cursor ?? "default");

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
        const currentSlot = resolvedSlotProps.value;
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

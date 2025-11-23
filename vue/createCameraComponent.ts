import { defineComponent, h, computed, provide } from "vue";
import type { AutoRotateOption } from "@voxcss/core/camera";
import {
  CAMERA_HOST_CLASS,
  createCameraBindingProps,
  ensureCameraController
} from "@voxcss/controller/cameraBindings";
import { useCameraBinding } from "./bindings";
import { CONTROLLER_KEY } from "./controllerKey";
import { cameraPropOptions } from "./propOptions";

export function createCameraComponent() {
  return defineComponent({
    name: "VoxCamera",
    props: cameraPropOptions,
    setup(props, { slots, expose }) {
      const bindingProps = () => createCameraBindingProps(props);
      const { elementRef, controller, slotProps, cursor, startAutoRotate, stopAutoRotate } = useCameraBinding(bindingProps);
      provide(CONTROLLER_KEY, controller);

      const cursorStyle = computed(() => cursor.value ?? "default");

      expose({
        get controller() {
          return ensureCameraController(controller.value);
        },
        startAutoRotate(config?: AutoRotateOption) {
          startAutoRotate(config ?? props.animate);
        },
        stopAutoRotate() {
          stopAutoRotate();
        }
      });

      return () => {
        const slotPayload = slotProps.value;
        const children =
          slotPayload && controller.value && slots.default
            ? slots.default(slotPayload)
            : undefined;

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

export type { CameraComponentProps } from "@voxcss/controller/cameraBindings";

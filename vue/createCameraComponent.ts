import { defineComponent, h, computed, provide } from "vue";
import type { AutoRotateOption } from "@voxcss/core/camera";
import {
  CAMERA_HOST_CLASS,
  createCameraBindingProps,
  createCameraViewController
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

      const viewState = computed(() => createCameraViewController(slotProps.value));
      const cursorStyle = computed(() => viewState.value.cursor);

      expose({
        get controller() {
          return viewState.value.ensureController();
        },
        startAutoRotate(config?: AutoRotateOption) {
          startAutoRotate(config ?? props.animate);
        },
        stopAutoRotate() {
          stopAutoRotate();
        }
      });

      return () => {
        const controllerView = viewState.value;
        const slotPayload = controllerView.getRenderableProps();
        const children = slotPayload && slots.default ? slots.default(slotPayload) : undefined;

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

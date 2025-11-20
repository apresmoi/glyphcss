import { defineComponent, h, computed, provide } from "vue";
import type { AutoRotateOption } from "@voxcss/core/camera";
import {
  CAMERA_HOST_CLASS,
  createCameraBindingProps,
  ensureCameraController,
  resolveCameraView
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

      const viewState = computed(() => resolveCameraView(slotProps.value));
      const cursorStyle = computed(() => viewState.value.cursor);

      expose({
        get controller() {
          return ensureCameraController(viewState.value.controller);
        },
        startAutoRotate(config?: AutoRotateOption) {
          startAutoRotate(config ?? props.animate);
        },
        stopAutoRotate() {
          stopAutoRotate();
        }
      });

      return () => {
        const currentView = viewState.value;
        const children =
          currentView.ready && currentView.slotProps && slots.default ? slots.default(currentView.slotProps) : undefined;

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

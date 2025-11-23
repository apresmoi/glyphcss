import { defineComponent, h, computed } from "vue";
import type { AutoRotateOption } from "@voxcss/core/camera";
import { CAMERA_HOST_CLASS, ensureCameraController } from "@voxcss/controller/cameraBindings";
import { useCameraBinding } from "./bindings";
import { cameraPropOptions } from "./propOptions";

export default defineComponent({
  name: "VoxCamera",
  props: cameraPropOptions,
  setup(props, { slots, expose }) {
    const bindingProps = () => props;
    const { elementRef, controller, slotProps, cursor, startAutoRotate, stopAutoRotate } = useCameraBinding(bindingProps);

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

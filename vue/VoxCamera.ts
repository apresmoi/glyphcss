import { defineComponent, h, computed, getCurrentInstance, watch } from "vue";
import type { PropType, ComponentInternalInstance } from "vue";
import type { AutoRotateOption } from "@voxcss/core/camera";
import { useCameraBinding } from "./bindings";

export const CONTROLLER_KEY = Symbol("voxcss-scene-controller");

export default defineComponent({
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
    const instance = getCurrentInstance() as (ComponentInternalInstance & { provides: Record<PropertyKey, unknown> }) | null;
    const bindingProps = () => ({
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

    if (instance) {
      watch(
        controller,
        (next) => {
          if (next) {
            const key = CONTROLLER_KEY as unknown as PropertyKey;
            instance.provides[key] = next;
          }
        },
        { immediate: true }
      );
    }

    const cursorStyle = computed(() => snapshot.value?.cursor ?? "default");

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
      const currentSnapshot = snapshot.value;
      const slotProps =
        currentSnapshot && controller.value
          ? {
              boxStyle: currentSnapshot.boxStyle ?? {},
              cursor: cursorStyle.value,
              walls: currentSnapshot.walls,
              camera: currentSnapshot.camera,
              controller: controller.value!
            }
          : undefined;
      const children = slots.default ? slots.default(slotProps ?? {}) : undefined;

      return h(
        "div",
        {
          class: "voxcss-camera",
          ref: elementRef,
          style: { cursor: cursorStyle.value }
        },
        children
      );
    };
  }
});

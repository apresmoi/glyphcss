import { defineComponent, h, computed, onBeforeUnmount, ref, watch, provide } from "vue";
import type { AutoRotateOption } from "@layoutit/voxcss-core";
import {
  CAMERA_HOST_CLASS,
  ensureCameraController,
  type CameraSlotProps
} from "@layoutit/voxcss-html";
import { mountCameraBinding } from "@layoutit/voxcss-html";
import { controllerKey } from "./context";

const cameraPropOptions = {
  zoom: { type: Number },
  pan: { type: Number },
  tilt: { type: Number },
  rotX: { type: Number },
  rotY: { type: Number },
  invert: { type: [Boolean, Number] as import("vue").PropType<boolean | number> },
  perspective: { type: [Number, Boolean] as import("vue").PropType<number | boolean> },
  interactive: { type: Boolean },
  animate: { type: [Boolean, Number, Object] as import("vue").PropType<AutoRotateOption | false> }
} as const;

export default defineComponent({
  name: "VoxCamera",
  props: cameraPropOptions,
  setup(props, { slots, expose }) {
    const slotProps = ref<CameraSlotProps | null>(null);
    const cursor = ref("default");
    const controllerRef = ref<CameraSlotProps["controller"] | null>(null);
    provide(controllerKey, controllerRef);
    const elementRef = ref<HTMLElement | null>(null);
    let teardown: ReturnType<typeof mountCameraBinding> | null = null;

    const mountBinding = () => {
      teardown?.destroy();
      teardown = null;
      const element = elementRef.value;
      if (!element) return;
      teardown = mountCameraBinding(
        element,
        props,
        (snapshot) => {
          slotProps.value = snapshot;
          controllerRef.value = snapshot?.controller ?? null;
          cursor.value = snapshot?.cursor ?? "default";
        },
        (nextCursor) => {
          cursor.value = nextCursor;
        }
      );
    };

    watch(elementRef, () => mountBinding(), { immediate: true });
    watch(
      () => props,
      (next) => {
        teardown?.update(next);
      },
      { deep: true }
    );

    onBeforeUnmount(() => {
      teardown?.destroy();
      teardown = null;
      slotProps.value = null;
      controllerRef.value = null;
      cursor.value = "default";
    });

    const cursorStyle = computed(() => cursor.value ?? "default");

    expose({
      get controller() {
        return ensureCameraController(slotProps.value?.controller ?? null);
      },
      startAutoRotate(config?: AutoRotateOption) {
        teardown?.startAutoRotate(config);
      },
      stopAutoRotate() {
        teardown?.stopAutoRotate();
      }
    });

    return () => {
      const slotPayload = slotProps.value;
      const children =
        slotPayload && slotProps.value?.controller && slots.default
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

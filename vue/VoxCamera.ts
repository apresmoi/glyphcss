import { defineComponent, h, computed, onBeforeUnmount, ref, watch } from "vue";
import type { AutoRotateOption } from "@voxcss/core/camera";
import { mountCameraBinding, CAMERA_HOST_CLASS, ensureCameraController, type CameraSlotProps } from "@voxcss/controller/domBindings";

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
    const controller = ref<import("@voxcss/controller/sceneController").SceneController | null>(null);
    const slotProps = ref<CameraSlotProps | null>(null);
    const cursor = ref("default");
    const elementRef = ref<HTMLElement | null>(null);
    const animateRef = ref(props.animate);
    let teardown: ReturnType<typeof mountCameraBinding> | null = null;

    const mountBinding = () => {
      teardown?.destroy();
      teardown = null;
      controller.value = null;
      slotProps.value = null;
      cursor.value = "default";
      const element = elementRef.value;
      if (!element) return;
      teardown = mountCameraBinding(
        element,
        props,
        (snapshot) => {
          if (!snapshot) {
            controller.value = null;
            slotProps.value = null;
            cursor.value = "default";
            return;
          }
          controller.value = snapshot.controller;
          slotProps.value = {
            boxStyle: snapshot.boxStyle,
            cursor: snapshot.cursor,
            walls: snapshot.walls,
            camera: snapshot.camera,
            controller: snapshot.controller
          };
          cursor.value = snapshot.cursor;
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
        animateRef.value = next.animate;
        teardown?.update(next);
      },
      { deep: true }
    );

    onBeforeUnmount(() => {
      teardown?.destroy();
      teardown = null;
      controller.value = null;
      slotProps.value = null;
      cursor.value = "default";
    });

    const cursorStyle = computed(() => cursor.value ?? "default");

    expose({
      get controller() {
        return ensureCameraController(controller.value);
      },
      startAutoRotate(config?: AutoRotateOption) {
        const next = config ?? animateRef.value;
        animateRef.value = next;
        teardown?.startAutoRotate(next);
      },
      stopAutoRotate() {
        animateRef.value = false;
        teardown?.stopAutoRotate();
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

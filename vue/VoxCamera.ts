import {
  defineComponent,
  h,
  onMounted,
  onBeforeUnmount,
  ref,
  watch,
  computed,
  getCurrentInstance
} from "vue";
import type { PropType, ComponentInternalInstance } from "vue";
import type { AutoRotateOption } from "@voxcss/core/camera";
import type { SceneController } from "@voxcss/controller/createSceneController";
import {
  createCameraBinding,
  type CameraBindingHandle,
  type CameraRenderSnapshot
} from "@voxcss/controller/createCameraBinding";

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
    const containerRef = ref<HTMLElement | null>(null);
    const cameraBinding = ref<CameraBindingHandle | null>(null);
    const controller = ref<SceneController | null>(null);
    const snapshot = ref<CameraRenderSnapshot | null>(null);
    const instance = getCurrentInstance() as (ComponentInternalInstance & { provides: Record<PropertyKey, unknown> }) | null;
    const ready = ref(false);
    const unsubscribe = ref<(() => void) | null>(null);

    const cursorStyle = computed(() => snapshot.value?.cursor ?? "default");

    onMounted(() => {
      if (!containerRef.value) return;
      const handle = createCameraBinding({
        element: containerRef.value,
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
      cameraBinding.value = handle;
      controller.value = handle.controller;
      snapshot.value = handle.getSnapshot();
      unsubscribe.value = handle.subscribe((next) => {
        snapshot.value = next;
      });
      if (instance && controller.value) {
        const key = CONTROLLER_KEY as unknown as PropertyKey;
        instance.provides[key] = controller.value;
      }
      ready.value = true;
    });

    onBeforeUnmount(() => {
      unsubscribe.value?.();
      cameraBinding.value?.destroy();
      cameraBinding.value = null;
      controller.value = null;
      unsubscribe.value = null;
    });

    watch(
      () => [props.zoom, props.pan, props.tilt, props.rotX, props.rotY, props.invert, props.interactive, props.perspective, props.animate],
      () => {
        cameraBinding.value?.setOptions({
          zoom: props.zoom,
          pan: props.pan,
          tilt: props.tilt,
          rotX: props.rotX,
          rotY: props.rotY,
          invert: props.invert,
          interactive: props.interactive,
          perspective: props.perspective,
          animate: props.animate
        });
      }
    );

    expose({
      get controller() {
        if (!controller.value) {
          throw new Error("voxcss: controller is not ready yet.");
        }
        return controller.value;
      },
      startAutoRotate(config?: AutoRotateOption) {
        cameraBinding.value?.setAnimate(config ?? props.animate);
      },
      stopAutoRotate() {
        cameraBinding.value?.setAnimate(false);
      }
    });

    return () => {
      if (!ready.value) {
        return h("div", {
          class: "voxcss-camera",
          ref: containerRef
        });
      }
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
          ref: containerRef,
          style: { cursor: cursorStyle.value }
        },
        children
      );
    };
  }
});

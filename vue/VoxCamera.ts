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
import { resolveInvertMultiplier } from "@voxcss/controller/cameraUtils";
import { DEFAULT_CAMERA_PROPS } from "@voxcss/controller/defaults";
import {
  createCameraBinding,
  type CameraBindingHandle,
  type CameraRenderSnapshot
} from "@voxcss/controller/createCameraBinding";

export const CONTROLLER_KEY = Symbol("voxcss-scene-controller");

export default defineComponent({
  name: "VoxCamera",
  props: {
    zoom: { type: Number, default: DEFAULT_CAMERA_PROPS.zoom },
    pan: { type: Number, default: DEFAULT_CAMERA_PROPS.pan },
    tilt: { type: Number, default: DEFAULT_CAMERA_PROPS.tilt },
    rotX: { type: Number, default: DEFAULT_CAMERA_PROPS.rotX },
    rotY: { type: Number, default: DEFAULT_CAMERA_PROPS.rotY },
    invert: { type: [Boolean, Number], default: DEFAULT_CAMERA_PROPS.invert },
    perspective: { type: [Number, Boolean], default: DEFAULT_CAMERA_PROPS.perspective },
    interactive: { type: Boolean, default: DEFAULT_CAMERA_PROPS.interactive },
    animate: { type: [Boolean, Number, Object] as PropType<AutoRotateOption>, default: DEFAULT_CAMERA_PROPS.animate }
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
      () => [props.zoom, props.pan, props.tilt, props.rotX, props.rotY],
      () => {
        cameraBinding.value?.updateCamera({
          zoom: props.zoom,
          pan: props.pan,
          tilt: props.tilt,
          rotX: props.rotX,
          rotY: props.rotY
        });
      }
    );

    watch(
      () => props.invert,
      (value) => {
        cameraBinding.value?.setControls({ invert: resolveInvertMultiplier(value) });
      }
    );

    watch(
      () => props.interactive,
      (value) => {
        cameraBinding.value?.setInteractive(value);
      }
    );

    watch(
      () => props.perspective,
      (value) => {
        cameraBinding.value?.setPerspective(value);
      }
    );

    watch(
      () => props.animate,
      (value) => {
        cameraBinding.value?.setAnimate(value);
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

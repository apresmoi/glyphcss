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
import { createCamera } from "@voxcss/core";
import type { AutoRotateOption, CameraState } from "@voxcss/core/camera";
import type { WallsMask } from "@voxcss/core";
import type { HeadlessCameraHandle } from "@voxcss/core/headless";
import type { SceneController } from "@voxcss/controller/createSceneController";
import { resolveInvertMultiplier, normalizePerspectiveValue } from "@voxcss/controller/utils";

export const CONTROLLER_KEY = Symbol("voxcss-scene-controller");

export default defineComponent({
  name: "VoxCamera",
  props: {
    zoom: { type: Number, default: 0.65 },
    pan: { type: Number, default: 0 },
    tilt: { type: Number, default: 0 },
    rotX: { type: Number, default: 65 },
    rotY: { type: Number, default: 45 },
    invert: { type: [Boolean, Number], default: false },
    perspective: { type: [Number, Boolean], default: 8000 },
    interactive: { type: Boolean, default: false },
    animate: { type: [Boolean, Number, Object] as PropType<AutoRotateOption>, default: undefined }
  },
  setup(props, { slots, expose }) {
    const containerRef = ref<HTMLElement | null>(null);
    const cameraHandle = ref<HeadlessCameraHandle | null>(null);
    const controller = ref<SceneController | null>(null);
    const boxStyle = ref<Record<string, string>>({});
    const cameraSnapshot = ref<CameraState | null>(null);
    const cursorSnapshot = ref("default");
    const wallsSnapshot = ref<WallsMask | null>(null);
    const instance = getCurrentInstance() as (ComponentInternalInstance & { provides: Record<PropertyKey, unknown> }) | null;
    const ready = ref(false);
    const subscriptions: Array<() => void> = [];

    const cursorStyle = computed(() => (props.interactive ? cursorSnapshot.value : "default"));

    const applyPerspective = () => {
      cameraHandle.value?.setPerspective(normalizePerspectiveValue(props.perspective));
    };

    const syncSnapshots = () => {
      if (!controller.value) return;
      boxStyle.value = controller.value.getBoxStyle();
      cameraSnapshot.value = controller.value.getCameraState();
      wallsSnapshot.value = controller.value.getWalls();
      cursorSnapshot.value = props.interactive ? controller.value.getCursor() : "default";
    };

    onMounted(() => {
      if (!containerRef.value) return;
      const handle = createCamera({
        element: containerRef.value,
        interactive: props.interactive,
        perspective: normalizePerspectiveValue(props.perspective),
        zoom: props.zoom,
        pan: props.pan,
        tilt: props.tilt,
        rotX: props.rotX,
        rotY: props.rotY,
        invert: props.invert,
        animate: props.animate
      });
      cameraHandle.value = handle;
      controller.value = handle.controller;
      syncSnapshots();
      subscriptions.push(
        controller.value.subscribeBoxStyle((style) => {
          boxStyle.value = style;
        })
      );
      subscriptions.push(
        controller.value.subscribeCamera((state) => {
          cameraSnapshot.value = state;
          wallsSnapshot.value = controller.value?.getWalls() ?? null;
          cursorSnapshot.value = props.interactive && controller.value ? controller.value.getCursor() : "default";
        })
      );
      if (instance && controller.value) {
        const key = CONTROLLER_KEY as unknown as PropertyKey;
        instance.provides[key] = controller.value;
      }
      ready.value = true;
    });

    onBeforeUnmount(() => {
      subscriptions.forEach((stop) => stop?.());
      subscriptions.length = 0;
      cameraHandle.value?.destroy();
      cameraHandle.value = null;
      controller.value = null;
    });

    watch(
      () => props.zoom,
      (value) => {
        if (!cameraHandle.value) return;
        cameraHandle.value.controller.updateCamera({ zoom: value });
      }
    );
    watch(
      () => props.pan,
      (value) => {
        if (!cameraHandle.value) return;
        cameraHandle.value.controller.updateCamera({ pan: value });
      }
    );
    watch(
      () => props.tilt,
      (value) => {
        if (!cameraHandle.value) return;
        cameraHandle.value.controller.updateCamera({ tilt: value });
      }
    );
    watch(
      () => props.rotX,
      (value) => {
        if (!cameraHandle.value) return;
        cameraHandle.value.controller.updateCamera({ rotX: value });
      }
    );
    watch(
      () => props.rotY,
      (value) => {
        if (!cameraHandle.value) return;
        cameraHandle.value.controller.updateCamera({ rotY: value });
      }
    );

    watch(
      () => props.invert,
      (value) => {
        controller.value?.setControls({ invert: resolveInvertMultiplier(value) });
      }
    );

    watch(
      () => props.interactive,
      (value) => {
        cameraHandle.value?.setInteractive(value);
        cursorSnapshot.value = value && controller.value ? controller.value.getCursor() : "default";
      }
    );

    watch(
      () => props.perspective,
      () => {
        applyPerspective();
      }
    );

    watch(
      () => props.animate,
      (value) => {
        cameraHandle.value?.setAnimate(value);
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
        cameraHandle.value?.setAnimate(config ?? props.animate);
      },
      stopAutoRotate() {
        cameraHandle.value?.setAnimate(false);
      }
    });

    return () => {
      if (!ready.value) {
        return h("div", {
          class: "voxcss-camera",
          ref: containerRef
        });
      }
      const slotProps = {
        boxStyle: boxStyle.value ?? {},
        cursor: cursorStyle.value,
        walls: wallsSnapshot.value ?? (controller.value?.getWalls() as WallsMask),
        camera: cameraSnapshot.value ?? controller.value?.getCameraState(),
        controller: controller.value!
      };
      const children = slots.default ? slots.default(slotProps) : undefined;

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

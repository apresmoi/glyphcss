import {
  defineComponent,
  h,
  provide,
  onMounted,
  onBeforeUnmount,
  ref,
  watch,
  computed
} from "vue";
import { createSceneController } from "@voxcss/controller/createSceneController";
import type { CameraState } from "@voxcss/core/camera";
import type { WallsMask } from "@voxcss/core";

function resolveInvertMultiplier(value: number | boolean | undefined): number {
  if (typeof value === "number") {
    return value < 0 ? -1 : 1;
  }
  return value ? -1 : 1;
}

function resolvePerspectiveValue(value: number | boolean | undefined): string {
  if (value === false) return "none";
  const numeric = typeof value === "number" ? value : 8000;
  return `${numeric}px`;
}

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
    interactive: { type: Boolean, default: false }
  },
  setup(props, { slots }) {
    const controller = createSceneController({
      camera: {
        zoom: props.zoom,
        pan: props.pan,
        tilt: props.tilt,
        rotX: props.rotX,
        rotY: props.rotY
      }
    });

    provide(CONTROLLER_KEY, controller);

    const boxStyle = ref<Record<string, string>>(controller.getBoxStyle());
    const cameraSnapshot = ref<CameraState>(controller.getCameraState());
    const cursorSnapshot = ref(controller.getCursor());
    const wallsSnapshot = ref<WallsMask>(controller.getWalls());
    const subscriptions: Array<() => void> = [];

    const cursorStyle = computed(() => (props.interactive ? cursorSnapshot.value : "default"));
    const sceneStyle = computed(() => ({
      cursor: cursorStyle.value,
      perspective: resolvePerspectiveValue(props.perspective)
    }));

    const syncCameraProps = () => {
      controller.updateCamera({
        zoom: props.zoom,
        pan: props.pan,
        tilt: props.tilt,
        rotX: props.rotX,
        rotY: props.rotY
      });
    };

    watch(
      () => props.zoom,
      (value) => controller.updateCamera({ zoom: value })
    );
    watch(
      () => props.pan,
      (value) => controller.updateCamera({ pan: value })
    );
    watch(
      () => props.tilt,
      (value) => controller.updateCamera({ tilt: value })
    );
    watch(
      () => props.rotX,
      (value) => controller.updateCamera({ rotX: value })
    );
    watch(
      () => props.rotY,
      (value) => controller.updateCamera({ rotY: value })
    );
    const applyInvert = (value: number | boolean | undefined) => {
      controller.setControls({ invert: resolveInvertMultiplier(value) });
    };

    watch(() => props.invert, applyInvert);

    const handlePointerDown = (event: PointerEvent) => {
      if (!props.interactive) return;
      controller.handlePointerDown(event);
      cursorSnapshot.value = controller.getCursor();
      (event.target as HTMLElement | null)?.setPointerCapture?.(event.pointerId);
    };

    const handlePointerMove = (event: PointerEvent) => {
      if (!props.interactive) return;
      controller.handlePointerMove(event);
    };

    const handlePointerUp = (event: PointerEvent) => {
      if (!props.interactive) return;
      controller.handlePointerUp();
      cursorSnapshot.value = controller.getCursor();
      (event.target as HTMLElement | null)?.releasePointerCapture?.(event.pointerId);
    };

    onMounted(() => {
      syncCameraProps();
      applyInvert(props.invert);
      subscriptions.push(
        controller.subscribeBoxStyle((style) => {
          boxStyle.value = style;
        })
      );
      subscriptions.push(
        controller.subscribeCamera((state) => {
          cameraSnapshot.value = state;
          wallsSnapshot.value = controller.getWalls();
        })
      );
    });

    onBeforeUnmount(() => {
      subscriptions.forEach((stop) => stop?.());
      subscriptions.length = 0;
    });

    return () => {
      const slotProps = {
        boxStyle: boxStyle.value,
        cursor: cursorStyle.value,
        walls: wallsSnapshot.value,
        camera: cameraSnapshot.value,
        controller
      };
      const children = slots.default ? slots.default(slotProps) : undefined;

      return h(
        "div",
        {
          class: "voxcss-scene",
          style: sceneStyle.value,
          onPointerdown: props.interactive ? handlePointerDown : undefined,
          onPointermove: props.interactive ? handlePointerMove : undefined,
          onPointerup: props.interactive ? handlePointerUp : undefined,
          onPointerleave: props.interactive ? handlePointerUp : undefined
        },
        children
      );
    };
  }
});

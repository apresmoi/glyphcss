// @ts-nocheck
import Vue from "vue";
import type { PropType, VNode } from "vue";
import { createSceneController } from "@voxcss/controller/createSceneController";
import type { SceneController } from "@voxcss/controller/createSceneController";
import { createAutoRotateHandle, type AutoRotateHandle } from "@voxcss/controller/autoRotate";
import type { AutoRotateOption, CameraState } from "@voxcss/core/camera";
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

export default Vue.extend({
  name: "VoxCamera",
  provide() {
    const vm = this as any;
    return {
      sceneController: () => vm.controllerInstance
    };
  },
  props: {
    zoom: {
      type: Number,
      default: 0.65
    },
    pan: {
      type: Number,
      default: 0
    },
    tilt: {
      type: Number,
      default: 0
    },
    rotX: {
      type: Number,
      default: 65
    },
    rotY: {
      type: Number,
      default: 45
    },
    invert: {
      type: [Boolean, Number] as PropType<boolean | number>,
      default: false
    },
    perspective: {
      type: [Number, Boolean] as PropType<number | boolean>,
      default: 8000
    },
    interactive: {
      type: Boolean,
      default: false
    },
    animate: {
      type: [Boolean, Number, Object] as PropType<AutoRotateOption>,
      default: undefined
    }
  },
  data(): {
    controllerInstance: SceneController;
    boxStyleSnapshot: Record<string, string>;
    cameraSnapshot: CameraState;
    cursorSnapshot: string;
    wallsSnapshot: WallsMask;
    subscriptions: Array<() => void>;
    autoRotateHandle: AutoRotateHandle | null;
  } {
    const controllerInstance = createSceneController({
      camera: {
        zoom: this.zoom,
        pan: this.pan,
        tilt: this.tilt,
        rotX: this.rotX,
        rotY: this.rotY
      }
    });

    return {
      controllerInstance,
      boxStyleSnapshot: controllerInstance.getBoxStyle(),
      cameraSnapshot: controllerInstance.getCameraState(),
      cursorSnapshot: controllerInstance.getCursor(),
      wallsSnapshot: controllerInstance.getWalls(),
      subscriptions: [],
      autoRotateHandle: null
    };
  },
  created() {
    this.syncCameraProps();
    this.syncControls();
    const stopBoxStyle = this.controllerInstance.subscribeBoxStyle((style) => {
      this.boxStyleSnapshot = style;
    });
    const stopCamera = this.controllerInstance.subscribeCamera((state) => {
      this.cameraSnapshot = state;
      this.wallsSnapshot = this.controllerInstance.getWalls();
    });
    this.subscriptions = [stopBoxStyle, stopCamera];
    this.syncAutoRotate();
  },
  beforeDestroy() {
    this.subscriptions.forEach((stop) => stop?.());
    this.subscriptions = [];
    this.autoRotateHandle?.stop?.();
    this.autoRotateHandle = null;
  },
  watch: {
    zoom(value: number) {
      this.controllerInstance.updateCamera({ zoom: value });
    },
    pan(value: number) {
      this.controllerInstance.updateCamera({ pan: value });
    },
    tilt(value: number) {
      this.controllerInstance.updateCamera({ tilt: value });
    },
    rotX(value: number) {
      this.controllerInstance.updateCamera({ rotX: value });
    },
    rotY(value: number) {
      this.controllerInstance.updateCamera({ rotY: value });
    },
    invert(value: number | boolean) {
      this.controllerInstance.setControls({ invert: resolveInvertMultiplier(value) });
    },
    animate() {
      this.syncAutoRotate();
    }
  },
  computed: {
    controllerState() {
      return this.cameraSnapshot;
    },
    boxStyle(): Record<string, string> {
      return this.boxStyleSnapshot;
    },
    cursor(): string {
      return this.interactive ? this.cursorSnapshot : "default";
    },
    walls(): WallsMask {
      return this.wallsSnapshot;
    },
    sceneStyle(): Record<string, string> {
      return {
        cursor: this.cursor,
        perspective: resolvePerspectiveValue(this.perspective)
      };
    }
  },
  methods: {
    syncCameraProps() {
      this.controllerInstance.updateCamera({
        zoom: this.zoom,
        pan: this.pan,
        tilt: this.tilt,
        rotX: this.rotX,
        rotY: this.rotY
      });
    },
    syncControls() {
      this.controllerInstance.setControls({
        invert: resolveInvertMultiplier(this.invert)
      });
    },
    syncAutoRotate(config?: AutoRotateOption) {
      this.autoRotateHandle?.stop?.();
      const option = config !== undefined ? config : this.animate;
      this.autoRotateHandle = createAutoRotateHandle(this.controllerInstance, option) ?? null;
      this.autoRotateHandle?.start?.();
    },
    startAutoRotate(config?: AutoRotateOption) {
      this.syncAutoRotate(config);
    },
    stopAutoRotate() {
      this.autoRotateHandle?.stop?.();
    },
    handlePointerDown(event: PointerEvent) {
      if (!this.interactive) return;
      this.autoRotateHandle?.notifyInteraction?.();
      this.controllerInstance.handlePointerDown(event);
      this.cursorSnapshot = this.controllerInstance.getCursor();
      (event.target as HTMLElement)?.setPointerCapture?.(event.pointerId);
    },
    handlePointerMove(event: PointerEvent) {
      if (!this.interactive) return;
      this.controllerInstance.handlePointerMove(event);
    },
    handlePointerUp(event: PointerEvent) {
      if (!this.interactive) return;
      this.controllerInstance.handlePointerUp();
      this.cursorSnapshot = this.controllerInstance.getCursor();
      (event.target as HTMLElement)?.releasePointerCapture?.(event.pointerId);
    }
  },
  render(h) {
    const vm = this as any;
    const slot = vm.$scopedSlots.default;
    const slotContent = slot
      ? slot({
        boxStyle: vm.boxStyle,
        cursor: vm.cursor,
        walls: vm.walls,
        camera: vm.controllerState,
        controller: vm.controllerInstance
      })
      : (vm.$slots.default as VNode[] | undefined);

    return h(
      "div",
      {
        class: "voxcss-camera",
        style: vm.sceneStyle,
        on: vm.interactive
          ? {
            pointerdown: vm.handlePointerDown,
            pointermove: vm.handlePointerMove,
            pointerup: vm.handlePointerUp,
            pointerleave: vm.handlePointerUp
          }
          : undefined
      },
      slotContent
    );
  }
});

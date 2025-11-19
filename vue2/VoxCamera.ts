// @ts-nocheck
import Vue from "vue";
import type { PropType, VNode } from "vue";
import { createCamera } from "@voxcss/core";
import type { HeadlessCameraHandle } from "@voxcss/core/headless";
import type { SceneController } from "@voxcss/controller/createSceneController";
import type { AutoRotateOption, CameraState } from "@voxcss/core/camera";
import type { WallsMask } from "@voxcss/core";
import { resolveInvertMultiplier, normalizePerspectiveValue } from "@voxcss/controller/utils";

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
    controllerInstance: SceneController | null;
    cameraHandle: HeadlessCameraHandle | null;
    boxStyleSnapshot: Record<string, string>;
    cameraSnapshot: CameraState | null;
    cursorSnapshot: string;
    wallsSnapshot: WallsMask | null;
    subscriptions: Array<() => void>;
  } {
    return {
      controllerInstance: null,
      cameraHandle: null,
      boxStyleSnapshot: {},
      cameraSnapshot: null,
      cursorSnapshot: "default",
      wallsSnapshot: null,
      subscriptions: []
    };
  },
  beforeDestroy() {
    this.subscriptions.forEach((stop) => stop?.());
    this.subscriptions = [];
    this.cameraHandle?.destroy?.();
    this.cameraHandle = null;
    this.controllerInstance = null;
  },
  watch: {
    zoom(value: number) {
      this.cameraHandle?.controller.updateCamera({ zoom: value });
    },
    pan(value: number) {
      this.cameraHandle?.controller.updateCamera({ pan: value });
    },
    tilt(value: number) {
      this.cameraHandle?.controller.updateCamera({ tilt: value });
    },
    rotX(value: number) {
      this.cameraHandle?.controller.updateCamera({ rotX: value });
    },
    rotY(value: number) {
      this.cameraHandle?.controller.updateCamera({ rotY: value });
    },
    invert(value: number | boolean) {
      this.controllerInstance?.setControls({ invert: resolveInvertMultiplier(value) });
    },
    animate() {
      this.cameraHandle?.setAnimate(this.animate);
    },
    interactive(value: boolean) {
      this.cameraHandle?.setInteractive(value);
      this.cursorSnapshot = value && this.controllerInstance ? this.controllerInstance.getCursor() : "default";
    },
    perspective(value: number | boolean) {
      this.cameraHandle?.setPerspective(normalizePerspectiveValue(value));
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
        cursor: this.cursor
      };
    }
  },
  methods: {
    mountCamera() {
      const node = this.$refs.camera as HTMLElement | undefined;
      if (!node) return;
      const handle = createCamera({
        element: node,
        interactive: this.interactive,
        perspective: normalizePerspectiveValue(this.perspective),
        zoom: this.zoom,
        pan: this.pan,
        tilt: this.tilt,
        rotX: this.rotX,
        rotY: this.rotY,
        invert: this.invert,
        animate: this.animate
      });
      this.cameraHandle = handle;
      this.controllerInstance = handle.controller;
      this.syncSnapshots();
      this.subscriptions = [
        this.controllerInstance.subscribeBoxStyle((style) => {
          this.boxStyleSnapshot = style;
        }),
        this.controllerInstance.subscribeCamera((state) => {
          this.cameraSnapshot = state;
          this.wallsSnapshot = this.controllerInstance?.getWalls() ?? null;
          this.cursorSnapshot =
            this.interactive && this.controllerInstance ? this.controllerInstance.getCursor() : "default";
        })
      ];
    },
    syncSnapshots() {
      if (!this.controllerInstance) return;
      this.boxStyleSnapshot = this.controllerInstance.getBoxStyle();
      this.cameraSnapshot = this.controllerInstance.getCameraState();
      this.wallsSnapshot = this.controllerInstance.getWalls();
      this.cursorSnapshot = this.interactive ? this.controllerInstance.getCursor() : "default";
    },
    startAutoRotate(config?: AutoRotateOption) {
      this.cameraHandle?.setAnimate(config ?? this.animate);
    },
    stopAutoRotate() {
      this.cameraHandle?.setAnimate(false);
    }
  },
  mounted() {
    this.mountCamera();
  },
  updated() {
    if (!this.controllerInstance && this.cameraHandle) {
      this.controllerInstance = this.cameraHandle.controller;
      this.syncSnapshots();
    }
  },
  render(h) {
    const vm = this as any;
    const slot = vm.$scopedSlots.default;
    const slotContent =
      vm.controllerInstance && slot
        ? slot({
          boxStyle: vm.boxStyle,
          cursor: vm.cursor,
          walls: vm.walls,
          camera: vm.controllerState,
          controller: vm.controllerInstance
        })
        : vm.controllerInstance
          ? (vm.$slots.default as VNode[] | undefined)
          : undefined;

    return h(
      "div",
      {
        class: "voxcss-camera",
        ref: "camera",
        style: vm.sceneStyle
      },
      slotContent
    );
  }
});

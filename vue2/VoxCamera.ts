// @ts-nocheck
import Vue from "vue";
import type { VNode } from "vue";
import { createCamera } from "@voxcss/core/headless";
import {
  CAMERA_HOST_CLASS,
  ensureCameraController,
  normalizeCameraOptions,
  syncCameraOptions,
  type CameraComponentProps,
  type CameraSlotProps,
  type NormalizedCameraOptions
} from "@voxcss/controller/cameraBindings";
import type { AutoRotateOption } from "@voxcss/core/camera";
import { cameraPropOptions } from "../vue/propOptions";

export default Vue.extend({
  name: "VoxCamera",
  provide() {
    const vm = this as any;
    return {
      sceneControllerState: vm.controllerState
    };
  },
  props: cameraPropOptions,
  data(): {
    controllerInstance: any;
    controllerState: { value: any };
    slotPayload: CameraSlotProps | null;
    cursorStyleValue: string;
    optionsState: NormalizedCameraOptions | null;
    handle: any;
    unsubscribers: Array<() => void>;
  } {
    return {
      controllerInstance: null,
      controllerState: Vue.observable({ value: null }),
      slotPayload: null,
      cursorStyleValue: "default",
      optionsState: null,
      handle: null,
      unsubscribers: []
    };
  },
  computed: {
    renderableSlot(): CameraSlotProps | null {
      return this.slotPayload && this.controllerInstance ? this.slotPayload : null;
    },
    controller() {
      return this.renderableSlot?.controller;
    },
    boxStyle(): Record<string, string> {
      return this.renderableSlot?.boxStyle ?? {};
    },
    walls() {
      return this.renderableSlot?.walls;
    },
    sceneStyle(): Record<string, string> {
      return {
        cursor: this.cursorStyleValue
      };
    }
  },
  methods: {
    mountCamera() {
      const node = this.$refs.camera as HTMLElement | undefined;
      if (!node) return;
      const props = extractCameraProps(this);
      this.optionsState = normalizeCameraOptions(props);
      this.handle = createCamera({ ...props, element: node });
      this.controllerInstance = this.handle.controller;
      this.controllerState.value = this.controllerInstance;
      this.applySnapshot();
      this.unsubscribers = [
        this.controllerInstance.subscribeBoxStyle(this.applySnapshot),
        this.controllerInstance.subscribeCamera(this.applySnapshot),
        this.controllerInstance.subscribeWalls(this.applySnapshot),
        this.controllerInstance.subscribeCursor(this.applySnapshot)
      ];
    },
    applySnapshot() {
      if (!this.handle) return;
      const controller = this.handle.controller;
      const nextCursor = this.handle.interactive ? controller.getCursor() : "default";
      this.slotPayload = {
        boxStyle: controller.getBoxStyle(),
        cursor: nextCursor,
        walls: controller.getWalls(),
        camera: controller.getCameraState(),
        controller
      };
      this.cursorStyleValue = nextCursor;
    },
    updateOptions() {
      if (!this.handle || !this.optionsState) return;
      this.optionsState = syncCameraOptions(this.handle, this.optionsState, extractCameraProps(this));
      this.applySnapshot();
    },
    startAutoRotate(config?: AutoRotateOption) {
      if (!this.handle || !this.optionsState) return;
      this.optionsState = syncCameraOptions(this.handle, this.optionsState, { animate: config ?? this.animate });
      this.applySnapshot();
    },
    stopAutoRotate() {
      if (!this.handle || !this.optionsState) return;
      this.optionsState = syncCameraOptions(this.handle, this.optionsState, { animate: false });
      this.applySnapshot();
    }
  },
  mounted() {
    this.mountCamera();
  },
  updated() {
    this.updateOptions();
  },
  beforeDestroy() {
    this.unsubscribers.forEach((dispose) => dispose());
    this.unsubscribers = [];
    this.handle?.destroy();
    this.handle = null;
    this.controllerInstance = null;
    this.controllerState.value = null;
    this.slotPayload = null;
  },
  render(h) {
    const vm = this as any;
    const slot = vm.$scopedSlots.default;
    const slotPayload = vm.renderableSlot;
    const controller = vm.controllerInstance;
    const slotContent =
      slotPayload && controller && slot
        ? slot({
            boxStyle: vm.boxStyle,
            cursor: slotPayload.cursor,
            walls: vm.walls,
            camera: vm.controllerState,
            controller: ensureCameraController(controller)
          })
        : slotPayload && controller
          ? (vm.$slots.default as VNode[] | undefined)
          : undefined;

    return h(
      "div",
      {
        class: CAMERA_HOST_CLASS,
        ref: "camera",
        style: vm.sceneStyle
      },
      slotContent
    );
  }
});

function extractCameraProps(vm: any): CameraComponentProps {
  return {
    zoom: vm.zoom,
    pan: vm.pan,
    tilt: vm.tilt,
    rotX: vm.rotX,
    rotY: vm.rotY,
    invert: vm.invert,
    perspective: vm.perspective,
    interactive: vm.interactive,
    animate: vm.animate
  };
}

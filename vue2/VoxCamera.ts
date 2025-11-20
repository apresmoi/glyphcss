// @ts-nocheck
import Vue from "vue";
import type { PropType, VNode } from "vue";
import { type CameraBindingHandle, type CameraRenderSnapshot } from "@voxcss/controller/createCameraBinding";
import { createCameraBindingManager } from "./bindings";
import type { SceneController } from "@voxcss/controller/createSceneController";
import type { AutoRotateOption, CameraState } from "@voxcss/core/camera";
import type { WallsMask } from "@voxcss/core";

export default Vue.extend({
  name: "VoxCamera",
  provide() {
    const vm = this as any;
    return {
      sceneController: () => vm.controllerInstance
    };
  },
  props: {
    zoom: { type: Number },
    pan: { type: Number },
    tilt: { type: Number },
    rotX: { type: Number },
    rotY: { type: Number },
    invert: { type: [Boolean, Number] as PropType<boolean | number> },
    perspective: { type: [Number, Boolean] as PropType<number | boolean> },
    interactive: { type: Boolean },
    animate: { type: [Boolean, Number, Object] as PropType<AutoRotateOption | false> }
  },
  data(): {
    controllerInstance: SceneController | null;
    cameraBinding: CameraBindingHandle | null;
    boxStyleSnapshot: Record<string, string>;
    cameraSnapshot: CameraState | null;
    cursorSnapshot: string;
    wallsSnapshot: WallsMask | null;
    cameraBindingManager: ReturnType<typeof createCameraBindingManager> | null;
  } {
    return {
      controllerInstance: null,
      cameraBinding: null,
      boxStyleSnapshot: {},
      cameraSnapshot: null,
      cursorSnapshot: "default",
      wallsSnapshot: null,
      cameraBindingManager: null
    };
  },
  created() {
    this.cameraBindingManager = createCameraBindingManager(
      this,
      () => ({
        zoom: this.zoom,
        pan: this.pan,
        tilt: this.tilt,
        rotX: this.rotX,
        rotY: this.rotY,
        invert: this.invert,
        interactive: this.interactive,
        perspective: this.perspective,
        animate: this.animate
      }),
      (snapshot) => this.applySnapshot(snapshot),
      (handle) => {
        this.cameraBinding = handle;
        this.controllerInstance = handle ? handle.controller : null;
      }
    );
  },
  beforeDestroy() {
    this.cameraBindingManager?.destroy();
    this.cameraBindingManager = null;
    this.cameraBinding = null;
    this.controllerInstance = null;
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
    applySnapshot(snapshot?: CameraRenderSnapshot) {
      if (!snapshot) return;
      this.boxStyleSnapshot = snapshot.boxStyle;
      this.cameraSnapshot = snapshot.camera;
      this.wallsSnapshot = snapshot.walls;
      this.cursorSnapshot = snapshot.cursor;
    },
    mountCamera() {
      const node = this.$refs.camera as HTMLElement | undefined;
      if (!node) return;
      this.cameraBindingManager?.mount(node);
    },
    startAutoRotate(config?: AutoRotateOption) {
      this.cameraBinding?.setAnimate(config ?? this.animate);
    },
    stopAutoRotate() {
      this.cameraBinding?.setAnimate(false);
    }
  },
  mounted() {
    this.mountCamera();
  },
  updated() {
    this.cameraBindingManager?.update();
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

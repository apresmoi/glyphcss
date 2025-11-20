// @ts-nocheck
import Vue from "vue";
import type { PropType, VNode } from "vue";
import {
  createCameraBinding,
  type CameraBindingHandle,
  type CameraRenderSnapshot
} from "@voxcss/controller/createCameraBinding";
import type { SceneController } from "@voxcss/controller/createSceneController";
import type { AutoRotateOption, CameraState } from "@voxcss/core/camera";
import type { WallsMask } from "@voxcss/core";
import { DEFAULT_CAMERA_PROPS } from "@voxcss/controller/defaults";

export default Vue.extend({
  name: "VoxCamera",
  provide() {
    const vm = this as any;
    return {
      sceneController: () => vm.controllerInstance
    };
  },
  props: {
    zoom: { type: Number, default: DEFAULT_CAMERA_PROPS.zoom },
    pan: { type: Number, default: DEFAULT_CAMERA_PROPS.pan },
    tilt: { type: Number, default: DEFAULT_CAMERA_PROPS.tilt },
    rotX: { type: Number, default: DEFAULT_CAMERA_PROPS.rotX },
    rotY: { type: Number, default: DEFAULT_CAMERA_PROPS.rotY },
    invert: { type: [Boolean, Number] as PropType<boolean | number>, default: DEFAULT_CAMERA_PROPS.invert },
    perspective: { type: [Number, Boolean] as PropType<number | boolean>, default: DEFAULT_CAMERA_PROPS.perspective },
    interactive: { type: Boolean, default: DEFAULT_CAMERA_PROPS.interactive },
    animate: { type: [Boolean, Number, Object] as PropType<AutoRotateOption>, default: DEFAULT_CAMERA_PROPS.animate }
  },
  data(): {
    controllerInstance: SceneController | null;
    cameraBinding: CameraBindingHandle | null;
    boxStyleSnapshot: Record<string, string>;
    cameraSnapshot: CameraState | null;
    cursorSnapshot: string;
    wallsSnapshot: WallsMask | null;
    unsubscribeSnapshot: (() => void) | null;
  } {
    return {
      controllerInstance: null,
      cameraBinding: null,
      boxStyleSnapshot: {},
      cameraSnapshot: null,
      cursorSnapshot: "default",
      wallsSnapshot: null,
      unsubscribeSnapshot: null
    };
  },
  beforeDestroy() {
    this.unsubscribeSnapshot?.();
    this.unsubscribeSnapshot = null;
    this.cameraBinding?.destroy?.();
    this.cameraBinding = null;
    this.controllerInstance = null;
  },
  watch: {
    cameraPropSignature() {
      this.updateBindingOptions();
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
    },
    cameraPropSignature(): unknown[] {
      return [
        this.zoom,
        this.pan,
        this.tilt,
        this.rotX,
        this.rotY,
        this.invert,
        this.interactive,
        this.perspective,
        this.animate
      ];
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
      const handle = createCameraBinding({
        element: node,
        interactive: this.interactive,
        perspective: this.perspective,
        zoom: this.zoom,
        pan: this.pan,
        tilt: this.tilt,
        rotX: this.rotX,
        rotY: this.rotY,
        invert: this.invert,
        animate: this.animate
      });
      this.cameraBinding = handle;
      this.controllerInstance = handle.controller;
      this.applySnapshot(handle.getSnapshot());
      this.unsubscribeSnapshot?.();
      this.unsubscribeSnapshot = handle.subscribe((next) => this.applySnapshot(next));
    },
    updateBindingOptions() {
      this.cameraBinding?.setOptions({
        zoom: this.zoom,
        pan: this.pan,
        tilt: this.tilt,
        rotX: this.rotX,
        rotY: this.rotY,
        invert: this.invert,
        interactive: this.interactive,
        perspective: this.perspective,
        animate: this.animate
      });
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
    if (!this.controllerInstance && this.cameraBinding) {
      this.controllerInstance = this.cameraBinding.controller;
      this.applySnapshot(this.cameraBinding.getSnapshot());
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

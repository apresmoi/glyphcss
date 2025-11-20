// @ts-nocheck
import Vue from "vue";
import type { VNode } from "vue";
import type { SceneController } from "@voxcss/controller/createSceneController";
import type { AutoRotateOption } from "@voxcss/core/camera";
import {
  CAMERA_HOST_CLASS,
  createCameraBindingProps,
  type CameraComponentProps,
  type CameraSlotProps
} from "@voxcss/controller/createCameraComponentCore";
import { createCameraBindingManager } from "./bindings";
import { cameraPropOptions } from "../vue/propOptions";

export function createCameraComponent() {
  return Vue.extend({
    name: "VoxCamera",
    provide() {
      const vm = this as any;
      return {
        sceneController: () => vm.controllerInstance
      };
    },
    props: cameraPropOptions,
    data(): {
      controllerInstance: SceneController | null;
      slotPayload: CameraSlotProps | null;
      cameraBindingManager: ReturnType<typeof createCameraBindingManager> | null;
    } {
      return {
        controllerInstance: null,
        slotPayload: null,
        cameraBindingManager: null
      };
    },
    created() {
      this.cameraBindingManager = createCameraBindingManager(
        this,
        () =>
          createCameraBindingProps({
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
        {
          onSlotProps: (slotProps) => {
            this.slotPayload = slotProps;
          },
          onController: (controller) => {
            this.controllerInstance = controller;
          }
        }
      );
    },
    beforeDestroy() {
      this.cameraBindingManager?.destroy();
      this.cameraBindingManager = null;
      this.controllerInstance = null;
      this.slotPayload = null;
    },
    computed: {
      controllerState() {
        return this.slotPayload?.camera;
      },
      boxStyle(): Record<string, string> {
        return this.slotPayload?.boxStyle ?? {};
      },
      cursor(): string {
        return this.slotPayload?.cursor ?? "default";
      },
      walls() {
        return this.slotPayload?.walls;
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
        this.cameraBindingManager?.mount(node);
      },
      startAutoRotate(config?: AutoRotateOption) {
        this.cameraBindingManager?.startAutoRotate(config ?? this.animate);
      },
      stopAutoRotate() {
        this.cameraBindingManager?.stopAutoRotate();
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
          class: CAMERA_HOST_CLASS,
          ref: "camera",
          style: vm.sceneStyle
        },
        slotContent
      );
    }
  });
}

export type { CameraComponentProps };

// @ts-nocheck
import Vue from "vue";
import type { VNode } from "vue";
import type { SceneController } from "@voxcss/controller/createSceneController";
import type { AutoRotateOption } from "@voxcss/core/camera";
import {
  CAMERA_HOST_CLASS,
  createCameraBindingProps,
  createCameraViewController,
  type CameraComponentProps,
  type CameraSlotProps
} from "@voxcss/controller/cameraBindingView";
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
        () => createCameraBindingProps(this),
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
      cameraViewController() {
        return createCameraViewController(this.slotPayload);
      },
      renderableSlot(): CameraSlotProps | null {
        return this.cameraViewController.getRenderableProps();
      },
      controllerState() {
        return this.renderableSlot?.camera;
      },
      boxStyle(): Record<string, string> {
        return this.renderableSlot?.boxStyle ?? {};
      },
      cursor(): string {
        return this.cameraViewController.cursor;
      },
      walls() {
        return this.renderableSlot?.walls;
      },
      sceneStyle(): Record<string, string> {
        return {
          cursor: this.cameraViewController.cursor
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
      const view = vm.cameraViewController;
      const slotPayload = vm.renderableSlot;
      const slotContent =
        slotPayload && slot
          ? slot({
              boxStyle: vm.boxStyle,
              cursor: view.cursor,
              walls: vm.walls,
              camera: vm.controllerState,
              controller: view.ensureController()
            })
          : view.ready
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

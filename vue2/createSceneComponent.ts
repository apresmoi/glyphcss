// @ts-nocheck
import Vue from "vue";
import type { SceneController } from "@voxcss/controller/sceneController";
import { ensureSceneController, SCENE_HOST_CLASS, type SceneComponentProps } from "@voxcss/controller/sceneBindings";
import { createSceneBindingManager } from "./bindings";
import { scenePropOptions } from "../vue/propOptions";

export function createSceneComponent() {
  return Vue.extend({
    inject: {
      sceneController: {
        default: null
      }
    },
    name: "VoxScene",
    props: scenePropOptions,
    data() {
      return {
        controller: null as SceneController | null,
        sceneBindingManager: null as ReturnType<typeof createSceneBindingManager> | null
      };
    },
    created() {
      const controller = this.resolveController();
      this.controller = controller;
      this.sceneBindingManager = createSceneBindingManager(this, () => ({
        controller: this.controller,
        ...this.buildProps()
      }));
      this.sceneBindingManager?.update();
      this.$watch(
        () => [this.voxels, this.rows, this.cols, this.depth, this.showWalls, this.showFloor, this.projection],
        () => {
          this.sceneBindingManager?.update();
        },
        { deep: false }
      );
    },
    mounted() {
      const node = this.$refs.host as HTMLElement | undefined;
      if (node) {
        this.sceneBindingManager?.mount(node);
      }
    },
    beforeDestroy() {
      this.sceneBindingManager?.destroy();
      this.sceneBindingManager = null;
    },
    methods: {
      resolveController(): SceneController {
        const injected = (this as any).sceneController;
        return ensureSceneController(typeof injected === "function" ? injected() : injected);
      },
      buildProps(): SceneComponentProps {
        return {
          voxels: this.voxels as VoxelGrid,
          rows: this.rows,
          cols: this.cols,
          depth: this.depth,
          showWalls: this.showWalls,
          showFloor: this.showFloor,
          projection: this.projection
        };
      }
    },
    render(h) {
      return h("div", {
        ref: "host",
        class: SCENE_HOST_CLASS
      });
    }
  });
}

export type { SceneComponentProps };

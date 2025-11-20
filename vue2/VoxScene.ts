// @ts-nocheck
import Vue from "vue";
import type { PropType, VNode } from "vue";
import type { SceneController } from "@voxcss/controller/createSceneController";
import type { VoxelGrid, ProjectionMode } from "@voxcss/core";
import { createSceneBindingManager } from "./bindings";

export default Vue.extend({
  inject: {
    sceneController: {
      default: null
    }
  },
  name: "VoxScene",
  props: {
    voxels: {
      type: Array as PropType<VoxelGrid | undefined>
    },
    rows: {
      type: Number
    },
    cols: {
      type: Number
    },
    depth: {
      type: Number
    },
    showWalls: { type: Boolean as PropType<boolean | undefined> },
    showFloor: { type: Boolean as PropType<boolean | undefined> },
    projection: { type: String as PropType<ProjectionMode | undefined> }
  },
  data() {
    return {
      controller: null as SceneController | null,
      sceneBindingManager: null as ReturnType<typeof createSceneBindingManager> | null
    };
  },
  created() {
    const controller = this.resolveController();
    if (!controller) {
      throw new Error("voxcss: VoxScene must be rendered inside a VoxCamera.");
    }
    this.controller = controller;
    this.sceneBindingManager = createSceneBindingManager(this, () => ({
      controller: this.controller,
      voxels: this.voxels as VoxelGrid,
      rows: this.rows,
      cols: this.cols,
      depth: this.depth,
      showWalls: this.showWalls,
      showFloor: this.showFloor,
      projection: this.projection
    }));
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
    resolveController(): SceneController | null {
      const injected = (this as any).sceneController;
      return typeof injected === "function" ? injected() : injected;
    }
  },
  render(h) {
    return h("div", {
      ref: "host",
      class: "voxcss-scene-host"
    });
  }
});

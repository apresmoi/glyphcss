// @ts-nocheck
import Vue from "vue";
import type { PropType, VNode } from "vue";
import { createSceneHostManager } from "./sceneHostManager";
import type { SceneController } from "@voxcss/controller/createSceneController";
import type { VoxelGrid, ProjectionMode } from "@voxcss/core";

export default Vue.extend({
  inject: {
    sceneController: {
      default: null
    }
  },
  name: "VoxScene",
  props: {
    voxels: {
      type: Array,
      default: () => []
    },
    rows: {
      type: Number,
      default: undefined
    },
    cols: {
      type: Number,
      default: undefined
    },
    depth: {
      type: Number,
      default: undefined
    },
    showWalls: {
      type: Boolean,
      default: false
    },
    showFloor: {
      type: Boolean,
      default: false
    },
    projection: {
      type: String as PropType<ProjectionMode | undefined>,
      default: undefined
    },
    dimetric: {
      type: Boolean,
      default: false
    }
  },
  data() {
    return {
      controller: null as SceneController | null,
      boxStyleSnapshot: {} as Record<string, string>,
      hostManager: null as ReturnType<typeof createSceneHostManager> | null
    };
  },
  created() {
    const controller = this.resolveController();
    if (!controller) {
      throw new Error("voxcss: VoxScene must be rendered inside a VoxCamera.");
    }
    this.controller = controller;
    this.boxStyleSnapshot = controller.getBoxStyle();
  },
  mounted() {
    if (!this.controller) return;
    this.hostManager = createSceneHostManager(this as any, this.controller);
    this.hostManager.mount(this.$refs.host as HTMLElement);
  },
  beforeDestroy() {
    this.hostManager?.destroy();
    this.hostManager = null;
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
      style: this.boxStyleSnapshot
    });
  }
});

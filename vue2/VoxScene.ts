// @ts-nocheck
import Vue from "vue";
import type { PropType, VNode } from "vue";
import type { SceneController } from "@voxcss/controller/createSceneController";
import type { VoxelGrid, ProjectionMode } from "@voxcss/core";
import { DEFAULT_SCENE_FLAGS } from "@voxcss/controller/defaults";
import { createSceneSession, type SceneSessionHandle } from "@voxcss/controller/createSceneSession";

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
    showWalls: { type: Boolean, default: DEFAULT_SCENE_FLAGS.showWalls },
    showFloor: { type: Boolean, default: DEFAULT_SCENE_FLAGS.showFloor },
    projection: { type: String as PropType<ProjectionMode | undefined>, default: DEFAULT_SCENE_FLAGS.projection }
  },
  data() {
    return {
      controller: null as SceneController | null,
      sessionHandle: null as SceneSessionHandle | null
    };
  },
  created() {
    const controller = this.resolveController();
    if (!controller) {
      throw new Error("voxcss: VoxScene must be rendered inside a VoxCamera.");
    }
    this.controller = controller;
  },
  mounted() {
    this.mountSession();
  },
  beforeDestroy() {
    this.sessionHandle?.destroy();
    this.sessionHandle = null;
  },
  methods: {
    resolveController(): SceneController | null {
      const injected = (this as any).sceneController;
      return typeof injected === "function" ? injected() : injected;
    },
    mountSession() {
      if (!this.controller) return;
      const node = this.$refs.host as HTMLElement | undefined;
      if (!node) return;
      const session = createSceneSession({
        controller: this.controller,
        element: node,
        voxels: this.voxels as VoxelGrid,
        rows: this.rows,
        cols: this.cols,
        depth: this.depth,
        showWalls: this.showWalls,
        showFloor: this.showFloor,
        projection: this.projection
      });
      session.mount();
      this.sessionHandle = session;
    },
    updateSessionState() {
      this.sessionHandle?.setState({
        voxels: this.voxels as VoxelGrid,
        rows: this.rows,
        cols: this.cols,
        depth: this.depth,
        showWalls: this.showWalls,
        showFloor: this.showFloor,
        projection: this.projection
      });
    }
  },
  watch: {
    voxels: {
      handler() {
        this.updateSessionState();
      },
      deep: false
    },
    rows() {
      this.updateSessionState();
    },
    cols() {
      this.updateSessionState();
    },
    depth() {
      this.updateSessionState();
    },
    showWalls() {
      this.updateSessionState();
    },
    showFloor() {
      this.updateSessionState();
    },
    projection() {
      this.updateSessionState();
    }
  },
  render(h) {
    return h("div", {
      ref: "host",
      class: "voxcss-scene-host"
    });
  }
});

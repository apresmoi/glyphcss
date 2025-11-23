// @ts-nocheck
import Vue from "vue";
import { SCENE_HOST_CLASS, type SceneComponentProps } from "@voxcss/controller/sceneBindings";
import { scenePropOptions } from "../vue/propOptions";

export default Vue.extend({
  name: "VoxScene",
  inject: ["sceneControllerState"],
  props: scenePropOptions,
  data(): { binding: any } {
    return {
      binding: null
    };
  },
  mounted() {
    this.mountScene();
  },
  updated() {
    this.updateBinding();
  },
  beforeDestroy() {
    this.binding?.destroy();
    this.binding = null;
  },
  methods: {
    mountScene() {
      this.binding?.destroy();
      const element = this.$refs.scene as HTMLElement | undefined;
      const controller = (this as any).sceneControllerState?.value;
      if (!element || !controller) return;
      const props: SceneComponentProps = {
        controller,
        voxels: this.voxels,
        rows: this.rows,
        cols: this.cols,
        depth: this.depth,
        showWalls: this.showWalls,
        showFloor: this.showFloor,
        projection: this.projection
      };
      const { createSceneBinding } = require("@voxcss/controller/sceneBindings");
      this.binding = createSceneBinding({ ...props, element });
    },
    updateBinding() {
      if (!this.binding) return;
      this.binding.update({
        voxels: this.voxels,
        rows: this.rows,
        cols: this.cols,
        depth: this.depth,
        showWalls: this.showWalls,
        showFloor: this.showFloor,
        projection: this.projection
      });
    }
  },
  render(h) {
    return h("div", {
      class: SCENE_HOST_CLASS,
      ref: "scene"
    });
  }
});

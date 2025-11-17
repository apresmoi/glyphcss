// @ts-nocheck
import Vue from "vue";
import type { PropType, VNode } from "vue";
import { createSceneHost } from "@voxcss/controller/createSceneHost";
import type { SceneHost } from "@voxcss/controller/createSceneHost";
import type { SceneController } from "@voxcss/controller/createSceneController";
import { inferGridDimensions, wallMasksEqual } from "@voxcss/core";
import type {
  SceneDimensions,
  VoxelGrid,
  WallsMask,
  VoxcssHooks,
  ProjectionMode
} from "@voxcss/core";

type SceneVm = Vue & {
  unwatchers: Array<() => void>;
};

function registerWatch(this: SceneVm, stop?: () => void): void {
  if (typeof stop === "function") {
    this.unwatchers.push(stop);
  }
}

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
    shapes: {
      type: Object,
      default: () => ({})
    },
    hooks: {
      type: Object as PropType<VoxcssHooks | undefined>,
      default: undefined
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
      host: null as SceneHost | null,
      controller: null as SceneController | null,
      controllerUnsub: null as (() => void) | null,
      boxStyleUnsub: null as (() => void) | null,
      boxStyleSnapshot: {} as Record<string, string>,
      unwatchers: [] as Array<() => void>,
      wallsSnapshot: null as WallsMask | null
    };
  },
  created() {
    const controller = this.resolveController();
    if (!controller) {
      throw new Error("voxcss: VoxScene must be rendered inside a VoxCamera.");
    }
    this.controller = controller;
    this.wallsSnapshot = controller.getWalls();
    this.boxStyleSnapshot = controller.getBoxStyle();
    this.controllerUnsub = controller.subscribeCamera(() => this.handleCameraUpdate());
    this.boxStyleUnsub = controller.subscribeBoxStyle((style) => {
      this.boxStyleSnapshot = style;
    });
  },
  mounted() {
    this.host = createSceneHost({ shapes: this.shapes, hooks: this.hooks });
    this.host.mount(this.$refs.host as HTMLElement, this.voxels as VoxelGrid, this.buildContext());
    this.syncDimensions();
    this.registerWatch(
      this.$watch(
        () => this.voxels,
        () => {
          this.host?.update(this.voxels as VoxelGrid, this.buildContext());
          this.syncDepth();
        }
      )
    );
    this.registerWatch(
      this.$watch(
        () => [
          this.rows,
          this.cols,
          this.depth,
          this.showWalls,
          this.showFloor,
          this.projection,
          this.dimetric
        ],
        () => {
          this.host?.updateContext(this.buildContext());
          this.syncDimensions();
        }
      )
    );
    this.registerWatch(
      this.$watch(
        () => this.shapes,
        (next) => {
          this.host?.setShapes(next as Record<string, any>);
          this.host?.update(this.voxels as VoxelGrid, this.buildContext());
        }
      )
    );
    this.registerWatch(
      this.$watch(
        () => this.hooks,
        (next) => {
          this.host?.setHooks(next as VoxcssHooks | undefined);
        }
      )
    );
  },
  beforeDestroy() {
    this.host?.destroy();
    this.host = null;
    this.unwatchers.forEach((stop) => stop());
    this.unwatchers = [];
    this.controllerUnsub?.();
    this.controllerUnsub = null;
    this.boxStyleUnsub?.();
    this.boxStyleUnsub = null;
  },
  methods: {
    resolveController(): SceneController | null {
      const injected = (this as any).sceneController;
      return typeof injected === "function" ? injected() : injected;
    },
    /** @param {(() => void) | undefined} stop */
    registerWatch,
    handleCameraUpdate() {
      if (!this.controller) return;
      const nextWalls = this.controller.getWalls();
      if (this.wallsSnapshot && wallMasksEqual(this.wallsSnapshot, nextWalls)) {
        return;
      }
      this.wallsSnapshot = nextWalls;
      if (!this.host) return;
      this.host.updateContext(this.buildContext());
    },
    syncDimensions() {
      if (!this.controller) return;
      const inferred = inferGridDimensions(this.voxels as VoxelGrid);
      const rows = typeof this.rows === "number" ? this.rows : inferred.rows;
      const cols = typeof this.cols === "number" ? this.cols : inferred.cols;
      const depth = typeof this.depth === "number" ? this.depth : inferred.depth;
      const dimensions: SceneDimensions = {
        rows,
        cols,
        depth
      };
      this.controller.setDimensions(dimensions);
    },
    syncDepth() {
      if (!this.controller) return;
      const inferred = inferGridDimensions(this.voxels as VoxelGrid);
      const depth = typeof this.depth === "number" ? this.depth : inferred.depth;
      this.controller.setDimensions({ depth });
    },
    buildContext() {
      const walls = (this.wallsSnapshot ?? this.controller?.getWalls())!;
      const inferred = inferGridDimensions(this.voxels as VoxelGrid);
      const rows = typeof this.rows === "number" ? this.rows : inferred.rows;
      const cols = typeof this.cols === "number" ? this.cols : inferred.cols;
      const depth = typeof this.depth === "number" ? this.depth : inferred.depth;
      const projectionMode = this.dimetric ? "dimetric" : (this.projection as ProjectionMode | undefined);
      this.controller?.setProjection?.(projectionMode);
      return {
        rows,
        cols,
        depth,
        rotX: this.controller?.getCameraState().rotX ?? 65,
        rotY: this.controller?.getCameraState().rotY ?? 45,
        showWalls: this.showWalls,
        showFloor: this.showFloor,
        projection: projectionMode,
        walls,
        resolveTexture(name: string, face: string) {
          if (!name || name.startsWith("#")) return undefined;
          if (
            name.startsWith("/") ||
            name.startsWith("./") ||
            name.startsWith("../") ||
            name.startsWith("http://") ||
            name.startsWith("https://") ||
            name.includes(".")
          ) {
            return name;
          }
          return `textures/${name}/${name}-${face}.svg`;
        }
      };
    }
  },
  render(h) {
    return h("div", {
      ref: "host",
      style: this.boxStyleSnapshot
    });
  }
});

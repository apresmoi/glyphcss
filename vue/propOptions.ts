import type { PropType } from "vue";
import type { AutoRotateOption } from "@voxcss/core/camera";
import type { ProjectionMode, VoxelGrid } from "@voxcss/core";
import type { SceneController } from "@voxcss/controller/sceneController";

export const cameraPropOptions = {
  zoom: { type: Number },
  pan: { type: Number },
  tilt: { type: Number },
  rotX: { type: Number },
  rotY: { type: Number },
  invert: { type: [Boolean, Number] as PropType<boolean | number> },
  perspective: { type: [Number, Boolean] as PropType<number | boolean> },
  interactive: { type: Boolean },
  animate: { type: [Boolean, Number, Object] as PropType<AutoRotateOption | false> }
} as const;

export const scenePropOptions = {
  controller: { type: Object as PropType<SceneController>, required: true },
  voxels: { type: Array as PropType<VoxelGrid | undefined> },
  rows: { type: Number },
  cols: { type: Number },
  depth: { type: Number },
  showWalls: { type: Boolean as PropType<boolean | undefined> },
  showFloor: { type: Boolean as PropType<boolean | undefined> },
  projection: { type: String as PropType<ProjectionMode | undefined> }
} as const;

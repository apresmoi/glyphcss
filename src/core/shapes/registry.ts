import type { ShapeRenderer } from "../types";
import { cubeShapeRenderer } from "./cube";
import { rampShapeRenderer } from "./ramp";
import { wedgeShapeRenderer } from "./wedge";
import { spikeShapeRenderer } from "./spike";

export const defaultShapes: Record<string, ShapeRenderer> = {
  cube: cubeShapeRenderer,
  ramp: rampShapeRenderer,
  wedge: wedgeShapeRenderer,
  spike: spikeShapeRenderer
};

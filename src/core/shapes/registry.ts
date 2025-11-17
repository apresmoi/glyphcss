import type { ShapeRenderer } from "../types";
import { cubeShapeRenderer } from "./cube";
import { flatShapeRenderer } from "./flat";
import { rampShapeRenderer } from "./ramp";
import { wedgeShapeRenderer } from "./wedge";
import { spikeShapeRenderer } from "./spike";

export const dimetricShapes: Record<string, ShapeRenderer> = {
  cube: cubeShapeRenderer,
  flat: flatShapeRenderer,
  ramp: rampShapeRenderer,
  wedge: wedgeShapeRenderer,
  spike: spikeShapeRenderer
};

import { createContext, useContext } from "react";
import type { SceneController } from "@voxcss/controller/createSceneController";

export const SceneControllerContext = createContext<SceneController | null>(null);

export function useSceneControllerContext(): SceneController {
  const controller = useContext(SceneControllerContext);
  if (!controller) {
    throw new Error("voxcss: VoxScene must be rendered inside a VoxCamera.");
  }
  return controller;
}

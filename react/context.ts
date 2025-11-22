import { createContext, useContext } from "react";
import type { SceneController } from "@voxcss/controller/sceneController";
import { ensureSceneController } from "@voxcss/controller/sceneBindings";

export const SceneControllerContext = createContext<SceneController | null>(null);

export function useSceneControllerContext(): SceneController {
  const controller = useContext(SceneControllerContext);
  return ensureSceneController(controller);
}

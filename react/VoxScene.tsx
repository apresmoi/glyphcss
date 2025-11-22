import { useSceneControllerContext } from "./context";
import { useSceneBinding } from "./useBindings";
import { createSceneComponent } from "./createSceneComponent";

export const VoxScene = createSceneComponent({
  useController: useSceneControllerContext,
  useBinding: useSceneBinding
});

export type { SceneComponentProps as VoxSceneProps } from "@voxcss/controller/createSceneBinding";

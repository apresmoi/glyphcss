import type { InjectionKey, Ref } from "vue";
import type { SceneController } from "@voxcss/controller/sceneController";

export const controllerKey: InjectionKey<Ref<SceneController | null>> = Symbol("voxcss-controller");

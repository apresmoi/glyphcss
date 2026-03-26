import type { InjectionKey, Ref } from "vue";
import type { SceneController } from "@layoutit/voxcss-core";

export const controllerKey: InjectionKey<Ref<SceneController | null>> = Symbol("voxcss-controller");

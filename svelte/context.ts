import type { SceneController } from "@voxcss/controller/sceneController";
import { getContext, setContext } from "svelte";
import { readable, writable, type Readable, type Writable } from "svelte/store";

const CONTROLLER_KEY = Symbol("voxcss-controller");
const NULL_STORE = readable<SceneController | null>(null);

export function createControllerStore(): Writable<SceneController | null> {
  return writable<SceneController | null>(null);
}

export function provideControllerStore(store: Writable<SceneController | null>): void {
  setContext(CONTROLLER_KEY, store);
}

export function useControllerStore(): Readable<SceneController | null> {
  return getContext<Readable<SceneController | null>>(CONTROLLER_KEY) ?? NULL_STORE;
}

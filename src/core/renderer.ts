import type { SceneSnapshot } from "./state";

export interface RendererMountOptions {
  documentRef: Document;
  target: HTMLElement;
}

export interface RendererHandle {
  render(snapshot: SceneSnapshot): void;
  destroy(): void;
}

export type RendererFactory = (options: RendererMountOptions) => RendererHandle;

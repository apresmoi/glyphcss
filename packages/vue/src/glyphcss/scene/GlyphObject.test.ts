import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp, defineComponent, h, nextTick, provide, shallowRef } from "vue";
import type { GlyphSceneHandle, GlyphSceneObject, GlyphSceneObjectHandle } from "glyphcss";
import { GlyphObject } from "./GlyphObject";
import { GlyphSceneContextKey } from "./context";

function createHandle(): GlyphSceneObjectHandle & {
  setTransform: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
} {
  return {
    meshes: new Map(),
    setTransform: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
  };
}

function createScene(handle: GlyphSceneObjectHandle) {
  const addObject = vi.fn(() => handle);
  const rerender = vi.fn();
  return { scene: { addObject, rerender } as unknown as GlyphSceneHandle, addObject, rerender };
}

const object: GlyphSceneObject = {
  id: "obj-1",
  meshes: [],
  bounds: { min: [0, 0, 0], max: [0, 0, 0] },
};

function mountObject(scene: GlyphSceneHandle, initialProps: Record<string, unknown>) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const props = shallowRef(initialProps);
  const app = createApp(defineComponent({
    setup() {
      provide(GlyphSceneContextKey, { sceneRef: shallowRef(scene) });
      return () => h(GlyphObject, props.value as never);
    },
  }));
  app.mount(container);
  return { app, container, props };
}

describe("GlyphObject (Vue)", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("mounts via scene.addObject, forwards the transform, and removes on unmount", async () => {
    const handle = createHandle();
    const { scene, addObject } = createScene(handle);
    const mounted = mountObject(scene, { object, position: [1, 2, 3] });
    await nextTick();

    expect(addObject).toHaveBeenCalledOnce();
    expect(addObject).toHaveBeenCalledWith(object, { position: [1, 2, 3], scale: undefined, rotation: undefined });
    expect(mounted.container.childElementCount).toBe(0);

    mounted.app.unmount();
    expect(handle.remove).toHaveBeenCalledOnce();
  });

  it("calls update() when the object prop changes, and setTransform() when the transform changes", async () => {
    const handle = createHandle();
    const { scene } = createScene(handle);
    const mounted = mountObject(scene, { object });
    await nextTick();

    const nextObject: GlyphSceneObject = { ...object, meshes: [] };
    mounted.props.value = { object: nextObject };
    await nextTick();
    expect(handle.update).toHaveBeenCalledWith(nextObject);

    mounted.props.value = { object: nextObject, rotation: [0, 90, 0] };
    await nextTick();
    expect(handle.setTransform).toHaveBeenCalledWith({ position: undefined, scale: undefined, rotation: [0, 90, 0] });
  });
});

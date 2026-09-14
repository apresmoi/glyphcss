import { afterEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import type { GlyphSceneHandle, GlyphSceneObject, GlyphSceneObjectHandle } from "glyphcss";
import { GlyphObject } from "./GlyphObject";
import { GlyphSceneContext } from "./context";

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

describe("GlyphObject (React)", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("mounts via scene.addObject, forwards the transform, and disposes on unmount", () => {
    const handle = createHandle();
    const { scene, addObject } = createScene(handle);
    const sceneRef = { current: scene };
    const container = document.createElement("div");
    const root = createRoot(container);

    act(() => {
      root.render(
        <GlyphSceneContext.Provider value={{ sceneRef }}>
          <GlyphObject object={object} position={[1, 2, 3]} />
        </GlyphSceneContext.Provider>,
      );
    });

    expect(addObject).toHaveBeenCalledOnce();
    expect(addObject).toHaveBeenCalledWith(object, { position: [1, 2, 3], scale: undefined, rotation: undefined });
    expect(container.childElementCount).toBe(0);

    act(() => root.unmount());
    expect(handle.remove).toHaveBeenCalledOnce();
  });

  it("calls update() when the object prop changes, and setTransform() when the transform changes", () => {
    const handle = createHandle();
    const { scene } = createScene(handle);
    const sceneRef = { current: scene };
    const container = document.createElement("div");
    const root = createRoot(container);

    const render = (props: React.ComponentProps<typeof GlyphObject>) => (
      <GlyphSceneContext.Provider value={{ sceneRef }}>
        <GlyphObject {...props} />
      </GlyphSceneContext.Provider>
    );

    act(() => root.render(render({ object })));
    const nextObject: GlyphSceneObject = { ...object, meshes: [] };
    act(() => root.render(render({ object: nextObject })));
    expect(handle.update).toHaveBeenCalledWith(nextObject);

    act(() => root.render(render({ object: nextObject, rotation: [0, 90, 0] })));
    expect(handle.setTransform).toHaveBeenCalledWith({ position: undefined, scale: undefined, rotation: [0, 90, 0] });
  });
});

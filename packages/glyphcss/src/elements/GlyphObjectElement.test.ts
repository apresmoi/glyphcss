import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { GlyphSceneHandle } from "../api/createGlyphScene";
import type { GlyphSceneObject, GlyphSceneObjectHandle } from "../api/sceneObject";
import { GlyphObjectElement } from "./GlyphObjectElement";

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

function mountWithScene() {
  const handles: ReturnType<typeof createHandle>[] = [];
  const addObject = vi.fn(() => {
    const handle = createHandle();
    handles.push(handle);
    return handle;
  });
  const scene = { addObject } as unknown as GlyphSceneHandle;
  const sceneElement = document.createElement("div") as HTMLDivElement & {
    getScene(): GlyphSceneHandle;
  };
  sceneElement.getScene = () => scene;
  const element = document.createElement("glyph-object") as GlyphObjectElement;
  Object.defineProperty(element, "closest", { value: () => sceneElement });
  document.body.appendChild(element);
  return { element, handles, addObject };
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

const object: GlyphSceneObject = {
  id: "obj-1",
  meshes: [],
  bounds: { min: [0, 0, 0], max: [0, 0, 0] },
};

beforeAll(() => {
  if (!customElements.get("glyph-object")) {
    customElements.define("glyph-object", GlyphObjectElement);
  }
});

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("GlyphObjectElement", () => {
  it("mounts via scene.addObject when `.object` is set, forwarding position/scale/rotation attributes", async () => {
    const { element, addObject, handles } = mountWithScene();
    element.setAttribute("position", "1,2,3");
    element.object = object;
    await flush();

    expect(addObject).toHaveBeenCalledOnce();
    expect(addObject).toHaveBeenCalledWith(object, { position: [1, 2, 3], scale: undefined, rotation: undefined });
    expect(element.getObjectHandle()).toBe(handles[0]);
  });

  it("update()s the existing handle when `.object` changes (does not remount)", async () => {
    const { element, addObject, handles } = mountWithScene();
    element.object = object;
    await flush();

    const nextObject: GlyphSceneObject = { ...object, meshes: [] };
    element.object = nextObject;
    await flush();

    expect(addObject).toHaveBeenCalledTimes(1);
    expect(handles[0]!.update).toHaveBeenCalledWith(nextObject);
  });

  it("setTransform()s the existing handle when a transform attribute changes", async () => {
    const { element, handles } = mountWithScene();
    element.object = object;
    await flush();

    element.setAttribute("rotation", "0,90,0");
    await flush();

    expect(handles[0]!.setTransform).toHaveBeenCalledWith({ position: undefined, scale: undefined, rotation: [0, 90, 0] });
  });

  it("removes on disconnect, and setting `.object` to null removes without waiting for disconnect", async () => {
    const { element, handles } = mountWithScene();
    element.object = object;
    await flush();

    element.object = null;
    await flush();
    expect(handles[0]!.remove).toHaveBeenCalledOnce();

    element.object = object;
    await flush();
    element.remove();
    expect(handles[1]!.remove).toHaveBeenCalledOnce();
  });

  it("dispatches glyphcss:object-ready once mounted", async () => {
    const { element } = mountWithScene();
    const onReady = vi.fn();
    element.addEventListener("glyphcss:object-ready", onReady);
    element.object = object;
    await flush();
    expect(onReady).toHaveBeenCalledTimes(1);
  });
});

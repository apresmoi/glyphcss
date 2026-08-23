import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  GlyphEffectDefinition,
  GlyphEffectLayerHandle,
  GlyphEffectParamValue,
} from "../api/effects";
import type { GlyphSceneHandle } from "../api/createGlyphScene";
import { GlyphEffectLayerElement } from "./GlyphEffectLayerElement";

const schema = {
  time: { kind: "number", default: 0, animation: "continuous" },
  glyphs: { kind: "string", default: "HOLA", animation: "discrete" },
} as const;

const effectA: GlyphEffectDefinition<typeof schema> = {
  id: "test-a",
  version: 1,
  parameterSchema: schema,
  program: { evaluate() {} },
};

const effectB: GlyphEffectDefinition<typeof schema> = {
  ...effectA,
  id: "test-b",
};

type RuntimeParams = Record<string, GlyphEffectParamValue>;

function createHandle(initial: RuntimeParams): GlyphEffectLayerHandle<RuntimeParams> {
  const params = { ...initial };
  let disposed = false;
  return {
    params,
    get disposed() { return disposed; },
    enabled: true,
    opacity: 1,
    order: 0,
    setParams: vi.fn((next: Partial<RuntimeParams>) => Object.assign(params, next)),
    setOptions: vi.fn(),
    invalidate: vi.fn(),
    dispose: vi.fn(() => { disposed = true; }),
  };
}

function mountWithScene() {
  const handles: GlyphEffectLayerHandle<RuntimeParams>[] = [];
  const addEffectLayer = vi.fn((options: { params?: RuntimeParams }) => {
    const handle = createHandle(options.params ?? {});
    handles.push(handle);
    return handle;
  });
  const scene = { addEffectLayer } as unknown as GlyphSceneHandle;
  const sceneElement = document.createElement("div") as HTMLDivElement & {
    getScene(): GlyphSceneHandle;
  };
  sceneElement.getScene = () => scene;
  const element = document.createElement("glyph-effect-layer") as GlyphEffectLayerElement;
  Object.defineProperty(element, "closest", { value: () => sceneElement });
  document.body.appendChild(element);
  return { element, handles, addEffectLayer };
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

beforeAll(() => {
  if (!customElements.get("glyph-effect-layer")) {
    customElements.define("glyph-effect-layer", GlyphEffectLayerElement);
  }
});

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("GlyphEffectLayerElement", () => {
  it("coalesces property configuration and exposes the stable live params object", async () => {
    const { element, addEffectLayer, handles } = mountWithScene();
    const ready = element.whenReady();
    element.effect = effectA;
    element.params = { time: 2 };
    await flush();

    expect(addEffectLayer).toHaveBeenCalledTimes(1);
    expect(addEffectLayer).toHaveBeenCalledWith(expect.objectContaining({
      effect: effectA,
      params: { time: 2, glyphs: "HOLA" },
    }));
    expect(await ready).toBe(handles[0]);
    expect(element.params).toBe(handles[0]!.params);
  });

  it("updates params and layer options without recreating the layer", async () => {
    const { element, addEffectLayer, handles } = mountWithScene();
    element.configure({ effect: effectA, params: { glyphs: "ONE" } });
    await flush();
    element.setAttribute("blend", "replace");
    element.setAttribute("opacity", "0.4");
    element.params = { time: 3 };
    await flush();

    const handle = handles[0]!;
    expect(addEffectLayer).toHaveBeenCalledTimes(1);
    expect(handle.setParams).toHaveBeenCalledWith({ time: 3, glyphs: "HOLA" });
    expect(handle.setOptions).toHaveBeenCalledWith(expect.objectContaining({
      blend: "replace",
      opacity: 0.4,
    }));
  });

  it("does not reset imperatively animated params when only options change", async () => {
    const { element, handles } = mountWithScene();
    element.configure({ effect: effectA, params: { glyphs: "HOLA" } });
    await flush();

    const handle = handles[0]!;
    handle.params.time = 12;
    element.setAttribute("opacity", "0.6");
    await flush();

    expect(handle.params.time).toBe(12);
    expect(handle.setParams).not.toHaveBeenCalled();
    expect(handle.setOptions).toHaveBeenCalledWith(expect.objectContaining({ opacity: 0.6 }));
  });

  it("recreates only when effect identity changes", async () => {
    const { element, addEffectLayer, handles } = mountWithScene();
    element.configure({ effect: effectA });
    await flush();
    element.configure({ effect: effectB });
    await flush();

    expect(addEffectLayer).toHaveBeenCalledTimes(2);
    expect(handles[0]!.dispose).toHaveBeenCalledTimes(1);
    expect(element.getEffectHandle()).toBe(handles[1]);
  });

  it("disposes on disconnect and remounts on reconnect", async () => {
    const { element, addEffectLayer, handles } = mountWithScene();
    element.effect = effectA;
    await flush();
    element.remove();
    expect(handles[0]!.dispose).toHaveBeenCalledTimes(1);

    document.body.appendChild(element);
    await flush();
    expect(addEffectLayer).toHaveBeenCalledTimes(2);
  });

  it("forwards a GlyphMeshHandle/array target verbatim (JS property, not attribute — mesh handles cannot serialize to a string)", async () => {
    const { element, addEffectLayer, handles } = mountWithScene();
    const meshA = { id: 1 } as unknown as import("../api/createGlyphScene").GlyphMeshHandle;
    const meshB = { id: 2 } as unknown as import("../api/createGlyphScene").GlyphMeshHandle;
    element.configure({ effect: effectA, target: [meshA, meshB] });
    await flush();
    expect(addEffectLayer).toHaveBeenCalledWith(expect.objectContaining({ target: [meshA, meshB] }));

    // A subsequent flush with the handle already mounted forwards target
    // through setOptions the same way.
    element.setAttribute("opacity", "0.5");
    await flush();
    expect(handles[0]!.setOptions).toHaveBeenCalledWith(expect.objectContaining({ target: [meshA, meshB] }));
  });

  it("dispatches readiness once the atomic configuration mounts", async () => {
    const { element } = mountWithScene();
    const onReady = vi.fn();
    element.addEventListener("glyphcss:effect-ready", onReady);
    element.configure({ effect: effectA, params: { time: 4 } });
    await flush();
    expect(onReady).toHaveBeenCalledTimes(1);
  });

  it("forwards a `program` option only at layer creation (VOLUMETRIC-3.md §4, JS property — program-as-data is not attribute-serializable)", async () => {
    const { element, addEffectLayer, handles } = mountWithScene();
    const payload = { domain: "2d", layers: [] };
    element.configure({ effect: effectA, program: payload });
    await flush();
    expect(addEffectLayer).toHaveBeenCalledWith(expect.objectContaining({ program: payload }));

    // A later flush on the SAME (already-mounted) handle never forwards
    // `program` through setOptions — it's immutable after mount, so this
    // wrapper doesn't even attempt to re-apply it.
    element.setAttribute("opacity", "0.5");
    await flush();
    expect(handles[0]!.setOptions).toHaveBeenCalled();
    for (const call of (handles[0]!.setOptions as ReturnType<typeof vi.fn>).mock.calls) {
      expect(call[0]).not.toHaveProperty("program");
    }
  });

  it("forwards a `colorProgram` option only at layer creation (VOLUMETRIC-4.md §1, program-as-data's named sibling — same JS-property, mount-only contract as `program`)", async () => {
    const { element, addEffectLayer, handles } = mountWithScene();
    const payload = { domain: "2d", layers: [] };
    element.configure({ effect: effectA, colorProgram: payload });
    await flush();
    expect(addEffectLayer).toHaveBeenCalledWith(expect.objectContaining({ colorProgram: payload }));

    element.setAttribute("opacity", "0.5");
    await flush();
    expect(handles[0]!.setOptions).toHaveBeenCalled();
    for (const call of (handles[0]!.setOptions as ReturnType<typeof vi.fn>).mock.calls) {
      expect(call[0]).not.toHaveProperty("colorProgram");
    }
  });
});

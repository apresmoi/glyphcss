import { afterEach, describe, expect, it, vi } from "vitest";
import React, { act, createRef } from "react";
import { createRoot } from "react-dom/client";
import type {
  GlyphEffectDefinition,
  GlyphEffectLayerHandle,
  GlyphEffectParamValue,
  GlyphEffectProgram,
  GlyphMeshHandle,
  GlyphSceneHandle,
} from "glyphcss";
import { GlyphEffectLayer } from "./GlyphEffectLayer";
import { GlyphSceneContext } from "./context";

const parameterSchema = {
  time: { kind: "number", default: 0 },
  glyphs: { kind: "string", default: "ABC", animation: "discrete" },
} as const;

type TestParams = {
  time: number;
  glyphs: string;
};

const effectA = {
  id: "test-a",
  version: 1,
  parameterSchema,
  program: { evaluate() {} },
} satisfies GlyphEffectDefinition<typeof parameterSchema>;

const effectB = {
  id: "test-b",
  version: 1,
  parameterSchema,
  program: { evaluate() {} },
} satisfies GlyphEffectDefinition<typeof parameterSchema>;

const rawProgram = {
  evaluate() {},
} satisfies GlyphEffectProgram<Record<string, GlyphEffectParamValue>>;

function createHandle(): GlyphEffectLayerHandle<TestParams> & {
  setParams: ReturnType<typeof vi.fn>;
  setOptions: ReturnType<typeof vi.fn>;
  invalidate: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
} {
  const params: TestParams = { time: 1, glyphs: "ABC" };
  let disposed = false;
  const handle = {
    params,
    get disposed() { return disposed; },
    enabled: true,
    opacity: 1,
    order: 0,
    setParams: vi.fn((next: Partial<TestParams>) => Object.assign(params, next)),
    setOptions: vi.fn((next: Parameters<GlyphEffectLayerHandle<TestParams>["setOptions"]>[0]) => {
      if (next.enabled !== undefined) handle.enabled = next.enabled;
      if (next.opacity !== undefined) handle.opacity = next.opacity;
      if (next.order !== undefined) handle.order = next.order;
    }),
    invalidate: vi.fn(),
    dispose: vi.fn(() => { disposed = true; }),
  };
  return handle;
}

function createScene(handles: GlyphEffectLayerHandle<TestParams>[]) {
  const queue = [...handles];
  const addEffectLayer = vi.fn(() => {
    const handle = queue.shift();
    if (!handle) throw new Error("No test handle available.");
    return handle;
  });
  return {
    scene: { addEffectLayer } as unknown as GlyphSceneHandle,
    addEffectLayer,
  };
}

describe("GlyphEffectLayer (React)", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("registers one scene-root layer, forwards its handle, and renders no element", () => {
    const handle = createHandle();
    const { scene, addEffectLayer } = createScene([handle]);
    const sceneRef = { current: scene };
    const layerRef = createRef<GlyphEffectLayerHandle<TestParams>>();
    const container = document.createElement("div");
    const root = createRoot(container);

    act(() => {
      root.render(
        <GlyphSceneContext.Provider value={{ sceneRef }}>
          <GlyphEffectLayer
            ref={layerRef}
            effect={effectA}
            params={{ time: 1 }}
          />
        </GlyphSceneContext.Provider>,
      );
    });

    expect(addEffectLayer).toHaveBeenCalledOnce();
    expect(addEffectLayer).toHaveBeenCalledWith(expect.objectContaining({
      effect: effectA,
      params: { time: 1 },
      target: "surfaces",
      blend: "over",
      opacity: 1,
      order: 0,
      enabled: true,
    }));
    expect(layerRef.current).toBe(handle);
    expect(container.childElementCount).toBe(0);

    act(() => root.unmount());
    expect(handle.dispose).toHaveBeenCalledOnce();
    expect(layerRef.current).toBeNull();
  });

  it("diffs declarative params without resetting a live animated value", () => {
    const handle = createHandle();
    const { scene, addEffectLayer } = createScene([handle]);
    const sceneRef = { current: scene };
    const container = document.createElement("div");
    const root = createRoot(container);

    const render = (params: Partial<TestParams>) => (
      <GlyphSceneContext.Provider value={{ sceneRef }}>
        <GlyphEffectLayer effect={effectA} params={params} />
      </GlyphSceneContext.Provider>
    );

    act(() => root.render(render({ time: 1, glyphs: "ABC" })));
    handle.params.time = 9;
    act(() => root.render(render({ time: 1, glyphs: "ABC" })));

    expect(handle.setParams).not.toHaveBeenCalled();
    expect(handle.params.time).toBe(9);
    expect(addEffectLayer).toHaveBeenCalledOnce();

    act(() => root.render(render({ time: 2, glyphs: "ABC" })));
    expect(handle.setParams).toHaveBeenLastCalledWith({ time: 2 });
    expect(handle.params.time).toBe(2);
    expect(addEffectLayer).toHaveBeenCalledOnce();

    act(() => root.render(render({ glyphs: "ABC" })));
    expect(handle.setParams).toHaveBeenLastCalledWith({ time: 0 });
    expect(addEffectLayer).toHaveBeenCalledOnce();

    act(() => root.unmount());
  });

  it("updates layer options without recreating the layer", () => {
    const handle = createHandle();
    const { scene, addEffectLayer } = createScene([handle]);
    const sceneRef = { current: scene };
    const container = document.createElement("div");
    const root = createRoot(container);

    act(() => {
      root.render(
        <GlyphSceneContext.Provider value={{ sceneRef }}>
          <GlyphEffectLayer effect={effectA} params={{ time: 1 }} />
        </GlyphSceneContext.Provider>,
      );
    });
    act(() => {
      root.render(
        <GlyphSceneContext.Provider value={{ sceneRef }}>
          <GlyphEffectLayer
            effect={effectA}
            params={{ time: 1 }}
            target="viewport"
            blend="replace"
            opacity={0.4}
            order={3}
            enabled={false}
          />
        </GlyphSceneContext.Provider>,
      );
    });

    expect(addEffectLayer).toHaveBeenCalledOnce();
    expect(handle.setOptions).toHaveBeenCalledOnce();
    expect(handle.setOptions).toHaveBeenCalledWith({
      target: "viewport",
      blend: "replace",
      opacity: 0.4,
      order: 3,
      enabled: false,
    });

    act(() => root.unmount());
  });

  it("recreates only when the effect identity changes", () => {
    const first = createHandle();
    const second = createHandle();
    const { scene, addEffectLayer } = createScene([first, second]);
    const sceneRef = { current: scene };
    const layerRef = createRef<GlyphEffectLayerHandle<TestParams>>();
    const container = document.createElement("div");
    const root = createRoot(container);

    const render = (effect: typeof effectA | typeof effectB) => (
      <GlyphSceneContext.Provider value={{ sceneRef }}>
        <GlyphEffectLayer ref={layerRef} effect={effect} params={{ time: 1 }} />
      </GlyphSceneContext.Provider>
    );

    act(() => root.render(render(effectA)));
    expect(layerRef.current).toBe(first);

    act(() => root.render(render(effectB)));
    expect(first.dispose).toHaveBeenCalledOnce();
    expect(addEffectLayer).toHaveBeenCalledTimes(2);
    expect(layerRef.current).toBe(second);

    act(() => root.unmount());
    expect(second.dispose).toHaveBeenCalledOnce();
  });

  it("mesh-target re-render: a same-set fresh array is a no-op, a different set forwards to setOptions (which the runtime rejects)", () => {
    const meshA = { id: 1 } as unknown as GlyphMeshHandle;
    const meshB = { id: 2 } as unknown as GlyphMeshHandle;
    const meshC = { id: 3 } as unknown as GlyphMeshHandle;
    const handle = createHandle();
    handle.setOptions.mockImplementation((next: Parameters<GlyphEffectLayerHandle<TestParams>["setOptions"]>[0]) => {
      if (next.target !== undefined && next.target !== "surfaces" && next.target !== "viewport") {
        const ids = (Array.isArray(next.target) ? next.target : [next.target]).map((m) => (m as GlyphMeshHandle).id).sort();
        if (JSON.stringify(ids) !== JSON.stringify([1, 2])) {
          throw new Error("glyphcss: an effect layer's mesh target is immutable after mount.");
        }
      }
    });
    const { scene } = createScene([handle]);
    const sceneRef = { current: scene };
    const container = document.createElement("div");
    const root = createRoot(container);

    const render = (target: readonly GlyphMeshHandle[]) => (
      <GlyphSceneContext.Provider value={{ sceneRef }}>
        <GlyphEffectLayer effect={effectA} params={{ time: 1 }} target={target} />
      </GlyphSceneContext.Provider>
    );

    act(() => root.render(render([meshA, meshB])));
    handle.setOptions.mockClear();

    // A fresh array, same mesh ids in a different order — must be a no-op.
    act(() => root.render(render([meshB, meshA])));
    expect(handle.setOptions).not.toHaveBeenCalled();

    // A genuinely different mesh set is forwarded and rejected by the runtime.
    expect(() => act(() => root.render(render([meshA, meshC])))).toThrow(/immutable after mount/i);

    act(() => root.unmount());
  });

  it("forwards a `program` option (VOLUMETRIC-3.md §4) at mount, and does not re-forward it through setOptions on a later options-only re-render", () => {
    const handle = createHandle();
    const { scene, addEffectLayer } = createScene([handle]);
    const sceneRef = { current: scene };
    const container = document.createElement("div");
    const root = createRoot(container);
    const payload = { domain: "2d", layers: [] };

    act(() => {
      root.render(
        <GlyphSceneContext.Provider value={{ sceneRef }}>
          <GlyphEffectLayer effect={effectA} params={{ time: 1 }} program={payload} />
        </GlyphSceneContext.Provider>,
      );
    });
    expect(addEffectLayer).toHaveBeenCalledWith(expect.objectContaining({ program: payload }));

    act(() => {
      root.render(
        <GlyphSceneContext.Provider value={{ sceneRef }}>
          <GlyphEffectLayer effect={effectA} params={{ time: 1 }} program={payload} opacity={0.5} />
        </GlyphSceneContext.Provider>,
      );
    });
    expect(addEffectLayer).toHaveBeenCalledOnce();
    expect(handle.setOptions).toHaveBeenCalledOnce();
    expect(handle.setOptions).toHaveBeenCalledWith(expect.not.objectContaining({ program: expect.anything() }));

    act(() => root.unmount());
  });

  it("recreates a raw-program layer when its parameter schema changes", () => {
    const first = createHandle();
    const second = createHandle();
    const { scene, addEffectLayer } = createScene([first, second]);
    const sceneRef = { current: scene };
    const container = document.createElement("div");
    const root = createRoot(container);

    const render = (params: Record<string, GlyphEffectParamValue>) => (
      <GlyphSceneContext.Provider value={{ sceneRef }}>
        <GlyphEffectLayer effect={rawProgram} params={params} />
      </GlyphSceneContext.Provider>
    );

    act(() => root.render(render({ time: 1 })));
    act(() => root.render(render({ time: 1, phase: 0 })));

    expect(first.dispose).toHaveBeenCalledOnce();
    expect(addEffectLayer).toHaveBeenCalledTimes(2);

    act(() => root.unmount());
    expect(second.dispose).toHaveBeenCalledOnce();
  });
});

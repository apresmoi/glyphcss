import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createApp,
  defineComponent,
  h,
  nextTick,
  provide,
  ref,
  shallowRef,
} from "vue";
import type {
  GlyphEffectDefinition,
  GlyphEffectLayerHandle,
  GlyphEffectParamValue,
  GlyphEffectProgram,
  GlyphSceneHandle,
} from "glyphcss";
import { GlyphEffectLayer } from "./GlyphEffectLayer";
import type { GlyphEffectLayerExposed } from "./GlyphEffectLayer";
import { GlyphSceneContextKey } from "./context";

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

function mountLayer(
  scene: GlyphSceneHandle,
  initialProps: Record<string, unknown>,
) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const props = shallowRef(initialProps);
  const layerRef = ref<GlyphEffectLayerExposed<TestParams> | null>(null);
  const app = createApp(defineComponent({
    setup() {
      provide(GlyphSceneContextKey, { sceneRef: shallowRef(scene) });
      return () => h(GlyphEffectLayer, { ...props.value, ref: layerRef });
    },
  }));
  app.mount(container);
  return { app, container, layerRef, props };
}

describe("GlyphEffectLayer (Vue)", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("registers one scene-root layer, exposes its handle, and renders no element", async () => {
    const handle = createHandle();
    const { scene, addEffectLayer } = createScene([handle]);
    const mounted = mountLayer(scene, {
      effect: effectA,
      params: { time: 1 },
    });
    await nextTick();

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
    expect(mounted.layerRef.value?.params).toBe(handle.params);
    expect(mounted.container.childElementCount).toBe(0);

    mounted.app.unmount();
    expect(handle.dispose).toHaveBeenCalledOnce();
    expect(mounted.layerRef.value).toBeNull();
  });

  it("diffs declarative params without resetting a live animated value", async () => {
    const handle = createHandle();
    const { scene, addEffectLayer } = createScene([handle]);
    const mounted = mountLayer(scene, {
      effect: effectA,
      params: { time: 1, glyphs: "ABC" },
    });
    await nextTick();

    handle.params.time = 9;
    mounted.props.value = {
      effect: effectA,
      params: { time: 1, glyphs: "ABC" },
    };
    await nextTick();

    expect(handle.setParams).not.toHaveBeenCalled();
    expect(handle.params.time).toBe(9);
    expect(addEffectLayer).toHaveBeenCalledOnce();

    mounted.props.value = {
      effect: effectA,
      params: { time: 2, glyphs: "ABC" },
    };
    await nextTick();
    expect(handle.setParams).toHaveBeenLastCalledWith({ time: 2 });
    expect(handle.params.time).toBe(2);
    expect(addEffectLayer).toHaveBeenCalledOnce();

    mounted.props.value = {
      effect: effectA,
      params: { glyphs: "ABC" },
    };
    await nextTick();
    expect(handle.setParams).toHaveBeenLastCalledWith({ time: 0 });
    expect(addEffectLayer).toHaveBeenCalledOnce();

    mounted.app.unmount();
  });

  it("updates layer options without recreating the layer", async () => {
    const handle = createHandle();
    const { scene, addEffectLayer } = createScene([handle]);
    const mounted = mountLayer(scene, {
      effect: effectA,
      params: { time: 1 },
    });
    await nextTick();

    mounted.props.value = {
      effect: effectA,
      params: { time: 1 },
      target: "viewport",
      blend: "replace",
      opacity: 0.4,
      order: 3,
      enabled: false,
    };
    await nextTick();

    expect(addEffectLayer).toHaveBeenCalledOnce();
    expect(handle.setOptions).toHaveBeenCalledOnce();
    expect(handle.setOptions).toHaveBeenCalledWith({
      target: "viewport",
      blend: "replace",
      opacity: 0.4,
      order: 3,
      enabled: false,
    });

    mounted.app.unmount();
  });

  it("recreates only when the effect identity changes", async () => {
    const first = createHandle();
    const second = createHandle();
    const { scene, addEffectLayer } = createScene([first, second]);
    const mounted = mountLayer(scene, {
      effect: effectA,
      params: { time: 1 },
    });
    await nextTick();
    expect(mounted.layerRef.value?.params).toBe(first.params);

    mounted.props.value = {
      effect: effectB,
      params: { time: 1 },
    };
    await nextTick();

    expect(first.dispose).toHaveBeenCalledOnce();
    expect(addEffectLayer).toHaveBeenCalledTimes(2);
    expect(mounted.layerRef.value?.params).toBe(second.params);

    mounted.app.unmount();
    expect(second.dispose).toHaveBeenCalledOnce();
  });

  it("recreates a raw-program layer when its parameter schema changes", async () => {
    const first = createHandle();
    const second = createHandle();
    const { scene, addEffectLayer } = createScene([first, second]);
    const mounted = mountLayer(scene, {
      effect: rawProgram,
      params: { time: 1 },
    });
    await nextTick();

    mounted.props.value = {
      effect: rawProgram,
      params: { time: 1, phase: 0 },
    };
    await nextTick();

    expect(first.dispose).toHaveBeenCalledOnce();
    expect(addEffectLayer).toHaveBeenCalledTimes(2);

    mounted.app.unmount();
    expect(second.dispose).toHaveBeenCalledOnce();
  });
});

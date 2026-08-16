import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Polygon } from "@glyphcss/core";
import { createGlyphOrthographicCamera } from "./createGlyphCamera";
import { createGlyphScene } from "./createGlyphScene";
import {
  GlyphEffectOutputChannel,
  defineGlyphEffect,
  type GlyphEffectDefinition,
} from "./effects";

declare global {
  var __glyphRenderStage: ((stage: string) => void) | undefined;
  var __glyphRenderError: ((error: unknown) => void) | undefined;
}

function makeCubePolygons(): Polygon[] {
  const out: Polygon[] = [];
  const faces: Array<[number, number, number, number, number, number, number, number, number]> = [
    [-1, -1, 1, 1, -1, 1, 1, 1, 1],
    [-1, -1, 1, 1, 1, 1, -1, 1, 1],
    [1, -1, -1, -1, -1, -1, -1, 1, -1],
    [1, -1, -1, -1, 1, -1, 1, 1, -1],
    [-1, 1, 1, 1, 1, 1, 1, 1, -1],
    [-1, 1, 1, 1, 1, -1, -1, 1, -1],
  ];
  for (const [x0, y0, z0, x1, y1, z1, x2, y2, z2] of faces) {
    out.push({ vertices: [[x0, y0, z0], [x1, y1, z1], [x2, y2, z2]], color: "#88aacc" });
  }
  return out;
}

async function flushRenders(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function glyphProgram(glyph: string, onEvaluate?: () => void) {
  return defineGlyphEffect<{ phase: number }>({
    evaluate({ target, output }) {
      onEvaluate?.();
      for (let i = 0; i < output.coverage.length; i++) {
        if (target.coverage[i]! <= 0) continue;
        output.glyph[i] = glyph;
        output.coverage[i] = 1;
        output.channels[i] = GlyphEffectOutputChannel.Glyph;
      }
    },
  });
}

describe("createGlyphScene effects", () => {
  let host: HTMLElement;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    delete globalThis.__glyphRenderStage;
    delete globalThis.__glyphRenderError;
  });

  it("rolls back a retained-only effect publish when its output setter fails", async () => {
    const scene = createGlyphScene(host, { cols: 32, rows: 18, useColors: true, camera: createGlyphOrthographicCamera({ zoom: 50 }) });
    scene.add(makeCubePolygons());
    scene.add(makeCubePolygons(), { density: 2 });
    const layer = scene.addEffectLayer({ effect: glyphProgram("X"), params: { phase: 0 }, blend: "replace" });
    await flushRenders();
    const before = scene.output.innerHTML;
    const detail = host.querySelector("pre.glyph-output--detail") as HTMLPreElement;
    const detailBefore = detail.innerHTML;
    const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, "innerHTML")!;
    let reached = false;
    let captured: unknown;
    let fail = true;
    Object.defineProperty(detail, "innerHTML", {
      configurable: true,
      get: descriptor.get,
      set(value) { if (fail) { fail = false; throw new Error("publish failed"); } descriptor.set!.call(this, value); },
    });
    globalThis.__glyphRenderStage = (stage) => { if (stage === "effect-compose") reached = true; };
    globalThis.__glyphRenderError = (error) => { captured = error; };
    layer.params.phase = 1;
    await flushRenders();
    Object.defineProperty(detail, "innerHTML", descriptor);
    delete globalThis.__glyphRenderStage;
    delete globalThis.__glyphRenderError;
    expect(reached).toBe(true);
    expect((captured as Error).message).toBe("publish failed");
    expect(scene.output.innerHTML).toBe(before);
    expect(detail.innerHTML).toBe(detailBefore);
    // A later retained-only update still composes and publishes from the same
    // retained frame rather than requiring a camera/geometry rerender.
    layer.params.phase = 2;
    await flushRenders();
    expect(scene.output.textContent).toContain("X");
    scene.destroy();
  });

  it("uses definition defaults and exposes stable Anime-compatible params", async () => {
    const schema = {
      amount: { kind: "number", default: 0.25, min: 0, max: 1 },
      mode: { kind: "string", default: "a", values: ["a", "b"], animation: "discrete" },
      active: { kind: "boolean", default: true, animation: "discrete" },
      color: { kind: "color", default: "#00ff88" },
    } as const;
    const definition = {
      id: "test.defaults",
      version: 1,
      parameterSchema: schema,
      program: defineGlyphEffect<{
        amount: number;
        mode: string;
        active: boolean;
        color: string;
      }>({ evaluate() {} }),
    } satisfies GlyphEffectDefinition<typeof schema>;
    const scene = createGlyphScene(host, { cols: 20, rows: 10, useColors: false });
    const layer = scene.addEffectLayer({ effect: definition, params: { amount: 0.5 } });
    const params = layer.params;

    expect(params).toEqual({ amount: 0.5, mode: "a", active: true, color: "#00ff88" });
    expect(layer.params).toBe(params);
    expect(Object.isExtensible(params)).toBe(true);
    const animeMetadata = Symbol("anime");
    Reflect.set(params, animeMetadata, { target: true });
    expect(Reflect.get(params, animeMetadata)).toEqual({ target: true });
    expect(() => Reflect.set(params, "unknown", 1)).toThrow(/unknown effect parameter/);
    expect(() => layer.setParams({ mode: "c" })).toThrow(/must be one of/);
    expect(() => layer.setParams({ color: "javascript:bad" })).toThrow(/unsupported effect color/);

    layer.setParams({ amount: 1, mode: "b" });
    await flushRenders();
    expect(params.amount).toBe(1);
    expect(params.mode).toBe("b");
    scene.destroy();
  });

  it("coalesces param writes and reuses retained frames without camera projection", async () => {
    const camera = createGlyphOrthographicCamera({ zoom: 50 });
    const project = vi.spyOn(camera, "project");
    const evaluate = vi.fn();
    const scene = createGlyphScene(host, {
      cols: 32,
      rows: 18,
      useColors: false,
      camera,
    });
    scene.add(makeCubePolygons());
    const layer = scene.addEffectLayer({
      effect: glyphProgram("X", evaluate),
      params: { phase: 0 },
      blend: "replace",
    });
    await flushRenders();
    const projected = project.mock.calls.length;
    const evaluations = evaluate.mock.calls.length;

    layer.params.phase = 1;
    layer.params.phase = 2;
    layer.setParams({ phase: 3 });
    await flushRenders();

    expect(project.mock.calls.length).toBe(projected);
    expect(evaluate.mock.calls.length).toBe(evaluations + 1);
    expect(scene.output.textContent).toContain("X");
    scene.destroy();
  });

  it("prepares once but evaluates every retained base/detail output", async () => {
    const camera = createGlyphOrthographicCamera({ zoom: 50 });
    const project = vi.spyOn(camera, "project");
    const prepare = vi.fn();
    const evaluate = vi.fn();
    const scene = createGlyphScene(host, {
      cols: 32,
      rows: 18,
      useColors: false,
      camera,
    });
    scene.add(makeCubePolygons(), { density: 2 });
    const layer = scene.addEffectLayer({
      effect: defineGlyphEffect<{ phase: number }>({
        prepare,
        evaluate(context) {
          evaluate(context.base.cols, context.base.rows);
        },
      }),
      params: { phase: 0 },
    });
    await flushRenders();
    expect(host.querySelector("pre.glyph-output--detail")).toBeTruthy();
    const projected = project.mock.calls.length;
    const prepares = prepare.mock.calls.length;
    const evaluations = evaluate.mock.calls.length;
    expect(evaluations).toBeGreaterThanOrEqual(2);

    layer.params.phase = 1;
    await flushRenders();
    expect(project.mock.calls.length).toBe(projected);
    expect(prepare.mock.calls.length).toBe(prepares + 1);
    expect(evaluate.mock.calls.length).toBe(evaluations + 2);
    scene.destroy();
  });

  it("orders layers deterministically and applies the legacy hook last", async () => {
    const calls: string[] = [];
    let legacySawEffect = false;
    const scene = createGlyphScene(host, {
      cols: 30,
      rows: 16,
      useColors: false,
      camera: createGlyphOrthographicCamera({ zoom: 50 }),
      transformCells(grid) {
        for (let i = 0; i < grid.char.length; i++) {
          if (grid.char[i] === "A") {
            legacySawEffect = true;
            grid.char[i] = "L";
          }
        }
      },
    });
    scene.add(makeCubePolygons());
    const later = scene.addEffectLayer({
      effect: glyphProgram("A", () => calls.push("later")),
      params: { phase: 0 },
      blend: "replace",
      order: 10,
    });
    scene.addEffectLayer({
      effect: glyphProgram("B", () => calls.push("earlier")),
      params: { phase: 0 },
      blend: "replace",
      order: 0,
    });
    await flushRenders();

    expect(calls).toEqual(["earlier", "later"]);
    expect(legacySawEffect).toBe(true);
    expect(scene.output.textContent).toContain("L");
    calls.length = 0;
    later.order = -1;
    await flushRenders();
    expect(calls).toEqual(["later", "earlier"]);
    scene.destroy();
  });

  it("escapes effect glyph HTML before colored output", async () => {
    const scene = createGlyphScene(host, {
      cols: 24,
      rows: 12,
      useColors: true,
      camera: createGlyphOrthographicCamera({ zoom: 50 }),
    });
    scene.add(makeCubePolygons());
    scene.addEffectLayer({
      effect: glyphProgram("<"),
      params: { phase: 0 },
      blend: "replace",
    });
    await flushRenders();
    expect(scene.output.innerHTML).toContain("&lt;");
    expect(scene.output.textContent).toContain("<");
    scene.destroy();
  });

  it("targets dark covered surfaces after supersample downsampling", async () => {
    const scene = createGlyphScene(host, {
      cols: 30,
      rows: 16,
      useColors: false,
      supersample: 2,
      doubleSided: true,
      camera: createGlyphOrthographicCamera({ zoom: 50 }),
      directionalLight: { direction: [0, 0, 1], intensity: 0 },
      ambientLight: { intensity: 0 },
    });
    scene.add(makeCubePolygons());
    scene.addEffectLayer({
      effect: glyphProgram("X"),
      params: { phase: 0 },
      blend: "replace",
    });
    await flushRenders();

    expect(scene.output.textContent).toContain("X");
    scene.destroy();
  });

  it("rejects unsupported requirements and incompatible modes atomically", () => {
    const scene = createGlyphScene(host, { mode: "solid" });
    const mesh = scene.add(makeCubePolygons());
    const unsupportedProgram = defineGlyphEffect<{ phase: number }>({
      requirements: ["surfaceKey"],
      evaluate() {},
    });
    expect(() => scene.addEffectLayer({ effect: unsupportedProgram, params: { phase: 0 } }))
      .toThrow(/not supported/);

    // Mesh-handle targets are now supported (VOLUMETRIC-3.md §1) — mounting
    // one no longer throws.
    const uvProgram = defineGlyphEffect<{ phase: number }>({
      requirements: ["uv0"],
      evaluate() {},
    });
    const meshTargeted = scene.addEffectLayer({ effect: uvProgram, params: { phase: 0 }, target: mesh });
    expect(meshTargeted.disposed).toBe(false);
    const layer = scene.addEffectLayer({ effect: uvProgram, params: { phase: 0 } });
    expect(() => scene.setOptions({ mode: "wireframe" })).toThrow(/only available in solid mode/);
    expect(scene.getOptions().mode).toBe("solid");
    // A layer mounted with the default "surfaces" target cannot be
    // retargeted to a mesh set after mount — live retargeting is out of
    // scope; remove and re-add the layer instead.
    expect(() => layer.setOptions({ target: mesh })).toThrow(/immutable after mount/i);
    scene.destroy();
  });

  it("rejects malformed mesh-handle targets", () => {
    const scene = createGlyphScene(host, { mode: "solid" });
    scene.add(makeCubePolygons());
    const program = defineGlyphEffect<{ phase: number }>({ evaluate() {} });
    expect(() => scene.addEffectLayer({ effect: program, params: { phase: 0 }, target: [] }))
      .toThrow(/at least one GlyphMeshHandle/i);
    expect(() => scene.addEffectLayer({ effect: program, params: { phase: 0 }, target: [{} as never] }))
      .toThrow(/only GlyphMeshHandle values/i);
    scene.destroy();
  });

  it("restores the retained base on dispose and cancels queued work on destroy", async () => {
    const scene = createGlyphScene(host, {
      cols: 30,
      rows: 16,
      useColors: false,
      camera: createGlyphOrthographicCamera({ zoom: 50 }),
    });
    scene.add(makeCubePolygons());
    await flushRenders();
    const baseline = scene.output.textContent;
    const layer = scene.addEffectLayer({
      effect: glyphProgram("X"),
      params: { phase: 0 },
      blend: "replace",
    });
    await flushRenders();
    expect(scene.output.textContent).not.toBe(baseline);
    layer.dispose();
    await flushRenders();
    expect(scene.output.textContent).toBe(baseline);

    const queued = scene.addEffectLayer({
      effect: glyphProgram("Y"),
      params: { phase: 0 },
    });
    queued.params.phase = 1;
    scene.destroy();
    await flushRenders();
    expect(queued.disposed).toBe(true);
    expect(host.querySelector(".glyph-scene")).toBeNull();
  });
});

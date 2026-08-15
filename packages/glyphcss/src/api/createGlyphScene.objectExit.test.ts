import type { Polygon, Vec3 } from "@glyphcss/core";
import { describe, expect, it } from "vitest";
import { createGlyphOrthographicCamera } from "./createGlyphCamera";
import { createGlyphScene } from "./createGlyphScene";
import { defineGlyphEffect, type GlyphEffectRequirement } from "./effects";

function cubePolygons(): Polygon[] {
  const faces: Vec3[][] = [
    [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]],
    [[-1, -1, -1], [-1, 1, -1], [1, 1, -1], [1, -1, -1]],
    [[-1, 1, -1], [-1, 1, 1], [1, 1, 1], [1, 1, -1]],
    [[-1, -1, 1], [-1, -1, -1], [1, -1, -1], [1, -1, 1]],
    [[1, -1, 1], [1, -1, -1], [1, 1, -1], [1, 1, 1]],
    [[-1, -1, -1], [-1, -1, 1], [-1, 1, 1], [-1, 1, -1]],
  ];
  return faces.map((vertices) => ({ vertices, color: "#8899cc" }));
}

async function flushRenders(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("createGlyphScene — objectExit effect input", () => {
  it("is undefined unless a layer's requirements ask for it (pays nothing otherwise)", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    let sawObjectExit: boolean | undefined;
    const scene = createGlyphScene(host, {
      cols: 30,
      rows: 20,
      useColors: false,
      doubleSided: true,
      camera: createGlyphOrthographicCamera({ zoom: 200, rotX: 25, rotY: 35 }),
    });
    scene.add(cubePolygons());
    // This effect only asks for objectPosition — never objectExit.
    scene.addEffectLayer({
      effect: defineGlyphEffect<{ phase: number }>({
        optionalRequirements: ["objectPosition"],
        evaluate({ base }) {
          sawObjectExit = base.objectExit !== undefined;
        },
      }),
      params: { phase: 0 },
    });
    await flushRenders();
    expect(sawObjectExit).toBe(false);
    scene.destroy();
    host.remove();
  });

  it("is defined (with NaN empty cells) once a layer's static requirement asks for it", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    let captured: { defined?: boolean; centerFinite?: boolean; emptyIsNaN?: boolean; onCubeSurface?: boolean } = {};
    const scene = createGlyphScene(host, {
      cols: 30,
      rows: 20,
      useColors: false,
      doubleSided: true,
      camera: createGlyphOrthographicCamera({ zoom: 200, rotX: 25, rotY: 35 }),
    });
    scene.add(cubePolygons());
    scene.addEffectLayer({
      effect: defineGlyphEffect<{ phase: number }>({
        optionalRequirements: ["objectPosition", "objectExit"],
        evaluate({ base }) {
          const exit = base.objectExit;
          const covered = Array.from(base.coverage).findIndex((v) => v > 0);
          const empty = Array.from(base.coverage).findIndex((v) => v <= 0);
          const onSurface = (i: number): boolean => {
            const x = exit![i * 3]!, y = exit![i * 3 + 1]!, z = exit![i * 3 + 2]!;
            return Math.abs(Math.max(Math.abs(x), Math.abs(y), Math.abs(z)) - 1) < 0.02;
          };
          captured = {
            defined: exit !== undefined,
            centerFinite: exit !== undefined && covered >= 0 && Number.isFinite(exit[covered * 3]!),
            emptyIsNaN: exit !== undefined && empty >= 0 && Number.isNaN(exit[empty * 3]!),
            onCubeSurface: exit !== undefined && covered >= 0 && onSurface(covered),
          };
        },
      }),
      params: { phase: 0 },
    });
    await flushRenders();
    expect(captured.defined).toBe(true);
    expect(captured.centerFinite).toBe(true);
    expect(captured.emptyIsNaN).toBe(true);
    expect(captured.onCubeSurface).toBe(true);
    scene.destroy();
    host.remove();
  });

  it("dynamicRequirements gates retention on the layer's LIVE params, not a static declaration", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const scene = createGlyphScene(host, {
      cols: 30,
      rows: 20,
      useColors: false,
      doubleSided: true,
      camera: createGlyphOrthographicCamera({ zoom: 200, rotX: 25, rotY: 35 }),
    });
    scene.add(cubePolygons());
    let sawObjectExit: boolean | undefined;
    const layer = scene.addEffectLayer({
      effect: defineGlyphEffect<{ carve: boolean }>({
        optionalRequirements: ["objectPosition"],
        // Mirrors field-synth's spec'd behavior: `objectExit` is only ever
        // requested when the live param asks for it (VOLUMETRIC.md "Step 1"
        // — "adds `objectExit` only when `render: 'carve'`").
        dynamicRequirements(params): readonly GlyphEffectRequirement[] {
          return params.carve ? ["objectExit"] : [];
        },
        evaluate({ base }) {
          sawObjectExit = base.objectExit !== undefined;
        },
      }),
      params: { carve: false },
    });
    await flushRenders();
    expect(sawObjectExit).toBe(false);

    layer.params.carve = true;
    await flushRenders();
    expect(sawObjectExit).toBe(true);

    layer.params.carve = false;
    await flushRenders();
    expect(sawObjectExit).toBe(false);

    scene.destroy();
    host.remove();
  });

  it("mounting a hard-objectExit layer while another layer's output is already retained triggers a full render", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const scene = createGlyphScene(host, {
      cols: 30,
      rows: 20,
      useColors: false,
      doubleSided: true,
      camera: createGlyphOrthographicCamera({ zoom: 200, rotX: 25, rotY: 35 }),
    });
    scene.add(cubePolygons());
    // First layer never touches objectExit — its mount is what populates
    // `retainedEffectOutputs` with a base grid lacking that buffer.
    scene.addEffectLayer({
      effect: defineGlyphEffect<{ phase: number }>({ evaluate() {} }),
      params: { phase: 0 },
    });
    await flushRenders();

    let evaluated = false;
    let sawObjectExit: boolean | undefined;
    // Second layer has a HARD `objectExit` requirement, mounted AFTER the
    // first layer's retained output already exists
    // (`retainedEffectOutputs.size > 0`) — the exact precondition for the
    // `addEffectLayer` mount-time probe gap (VOLUMETRIC.md "Step 1"):
    // `needsInputRaster` must recognize the new layer needs a buffer the
    // existing retained output doesn't have, and schedule a full geometry
    // render instead of the cheap `scheduleEffectRender()` recompose.
    scene.addEffectLayer({
      effect: defineGlyphEffect<{ phase: number }>({
        requirements: ["objectExit"],
        evaluate({ base }) {
          evaluated = true;
          sawObjectExit = base.objectExit !== undefined;
        },
      }),
      params: { phase: 0 },
    });
    await flushRenders();
    expect(evaluated).toBe(true);
    expect(sawObjectExit).toBe(true);

    // A subsequent recompose (any further render pass) must keep succeeding —
    // not throw "retained object exit positions are unavailable" forever.
    evaluated = false;
    scene.add(cubePolygons());
    await flushRenders();
    expect(evaluated).toBe(true);

    scene.destroy();
    host.remove();
  });

  it("mounting a layer whose dynamicRequirements ask for objectExit at INITIAL params, while another layer's output is already retained, sees a real buffer instead of silently evaluating against undefined", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const scene = createGlyphScene(host, {
      cols: 30,
      rows: 20,
      useColors: false,
      doubleSided: true,
      camera: createGlyphOrthographicCamera({ zoom: 200, rotX: 25, rotY: 35 }),
    });
    scene.add(cubePolygons());
    scene.addEffectLayer({
      effect: defineGlyphEffect<{ phase: number }>({ evaluate() {} }),
      params: { phase: 0 },
    });
    await flushRenders();

    let evaluated = false;
    let sawObjectExit: boolean | undefined;
    let coveredFinite: boolean | undefined;
    // Mirrors field-synth mounting directly into `render: "carve"` — the
    // dynamic requirement is already live on the FIRST evaluation, not
    // reached later through a params change.
    scene.addEffectLayer({
      effect: defineGlyphEffect<{ carve: boolean }>({
        dynamicRequirements: (params): readonly GlyphEffectRequirement[] => (params.carve ? ["objectExit"] : []),
        evaluate({ base }) {
          evaluated = true;
          sawObjectExit = base.objectExit !== undefined;
          if (base.objectExit) {
            const covered = Array.from(base.coverage).findIndex((v) => v > 0);
            coveredFinite = covered >= 0 && Number.isFinite(base.objectExit[covered * 3]!);
          }
        },
      }),
      params: { carve: true },
    });
    await flushRenders();
    expect(evaluated).toBe(true);
    expect(sawObjectExit).toBe(true);
    expect(coveredFinite).toBe(true);

    scene.destroy();
    host.remove();
  });

  it("rejects an unsupported requirement returned from dynamicRequirements at mount time", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const scene = createGlyphScene(host, { mode: "solid" });
    scene.add(cubePolygons());
    const badProgram = defineGlyphEffect<{ phase: number }>({
      dynamicRequirements: () => ["surfaceKey"],
      evaluate() {},
    });
    expect(() => scene.addEffectLayer({ effect: badProgram, params: { phase: 0 } }))
      .toThrow(/not supported/);
    scene.destroy();
    host.remove();
  });
});

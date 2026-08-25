import { describe, it, expect } from "vitest";
import type { Polygon } from "@glyphcss/core";
import { buildRasterizeContext } from "./rasterizeContext";
import { createGlyphScene } from "./createGlyphScene";
import { createGlyphOrthographicCamera } from "./createGlyphCamera";
import { GlyphEffectOutputChannel, defineGlyphEffect } from "./effects";
import { GLYPH_FONT_ATLAS } from "../render/fontAtlas";

function makeDiv(): HTMLElement {
  const div = document.createElement("div");
  document.body.appendChild(div);
  return div;
}

async function flushRenders(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function countSpans(html: string): number {
  return (html.match(/<span/g) ?? []).length;
}

// Flat ambient-only lighting keeps rendered color == authored color exactly
// (same convention `createGlyphScene.colorTolerance.test.ts`'s `nearColorQuad`
// uses), and full ambient intensity saturates the shade ramp to its densest
// glyph uniformly, so every covered cell renders the exact same (glyph,
// color) pair — trivially within a one-entry atlasPalette.
const FLAT_LIGHTING = {
  directionalLight: { direction: [0, 0, 1] as [number, number, number], intensity: 0 },
  ambientLight: { intensity: 1 },
};

function flatQuad(color: string): Polygon[] {
  return [{ vertices: [[-3, -3, 0], [-3, 3, 0], [3, 3, 0], [3, -3, 0]], color }];
}

describe("buildRasterizeContext — colorEncoding validation", () => {
  const baseOpts = {
    camera: createGlyphOrthographicCamera(),
    grid: { cols: 4, rows: 4, cellAspect: 2.0 },
    mode: "wireframe" as const,
  };

  it("defaults to \"spans\" when omitted", () => {
    expect(buildRasterizeContext(baseOpts).colorEncoding).toBe("spans");
  });

  it("passes \"spans\" through explicitly", () => {
    expect(buildRasterizeContext({ ...baseOpts, colorEncoding: "spans" }).colorEncoding).toBe("spans");
  });

  it("passes \"atlas\" through explicitly", () => {
    expect(buildRasterizeContext({ ...baseOpts, colorEncoding: "atlas" }).colorEncoding).toBe("atlas");
  });

  it("throws on an invalid colorEncoding value", () => {
    // @ts-expect-error deliberately invalid at the type level too
    expect(() => buildRasterizeContext({ ...baseOpts, colorEncoding: "bogus" })).toThrow(TypeError);
  });

  it("passes atlasPalette through unchanged", () => {
    const palette = ["#ff0000", "#00ff00"];
    expect(buildRasterizeContext({ ...baseOpts, atlasPalette: palette }).atlasPalette).toBe(palette);
  });

  it("leaves atlasPalette undefined when omitted", () => {
    expect(buildRasterizeContext(baseOpts).atlasPalette).toBeUndefined();
  });
});

describe("createGlyphScene — colorEncoding option plumbing", () => {
  it("defaults to \"spans\" when omitted at construction", () => {
    const host = makeDiv();
    const scene = createGlyphScene(host, { camera: createGlyphOrthographicCamera() });
    expect(scene.getOptions().colorEncoding).toBe("spans");
    scene.destroy();
  });

  it("setOptions updates colorEncoding", () => {
    const host = makeDiv();
    const scene = createGlyphScene(host, { camera: createGlyphOrthographicCamera(), colorEncoding: "atlas" });
    expect(scene.getOptions().colorEncoding).toBe("atlas");
    scene.setOptions({ colorEncoding: "spans" });
    expect(scene.getOptions().colorEncoding).toBe("spans");
    scene.destroy();
  });

  it("setOptions with atlasPalette omitted leaves the previous value untouched, but an explicit undefined clears it", () => {
    const host = makeDiv();
    const palette = ["#ff0000"];
    const scene = createGlyphScene(host, { camera: createGlyphOrthographicCamera(), atlasPalette: palette });
    expect(scene.getOptions().atlasPalette).toBe(palette);
    scene.setOptions({ mode: "wireframe" });
    expect(scene.getOptions().atlasPalette).toBe(palette);
    scene.setOptions({ atlasPalette: undefined });
    expect(scene.getOptions().atlasPalette).toBeUndefined();
    scene.destroy();
  });
});

describe("createGlyphScene — colorEncoding \"spans\" (unset/explicit) is byte-identical to before this option existed", () => {
  const sceneOptions = {
    cols: 40,
    rows: 16,
    useColors: true,
    mode: "solid" as const,
    doubleSided: true,
    camera: createGlyphOrthographicCamera({ zoom: 50 }),
    ...FLAT_LIGHTING,
  };

  async function renderHtml(colorEncoding: "spans" | undefined): Promise<string> {
    const host = makeDiv();
    const scene = createGlyphScene(host, { ...sceneOptions, colorEncoding });
    scene.add(flatQuad("#336699"));
    await flushRenders();
    const html = scene.output.innerHTML;
    scene.destroy();
    host.remove();
    return html;
  }

  it("produces the exact same HTML whether colorEncoding is omitted or explicitly \"spans\"", async () => {
    const omitted = await renderHtml(undefined);
    const explicit = await renderHtml("spans");
    expect(explicit).toBe(omitted);
    // Sanity: this scene actually renders spans (not a degenerate blank compare).
    expect(countSpans(omitted)).toBeGreaterThan(0);
  });
});

describe("createGlyphScene — colorEncoding \"atlas\" end to end", () => {
  const sceneOptions = {
    cols: 40,
    rows: 16,
    useColors: true,
    mode: "solid" as const,
    doubleSided: true,
    camera: createGlyphOrthographicCamera({ zoom: 50 }),
    ...FLAT_LIGHTING,
  };

  it("renders zero <span>s as one PUA text node when the palette fully covers the scene", async () => {
    const host = makeDiv();
    const color = "#336699";
    const scene = createGlyphScene(host, { ...sceneOptions, colorEncoding: "atlas", atlasPalette: [color] });
    scene.add(flatQuad(color));
    await flushRenders();
    const html = scene.output.innerHTML;
    expect(html).not.toContain("<span");
    // Actually rendered something (not a degenerate blank compare) and used
    // real PUA code points, not the literal glyph — checked across the whole
    // string since the flat quad doesn't necessarily cover the grid's very
    // first cell (near the corners, outside its silhouette, stays blank).
    expect(html.trim().length).toBeGreaterThan(0);
    const codePoints = Array.from(html, (ch) => ch.codePointAt(0)!);
    expect(codePoints.some((cp) => cp >= GLYPH_FONT_ATLAS.puaStart)).toBe(true);
    scene.destroy();
    host.remove();
  });

  it("falls back to spans (whole-scene) when the palette does not cover the scene's actual color", async () => {
    const host = makeDiv();
    const scene = createGlyphScene(host, {
      ...sceneOptions,
      colorEncoding: "atlas",
      atlasPalette: ["#000000"], // does not match the quad's authored color
    });
    scene.add(flatQuad("#336699"));
    await flushRenders();
    const html = scene.output.innerHTML;
    expect(countSpans(html)).toBeGreaterThan(0);
    scene.destroy();
    host.remove();
  });

  it("falls back to spans when colorEncoding is \"atlas\" but no atlasPalette is supplied", async () => {
    const host = makeDiv();
    const scene = createGlyphScene(host, { ...sceneOptions, colorEncoding: "atlas" });
    scene.add(flatQuad("#336699"));
    await flushRenders();
    expect(countSpans(scene.output.innerHTML)).toBeGreaterThan(0);
    scene.destroy();
    host.remove();
  });
});

// Mirrors `createGlyphScene.colorTolerance.test.ts`'s two dedicated coverage
// suites for the two `createGlyphScene` call sites that bypass the main
// `rasterize()` pipeline: the retained Glyph Effect recompose path
// (`encodeCellGridOutput`, createGlyphScene.ts) and a per-mesh detail layer's
// own `buildRasterizeContext` call.
function nearColorGradientProgram(color: number) {
  return defineGlyphEffect<{ phase: number }>({
    evaluate({ target, output }) {
      const n = output.coverage.length;
      for (let i = 0; i < n; i++) {
        if (target.coverage[i]! <= 0) continue;
        output.glyph[i] = "#";
        output.color[i] = color;
        output.coverage[i] = 1;
        output.channels[i] = GlyphEffectOutputChannel.Glyph | GlyphEffectOutputChannel.Color;
      }
    },
  });
}

describe("createGlyphScene — colorEncoding reaches the retained-effect recompose path", () => {
  it("renders zero-span atlas output on a params-only recompose (not just the initial full render)", async () => {
    const host = makeDiv();
    const scene = createGlyphScene(host, {
      cols: 20,
      rows: 1,
      useColors: true,
      colorEncoding: "atlas",
      atlasPalette: ["#802020"],
      camera: createGlyphOrthographicCamera(),
    });
    const layer = scene.addEffectLayer({
      effect: nearColorGradientProgram(0x802020),
      params: { phase: 0 },
      target: "viewport",
      blend: "replace",
    });
    await flushRenders(); // initial full render — retains the base CellGrid.
    layer.params.phase = 1; // params-only write — takes the recompose path, not rasterize().
    await flushRenders();
    const html = scene.output.innerHTML;
    expect(html).not.toContain("<span");
    expect(html.trim().length).toBeGreaterThan(0);
    scene.destroy();
    host.remove();
  });
});

describe("createGlyphScene — colorEncoding reaches a per-mesh detail layer's buildRasterizeContext", () => {
  it("renders zero-span atlas output on the detail <pre>", async () => {
    const host = makeDiv();
    const color = "#802020";
    const scene = createGlyphScene(host, {
      cols: 60,
      rows: 16,
      useColors: true,
      mode: "solid",
      doubleSided: true,
      colorEncoding: "atlas",
      atlasPalette: [color],
      camera: createGlyphOrthographicCamera({ zoom: 50 }),
      ...FLAT_LIGHTING,
    });
    // `density` (any value != 1) pops this mesh into its own detail `<pre>`,
    // rendered through the detail-layer `buildRasterizeContext` call.
    scene.add(flatQuad(color), { density: 2 });
    await flushRenders();
    const detail = host.querySelector("pre.glyph-output--detail") as HTMLPreElement | null;
    expect(detail).not.toBeNull();
    expect(detail!.innerHTML).not.toContain("<span");
    expect(detail!.textContent!.trim().length).toBeGreaterThan(0);
    scene.destroy();
    host.remove();
  });
});

/**
 * One frame, one palette — at the scene level.
 *
 * The pooled quantizer addresses colour by SLOT, and every output `<pre>` of a
 * scene references ONE scene-level `font-palette` custom ident. So if a repool
 * lands between the base `<pre>`'s resolve and a detail `<pre>`'s, the base is
 * left encoded against the old slots while the new palette is published to the
 * ident it shares — the base recolours wholesale, silently, and on a static
 * scene it never recovers.
 *
 * The 250 ms repool floor does not prevent this: the base resolves at the end
 * of base rasterization and each detail layer at the end of its own raster
 * pass, so the two are a whole pass apart, in exactly the heavy-scene regime
 * the atlas exists for. `createGlyphScene` therefore brackets each render in a
 * quantizer transaction. These tests drive a real scene with two output
 * `<pre>`s and a clock that advances a full refresh interval per raster pass.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import * as realQuantize from "../render/paletteQuantize";
import type { GlyphAtlasPaletteQuantizer, GlyphAtlasPaletteQuantizerOptions } from "../render/paletteQuantize";
import type { Polygon } from "@glyphcss/core";

/** Clock shared by the injected quantizer; each resolve advances a raster pass. */
let clock = 0;
const MS_PER_RASTER_PASS = 400;

interface Observation {
  /** Which transaction this resolve happened in; `-1` means "outside one". */
  transaction: number;
  generation: number;
  palette: readonly string[] | undefined;
}
interface Spy {
  quantizer: GlyphAtlasPaletteQuantizer;
  calls: string[];
  observations: Observation[];
}
const spies: Spy[] = [];

vi.mock("../render/paletteQuantize", async (importOriginal) => {
  const actual = await importOriginal<typeof realQuantize>();
  return {
    ...actual,
    createGlyphAtlasPaletteQuantizer(options: GlyphAtlasPaletteQuantizerOptions = {}) {
      // The real quantizer, on an injectable clock — nothing about the pooling
      // or repool policy is stubbed out, only the passage of time.
      const inner = actual.createGlyphAtlasPaletteQuantizer({ ...options, now: () => clock });
      const calls: string[] = [];
      const observations: Observation[] = [];
      let transaction = -1;
      let transactionsOpened = 0;
      const wrapped: GlyphAtlasPaletteQuantizer = {
        get palette() { return inner.palette; },
        get generation() { return inner.generation; },
        beginTransaction() { calls.push("begin"); transaction = transactionsOpened++; inner.beginTransaction(); },
        endTransaction() { calls.push("end"); transaction = -1; inner.endTransaction(); },
        reset() { inner.reset(); },
        resolveGlyphAtlasPalette(char, color, n) {
          calls.push("resolve");
          const palette = inner.resolveGlyphAtlasPalette(char, color, n);
          observations.push({ transaction, generation: inner.generation, palette });
          // A raster pass just happened. This is the whole point: outputs of
          // one frame are NOT microseconds apart.
          clock += MS_PER_RASTER_PASS;
          return palette;
        },
      };
      spies.push({ quantizer: wrapped, calls, observations });
      return wrapped;
    },
  };
});

const { createGlyphScene } = await import("./createGlyphScene");
const { createGlyphOrthographicCamera } = await import("./createGlyphCamera");
const { ensureGlyphAtlasFontFaceStyles } = await import("../styles/styles");

const FONT_FACE_STYLE_ID = "glyph-atlas-font-face";

const FLAT_LIGHTING = {
  directionalLight: { direction: [0, 0, 1] as [number, number, number], intensity: 0 },
  ambientLight: { intensity: 1 },
};

function quad(color: string, z: number): Polygon[] {
  return [{ vertices: [[-4, -4, z], [-4, 4, z], [4, 4, z], [4, -4, z]], color }];
}

async function flushAtlasRenders(): Promise<void> {
  await ensureGlyphAtlasFontFaceStyles(document);
  for (let i = 0; i < 6; i++) await Promise.resolve();
}

/** happy-dom has no layout; a detail layer needs a non-zero measured cell. */
function stubCellLayout(): void {
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const lines = (this.textContent ?? "").split("\n");
    const isCellProbe = lines.length === 20 && new Set(lines).size === 1 && [...lines[0]!].length === 1;
    const width = isCellProbe ? 8 : 0;
    const height = isCellProbe ? 320 : 0;
    return { width, height, top: 0, left: 0, right: width, bottom: height, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
  });
}

afterEach(() => {
  spies.length = 0;
  clock = 0;
  document.head.querySelectorAll("style").forEach((el) => {
    if (el.id === FONT_FACE_STYLE_ID || (el.textContent ?? "").includes("@font-palette-values")) el.remove();
  });
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("createGlyphScene — the pooled palette is latched per render", () => {
  async function twoOutputScene(): Promise<{ scene: ReturnType<typeof createGlyphScene>; host: HTMLElement }> {
    stubCellLayout();
    const host = document.createElement("div");
    document.body.appendChild(host);
    const scene = createGlyphScene(host, {
      camera: createGlyphOrthographicCamera({ zoom: 6 }),
      cols: 40,
      rows: 16,
      mode: "solid",
      doubleSided: true,
      useColors: true,
      // No pinned palette: this is the pooled-quantizer path.
      colorEncoding: "atlas",
      ...FLAT_LIGHTING,
    });
    // Base grid: a near-flat grey wash. Detail grid: a saturated hue nowhere
    // near any of the grey palette's slots — a repool-worthy drift, arriving on
    // the SECOND resolve of the same frame.
    scene.add(quad("#8a8a8a", 0));
    scene.add(quad("#ff00c8", 1), { density: 2 });
    await flushAtlasRenders();
    return { scene, host };
  }

  it("brackets every render's resolves in exactly one transaction", async () => {
    const { scene, host } = await twoOutputScene();
    const spy = spies[0];
    expect(spy).toBeDefined();
    // Two outputs — the base `<pre>` and the detail mesh's own — really did
    // resolve, so the ordering below is not describing a one-output scene.
    expect(spy!.calls.filter((c) => c === "resolve").length).toBeGreaterThanOrEqual(2);

    let open = 0;
    let resolvesOutsideTransaction = 0;
    let maxOpen = 0;
    for (const call of spy!.calls) {
      if (call === "begin") { open++; maxOpen = Math.max(maxOpen, open); }
      else if (call === "end") open--;
      else if (open === 0) resolvesOutsideTransaction++;
    }
    expect(resolvesOutsideTransaction).toBe(0);
    expect(maxOpen).toBe(1);
    expect(open).toBe(0);

    scene.destroy();
    host.remove();
  });

  it("hands every output of ONE render the same palette generation", async () => {
    const { scene, host } = await twoOutputScene();
    const spy = spies[0]!;

    // The clock really did cross the repool interval between outputs of the
    // same frame — the situation the 250 ms floor was wrongly assumed to make
    // impossible.
    expect(MS_PER_RASTER_PASS).toBeGreaterThan(250);

    const byTransaction = new Map<number, Observation[]>();
    for (const observation of spy.observations) {
      const bucket = byTransaction.get(observation.transaction) ?? [];
      bucket.push(observation);
      byTransaction.set(observation.transaction, bucket);
    }
    const multiOutput = [...byTransaction.values()].filter((bucket) => bucket.length > 1);
    // Otherwise there is no mid-frame window to protect and this asserts nothing.
    expect(multiOutput.length).toBeGreaterThan(0);
    for (const bucket of multiOutput) {
      // Same generation AND the same palette object: the detail `<pre>` encoded
      // its slots against the very palette the base `<pre>` did, which is what
      // the one shared `font-palette` ident requires.
      expect(new Set(bucket.map((o) => o.generation)).size).toBe(1);
      expect(new Set(bucket.map((o) => o.palette)).size).toBe(1);
    }

    scene.destroy();
    host.remove();
  });

  it("repools BETWEEN frames — the latch defers the decision, it does not freeze it", async () => {
    const { scene, host } = await twoOutputScene();
    const spy = spies[0]!;
    const generations = spy.observations.map((o) => o.generation);
    // The palette does still refresh; it just never refreshes mid-frame.
    expect(Math.max(...generations)).toBeGreaterThan(Math.min(...generations));

    scene.destroy();
    host.remove();
  });
});

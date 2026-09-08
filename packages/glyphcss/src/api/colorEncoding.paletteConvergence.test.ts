/**
 * A pooled palette must CONVERGE on a scene that stops rendering.
 *
 * The pooled quantizer bootstraps from the first colour-bearing frame and
 * repools behind two AND-ed gates: drift, and at least `refreshMs` since the
 * last repool. Both are evaluated INSIDE `resolveGlyphAtlasPalette`, i.e. only
 * during a render. A scene whose content streams in — every map, every lazily
 * mounted mesh — bootstraps on its least representative frame, gets its real
 * colours a few dozen milliseconds later (inside the refresh floor, so the
 * clock gate refuses), and then goes quiescent. Nothing ever asks again, so
 * the frame stays encoded against the bootstrap palette until the user
 * happens to cause a render.
 *
 * That is what this file pins, and why it cannot be a quantizer unit test:
 * `paletteQuantize.test.ts`'s "repools once the colours drift AND the interval
 * has elapsed" hands the quantizer exactly the resolve the real scene never
 * issues, and `colorEncoding.paletteTransaction.test.ts`'s harness advances
 * its clock a full refresh interval PER RASTER PASS — the opposite of the real
 * cold-load timing, where five renders fit inside 150 ms. The load-bearing
 * clause here is therefore "no further scene mutation and no manual
 * `rerender()`": only timers and microtasks are allowed to run. Remove that
 * constraint and this test silently becomes one of the blind ones.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import type { Polygon } from "@glyphcss/core";
import { createGlyphScene } from "./createGlyphScene";
import { createGlyphOrthographicCamera } from "./createGlyphCamera";
import { ensureGlyphAtlasFontFaceStyles } from "../styles/styles";

const FONT_FACE_STYLE_ID = "glyph-atlas-font-face";

const FLAT_LIGHTING = {
  directionalLight: { direction: [0, 0, 1] as [number, number, number], intensity: 0 },
  ambientLight: { intensity: 1 },
};

/**
 * The bootstrap frame: a near-flat set of dark greens, the shape a map's
 * coarse relief backstop tier paints before its target LOD lands (the reported
 * case bootstrapped on exactly 11 such colours). Small enough that
 * `medianCutPalette` returns the histogram verbatim — an "exact" palette whose
 * own baseline drift is 0.
 */
const BOOTSTRAP_GREENS = [
  "#203d24", "#224227", "#234428", "#2b5231",
  "#2f5a36", "#335728", "#375e2b", "#3a642e",
];

/** The frame that arrives late: a full terrain ramp, deep blue → green → tan → snow. */
const RAMP_STOPS = ["#1b3f66", "#2e4e24", "#536632", "#735e37", "#b09471", "#ccb399", "#e8e0d0"];

function lerpHex(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const mix = (shift: number): number => {
    const ca = (pa >> shift) & 0xff;
    const cb = (pb >> shift) & 0xff;
    return Math.round(ca + (cb - ca) * t);
  };
  return `#${((mix(16) << 16) | (mix(8) << 8) | mix(0)).toString(16).padStart(6, "0")}`;
}

function rampColors(count: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const u = (i / (count - 1)) * (RAMP_STOPS.length - 1);
    const lo = Math.min(RAMP_STOPS.length - 2, Math.floor(u));
    out.push(lerpHex(RAMP_STOPS[lo]!, RAMP_STOPS[lo + 1]!, u - lo));
  }
  return [...new Set(out)];
}

/** Horizontal bands, one flat colour each, filling the whole viewport. */
function bands(colors: readonly string[], z: number): Polygon[] {
  const top = 120;
  const height = (top * 2) / colors.length;
  return colors.map((color, i) => {
    const y0 = -top + i * height;
    const y1 = y0 + height;
    return {
      vertices: [[-40, y0, z], [-40, y1, z], [40, y1, z], [40, y0, z]],
      color,
    } as Polygon;
  });
}

/** The `@font-palette-values` block the scene actually published, as slot colours. */
function publishedPalette(): string[] {
  const css = [...document.head.querySelectorAll("style")]
    .map((el) => el.textContent ?? "")
    .find((text) => text.includes("@font-palette-values"));
  if (!css) return [];
  return [...css.matchAll(/\d+\s+(#[\da-f]{6})/gi)].map((m) => m[1]!.toLowerCase());
}

const isWarm = (hex: string): boolean => {
  const packed = parseInt(hex.slice(1), 16);
  return ((packed >> 16) & 0xff) > ((packed >> 8) & 0xff);
};

/** Let microtasks — and only microtasks — run. No timers, no scene mutation. */
async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 12; i++) await Promise.resolve();
}

/** happy-dom has no layout; the base grid needs a non-zero measured cell. */
function stubCellLayout(): void {
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const lines = (this.textContent ?? "").split("\n");
    const isCellProbe = lines.length === 20 && new Set(lines).size === 1 && [...lines[0]!].length === 1;
    const width = isCellProbe ? 8 : 0;
    const height = isCellProbe ? 320 : 0;
    return { width, height, top: 0, left: 0, right: width, bottom: height, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
  });
}

beforeEach(() => {
  // Real `Date.now` (what the quantizer's clock gate reads) and real
  // `setTimeout` on ONE faked clock, so "advance past the refresh floor"
  // means the same thing to both halves of the mechanism.
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  document.head.querySelectorAll("style").forEach((el) => {
    if (el.id === FONT_FACE_STYLE_ID || (el.textContent ?? "").includes("@font-palette-values")) el.remove();
  });
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("createGlyphScene — a pooled atlas palette converges without user input", () => {
  it("repools on its own after a quiescent scene bootstrapped on a poor frame", async () => {
    stubCellLayout();
    const host = document.createElement("div");
    document.body.appendChild(host);
    const scene = createGlyphScene(host, {
      camera: createGlyphOrthographicCamera({ zoom: 6 }),
      cols: 40,
      rows: 80,
      mode: "solid",
      doubleSided: true,
      useColors: true,
      colorEncoding: "atlas",
      ...FLAT_LIGHTING,
    });
    const mesh = scene.add(bands(BOOTSTRAP_GREENS, 0));
    await ensureGlyphAtlasFontFaceStyles(document);
    await flushMicrotasks();

    // 1. Bootstrap. The palette is exactly the near-flat frame it trained on.
    const bootstrap = publishedPalette();
    expect(bootstrap.length).toBeGreaterThan(0);
    expect(bootstrap.length).toBeLessThanOrEqual(BOOTSTRAP_GREENS.length);
    expect(bootstrap.filter(isWarm)).toEqual([]);

    // 2. The real colours arrive, in the SAME instant — no clock advance, which
    //    is the whole cold-load timing this reproduces (measured 101-151 ms
    //    between bootstrap and the last mount-storm render, against a 250 ms
    //    floor).
    mesh.setPolygons(bands(rampColors(40), 0));
    await flushMicrotasks();
    // The clock gate correctly refuses here — this is not the defect.
    expect(publishedPalette()).toEqual(bootstrap);

    // 3. Now nothing happens except time. No `setPolygons`, no `setOptions`, no
    //    `rerender()`, no camera write — exactly the quiescent page the user
    //    was looking at.
    await vi.advanceTimersByTimeAsync(400);
    await flushMicrotasks();

    const settled = publishedPalette();
    expect(settled).not.toEqual(bootstrap);
    expect(settled.length).toBeGreaterThan(bootstrap.length);
    // The ramp's warm half is representable now; on the bootstrap palette every
    // tan cell collapsed onto a green slot.
    expect(settled.filter(isWarm).length).toBeGreaterThan(0);

    scene.destroy();
    host.remove();
  });

  it("arms nothing for a scene whose palette already describes its content", async () => {
    stubCellLayout();
    const host = document.createElement("div");
    document.body.appendChild(host);
    const scene = createGlyphScene(host, {
      camera: createGlyphOrthographicCamera({ zoom: 6 }),
      cols: 40,
      rows: 80,
      mode: "solid",
      doubleSided: true,
      useColors: true,
      colorEncoding: "atlas",
      ...FLAT_LIGHTING,
    });
    scene.add(bands(BOOTSTRAP_GREENS, 0));
    await ensureGlyphAtlasFontFaceStyles(document);
    await flushMicrotasks();

    const settled = publishedPalette();
    expect(settled.length).toBeGreaterThan(0);
    const writes = pre(host).textContent;

    // A static scene must not acquire a heartbeat: no pending timer, and so no
    // render and no palette rewrite however long it sits.
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(5000);
    await flushMicrotasks();
    expect(publishedPalette()).toEqual(settled);
    expect(pre(host).textContent).toBe(writes);

    scene.destroy();
    host.remove();
  });

  it("arms nothing for a `spans` scene", async () => {
    stubCellLayout();
    const host = document.createElement("div");
    document.body.appendChild(host);
    const scene = createGlyphScene(host, {
      camera: createGlyphOrthographicCamera({ zoom: 6 }),
      cols: 40,
      rows: 80,
      mode: "solid",
      doubleSided: true,
      useColors: true,
      ...FLAT_LIGHTING,
    });
    const mesh = scene.add(bands(BOOTSTRAP_GREENS, 0));
    await flushMicrotasks();
    mesh.setPolygons(bands(rampColors(40), 0));
    await flushMicrotasks();

    expect(publishedPalette()).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);

    scene.destroy();
    host.remove();
  });
});

function pre(host: HTMLElement): HTMLPreElement {
  const el = host.querySelector("pre");
  if (!el) throw new Error("no output <pre>");
  return el as HTMLPreElement;
}

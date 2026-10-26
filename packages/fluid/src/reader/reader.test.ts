import { afterEach, describe, expect, it, vi } from "vitest";
import { createGlyphFluidReader } from "./createGlyphFluidReader";
import { GlyphFluidReaderTarget, glyphFluidReaderExtent, glyphFluidReaderWordCells } from "./target";
import { tokenizeGlyphReaderText } from "./rules/words";
import type { GlyphReaderScheduler } from "./rules/clock";
import { createGlyphFluidTargetFrame } from "../targets/frame";

/**
 * A 2D context that paints each fillText as a solid box: advance 0.6 em per code unit,
 * 0.7 em tall around the (middle) baseline, through translate/scale in y. Enough to see
 * where the word and its ORP letter land on the cell grid.
 */
const drawn: string[] = [];
function fakeCanvas(em = 0.6) {
  drawn.length = 0;
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (this: HTMLCanvasElement) {
    const cv = this, data = new Uint8ClampedArray(cv.width * cv.height * 4);
    let fs = 10, ty = 0, sy = 1;
    const stack: Array<[number, number]> = [];
    const ctx = {
      fillStyle: "#000",
      textBaseline: "alphabetic",
      set font(f: string) { fs = parseFloat(/(\d+(?:\.\d+)?)px/.exec(f)![1]!); },
      measureText: (s: string) => ({ width: s.length * fs * em }),
      save: () => stack.push([ty, sy]),
      restore: () => ([ty, sy] = stack.pop()!),
      translate: (_x: number, y: number) => (ty += y * sy),
      scale: (_x: number, y: number) => (sy *= y),
      fillText(s: string, x: number, y: number) {
        drawn.push(s);
        const green = ctx.fillStyle === "#0f0";
        const x1 = x + s.length * fs * em;
        const ya = ty + sy * (y - fs * 0.35), yb = ty + sy * (y + fs * 0.35);
        for (let py = Math.max(0, Math.floor(ya)); py < Math.min(cv.height, Math.ceil(yb)); py++)
          for (let px = Math.max(0, Math.floor(x)); px < Math.min(cv.width, Math.ceil(x1)); px++) {
            const q = (py * cv.width + px) * 4;
            data[q] = green ? 0 : 255;
            data[q + 1] = green ? 255 : 0;
            data[q + 3] = 255;
          }
      },
      getImageData: () => ({ data }),
    };
    // anything else (other canvas users in the runtime) is a no-op
    return new Proxy(ctx, { get: (o, k) => (k in o ? o[k as keyof typeof o] : () => undefined) }) as unknown as CanvasRenderingContext2D;
  } as never);
}

function sizedHost(w = 416, h = 416): HTMLElement {
  const host = document.createElement("div");
  Object.defineProperty(host, "clientWidth", { value: w });
  Object.defineProperty(host, "clientHeight", { value: h });
  host.getBoundingClientRect = () => ({ left: 0, top: 0, right: w, bottom: h, width: w, height: h, x: 0, y: 0, toJSON() {} }) as DOMRect;
  document.body.append(host);
  return host;
}

function fakeScheduler() {
  let now = 0, seq = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  return {
    now: () => now,
    setTimeout(fn: () => void, ms: number) {
      timers.set(++seq, { at: now + ms, fn });
      return seq;
    },
    clearTimeout: (h: unknown) => void timers.delete(h as number),
    advance(ms: number) {
      const end = now + ms;
      for (;;) {
        const next = [...timers].filter((e) => e[1].at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        timers.delete(next[0]);
        now = next[1].at;
        next[1].fn();
      }
      now = end;
    },
    pending: () => timers.size,
  } satisfies GlyphReaderScheduler & Record<string, unknown>;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe("glyphFluidReaderWordCells", () => {
  it("averages alpha into ink and splits it into ORP (green) and rest (red)", () => {
    // 4 × 2 px onto 2 × 1 cells: left cell half red; right cell one green, one red pixel
    const px = (r: number, g: number, a: number) => [r, g, 0, a];
    const data = [...px(255, 0, 255), ...px(0, 0, 0), ...px(0, 255, 255), ...px(255, 0, 255),
      ...px(255, 0, 255), ...px(0, 0, 0), ...px(0, 0, 0), ...px(0, 0, 0)];
    const c = glyphFluidReaderWordCells(data, 4, 2, 2, 1);
    expect([...c.cov]).toEqual([0.5, 0.5]);
    expect([...c.orp]).toEqual([0, 0.5]);
  });

  it("sizes a word by its longer half around the ORP letter", () => {
    const [a, , x] = tokenizeGlyphReaderText("a big extraordinary");
    expect(glyphFluidReaderExtent(a!)).toBe(1);
    // "extraordinary": core 13 → orp 3; 13 − 3 − 0.5 = 9.5
    expect(glyphFluidReaderExtent(x!)).toBe(9.5);
  });
});

describe("GlyphFluidReaderTarget", () => {
  function written(word: string, em = 0.6) {
    fakeCanvas(em);
    const host = sizedHost(416, 416);
    const t = new GlyphFluidReaderTarget(host, [1, 1, 1]);
    t.measure({ cw: 8, ch: 13, originX: 0, originY: 0 }); // 52 × 32 cells
    const toks = tokenizeGlyphReaderText(word);
    t.setWord(toks[0]!);
    const f = createGlyphFluidTargetFrame(52, 32);
    t.write(f, 0);
    return { f, t };
  }

  it("pivots the ORP letter on the centre column and accents only it", () => {
    const { f } = written("reading"); // orp 2 ('a'): "re" left of it, "ding" right
    let accSum = 0, accX = 0, inkL = 0, inkR = 0;
    for (let j = 0; j < 32; j++)
      for (let i = 0; i < 52; i++) {
        const k = j * 52 + i;
        accSum += f.TA[k]!;
        accX += f.TA[k]! * (i + 0.5);
        if (f.TA[k]! === 0 && f.T[k]! > 0.5) (i < 26 ? (inkL += 1) : (inkR += 1));
      }
    expect(accSum).toBeGreaterThan(0);
    expect(Math.abs(accX / accSum - 26)).toBeLessThan(1); // accent centroid on the centre column
    expect(inkR).toBeGreaterThan(inkL); // 4 letters right of the pivot, 2 left
  });

  it("draws the word condensed: taller than wide per letter, centred vertically", () => {
    const { f } = written("I");
    let j0 = 99, j1 = -1;
    for (let j = 0; j < 32; j++) for (let i = 0; i < 52; i++) if (f.TA[j * 52 + i]! > 0) ((j0 = Math.min(j0, j)), (j1 = Math.max(j1, j)));
    // molty's baseline sits 0.04 em low, stretched ×1.9: about one row under centre
    expect(Math.abs((j0 + j1 + 1) / 2 - 16)).toBeLessThanOrEqual(1);
    expect(j1 - j0 + 1).toBeGreaterThan(10); // 150 px × 0.7 × 1.9 ≈ 200 px ≈ 15 rows
  });

  it("sizes each word on its own: a short word is drawn taller than a long one", () => {
    const rowsOf = (w: string) => {
      const { f } = written(w);
      let n = 0;
      for (let j = 0; j < 32; j++) if ([...f.T.subarray(j * 52, j * 52 + 52)].some((v) => v > 0.5)) n++;
      return n;
    };
    expect(rowsOf("at")).toBeGreaterThan(rowsOf("extraordinary") + 3);
  });

  it("shrinks a word set in a wide face to fit the host, pivot still centred", () => {
    for (const w of ["living", "extraordinary", "a"]) {
      const { f } = written(w, 0.95); // far wider than the 0.62 em molty's formula assumes
      let i0 = 99, i1 = -1, accSum = 0, accX = 0;
      for (let j = 0; j < 32; j++)
        for (let i = 0; i < 52; i++) {
          const k = j * 52 + i;
          if (f.T[k]! > 0.5) ((i0 = Math.min(i0, i)), (i1 = Math.max(i1, i)));
          accSum += f.TA[k]!;
          accX += f.TA[k]! * (i + 0.5);
        }
      expect(i0, w).toBeGreaterThanOrEqual(3);
      expect(i1, w).toBeLessThanOrEqual(48);
      expect(Math.abs(accX / accSum - 26), w).toBeLessThan(1);
    }
  });

  it("never splits an astral character, whichever half the ORP index lands on", () => {
    const lone = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
    for (const w of ["a😀bcd", "😀bcde", "ab😀"]) {
      written(w);
      expect(drawn.join("|"), w).not.toMatch(lone);
      expect(drawn[0]! + drawn[2]! + drawn[1]!, w).toBe(w); // drawn as before, after, focal
    }
    expect(tokenizeGlyphReaderText("a😀bcd")[0]!.orp).toBe(2); // the low surrogate
  });

  it("reports a change once per word (reduced-motion redraw signal)", () => {
    const { t } = written("one");
    expect(t.changed?.()).toBe(true);
    expect(t.changed?.()).toBe(false);
  });
});

describe("createGlyphFluidReader", () => {
  it("gathers the first word during the lead-in, rings on later words, melts at the end; destroy stops the clock", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    fakeCanvas();
    const sch = fakeScheduler();
    const writes = vi.spyOn(GlyphFluidReaderTarget.prototype, "write");
    const reader = createGlyphFluidReader(sizedHost(), { text: "one two three", wpm: 600, scheduler: sch, clock: "manual", worker: false, shape: "circle" });
    await reader.ready;
    expect(reader.clock.playing).toBe(true);
    /** Frames in which the word target drew. */
    const drawnFrames = (n: number) => {
      const before = writes.mock.calls.length;
      for (let i = 0; i < n; i++) reader.fluid.step(1 / 60);
      return writes.mock.calls.length - before;
    };
    expect(drawnFrames(3)).toBe(3); // lead-in: the first word is already gathering (molty's)
    const impulse = vi.spyOn(reader.fluid, "impulse");
    const words: string[] = [];
    reader.clock.subscribe((e) => e.type === "word" && words.push(e.token.word));
    sch.advance(550);
    expect(words).toEqual(["one"]);
    expect(impulse).not.toHaveBeenCalled(); // the first word condensed with the lead-in (a target event), no ring
    sch.advance(100);
    expect(impulse).toHaveBeenCalledTimes(1);
    expect(impulse.mock.calls[0]![2]).toEqual({ strength: 0.63, radius: 0.12 });
    expect(drawnFrames(3)).toBe(3); // reading: condensed
    expect(reader.fluid.stats().cols).toBe(52);
    sch.advance(100 + 100); // "three", then the end
    expect(words).toEqual(["one", "two", "three"]);
    expect(reader.clock.playing).toBe(false);
    expect(drawnFrames(3)).toBe(0); // ended: melted back into the field
    reader.destroy();
    expect(sch.pending()).toBe(0);
    expect(reader.clock.playing).toBe(false);
  });

  it("circle shape leaves the corners blank", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const host = sizedHost();
    const reader = createGlyphFluidReader(host, { text: "x", scheduler: fakeScheduler(), clock: "manual", worker: false, shape: "circle", field: { level: 1 } });
    await reader.ready;
    for (let i = 0; i < 30; i++) reader.fluid.step(1 / 60);
    const rows = host.querySelector("pre")!.textContent!.split("\n");
    const blank = (s: string) => [...s].every((c) => c === "⠀" || c === " ");
    expect(blank(rows[1]!.slice(0, 8))).toBe(true);
    expect(blank(rows.at(-2)!.slice(-8))).toBe(true);
    expect(blank(rows[Math.floor(rows.length / 2)]!.slice(20, 32))).toBe(false);
    reader.destroy();
  });

  it("under reduced motion draws one settled still per word", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: q.includes("reduce"), addEventListener() {}, removeEventListener() {} }));
    fakeCanvas();
    const sch = fakeScheduler();
    const reader = createGlyphFluidReader(sizedHost(), { text: "one two three", wpm: 600, scheduler: sch, clock: "manual" });
    await reader.ready;
    const step = () => reader.fluid.step(1 / 60);
    step();
    const base = reader.fluid.stats().frames;
    step();
    expect(reader.fluid.stats().frames).toBe(base); // nothing changed: no redraw
    sch.advance(550 + 100); // "one", then "two"
    step();
    step();
    sch.advance(100); // "three"
    step();
    expect(reader.fluid.stats().frames).toBe(base + 2);
    reader.destroy();
  });
});

describe("plain look", () => {
  function plainTarget(word: string, w = 416, h = 416) {
    const host = sizedHost(w, h);
    const t = new GlyphFluidReaderTarget(host, [1, 1, 1], "plain", "monospace");
    const cw = w / 52, ch = cw * 1.6;
    t.measure({ cw, ch, originX: 0, originY: 0 });
    const toks = tokenizeGlyphReaderText(word);
    t.setSentence(toks);
    t.setWord(toks[0]!);
    return { t, cw, ch, host };
  }

  it("pivots the ORP letter on the centre column; the pooled band sits under the letters, accent under the ORP one", () => {
    for (const word of ["reading", "a", "extraordinary"]) {
      const { t, cw, ch } = plainTarget(word);
      const p = t.probes(0, 1 / 60)!.data, n = p.length / 7;
      const orp = tokenizeGlyphReaderText(word)[0]!.orp;
      expect(n, word).toBe(word.length);
      expect(Math.abs(p[orp * 7]! * cw - 208), word).toBeLessThan(0.01); // centre x in px
      expect(Math.abs(p[orp * 7 + 1]! * ch - 208), word).toBeLessThan(ch); // centre row
      const f = createGlyphFluidTargetFrame(52, 33);
      t.write(f, 0);
      // every probe's own cell is pooled at molty's 0.62; the ORP one is accented
      for (let l = 0; l < n; l++) {
        const k = Math.floor(p[l * 7 + 1]!) * 52 + Math.floor(p[l * 7]!);
        expect(f.T[k], `${word}[${l}]`).toBeCloseTo(0.62, 5);
        expect(f.TA[k], `${word}[${l}]`).toBe(l === orp ? 1 : 0);
      }
    }
  });

  it("sizes the letters once per sentence (they don't jump between words)", () => {
    const toks = tokenizeGlyphReaderText("a an extraordinary");
    const { t, host } = plainTarget("a");
    t.setSentence(toks);
    const px = host.querySelector<HTMLElement>("div[aria-hidden]")!.style.fontSize;
    for (const tok of toks) {
      t.setWord(tok);
      expect(host.querySelector<HTMLElement>("div[aria-hidden]")!.style.fontSize).toBe(px);
    }
  });

  it("keeps an astral character one letter, wherever the ORP unit falls", () => {
    for (const w of ["a😀bcd", "😀bcde"]) {
      const { t } = plainTarget(w);
      expect(t.probes(0, 1 / 60)!.data.length / 7, w).toBe([...w].length);
    }
  });

  it("melts: after the text the letters stay probed for 0.8 s with a rising threshold, then go", () => {
    const { t } = plainTarget("one");
    t.melt();
    const a = t.probes(0, 0.1)!.data;
    expect(a[6]).toBeCloseTo(0.14 + 0.1, 10);
    for (let i = 0; i < 6; i++) t.probes(0, 0.1);
    expect(t.probes(0, 0.2)).toBeNull();
  });
});

describe("createGlyphFluidReader, plain look", () => {
  it("draws the showing word as real DOM letters over the fluid, keeps it for assistive tech, melts them at the end", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const sch = fakeScheduler();
    const host = sizedHost();
    const reader = createGlyphFluidReader(host, { text: "one two", wpm: 600, scheduler: sch, clock: "manual", worker: false });
    await reader.ready;
    const shown = () => Array.from(host.querySelectorAll<HTMLElement>("div[aria-hidden] > span")).filter((s) => s.style.opacity === "1").map((s) => s.textContent).join("");
    const said = host.querySelector("[aria-live]")!;
    expect(said.getAttribute("aria-live")).toBe("off");
    for (let i = 0; i < 40; i++) reader.fluid.step(1 / 60); // the lead-in: "one" gathers and decodes
    expect(shown()).toBe("one");
    sch.advance(550);
    expect(said.textContent).toBe("one");
    sch.advance(100);
    for (let i = 0; i < 40; i++) reader.fluid.step(1 / 60);
    expect(shown()).toBe("two");
    expect(host.querySelector("pre")!.getAttribute("aria-hidden")).toBe("true");
    sch.advance(100); // the end: melt
    expect(said.textContent).toBe("");
    for (let i = 0; i < 60; i++) reader.fluid.step(1 / 60);
    expect(shown()).toBe("");
    reader.destroy();
    expect(host.querySelector("div[aria-hidden]")).toBeNull();
    expect(host.querySelector("[aria-live]")).toBeNull();
  });

  it("blanks the fluid under shown letters (the sim decides it, from the same step)", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const host = sizedHost();
    const run = async (look: "plain" | "glyph") => {
      const reader = createGlyphFluidReader(host, { text: "wonderful", scheduler: fakeScheduler(), clock: "manual", worker: false, look, encoding: "mono", field: { level: 1 } });
      await reader.ready;
      for (let i = 0; i < 60; i++) reader.fluid.step(1 / 60);
      const rows = host.querySelector("pre")!.textContent!.split("\n");
      const mid = rows[Math.floor(rows.length / 2)]!;
      reader.destroy();
      return mid;
    };
    // the middle row: a blank run where the letters are, ink on both sides of it; the glyph
    // look draws the letters with the fluid, so it has none
    const run6 = /\S {6,}\S/u;
    expect(run6.test(await run("plain"))).toBe(true);
    expect(run6.test(await run("glyph"))).toBe(false);
  });
});

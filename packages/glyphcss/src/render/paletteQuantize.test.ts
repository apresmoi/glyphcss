import { describe, expect, it } from "vitest";
import {
  createGlyphAtlasPaletteQuantizer,
  histogramGridColors,
  medianCutPalette,
  nearestPaletteIndex,
  packHexColor,
  quantizeGlyphAtlasPalette,
  redmeanDistanceSq,
  resolveGlyphAtlasPaletteInput,
  unpackHexColor,
} from "./paletteQuantize";
import { GLYPH_FONT_ATLAS } from "./fontAtlas";
import { encodeGlyphAtlas, encodeGlyphBuffers, encodeCellGridOutput, buildCellGrid } from "./cells";

const G = GLYPH_FONT_ATLAS.glyphs[0]!;

/** A smooth grey ramp — the shape a Lambert-shaded render actually emits. */
function greyRamp(count: number): string[] {
  return Array.from({ length: count }, (_, i) => {
    const v = Math.round((i / (count - 1)) * 255);
    return unpackHexColor((v << 16) | (v << 8) | v);
  });
}

/** Mean/p95 redmean error of assigning every `colors` entry to its nearest palette slot. */
function assignmentError(colors: readonly string[], palette: readonly string[]): { mean: number; p95: number; max: number } {
  const packed = palette.map((c) => packHexColor(c)!);
  const errors = colors.map((c) => {
    const p = packHexColor(c)!;
    const idx = nearestPaletteIndex(packed, p);
    return Math.sqrt(redmeanDistanceSq(packed[idx]!, p));
  }).sort((a, b) => a - b);
  const mean = errors.reduce((a, b) => a + b, 0) / errors.length;
  return { mean, p95: errors[Math.min(errors.length - 1, Math.floor(errors.length * 0.95))]!, max: errors.at(-1)! };
}

describe("redmean distance", () => {
  it("is zero for identical colors and grows with separation", () => {
    expect(redmeanDistanceSq(0x336699, 0x336699)).toBe(0);
    expect(redmeanDistanceSq(0x000000, 0x010101)).toBeLessThan(redmeanDistanceSq(0x000000, 0x101010));
  });

  it("weights green above red and blue, matching colorTolerance's own metric", () => {
    // Same raw channel delta on each axis; green must score highest.
    const dg = redmeanDistanceSq(0x808080, 0x80a080);
    const dr = redmeanDistanceSq(0x808080, 0xa08080);
    const db = redmeanDistanceSq(0x808080, 0x8080a0);
    expect(dg).toBeGreaterThan(dr);
    expect(dg).toBeGreaterThan(db);
  });
});

describe("medianCutPalette", () => {
  it("returns the histogram verbatim when it already fits — quantization is the identity", () => {
    const counts = new Map([[0x000000, 3], [0xff0000, 1], [0x00ff00, 9]]);
    expect(medianCutPalette(counts, 31)).toEqual([0x000000, 0x00ff00, 0xff0000]);
  });

  it("never exceeds maxSize on a histogram far larger than it", () => {
    const counts = new Map<number, number>();
    for (let i = 0; i < 4096; i++) counts.set((i * 1009) & 0xffffff, 1 + (i % 7));
    for (const n of [1, 4, 16, 31]) {
      expect(medianCutPalette(counts, n).length).toBeLessThanOrEqual(n);
    }
  });

  it("is deterministic and ascending — a slot index has to mean the same thing twice", () => {
    const counts = new Map<number, number>();
    for (let i = 0; i < 500; i++) counts.set((i * 7919) & 0xffffff, 1 + (i % 5));
    const a = medianCutPalette(counts, 16);
    const b = medianCutPalette(counts, 16);
    expect(a).toEqual(b);
    expect([...a].sort((x, y) => x - y)).toEqual(a);
  });

  it("puts a representative inside each cluster of a strongly clustered histogram", () => {
    // Three tight clusters, far apart. With 3 slots, each must get one.
    const counts = new Map<number, number>();
    for (let i = 0; i < 8; i++) {
      counts.set(0xe01010 + i, 10);
      counts.set(0x10e010 + i * 0x100, 10);
      counts.set(0x1010e0 + i, 10);
    }
    const palette = medianCutPalette(counts, 3);
    expect(palette).toHaveLength(3);
    const err = assignmentError([...counts.keys()].map(unpackHexColor), palette.map(unpackHexColor));
    expect(err.max).toBeLessThan(20);
  });

  it("beats a naive uniform-RGB-cut palette on a smooth grey ramp at the same slot count", () => {
    const ramp = greyRamp(256);
    const counts = histogramGridColors(ramp.map(() => G), ramp, ramp.length);
    const cut = medianCutPalette(counts, 16).map(unpackHexColor);
    const uniform = Array.from({ length: 16 }, (_, i) => {
      const v = Math.round((i / 15) * 255);
      return unpackHexColor((v << 16) | (v << 8) | v);
    });
    // Not a strict "must win" — a grey ramp is the one case a uniform cut is
    // near-optimal on. Median cut must at least match it, and the absolute
    // error must be small in colorTolerance units.
    const cutErr = assignmentError(ramp, cut);
    const uniErr = assignmentError(ramp, uniform);
    expect(cutErr.mean).toBeLessThanOrEqual(uniErr.mean * 1.05);
    expect(cutErr.mean).toBeLessThan(12);
  });

  it("rejects a non-positive maxSize instead of silently emitting an unencodable palette", () => {
    expect(() => medianCutPalette(new Map([[1, 1]]), 0)).toThrow(RangeError);
  });
});

describe("quantizeGlyphAtlasPalette", () => {
  it("reduces a 256-step Lambert-shaped ramp to the atlas's slot budget", () => {
    const ramp = greyRamp(256);
    const palette = quantizeGlyphAtlasPalette(ramp.map(() => G), ramp, ramp.length);
    expect(palette.length).toBeLessThanOrEqual(GLYPH_FONT_ATLAS.maxPaletteSize);
    expect(palette.length).toBeGreaterThan(1);
    for (const c of palette) expect(c).toMatch(/^#[0-9a-f]{6}$/);
    expect(assignmentError(ramp, palette).mean).toBeLessThan(8);
  });

  it("ignores blank cells and null colors", () => {
    const palette = quantizeGlyphAtlasPalette([" ", G, " "], ["#ffffff", "#112233", null], 3);
    expect(palette).toEqual(["#112233"]);
  });
});

describe("createGlyphAtlasPaletteQuantizer — pooling and refresh", () => {
  function frame(colors: readonly string[]): { char: string[]; color: (string | null)[] } {
    return { char: colors.map(() => G), color: [...colors] };
  }

  it("bootstraps a palette from the first colour-bearing grid", () => {
    const q = createGlyphAtlasPaletteQuantizer({ now: () => 0 });
    expect(q.palette).toBeUndefined();
    const f = frame(greyRamp(120));
    const palette = q.resolveGlyphAtlasPalette(f.char, f.color, f.color.length);
    expect(palette).toBeDefined();
    expect(palette!.length).toBeLessThanOrEqual(GLYPH_FONT_ATLAS.maxPaletteSize);
    expect(q.generation).toBe(1);
  });

  it("hands every output of the SAME frame one identical palette", () => {
    // Two outputs (base `<pre>` + a detail layer) sharing one `font-palette`
    // ident must share one palette. This case is the EASY one — the clock gate
    // alone covers it. The hard one (outputs a whole raster pass apart) is the
    // transaction-latch suite below.
    let t = 0;
    const q = createGlyphAtlasPaletteQuantizer({ now: () => t });
    const a = frame(greyRamp(200));
    const first = q.resolveGlyphAtlasPalette(a.char, a.color, a.color.length);
    t = 1;
    const b = frame(["#ff0000", "#00ff00", "#0000ff"]);
    const second = q.resolveGlyphAtlasPalette(b.char, b.color, b.color.length);
    expect(second).toBe(first);
    expect(q.generation).toBe(1);
  });

  it("does NOT repool a static render, however long it runs", () => {
    let t = 0;
    const q = createGlyphAtlasPaletteQuantizer({ now: () => t });
    const f = frame(greyRamp(200));
    q.resolveGlyphAtlasPalette(f.char, f.color, f.color.length);
    for (let i = 0; i < 200; i++) {
      t += 100;
      q.resolveGlyphAtlasPalette(f.char, f.color, f.color.length);
    }
    expect(q.generation).toBe(1); // drift gate never trips — nothing moved.
  });

  it("does NOT repool a static scene whose colour count 31 slots can never cover", () => {
    // A photo: thousands of distinct colours, so a fixed fraction of cells is
    // always further than the drift threshold from any of 31 slots. That floor
    // is irreducible, not staleness, and must not drive a repool. (Measured on
    // the real /examples/image render before the baseline gate existed: 10
    // repools over 3 motionless seconds.)
    let t = 0;
    const q = createGlyphAtlasPaletteQuantizer({ now: () => t });
    const photo = frame(Array.from({ length: 4000 }, (_, i) => unpackHexColor((i * 2654435761) & 0xffffff)));
    q.resolveGlyphAtlasPalette(photo.char, photo.color, photo.color.length);
    expect(q.generation).toBe(1);
    for (let i = 0; i < 40; i++) {
      t += 300;
      q.resolveGlyphAtlasPalette(photo.char, photo.color, photo.color.length);
    }
    expect(q.generation).toBe(1);
  });

  it("repools once the colours drift far from their slots AND the interval has elapsed", () => {
    let t = 0;
    const q = createGlyphAtlasPaletteQuantizer({ now: () => t, refreshMs: 250 });
    const reds = frame(Array.from({ length: 200 }, (_, i) => unpackHexColor(0xff0000 | (i & 0xff))));
    q.resolveGlyphAtlasPalette(reds.char, reds.color, reds.color.length);
    expect(q.generation).toBe(1);
    const firstPalette = q.palette;

    // Wholesale hue swap: every cell is now far from every red slot.
    const blues = frame(Array.from({ length: 200 }, (_, i) => unpackHexColor(0x0000ff | ((i & 0xff) << 16))));
    t = 100; // drifted, but inside the interval — must NOT repool yet.
    q.resolveGlyphAtlasPalette(blues.char, blues.color, blues.color.length);
    expect(q.generation).toBe(1);
    expect(q.palette).toBe(firstPalette);

    t = 400; // interval elapsed and still drifted.
    q.resolveGlyphAtlasPalette(blues.char, blues.color, blues.color.length);
    expect(q.generation).toBe(2);
    expect(q.palette).not.toBe(firstPalette);
  });

  it("pools CAUSALLY — a repool's palette comes from the window that already elapsed", () => {
    let t = 0;
    const q = createGlyphAtlasPaletteQuantizer({ now: () => t, refreshMs: 250 });
    const reds = frame(Array.from({ length: 64 }, (_, i) => unpackHexColor(0xf00000 | (i * 3))));
    q.resolveGlyphAtlasPalette(reds.char, reds.color, reds.color.length);
    const greens = frame(Array.from({ length: 64 }, (_, i) => unpackHexColor(0x00f000 | (i * 3))));
    t = 400;
    q.resolveGlyphAtlasPalette(greens.char, greens.color, greens.color.length);
    // The window is the frames SINCE the last repool. The bootstrap repool
    // consumed the reds, so the second palette describes the green window that
    // followed it — never a peek at a frame the renderer hasn't drawn, and
    // never a stale window already spent on an earlier palette.
    const packed = q.palette!.map((c) => packHexColor(c)!);
    expect(packed.every((p) => ((p >> 8) & 0xff) > 0x80)).toBe(true);
    expect(packed.every((p) => ((p >> 16) & 0xff) < 0x40)).toBe(true);
  });

  it("keeps error low across a drifting sequence, where a single-frame palette would not", () => {
    // A hue rotating through the wheel — bench/color-font-atlas.md §6's failing
    // shape. Frozen single-frame palette vs. the pooled quantizer's own output.
    const frames: string[][] = [];
    for (let f = 0; f < 40; f++) {
      const hue = (f / 40) * 360;
      frames.push(Array.from({ length: 64 }, (_, i) => hsvHex(hue + i * 0.2, 0.8, 0.5 + (i % 8) / 32)));
    }
    const frozen = quantizeGlyphAtlasPalette(frames[0]!.map(() => G), frames[0]!, frames[0]!.length);
    let t = 0;
    const q = createGlyphAtlasPaletteQuantizer({ now: () => t, refreshMs: 250 });
    let pooledTotal = 0;
    let frozenTotal = 0;
    for (const f of frames) {
      t += 300;
      const palette = q.resolveGlyphAtlasPalette(f.map(() => G), f, f.length)!;
      pooledTotal += assignmentError(f, palette).mean;
      frozenTotal += assignmentError(f, frozen).mean;
    }
    expect(pooledTotal / frames.length).toBeLessThan(frozenTotal / frames.length);
  });

  it("reset() drops every pooled artifact", () => {
    const q = createGlyphAtlasPaletteQuantizer({ now: () => 0 });
    const f = frame(greyRamp(50));
    q.resolveGlyphAtlasPalette(f.char, f.color, f.color.length);
    expect(q.palette).toBeDefined();
    q.reset();
    expect(q.palette).toBeUndefined();
  });
});

/**
 * The 250 ms repool floor was documented as making a mid-frame repool
 * "structurally impossible", on the reasoning that a scene's per-output
 * resolves are "microseconds apart". They are not: the base `<pre>` resolves at
 * the end of base rasterization and each detail `<pre>` at the end of its OWN
 * raster pass, which in the heavy-scene regime this feature exists for can
 * easily exceed the interval. A repool landing between them leaves the base
 * `<pre>` encoded against generation N while the scene publishes N+1 to the
 * single `font-palette` ident they share — the base recolours wholesale, with
 * no error, permanently on a static scene.
 */
describe("createGlyphAtlasPaletteQuantizer — the render-transaction latch", () => {
  function frame(colors: readonly string[]): { char: string[]; color: (string | null)[] } {
    return { char: colors.map(() => G), color: [...colors] };
  }

  const base = frame(greyRamp(200));
  const drifted = frame(Array.from({ length: 200 }, (_, i) => hsvHex(200 + i * 0.3, 0.9, 0.55)));

  it("the clock gate alone does NOT prevent a mid-frame repool (the defect)", () => {
    // Not an aspiration — a demonstration that the latch is load-bearing. If
    // this ever stops repooling, the test below proves nothing.
    let t = 0;
    const q = createGlyphAtlasPaletteQuantizer({ now: () => t, refreshMs: 250 });
    q.resolveGlyphAtlasPalette(base.char, base.color, base.color.length);
    expect(q.generation).toBe(1);
    t = 300; // one detail-layer raster pass later
    q.resolveGlyphAtlasPalette(drifted.char, drifted.color, drifted.color.length);
    expect(q.generation).toBe(2);
  });

  it("latches one palette across every output of a transaction, whatever the clock says", () => {
    let t = 0;
    const q = createGlyphAtlasPaletteQuantizer({ now: () => t, refreshMs: 250 });
    q.beginTransaction();
    const forBase = q.resolveGlyphAtlasPalette(base.char, base.color, base.color.length);
    expect(q.generation).toBe(1);
    t = 300;
    const forDetail = q.resolveGlyphAtlasPalette(drifted.char, drifted.color, drifted.color.length);
    q.endTransaction();

    // Identity, not just equality: the detail `<pre>` encoded its slots against
    // the very palette the base `<pre>` did.
    expect(forDetail).toBe(forBase);
    expect(q.generation).toBe(1);
    expect(q.palette).toBe(forBase);
  });

  it("still repools on the NEXT transaction, using the colours the latched one pooled", () => {
    let t = 0;
    const q = createGlyphAtlasPaletteQuantizer({ now: () => t, refreshMs: 250 });
    q.beginTransaction();
    q.resolveGlyphAtlasPalette(base.char, base.color, base.color.length);
    t = 300;
    q.resolveGlyphAtlasPalette(drifted.char, drifted.color, drifted.color.length);
    q.endTransaction();
    expect(q.generation).toBe(1);

    // The latch defers the DECISION; it does not drop the ingest. The drifted
    // colours pooled during the latched transaction are what the next repool
    // trains on, so the refresh is delayed by at most one frame.
    t = 600;
    q.beginTransaction();
    q.resolveGlyphAtlasPalette(drifted.char, drifted.color, drifted.color.length);
    q.endTransaction();
    expect(q.generation).toBe(2);
  });

  it("an all-blank output does not close the latch on the palette that preceded it", () => {
    let t = 0;
    const q = createGlyphAtlasPaletteQuantizer({ now: () => t, refreshMs: 250 });
    q.beginTransaction();
    // An off-screen detail layer resolves an empty grid before the base does.
    expect(q.resolveGlyphAtlasPalette([" "], [null], 1)).toBeUndefined();
    const forBase = q.resolveGlyphAtlasPalette(base.char, base.color, base.color.length);
    expect(forBase).toBeDefined();
    t = 300;
    expect(q.resolveGlyphAtlasPalette(drifted.char, drifted.color, drifted.color.length)).toBe(forBase);
    q.endTransaction();
  });

  it("a caller that never opens a transaction keeps the pre-existing behaviour", () => {
    let t = 0;
    const q = createGlyphAtlasPaletteQuantizer({ now: () => t, refreshMs: 250 });
    q.resolveGlyphAtlasPalette(base.char, base.color, base.color.length);
    t = 300;
    q.resolveGlyphAtlasPalette(drifted.char, drifted.color, drifted.color.length);
    expect(q.generation).toBe(2);
  });
});

describe("resolveGlyphAtlasPaletteInput", () => {
  it("passes a fixed array through without consulting any derivation", () => {
    const fixed = ["#ff0000"];
    expect(resolveGlyphAtlasPaletteInput(fixed, [G], ["#00ff00"], 1)).toBe(fixed);
  });

  it("delegates to a source, handing it the grid", () => {
    let seen = 0;
    const out = resolveGlyphAtlasPaletteInput(
      { resolveGlyphAtlasPalette: (_c, _col, n) => { seen = n; return ["#123456"]; } },
      [G], ["#00ff00"], 1,
    );
    expect(out).toEqual(["#123456"]);
    expect(seen).toBe(1);
  });

  it("is undefined for no input — the spans fallback", () => {
    expect(resolveGlyphAtlasPaletteInput(undefined, [G], ["#00ff00"], 1)).toBeUndefined();
  });
});

describe("the encode seam under quantization", () => {
  const many = Array.from({ length: 120 }, (_, i) => unpackHexColor((i * 0x010203) & 0xffffff));
  const char = many.map(() => G);

  it('colorEncoding: "spans" stays byte-identical with a palette source attached', () => {
    // The hard constraint: a "spans" scene must not change, and must not even
    // consult the palette source.
    let consulted = false;
    const source = { resolveGlyphAtlasPalette: () => { consulted = true; return ["#ff0000"]; } };
    const grid = buildCellGrid(char, many, null, many.length, 1);
    const out = encodeCellGridOutput(grid, true, 0, "spans", source);
    expect(out.text).toBe(encodeGlyphBuffers(char, many, many.length, 1, true));
    expect(out.encoding).toBe("spans");
    expect(consulted).toBe(false);
  });

  it("encodes a 120-colour grid through 31 slots with zero spans", () => {
    let t = 0;
    const q = createGlyphAtlasPaletteQuantizer({ now: () => t });
    const grid = buildCellGrid(char, many, null, many.length, 1);
    const out = encodeCellGridOutput(grid, true, 0, "atlas", q);
    expect(out.text).not.toContain("<span");
    expect([...out.text]).toHaveLength(many.length);
    expect(q.palette!.length).toBeLessThanOrEqual(GLYPH_FONT_ATLAS.maxPaletteSize);
    expect(out.text).toBe(encodeGlyphAtlas(char, many, many.length, 1, q.palette!));
    expect(out.encoding).toBe("atlas");
  });

  it("still falls back to spans when a glyph is outside the atlas, quantizer or not", () => {
    const q = createGlyphAtlasPaletteQuantizer({ now: () => 0 });
    const mixed = [...char.slice(0, -1), "ᚠ"];
    const grid = buildCellGrid(mixed, many, null, many.length, 1);
    const out = encodeCellGridOutput(grid, true, 0, "atlas", q);
    expect(out.text).toContain("<span");
    expect(out.encoding).toBe("spans");
    // And the unencodable grid never reached the quantizer at all: a grid the
    // atlas can never carry must not pool, repool, or bump the generation.
    expect(q.palette).toBeUndefined();
    expect(q.generation).toBe(0);
  });
});

/** Minimal HSV→hex, used only to synthesize a rotating-hue test sequence. */
function hsvHex(h: number, s: number, v: number): string {
  const hh = (((h % 360) + 360) % 360) / 60;
  const c = v * s;
  const x = c * (1 - Math.abs((hh % 2) - 1));
  const m = v - c;
  const [r, g, b] = hh < 1 ? [c, x, 0] : hh < 2 ? [x, c, 0] : hh < 3 ? [0, c, x] : hh < 4 ? [0, x, c] : hh < 5 ? [x, 0, c] : [c, 0, x];
  const q = (n: number) => Math.max(0, Math.min(255, Math.round((n + m) * 255)));
  return unpackHexColor((q(r!) << 16) | (q(g!) << 8) | q(b!));
}

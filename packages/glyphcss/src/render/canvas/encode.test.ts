import { describe, expect, it } from "vitest";
import { createGlyphCanvas } from "./canvas";
import { encodeGlyphCanvasAnsi, encodeGlyphCanvasHtml, encodeGlyphCanvasText, nearestAnsiCanvasColor } from "./encode";

describe("encodeGlyphCanvasText: raw, no escaping", () => {
  it("emits literal < > & (mutation: escape in the text exit -> red)", () => {
    const canvas = createGlyphCanvas({ cols: 3, rows: 1, tier: "box" });
    canvas.text(0, 0, ["<&>"], {});
    expect(encodeGlyphCanvasText(canvas)).toBe("<&>");
  });
});

describe("encodeGlyphCanvasHtml: escapes itself, spans only (Phase 0)", () => {
  it("emits &lt; for a literal < with no bg set (mutation: stop escaping -> red)", () => {
    // Phase 0 removed the atlas-delegation optimization entirely (it
    // returned colour-less PUA text for the common box-drawing/ASCII case,
    // see docs/design/canvas.md) — the HTML exit is spans, unconditionally,
    // so this needs no bg trick to reach the escaping code, unlike before.
    const canvas = createGlyphCanvas({ cols: 3, rows: 1, tier: "box" });
    canvas.text(0, 0, ["<&>"], { color: "#ff0000" });
    const html = encodeGlyphCanvasHtml(canvas);
    expect(html).toContain("&lt;");
    expect(html).toContain("&amp;");
    expect(html).toContain("&gt;");
    expect(html).not.toContain("<&>");
  });

  it("raw text exit and HTML exit disagree exactly on escaping", () => {
    const canvas = createGlyphCanvas({ cols: 1, rows: 1, tier: "box" });
    canvas.text(0, 0, ["<"], {});
    expect(encodeGlyphCanvasText(canvas)).toContain("<");
    expect(encodeGlyphCanvasHtml(canvas)).toContain("&lt;");
  });

  it("never delegates to atlas PUA output — always spans, for any glyph set", () => {
    // Every glyph here (box-drawing + ASCII) is atlas-covered, which is
    // exactly the shape that used to silently take the broken atlas path.
    const canvas = createGlyphCanvas({ cols: 5, rows: 1, tier: "box" });
    canvas.text(0, 0, ["hello"], { color: "#ff0000" });
    const html = encodeGlyphCanvasHtml(canvas);
    expect(html).toContain("<span");
    expect(html).toContain("color:#ff0000");
    expect(html).toContain("hello");
  });
});

describe("colour validation happens at paint time, not encode time", () => {
  it("fillRect throws a TypeError naming the painter for a non-canonical colour", () => {
    const canvas = createGlyphCanvas({ cols: 3, rows: 1, tier: "box" });
    expect(() => canvas.fillRect(0, 0, 0, 0, { fill: "solid", color: "red" })).toThrow(TypeError);
    expect(() => canvas.fillRect(0, 0, 0, 0, { fill: "solid", color: "red" })).toThrow(/fillRect/);
  });

  it("line/text/arrowhead each throw a TypeError naming themselves", () => {
    const canvas = createGlyphCanvas({ cols: 3, rows: 3, tier: "box" });
    expect(() => canvas.line({ x: 0, y: 0 }, { x: 2, y: 0 }, { color: "red" })).toThrow(/line/);
    expect(() => canvas.text(0, 0, ["a"], { color: "red" })).toThrow(/text/);
    expect(() => canvas.arrowhead(0, 0, "n", { color: "red" })).toThrow(/arrowhead/);
  });

  it("HTML style-attribute injection through the colour channel is refused, not sanitized after the fact", () => {
    // Regression fixture for the exact injection string both reviews used:
    // a colour value crafted to close the style attribute and open a new
    // one. Validating (and rejecting) at the painter, before the string
    // ever reaches a shared buffer, makes the encoder's job trivial — it
    // never needs to sanitize a colour, because an invalid one can never
    // arrive.
    const canvas = createGlyphCanvas({ cols: 2, rows: 1, tier: "box" });
    const injected = '#fff" onmouseover="alert(1)';
    expect(() => canvas.fillRect(0, 0, 0, 0, { fill: "solid", color: injected, bg: "#000000" })).toThrow(TypeError);
    // The buffer was never written, so a caller who catches and ignores the
    // throw cannot end up with an injected attribute either.
    expect(canvas.grid.color[0]).toBe(null);
  });

  it("a non-canonical bg is refused the same way", () => {
    const canvas = createGlyphCanvas({ cols: 2, rows: 1, tier: "box" });
    expect(() => canvas.fillRect(0, 0, 0, 0, { fill: "solid", color: "#ff0000", bg: "blue" })).toThrow(TypeError);
  });

  it("uppercase hex is refused — the contract is CANONICAL (lowercase) #rrggbb, not merely valid hex", () => {
    // `isQuantizableColor` alone is case-insensitive, so `#FF0000` is a
    // legal hex string; accepting it here would defeat run coalescing,
    // since both string encoders compare colours by exact string identity
    // (a palette written in mixed case, as most design tools print hex,
    // would fragment one intended run into one span/SGR sequence per cell).
    const canvas = createGlyphCanvas({ cols: 2, rows: 1, tier: "box" });
    expect(() => canvas.fillRect(0, 0, 0, 0, { fill: "solid", color: "#FF0000" })).toThrow(TypeError);
    expect(() => canvas.fillRect(0, 0, 0, 0, { fill: "solid", color: "#Ff0000" })).toThrow(TypeError);
  });

  it("shorthand #rgb, rgb(...), and incidental whitespace are all refused", () => {
    const canvas = createGlyphCanvas({ cols: 2, rows: 1, tier: "box" });
    expect(() => canvas.fillRect(0, 0, 0, 0, { fill: "solid", color: "#f00" })).toThrow(TypeError);
    expect(() => canvas.fillRect(0, 0, 0, 0, { fill: "solid", color: "rgb(255, 0, 0)" })).toThrow(TypeError);
    expect(() => canvas.fillRect(0, 0, 0, 0, { fill: "solid", color: " #ff0000" })).toThrow(TypeError);
    expect(() => canvas.fillRect(0, 0, 0, 0, { fill: "solid", color: "#ff0000 " })).toThrow(TypeError);
  });
});

describe("fillRect requires integer cell coordinates", () => {
  it("throws a RangeError for a fractional bound, rather than silently painting nothing", () => {
    const canvas = createGlyphCanvas({ cols: 5, rows: 2, tier: "box" });
    expect(() => canvas.fillRect(0.5, 0, 2.5, 1, { fill: "solid", color: "#ff0000" })).toThrow(RangeError);
    // The grid must not have been corrupted with non-integer indices.
    expect(Object.keys(canvas.grid.char).every((k) => /^\d+$/.test(k))).toBe(true);
  });
});

describe("fillRect validates fill.shade (mutation: drop the clamp/validation -> red)", () => {
  it("throws a RangeError for a NaN shade instead of writing 'undefined' into grid.char", () => {
    const canvas = createGlyphCanvas({ cols: 3, rows: 1, tier: "box" });
    // `shade = v / max` on an all-zero series, or `(v - min) / (max - min)`
    // on a constant series, is exactly this: `Math.round(NaN * n)` is `NaN`,
    // `ramp[NaN]` is `undefined`, and the previous unclamped, unvalidated
    // path wrote that `undefined` straight into `grid.char`, shortening the
    // encoded row and printing the literal string "undefined" downstream.
    expect(() => canvas.fillRect(0, 0, 2, 0, { fill: { shade: NaN }, color: "#ffffff" })).toThrow(RangeError);
    expect(() => canvas.fillRect(0, 0, 2, 0, { fill: { shade: NaN }, color: "#ffffff" })).toThrow(/fillRect/);
    // Nothing was written — no cell became `undefined`.
    expect(canvas.grid.char.every((c) => typeof c === "string")).toBe(true);
  });

  it("throws a RangeError for a shade outside [0, 1]", () => {
    const canvas = createGlyphCanvas({ cols: 1, rows: 1, tier: "box" });
    expect(() => canvas.fillRect(0, 0, 0, 0, { fill: { shade: 1.5 }, color: "#ffffff" })).toThrow(RangeError);
    expect(() => canvas.fillRect(0, 0, 0, 0, { fill: { shade: -0.1 }, color: "#ffffff" })).toThrow(RangeError);
  });

  it("shade: 0 is BLANK on every tier, not only ascii", () => {
    // Round-1 fixed this for `ascii` alone; `box`'s own shade ramp still
    // painted a visible light-shade glyph at shade 0 (no leading blank
    // entry), so switching a zero-valued heatmap cell from ascii to box
    // added ink that was not there. blocks derive their fill from `sub`
    // occupancy (mask 0 at shade 0 -> quadrant index 0 -> " "), which was
    // already blank; braille's `fillRect` now reuses that SAME quadrant
    // table (packet "Braille-tier fills" — `line()`/dots keep braille's own
    // dot patterns, `fillRect` doesn't), so mask 0 is a literal space there
    // too, not U+2800.
    for (const tier of ["ascii", "box", "blocks", "braille"] as const) {
      const canvas = createGlyphCanvas({ cols: 1, rows: 1, tier });
      canvas.fillRect(0, 0, 0, 0, { fill: { shade: 0 }, color: "#ffffff" });
      expect(canvas.grid.char[0]).toBe(" ");
    }
  });
});

describe("backgrounds paint blank cells (mutation: drop the bg buffer -> red)", () => {
  it("a blue bg behind \"a b\" colours all three cells in both ANSI and HTML, including the blank middle one", () => {
    const canvas = createGlyphCanvas({ cols: 3, rows: 1, tier: "box" });
    canvas.fillRect(0, 0, 2, 0, { fill: "solid", color: "#ffffff", bg: "#0000ff" });
    canvas.text(0, 0, ["a b"], { color: "#000000" });
    expect(canvas.bg).toEqual(["#0000ff", "#0000ff", "#0000ff"]);

    const ansi = encodeGlyphCanvasAnsi(canvas, { colors: "truecolor" });
    // Every one of the three cells' runs must carry the bg code — including
    // the middle space, which the previous implementation suppressed.
    expect(ansi.split("48;2;0;0;255").length - 1).toBeGreaterThanOrEqual(1);
    // Specifically: the middle (blank) cell's own run still has a bg code.
    // Isolate it by re-encoding a canvas with ONLY the blank cell bg'd.
    const middleOnly = createGlyphCanvas({ cols: 3, rows: 1, tier: "box" });
    middleOnly.fillRect(1, 0, 1, 0, { fill: "solid", color: null, bg: "#0000ff" });
    // fillRect with fill:"solid" always paints a glyph — clear it back to a
    // blank space to isolate "a bg with no foreground ink at all".
    middleOnly.grid.char[1] = " ";
    const ansiMiddle = encodeGlyphCanvasAnsi(middleOnly, { colors: "truecolor" });
    expect(ansiMiddle).toContain("48;2;0;0;255");

    const htmlMiddle = encodeGlyphCanvasHtml(middleOnly);
    expect(htmlMiddle).toContain("background-color:#0000ff");
  });
});

describe("encodeGlyphCanvasAnsi: colour-depth channel restriction", () => {
  it("16-color output contains no 38;5 and no 38;2", () => {
    const canvas = createGlyphCanvas({ cols: 1, rows: 1, tier: "box" });
    canvas.fillRect(0, 0, 0, 0, { fill: "solid", color: "#123456" });
    const ansi = encodeGlyphCanvasAnsi(canvas, { colors: "16" });
    expect(ansi).not.toContain("38;5");
    expect(ansi).not.toContain("38;2");
  });

  it("256-color output contains no 38;2 (truecolor)", () => {
    const canvas = createGlyphCanvas({ cols: 1, rows: 1, tier: "box" });
    canvas.fillRect(0, 0, 0, 0, { fill: "solid", color: "#123456" });
    const ansi = encodeGlyphCanvasAnsi(canvas, { colors: "256" });
    expect(ansi).toContain("38;5");
    expect(ansi).not.toContain("38;2");
  });

  it("truecolor output contains no 38;5 (256) and no plain 3x/9x SGR fg codes", () => {
    const canvas = createGlyphCanvas({ cols: 1, rows: 1, tier: "box" });
    canvas.fillRect(0, 0, 0, 0, { fill: "solid", color: "#123456" });
    const ansi = encodeGlyphCanvasAnsi(canvas, { colors: "truecolor" });
    expect(ansi).toContain("38;2");
    expect(ansi).not.toContain("38;5");
  });

  it("decoded 16-color codes match the nearest palette entry on an EXACT hit (mutation: skip the downgrade -> red)", () => {
    const canvas = createGlyphCanvas({ cols: 1, rows: 1, tier: "box" });
    // Pure red is an EXACT hit in the 16-color palette: "bright red", index
    // 9 -> fg SGR 91.
    canvas.fillRect(0, 0, 0, 0, { fill: "solid", color: "#ff0000" });
    const ansi16 = encodeGlyphCanvasAnsi(canvas, { colors: "16" });
    expect(ansi16).toContain("\x1b[91m");
  });

  it("decoded 256-color codes match the nearest colour-cube entry on an EXACT hit (mutation: skip the downgrade -> red)", () => {
    const canvas = createGlyphCanvas({ cols: 1, rows: 1, tier: "box" });
    // #5f0000 (95,0,0) is an EXACT hit on the 6x6x6 colour cube (level index
    // 1 = 95) at cube position r=1,g=0,b=0 -> overall index 16+36 = 52, and
    // is NOT one of the base 16 colours, so this exercises the cube branch
    // specifically rather than the aliased low-16 entries.
    canvas.fillRect(0, 0, 0, 0, { fill: "solid", color: "#5f0000" });
    const ansi256 = encodeGlyphCanvasAnsi(canvas, { colors: "256" });
    expect(ansi256).toContain("38;5;52");
  });

  // The two exact-hit tests above pass even if the distance metric itself
  // is wrong (e.g. plain Euclidean RGB instead of redmean) — an exact hit
  // has distance 0 under EVERY metric. These two colours were chosen (by
  // brute-force search over the real palettes) specifically because redmean
  // and plain Euclidean distance pick DIFFERENT nearest entries for them, so
  // a mutation that swaps the metric reddens here even though every
  // exact-hit assertion above stays green.
  it("16-color: an off-palette colour where redmean and Euclidean disagree resolves via redmean (mutation: Euclidean instead -> red)", () => {
    const canvas = createGlyphCanvas({ cols: 1, rows: 1, tier: "box" });
    // #0045c6: redmean's nearest entry is index 6 (teal, #008080, fg 36);
    // plain Euclidean distance picks index 12 (blue, #0000ff, fg 94).
    canvas.fillRect(0, 0, 0, 0, { fill: "solid", color: "#0045c6" });
    const ansi16 = encodeGlyphCanvasAnsi(canvas, { colors: "16" });
    expect(ansi16).toContain("\x1b[36m");
    expect(ansi16).not.toContain("\x1b[94m");
  });

  it("256-color: an off-palette colour where redmean and Euclidean disagree resolves via redmean (mutation: Euclidean instead -> red)", () => {
    const canvas = createGlyphCanvas({ cols: 1, rows: 1, tier: "box" });
    // #000309: redmean's nearest entry is grayscale-ramp index 232 (#080808);
    // plain Euclidean distance picks index 0 (pure black, #000000).
    canvas.fillRect(0, 0, 0, 0, { fill: "solid", color: "#000309" });
    const ansi256 = encodeGlyphCanvasAnsi(canvas, { colors: "256" });
    expect(ansi256).toContain("38;5;232");
    expect(ansi256).not.toContain("38;5;0m");
  });
});

describe("encodeGlyphCanvasAnsi: fg AND bg are decoded together in every colour mode (mutation: force bg to stay truecolor regardless of mode -> red)", () => {
  // Every existing exact-hit/downgrade test above sets ONLY a foreground —
  // a mutation that hardcodes the BACKGROUND channel to always emit
  // truecolor codes regardless of the requested mode passed every one of
  // them. These fixtures set fg AND bg on the SAME cell, in the SAME
  // escape sequence, so a channel-specific bypass has nowhere to hide.
  it("16-color: both fg and bg use 3x/4x/9x/10x, never 38;5/48;5 or 38;2/48;2", () => {
    const canvas = createGlyphCanvas({ cols: 1, rows: 1, tier: "box" });
    canvas.fillRect(0, 0, 0, 0, { fill: "solid", color: "#ff0000", bg: "#0000ff" });
    const ansi = encodeGlyphCanvasAnsi(canvas, { colors: "16" });
    expect(ansi).not.toContain("38;5");
    expect(ansi).not.toContain("48;5");
    expect(ansi).not.toContain("38;2");
    expect(ansi).not.toContain("48;2");
    expect(ansi).toContain("91"); // bright red fg
    expect(ansi).toContain("104"); // bright blue bg
  });

  it("256-color: both fg and bg use 38;5/48;5, never 38;2/48;2", () => {
    const canvas = createGlyphCanvas({ cols: 1, rows: 1, tier: "box" });
    canvas.fillRect(0, 0, 0, 0, { fill: "solid", color: "#ff0000", bg: "#0000ff" });
    const ansi = encodeGlyphCanvasAnsi(canvas, { colors: "256" });
    expect(ansi).toContain("38;5");
    expect(ansi).toContain("48;5");
    expect(ansi).not.toContain("38;2");
    expect(ansi).not.toContain("48;2");
  });

  it("truecolor: both fg and bg use 38;2/48;2, never 38;5/48;5", () => {
    const canvas = createGlyphCanvas({ cols: 1, rows: 1, tier: "box" });
    canvas.fillRect(0, 0, 0, 0, { fill: "solid", color: "#ff0000", bg: "#0000ff" });
    const ansi = encodeGlyphCanvasAnsi(canvas, { colors: "truecolor" });
    expect(ansi).toContain("38;2;255;0;0");
    expect(ansi).toContain("48;2;0;0;255");
    expect(ansi).not.toContain("38;5");
    expect(ansi).not.toContain("48;5");
  });
});

describe("encodeGlyphCanvasAnsi: a reset is emitted PER RUN (mutation: remove per-run resets -> red)", () => {
  it("two adjacent differently-coloured runs are each individually reset, not just the line", () => {
    const canvas = createGlyphCanvas({ cols: 2, rows: 1, tier: "box" });
    canvas.fillRect(0, 0, 0, 0, { fill: "solid", color: "#ff0000" });
    canvas.fillRect(1, 0, 1, 0, { fill: "solid", color: "#00ff00" });
    const ansi = encodeGlyphCanvasAnsi(canvas, { colors: "truecolor" });
    // One reset after the first run, one after the second, one at line end:
    // if the per-run reset were removed, only the unconditional line-end
    // reset would remain (a single occurrence), even though two visually
    // distinct runs exist.
    const resets = ansi.split("\x1b[0m").length - 1;
    expect(resets).toBeGreaterThanOrEqual(2);
  });

  it("reset closes every run and ends every line", () => {
    const canvas = createGlyphCanvas({ cols: 2, rows: 1, tier: "box" });
    canvas.fillRect(0, 0, 1, 0, { fill: "solid", color: "#ff0000" });
    const ansi = encodeGlyphCanvasAnsi(canvas, { colors: "truecolor" });
    expect(ansi.endsWith("\x1b[0m")).toBe(true);
  });

  it("mutation: a reset placed only at line end (never per-run) leaks the second run's colour before the first reset — checked by POSITION, not merely by count", () => {
    // Counting resets (the two tests above) is defeated by a mutation that
    // removes the per-run reset AND appends two resets at line end instead
    // — the same total count, wrong placement. This asserts where the
    // FIRST reset actually falls: immediately after the first run's own
    // colour, never after the second run's.
    const canvas = createGlyphCanvas({ cols: 3, rows: 1, tier: "box" });
    canvas.fillRect(0, 0, 0, 0, { fill: "solid", color: "#ff0000" });
    canvas.fillRect(1, 0, 1, 0, { fill: "solid", color: "#00ff00" });
    canvas.grid.char[2] = " ";
    canvas.grid.color[2] = null;
    const ansi = encodeGlyphCanvasAnsi(canvas, { colors: "truecolor" });
    const parts = ansi.split("\x1b[0m");
    // Three resets (one per coloured run, one unconditional at line end)
    // split the string into four parts, the last of which is empty because
    // the string ends exactly on a reset.
    expect(parts.length).toBe(4);
    expect(parts[0]).toContain("255;0;0");
    expect(parts[0]).not.toContain("0;255;0");
    expect(parts[1]).toContain("0;255;0");
    expect(parts[1]).not.toContain("255;0;0");
    // The trailing blank, uncoloured cell carries no escape codes at all.
    expect(parts[2]).not.toContain("\x1b[");
    expect(parts[3]).toBe("");
  });
});

describe("encodeGlyphCanvasAnsi: NO_COLOR / FORCE_COLOR — non-empty counts, empty is unset", () => {
  it("NO_COLOR: \"\" (empty) does NOT disable colour", () => {
    const canvas = createGlyphCanvas({ cols: 1, rows: 1, tier: "box" });
    canvas.fillRect(0, 0, 0, 0, { fill: "solid", color: "#ff0000" });
    const ansi = encodeGlyphCanvasAnsi(canvas, { colors: "truecolor", env: { NO_COLOR: "" } });
    expect(ansi).toContain("\x1b[");
  });

  it("NO_COLOR: \"0\" (non-empty) DOES disable colour", () => {
    const canvas = createGlyphCanvas({ cols: 1, rows: 1, tier: "box" });
    canvas.fillRect(0, 0, 0, 0, { fill: "solid", color: "#ff0000" });
    const ansi = encodeGlyphCanvasAnsi(canvas, { colors: "truecolor", env: { NO_COLOR: "0" } });
    expect(ansi).not.toContain("\x1b[");
  });

  it("NO_COLOR: \"1\" disables colour", () => {
    const canvas = createGlyphCanvas({ cols: 1, rows: 1, tier: "box" });
    canvas.fillRect(0, 0, 0, 0, { fill: "solid", color: "#ff0000" });
    const ansi = encodeGlyphCanvasAnsi(canvas, { colors: "truecolor", env: { NO_COLOR: "1" } });
    expect(ansi).not.toContain("\x1b[");
  });

  it("FORCE_COLOR: \"\" (empty) does NOT override NO_COLOR", () => {
    const canvas = createGlyphCanvas({ cols: 1, rows: 1, tier: "box" });
    canvas.fillRect(0, 0, 0, 0, { fill: "solid", color: "#ff0000" });
    const ansi = encodeGlyphCanvasAnsi(canvas, {
      colors: "truecolor",
      env: { NO_COLOR: "1", FORCE_COLOR: "" },
    });
    expect(ansi).not.toContain("\x1b[");
  });

  it("FORCE_COLOR: \"0\" (non-empty) DOES override NO_COLOR", () => {
    const canvas = createGlyphCanvas({ cols: 1, rows: 1, tier: "box" });
    canvas.fillRect(0, 0, 0, 0, { fill: "solid", color: "#ff0000" });
    const ansi = encodeGlyphCanvasAnsi(canvas, {
      colors: "truecolor",
      env: { NO_COLOR: "1", FORCE_COLOR: "0" },
    });
    expect(ansi).toContain("\x1b[");
  });

  it("FORCE_COLOR: \"1\" overrides NO_COLOR", () => {
    const canvas = createGlyphCanvas({ cols: 1, rows: 1, tier: "box" });
    canvas.fillRect(0, 0, 0, 0, { fill: "solid", color: "#ff0000" });
    const ansi = encodeGlyphCanvasAnsi(canvas, {
      colors: "truecolor",
      env: { NO_COLOR: "1", FORCE_COLOR: "1" },
    });
    expect(ansi).toContain("\x1b[");
  });

  it("never reads process.env even when NO_COLOR is set there but not passed explicitly", () => {
    const original = process.env.NO_COLOR;
    process.env.NO_COLOR = "1";
    try {
      const canvas = createGlyphCanvas({ cols: 1, rows: 1, tier: "box" });
      canvas.fillRect(0, 0, 0, 0, { fill: "solid", color: "#ff0000" });
      const ansi = encodeGlyphCanvasAnsi(canvas, { colors: "truecolor" });
      expect(ansi).toContain("\x1b[");
    } finally {
      if (original === undefined) delete process.env.NO_COLOR;
      else process.env.NO_COLOR = original;
    }
  });
});

describe("encodeGlyphCanvasHtml: text({ scale }) — the web textScale affordance", () => {
  it("emits a single <span class=\"glyph-text\"> per origin glyph, styled font-size:<s>em, and nothing for its filler cells on the ORIGIN's own row (mutation: emit a blank glyph for fillers -> red)", () => {
    const canvas = createGlyphCanvas({ cols: 6, rows: 2, tier: "box" });
    canvas.text(0, 0, ["a"], { color: "#ff0000", scale: 2 });
    const html = encodeGlyphCanvasHtml(canvas);
    expect(html).toContain('<span class="glyph-text" style="display:inline-block;font-size:2em;line-height:calc(1 / 2);width:1ch;color:#ff0000">a</span>');
    // Row 0: "a" span, then columns 2..5 are still blank (never a literal
    // space belonging to the origin's own box).
    const rows = html.split("\n");
    expect(rows[0]).toBe('<span class="glyph-text" style="display:inline-block;font-size:2em;line-height:calc(1 / 2);width:1ch;color:#ff0000">a</span>    ');
    // Row 1: columns 0-1 are FILLER too, but on the row BELOW the origin —
    // nothing else reserves that column's width there (the bigger glyph
    // only overflows DOWNWARD in ink, past its own line box; it never
    // widens a later `\n`-separated row's own text), so unlike row 0's
    // same-row fillers these DO emit real blanks, keeping the row's own
    // column count exact (P1-2 — codex review: skipping them too shifted
    // any later content on that row left by the filler width).
    expect(rows[1]).toBe("      ");
  });

  // codex P1-2's own repro: a 12x3 canvas, "A" at (2,0) scale:2, and a "|"
  // at column 8 on rows 0 AND 1. HEAD placed the lower bar at column 6
  // (shifted left by the 2 skipped filler columns on row 1); it must stay
  // at real column 8. Row 1 has no scaled origin of its own, so every one
  // of its cells (filler or not) emits exactly one plain character —
  // stripping tags and counting characters up to the bar therefore reads
  // the bar's true column directly (mutation: skip below-origin fillers
  // again -> the count drops to 6).
  it("does not shift later content left on a row below a scaled origin (P1-2)", () => {
    const canvas = createGlyphCanvas({ cols: 12, rows: 3, tier: "box" });
    canvas.text(2, 0, ["A"], { color: "#ff0000", scale: 2 });
    canvas.text(8, 0, ["|"], { color: "#00ff00" });
    canvas.text(8, 1, ["|"], { color: "#00ff00" });
    const html = encodeGlyphCanvasHtml(canvas);
    const rows = html.split("\n");
    const barCol = (row: string) => row.replace(/<[^>]*>/g, "").indexOf("|");
    expect(barCol(rows[1]!)).toBe(8);
    // Row 0's own bar sits one STRIPPED character earlier than its real
    // column (7, not 8) for a reason that is NOT the P1-2 bug: the
    // scaled "A" origin renders as ONE character in this plain-text
    // stripping (real column width is a CSS `font-size` fact this test
    // can't observe from the string alone) while its own same-row filler
    // column (col 3) correctly emits nothing at all — so the origin+
    // filler pair contributes 1 stripped character for 2 real columns.
    // Only row 1 (no scaled origin) has a 1:1 stripped-character-to-
    // column mapping, which is what the assertion above actually pins.
    expect(barCol(rows[0]!)).toBe(7);
  });

  it("a scale-1 (default) label renders exactly like before this option existed — no glyph-text span anywhere", () => {
    const canvas = createGlyphCanvas({ cols: 6, rows: 1, tier: "box" });
    canvas.text(0, 0, ["ab"], { color: "#ff0000" });
    const html = encodeGlyphCanvasHtml(canvas);
    expect(html).not.toContain("glyph-text");
  });

  it("the plain text exit and ANSI ignore textScale entirely: origin glyph + real blanks, never a span", () => {
    const canvas = createGlyphCanvas({ cols: 4, rows: 2, tier: "box" });
    canvas.text(0, 0, ["a"], { color: "#ff0000", scale: 2 });
    expect(encodeGlyphCanvasText(canvas)).toBe("a   \n    ");
    const ansi = encodeGlyphCanvasAnsi(canvas, { colors: "truecolor" });
    expect(ansi).not.toContain("glyph-text");
    expect(ansi).not.toContain("<span");
  });

  // N1 (CHARTS-RESEARCH `REVIEW-batch4-fixes-opus.md`): the reserved
  // COLUMN footprint of a scaled origin's own span must not depend on its
  // `font-size` — `display:inline-block;width:1ch` is what makes that
  // true (mutation: drop either declaration -> the byte-exact assertions
  // above already go red, since they pin the full style string).
  it("the scaled span is display:inline-block with a self-cancelling width:1ch reservation, independent of colour", () => {
    const canvas = createGlyphCanvas({ cols: 4, rows: 1, tier: "box" });
    canvas.text(0, 0, ["a"], { scale: 3 });
    const html = encodeGlyphCanvasHtml(canvas);
    expect(html).toContain('<span class="glyph-text" style="display:inline-block;font-size:3em;line-height:calc(1 / 3);width:1ch">a</span>');
  });
});

describe("encodeGlyphCanvasHtml: recolor option — requantizing colour for an ANSI-depth html", () => {
  it("applies recolor to a plain run's colour and background, not to the raw grouping key", () => {
    const canvas = createGlyphCanvas({ cols: 2, rows: 1, tier: "box" });
    canvas.fillRect(0, 0, 1, 0, { fill: "solid", color: "#123456", bg: "#654321" });
    const html = encodeGlyphCanvasHtml(canvas, { recolor: () => "#ff0000" });
    expect(html).toContain("color:#ff0000;background-color:#ff0000");
    expect(html).not.toContain("#123456");
    expect(html).not.toContain("#654321");
  });

  it("applies recolor to a scaled origin span's colour too", () => {
    const canvas = createGlyphCanvas({ cols: 2, rows: 1, tier: "box" });
    canvas.text(0, 0, ["a"], { color: "#123456", scale: 2 });
    const html = encodeGlyphCanvasHtml(canvas, { recolor: () => "#00ff00" });
    expect(html).toContain('color:#00ff00');
    expect(html).not.toContain("#123456");
  });

  it("two adjacent cells with different raw colours that recolour to the SAME value still emit two spans, mirroring the ANSI encoder's own per-run quantization (mutation: recolour before grouping -> merges into one span)", () => {
    const canvas = createGlyphCanvas({ cols: 2, rows: 1, tier: "box" });
    canvas.text(0, 0, ["a"], { color: "#100000" });
    canvas.text(1, 0, ["b"], { color: "#200000" });
    const html = encodeGlyphCanvasHtml(canvas, { recolor: () => "#ff0000" });
    expect(html.match(/<span/g)?.length).toBe(2);
  });

  it("with no recolor, colours pass through unchanged (byte-identical to before this option existed)", () => {
    const canvas = createGlyphCanvas({ cols: 2, rows: 1, tier: "box" });
    canvas.text(0, 0, ["a"], { color: "#123456" });
    expect(encodeGlyphCanvasHtml(canvas)).toContain("#123456");
  });
});

describe("nearestAnsiCanvasColor — the same palette encodeGlyphCanvasAnsi downgrades to", () => {
  it("maps pure red to ANSI red at both depths", () => {
    expect(nearestAnsiCanvasColor("#ff0000", "16")).toBe("#ff0000");
    expect(nearestAnsiCanvasColor("#ff0000", "256")).toBe("#ff0000");
  });

  it("is deterministic and always returns a canonical lowercase #rrggbb", () => {
    const hex = nearestAnsiCanvasColor("#7a7f8a", "256");
    expect(hex).toMatch(/^#[0-9a-f]{6}$/);
    expect(nearestAnsiCanvasColor("#7a7f8a", "256")).toBe(hex);
  });
});

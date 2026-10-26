import { afterEach, describe, expect, it, vi } from "vitest";
import { GlyphFluidReaderLetters, glyphFluidReaderGlyph, glyphFluidReaderLetterColor, type GlyphFluidReaderLetterSet } from "./letters";

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe("glyphFluidReaderGlyph (render.js's decode)", () => {
  it("shows the real letter only above 0.36 ink, a ramp glyph below", () => {
    expect(glyphFluidReaderGlyph("w", 0.37, 0)).toBe("w");
    expect(glyphFluidReaderGlyph("w", 0.36, 0)).not.toBe("w");
    // ramp " .:-=+*#%@": round(ink · 9), never the blank
    expect(glyphFluidReaderGlyph("w", 0.36, 0)).toBe("-");
    expect(glyphFluidReaderGlyph("w", 0.2, 0)).toBe(":");
    expect(glyphFluidReaderGlyph("w", 0.01, 0)).toBe(".");
  });

  it("melting raises the decode threshold (×1.5) and drains the ramp", () => {
    expect(glyphFluidReaderGlyph("w", 0.62, 0)).toBe("w");
    expect(glyphFluidReaderGlyph("w", 0.62, 0.1)).toBe("w"); // 0.62 > 0.51
    expect(glyphFluidReaderGlyph("w", 0.62, 0.2)).toBe("="); // 0.62 ≤ 0.66 → round(0.42 · 9) = 4
    expect(glyphFluidReaderGlyph("w", 0.62, 0.7)).toBe("."); // fully drained
  });
});

describe("glyphFluidReaderLetterColor", () => {
  it("brightens with ink (0.55 + ink) and pulls the ORP letter to molty's accent orange", () => {
    expect(glyphFluidReaderLetterColor([1, 1, 1], 0, 0, false)).toBe("#888888"); // 0.55 · 255 = 140 → 136
    expect(glyphFluidReaderLetterColor([1, 1, 1], 0.6, 0, false)).toBe("#f8f8f8");
    // ORP: at least 85 % of the way to (255, 140, 60)
    expect(glyphFluidReaderLetterColor([1, 1, 1], 0.6, 0, true)).toBe("#f89858");
    expect(glyphFluidReaderLetterColor([1, 1, 1], 0.6, 1, true)).toBe("#f88838");
  });
});

function overlay(reduced = false) {
  const host = document.createElement("div");
  document.body.append(host);
  return { host, o: new GlyphFluidReaderLetters(host, "monospace", [1, 1, 1], reduced) };
}

const SET: GlyphFluidReaderLetterSet = {
  letters: [
    { ch: "o", x: 190, y: 200, orp: false },
    { ch: "n", x: 206, y: 200, orp: true },
    { ch: "e", x: 222, y: 200, orp: false },
  ],
  melt: 0,
  wave: 1,
};
/** ink, wave height, accent, shown — per letter. */
const vals = (...l: number[][]) => Float64Array.from(l.flat());

describe("GlyphFluidReaderLetters (DOM overlay)", () => {
  it("draws real, aria-hidden text: one span per letter, ORP orange, hidden letters transparent", () => {
    const { host, o } = overlay();
    o.draw(SET, vals([0.6, 0, 0, 1], [0.6, 0, 1, 1], [0.1, 0, 0, 0]));
    const spans = Array.from(host.querySelectorAll("span"));
    expect(o.root.getAttribute("aria-hidden")).toBe("true");
    expect(spans.map((s) => s.textContent)).toEqual(["o", "n", ""]);
    expect(spans[1]!.getAttribute("style")).toContain("color: #f88838");
    expect(spans[1]!.getAttribute("style")).toContain("translate3d(206.0px,200.0px,0)");
    expect(spans[2]!.style.opacity).toBe("0");
  });

  it("writes each letter's style at most once per frame and only when it changed; textContent only when the character changes", () => {
    const { host, o } = overlay();
    const css = vi.fn(), text = vi.fn();
    o.draw(SET, vals([0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0])); // creates the spans, all hidden
    // count writes on each span's own style and textContent (instance-level accessors)
    const find = (o0: object, k: string) => {
      for (let p: object | null = o0; p; p = Object.getPrototypeOf(p)) {
        const d = Object.getOwnPropertyDescriptor(p, k);
        if (d) return d;
      }
      throw new Error(k);
    };
    for (const span of Array.from(host.querySelectorAll("span"))) {
      const st = span.style, ds = find(st, "cssText"), dt = find(span, "textContent");
      Object.defineProperty(st, "cssText", { configurable: true, get: () => ds.get!.call(st), set: (v: string) => (css(v), ds.set!.call(st, v)) });
      Object.defineProperty(span, "textContent", { configurable: true, get: () => dt.get!.call(span), set: (v: string) => (text(v), dt.set!.call(span, v)) });
    }
    const still = vals([0.6, 0, 0, 1], [0.6, 0, 1, 1], [0.6, 0, 0, 1]);
    o.draw(SET, still);
    expect(css).toHaveBeenCalledTimes(3);
    expect(text).toHaveBeenCalledTimes(3);
    css.mockClear();
    text.mockClear();
    // an unchanged frame writes nothing
    o.draw(SET, still);
    o.draw(SET, Float64Array.from(still));
    expect(css).not.toHaveBeenCalled();
    expect(text).not.toHaveBeenCalled();
    // the wave moves every letter: one style write each, no text writes
    o.draw(SET, vals([0.6, 0.3, 0, 1], [0.6, 0.3, 1, 1], [0.6, 0.3, 0, 1]));
    expect(css).toHaveBeenCalledTimes(3);
    expect(text).not.toHaveBeenCalled();
    css.mockClear();
    // one letter loses ink below the decode threshold: its character changes, only it
    o.draw(SET, vals([0.6, 0.3, 0, 1], [0.6, 0.3, 1, 1], [0.2, 0.3, 0, 1]));
    expect(text).toHaveBeenCalledTimes(1);
    expect(text).toHaveBeenCalledWith(":");
    expect(css).toHaveBeenCalledTimes(1); // its colour dims
  });

  it("under reduced motion shows the settled letter: no scramble, no wave", () => {
    const { host, o } = overlay(true);
    o.draw(SET, vals([0.2, 0.4, 0, 1], [0.2, 0.4, 1, 1], [0.2, 0.4, 0, 1]));
    const spans = Array.from(host.querySelectorAll("span"));
    expect(spans.map((s) => s.textContent)).toEqual(["o", "n", "e"]);
    expect(spans[0]!.getAttribute("style")).toContain("translate3d(190.0px,200.0px,0)");
  });

  it("null hides every letter; dispose removes the overlay", () => {
    const { host, o } = overlay();
    o.draw(SET, vals([0.6, 0, 0, 1], [0.6, 0, 1, 1], [0.6, 0, 0, 1]));
    o.draw(null, null);
    expect(Array.from(host.querySelectorAll("span")).every((s) => s.style.opacity === "0")).toBe(true);
    o.dispose();
    expect(host.children).toHaveLength(0);
  });
});

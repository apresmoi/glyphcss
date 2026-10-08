import { describe, expect, it } from "vitest";
import { ansiSpansToHtml, ansiToHtml, parseAnsiToSpans } from "./ansiToSpans";

describe("parseAnsiToSpans", () => {
  it("returns a single uncoloured span for plain text", () => {
    expect(parseAnsiToSpans("hello")).toEqual([{ text: "hello", fg: undefined, bg: undefined }]);
  });

  it("parses a 16-colour fg run and resets after it", () => {
    // \x1b[31m = red fg (index 1 -> #800000), reset after "hi", plain "!" after.
    const spans = parseAnsiToSpans("\x1b[31mhi\x1b[0m!");
    expect(spans).toEqual([
      { text: "hi", fg: "#800000", bg: undefined },
      { text: "!", fg: undefined, bg: undefined },
    ]);
  });

  it("parses a bright 16-colour fg (90-97)", () => {
    const spans = parseAnsiToSpans("\x1b[92mgo\x1b[0m");
    expect(spans[0]).toEqual({ text: "go", fg: "#00ff00", bg: undefined });
  });

  it("parses fg AND bg together in one escape", () => {
    const spans = parseAnsiToSpans("\x1b[31;42mx\x1b[0m");
    expect(spans[0]).toEqual({ text: "x", fg: "#800000", bg: "#008000" });
  });

  it("parses a 16-colour bg run (40-47) and a bright bg (100-107)", () => {
    expect(parseAnsiToSpans("\x1b[44my\x1b[0m")[0]).toEqual({ text: "y", fg: undefined, bg: "#000080" });
    expect(parseAnsiToSpans("\x1b[104mz\x1b[0m")[0]).toEqual({ text: "z", fg: undefined, bg: "#0000ff" });
  });

  it("parses 256-colour fg and bg (38;5;n / 48;5;n)", () => {
    // Index 196 in the 6x6x6 cube is pure red (0xff0000) in the standard xterm 256 table.
    const spans = parseAnsiToSpans("\x1b[38;5;196mred\x1b[0m");
    expect(spans[0]).toEqual({ text: "red", fg: "#ff0000", bg: undefined });
    const bgSpans = parseAnsiToSpans("\x1b[48;5;196mred-bg\x1b[0m");
    expect(bgSpans[0]).toEqual({ text: "red-bg", fg: undefined, bg: "#ff0000" });
  });

  it("parses truecolor fg and bg (38;2;r;g;b / 48;2;r;g;b)", () => {
    const spans = parseAnsiToSpans("\x1b[38;2;18;52;86mtc\x1b[0m");
    expect(spans[0]).toEqual({ text: "tc", fg: "#123456", bg: undefined });
    const bgSpans = parseAnsiToSpans("\x1b[48;2;18;52;86mtc-bg\x1b[0m");
    expect(bgSpans[0]).toEqual({ text: "tc-bg", fg: undefined, bg: "#123456" });
  });

  it("full reset (0) clears both channels", () => {
    const spans = parseAnsiToSpans("\x1b[31;44ma\x1b[0mb");
    expect(spans).toEqual([
      { text: "a", fg: "#800000", bg: "#000080" },
      { text: "b", fg: undefined, bg: undefined },
    ]);
  });

  it("per-channel reset (39 fg-only, 49 bg-only) clears only that channel", () => {
    const spans = parseAnsiToSpans("\x1b[31;44ma\x1b[39mb\x1b[49mc");
    expect(spans).toEqual([
      { text: "a", fg: "#800000", bg: "#000080" },
      { text: "b", fg: undefined, bg: "#000080" },
      { text: "c", fg: undefined, bg: undefined },
    ]);
  });

  it("mutation: dropping the 256/truecolor multi-code consumption would misread the following literal codes as separate SGR params", () => {
    // If `i` isn't advanced past the 5/n (or 2/r/g/b) sub-codes, the "31" that
    // follows here would be read as a spurious extra SGR code (harmless to
    // fg 30-37 collision detection, but the point is the SPAN TEXT/order
    // stays correct across two colour runs back to back).
    const spans = parseAnsiToSpans("\x1b[38;5;196;1mred\x1b[0m\x1b[31mplain-red\x1b[0m");
    expect(spans[0]!.fg).toBe("#ff0000");
    expect(spans[1]).toEqual({ text: "plain-red", fg: "#800000", bg: undefined });
  });
});

describe("ansiSpansToHtml / ansiToHtml", () => {
  it("emits plain escaped text for an uncoloured span", () => {
    expect(ansiSpansToHtml([{ text: "<a>&b" }])).toBe("&lt;a&gt;&amp;b");
  });

  it("emits a single top-level span with both channels", () => {
    expect(ansiToHtml("\x1b[31;44mhi\x1b[0m")).toBe('<span style="color:#800000;background-color:#000080">hi</span>');
  });

  it("emits fg-only and bg-only styles distinctly", () => {
    expect(ansiToHtml("\x1b[31mfg\x1b[0m")).toBe('<span style="color:#800000">fg</span>');
    expect(ansiToHtml("\x1b[44mbg\x1b[0m")).toBe('<span style="background-color:#000080">bg</span>');
  });

  it("round-trips a full render-shaped string: colour, reset, plain, colour", () => {
    const input = "\x1b[38;2;255;0;0mA\x1b[0m \x1b[38;2;0;0;255mB\x1b[0m";
    expect(ansiToHtml(input)).toBe('<span style="color:#ff0000">A</span> <span style="color:#0000ff">B</span>');
  });
});

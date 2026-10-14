import { describe, expect, it } from "vitest";
import { glyphDiagramWrap } from "./pipeline";
import { renderGlyphDiagram } from "./render";
import { fitGlyphGraph } from "./fit";

describe("punctuation wrapping", () => {
  it.each(["-", "+", "/", ":"])("breaks after %s without losing it or adding spaces", separator => {
    expect(glyphDiagramWrap(`alpha${separator}beta`, 6)).toEqual([`alpha${separator}`, "beta"]);
    expect(glyphDiagramWrap(`alpha${separator}beta`, 10)).toEqual([`alpha${separator}beta`]);
    expect(glyphDiagramWrap(`x alpha${separator}beta z`, 8)).toEqual([`x alpha${separator}`, "beta z"]);
  });

  it.each(["-", "+", "/", ":"])("tries %s breaks before cutting letters in a node", async separator => {
    const result = await renderGlyphDiagram(`flowchart TB\nA[alpha${separator}beta]`, {
      target: "chat", width: 10, height: 6, autoDirection: false, detail: "faithful",
    });
    expect(result.pages).toHaveLength(1);
    expect(result.layout.nodes[0]!.lines).toEqual([`alpha${separator}`, "beta"]);
    expect(result.report.ledger.map(entry => entry.code)).not.toContain("word-cut");
  });

  it("offers punctuation wraps for loop labels before expanding or dropping them", async () => {
    const result = await renderGlyphDiagram("flowchart TB\nA -->|alpha-beta/gamma| A", {
      target: "chat", width: 17, height: 10, autoDirection: false, detail: "faithful",
    });
    expect(result.pages).toHaveLength(1);
    expect(result.layout.loops[0]!.lines).toEqual(["alpha-", "beta/", "gamma"]);
    expect(result.labels.map(label => label.text)).toEqual(["alpha-", "beta/", "gamma"]);
    expect(result.report.ledger.map(entry => entry.code)).not.toContain("word-cut");
    expect(result.report.ledger.map(entry => entry.code)).not.toContain("label-dropped");
  });

  it("accepts punctuation wrapping when letter cuts are disabled", async () => {
    const result = await fitGlyphGraph({ direction: "TB", nodes: [{ id: "A", label: "alpha-beta" }], edges: [] }, {
      width: 10, height: 6, cutWords: false,
    });
    expect(result.okay).toBe(true);
    expect(result.layout.nodes[0]!.lines).toEqual(["alpha-", "beta"]);
  });

  it("still reports an authored word once when its pieces need letter cuts", async () => {
    const result = await renderGlyphDiagram("flowchart TB\nA[abcdefgh-ijklmnop]", {
      target: "chat", width: 10, height: 8, labelWidth: 6, autoDirection: false,
    });
    expect(result.report.ledger.find(entry => entry.code === "word-cut")?.detail?.nodes)
      .toEqual([{ id: "A", words: ["abcdefgh-ijklmnop"] }]);
    expect(glyphDiagramWrap("abcdefgh", 6)).toEqual(["abcdef", "gh"]);
  });
});

it("keeps a fitting hyphenated token together after preceding words", () => {
  expect(glyphDiagramWrap("x Face-on Edge-on", 7)).toEqual(["x", "Face-on", "Edge-on"]);
  expect(glyphDiagramWrap("Face-on", 5)).toEqual(["Face-", "on"]);
});

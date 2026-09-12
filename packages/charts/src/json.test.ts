import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderGlyphChartJson } from "./json";

describe("renderGlyphChartJson", () => {
  it("round 2: documents file-based CLI input and string wrappers without inventing a flag", () => {
    // Mutation: restore the nonexistent --stdin path in the entry-point JSDoc -> red.
    const doc = readFileSync(resolve(__dirname, "json.ts"), "utf8").split("*/", 1)[0]!;
    expect(doc).toContain("<spec.json>");
    expect(doc).toContain("MCP");
    expect(doc).toContain("skill");
    expect(doc).not.toContain("--stdin");
  });
  it("round-trips a bare number array to a rendered result", () => {
    const out = JSON.parse(renderGlyphChartJson(JSON.stringify([3, 5, 2, 8]), { target: "chat", width: 30, height: 10 }));
    // Mutation: delete the line painter -> no rising/falling segments.
    expect(out.text).toContain("/");
    expect(out.text).toContain("\\");
    expect(out.meta.values).toBe(4);
  });

  it("round-trips a full spec object with field-name channels", () => {
    const spec = {
      marks: [{ type: "line", data: [{ t: 0, v: 1 }, { t: 1, v: 2 }], channels: { x: "t", y: "v" } }],
      title: "T",
    };
    const out = JSON.parse(renderGlyphChartJson(JSON.stringify(spec), { target: "chat" }));
    // Mutation: parse but discard marks -> the diagonal disappears.
    expect(out.meta.title).toBe("T");
    expect(out.text).toMatch(/[_▔‾]/);
  });

  it("returns a structured error with a rule id and hint for an invalid spec", () => {
    const out = JSON.parse(renderGlyphChartJson(JSON.stringify({ marks: [] })));
    expect(out.error).toBeTruthy();
    expect(out.code).toBe("empty-marks");
    expect(out.hint).toBeTruthy();
  });

  it("returns a structured error for malformed JSON, without throwing", () => {
    expect(() => renderGlyphChartJson("{not json")).not.toThrow();
    const out = JSON.parse(renderGlyphChartJson("{not json"));
    expect(out.error).toContain("invalid JSON");
  });
});

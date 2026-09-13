// @vitest-environment node
import { describe, expect, it } from "vitest";
import { parseChartsHex } from "./ChartsColorSwatch";

describe("parseChartsHex", () => {
  it("normalises a 3- or 6-digit hex, with or without '#', to canonical lowercase #rrggbb", () => {
    expect(parseChartsHex("#FF0000")).toBe("#ff0000");
    expect(parseChartsHex("ff0000")).toBe("#ff0000");
    expect(parseChartsHex("#f00")).toBe("#ff0000");
    expect(parseChartsHex("f00")).toBe("#ff0000");
    expect(parseChartsHex(" #38bdf8 ")).toBe("#38bdf8");
  });

  it("rejects anything that isn't a hex triplet/sextet", () => {
    expect(parseChartsHex("not a colour")).toBeNull();
    expect(parseChartsHex("rgb(255,0,0)")).toBeNull();
    expect(parseChartsHex("#ff00")).toBeNull();
    expect(parseChartsHex("")).toBeNull();
  });
});

// @vitest-environment node
import { describe, expect, it } from "vitest";
import { parseHex } from "./colorHex";

describe("parseHex", () => {
  it("normalises a 3- or 6-digit hex, with or without '#', to canonical lowercase #rrggbb", () => {
    expect(parseHex("#FF0000")).toBe("#ff0000");
    expect(parseHex("ff0000")).toBe("#ff0000");
    expect(parseHex("#f00")).toBe("#ff0000");
    expect(parseHex("f00")).toBe("#ff0000");
    expect(parseHex(" #38bdf8 ")).toBe("#38bdf8");
  });

  it("rejects anything that isn't a hex triplet/sextet", () => {
    expect(parseHex("not a colour")).toBeNull();
    expect(parseHex("rgb(255,0,0)")).toBeNull();
    expect(parseHex("#ff00")).toBeNull();
    expect(parseHex("")).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import { parseNumber, parseVec3, parseBoolAttr, parseInvert, parseAxis } from "./parseAttr";

describe("parseNumber", () => {
  it("returns a number for a valid string", () => {
    expect(parseNumber("42")).toBe(42);
    expect(parseNumber("3.14")).toBeCloseTo(3.14);
    expect(parseNumber("-7")).toBe(-7);
    expect(parseNumber("0")).toBe(0);
  });

  it("returns undefined for null", () => {
    expect(parseNumber(null)).toBeUndefined();
  });

  it("returns undefined for non-numeric strings", () => {
    expect(parseNumber("abc")).toBeUndefined();
    expect(parseNumber("")).toBeUndefined();
    expect(parseNumber("NaN")).toBeUndefined();
  });

  it("returns undefined for Infinity strings", () => {
    expect(parseNumber("Infinity")).toBeUndefined();
    expect(parseNumber("-Infinity")).toBeUndefined();
  });
});

describe("parseVec3", () => {
  it("parses a valid '1,2,3' string", () => {
    expect(parseVec3("1,2,3")).toEqual([1, 2, 3]);
  });

  it("handles whitespace around commas", () => {
    expect(parseVec3(" 1 , 2 , 3 ")).toEqual([1, 2, 3]);
  });

  it("returns undefined for null or empty string", () => {
    expect(parseVec3(null)).toBeUndefined();
    expect(parseVec3("")).toBeUndefined();
  });

  it("returns undefined when there are not exactly 3 components", () => {
    expect(parseVec3("1,2")).toBeUndefined();
    expect(parseVec3("1,2,3,4")).toBeUndefined();
  });

  it("returns undefined when any component is NaN", () => {
    expect(parseVec3("1,two,3")).toBeUndefined();
  });
});

describe("parseBoolAttr", () => {
  it("returns undefined for null (attribute absent)", () => {
    expect(parseBoolAttr(null)).toBeUndefined();
  });

  it("returns false for 'false'", () => {
    expect(parseBoolAttr("false")).toBe(false);
  });

  it("returns false for '0'", () => {
    expect(parseBoolAttr("0")).toBe(false);
  });

  it("returns true for empty string (attribute present with no value)", () => {
    expect(parseBoolAttr("")).toBe(true);
  });

  it("returns true for 'true'", () => {
    expect(parseBoolAttr("true")).toBe(true);
  });

  it("returns true for any other string", () => {
    expect(parseBoolAttr("yes")).toBe(true);
    expect(parseBoolAttr("1")).toBe(true);
  });
});

describe("parseInvert", () => {
  it("returns undefined for null", () => {
    expect(parseInvert(null)).toBeUndefined();
  });

  it("returns true for 'true'", () => {
    expect(parseInvert("true")).toBe(true);
  });

  it("returns false for 'false'", () => {
    expect(parseInvert("false")).toBe(false);
  });

  it("returns a number for numeric strings", () => {
    expect(parseInvert("2")).toBe(2);
    expect(parseInvert("-1.5")).toBe(-1.5);
  });

  it("returns true for unrecognized strings (treats as boolean presence)", () => {
    expect(parseInvert("yes")).toBe(true);
    expect(parseInvert("")).toBe(true);
  });
});

describe("parseAxis", () => {
  it("returns 'x' for 'x'", () => {
    expect(parseAxis("x")).toBe("x");
  });

  it("returns 'y' for 'y'", () => {
    expect(parseAxis("y")).toBe("y");
  });

  it("returns undefined for null or other strings", () => {
    expect(parseAxis(null)).toBeUndefined();
    expect(parseAxis("z")).toBeUndefined();
    expect(parseAxis("")).toBeUndefined();
    expect(parseAxis("X")).toBeUndefined();
  });
});

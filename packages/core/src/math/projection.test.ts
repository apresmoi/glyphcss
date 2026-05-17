import { describe, it, expect } from "vitest";
import { project } from "./projection";

const EPS = 1e-9;

function approxEq(a: [number, number, number], b: [number, number, number], eps = EPS): boolean {
  return Math.abs(a[0] - b[0]) < eps && Math.abs(a[1] - b[1]) < eps && Math.abs(a[2] - b[2]) < eps;
}

describe("project — centred origin", () => {
  it("origin [0,0,0] projects to grid centre", () => {
    const [col, row, depth] = project([0, 0, 0], 80, 24, 0.5);
    expect(col).toBeCloseTo(40, 9);
    expect(row).toBeCloseTo(12, 9);
    expect(depth).toBe(0);
  });
});

describe("project — non-zero x displacement", () => {
  it("[1,0,0] shifts col to the right, row unchanged", () => {
    const result = project([1, 0, 0], 80, 24, 0.5);
    // persp = 4/3, r = 9.6, col = 40 + 1 * 9.6 * 0.5 * (4/3) = 46.4
    expect(approxEq(result, [46.4, 12, 0])).toBe(true);
  });
});

describe("project — non-zero z (perspective foreshortening)", () => {
  it("[0,1,2] shrinks row offset due to z depth", () => {
    const result = project([0, 1, 2], 80, 24, 0.5);
    // persp = 4/5 = 0.8, r = 9.6, row = 12 - 1 * 9.6 * 0.8 = 4.32, depth = 2
    expect(approxEq(result, [40, 4.32, 2])).toBe(true);
  });
});

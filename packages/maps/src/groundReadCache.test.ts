import { expect, it, vi } from "vitest";
import { createGlyphMapGroundReadCache } from "./groundReadCache";

it("retains source samples by identity and detects edited coordinates", () => {
  const cache = createGlyphMapGroundReadCache<number>();
  const read = vi.fn(([x, y]: readonly [number, number]) => x + y);
  const point: [number, number] = [1, 2];
  const first = cache(read, [0]);
  expect(first(point)).toBe(3); expect(first(point)).toBe(3);
  expect(cache(read, [0])(point)).toBe(3);
  expect(read).toHaveBeenCalledTimes(1);
  point[0] = 2; expect(cache(read, [0])(point)).toBe(4);
  expect(read).toHaveBeenCalledTimes(2);
  expect(cache(read, [0])([1, 2])).toBe(3);
  expect(read).toHaveBeenCalledTimes(3);
});

it.each(["terrain", "water", "projection", "exaggeration", "window"])("invalidates exact samples when %s changes", change => {
  const cache = createGlyphMapGroundReadCache<number>();
  const point = [1, 2] as const;
  let elevation = 5;
  const read = vi.fn(() => elevation);
  expect(cache(read, [change, 0])(point)).toBe(5);
  elevation = 25;
  expect(cache(read, [change, 1])(point)).toBe(25);
  expect(read).toHaveBeenCalledTimes(2);
});

it("caches non-finite raster answers without re-reading them", () => {
  const cache = createGlyphMapGroundReadCache<number>(), read = vi.fn(() => NaN);
  const point = [1, 2] as const;
  expect(cache(read, [0])(point)).toBeNaN();
  expect(cache(read, [0])(point)).toBeNaN();
  expect(read).toHaveBeenCalledTimes(1);
});

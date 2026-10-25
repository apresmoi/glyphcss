import { expect, it } from "vitest";
import { glideLaw, glideOffset } from "./glide";

const TAU = 220, FLOOR = 0.015;

it("ends exactly where speed reaches the floor, covering the closed-form distance", () => {
  const law = glideLaw(3, -4, TAU, FLOOR)!;
  const speedAtEnd = 5 * Math.exp(-law.duration / TAU);
  expect(speedAtEnd).toBeCloseTo(FLOOR, 12);
  const [x, y] = glideOffset(law, law.duration);
  const reach = TAU * (1 - FLOOR / 5);
  expect(x).toBeCloseTo(3 * reach, 9);
  expect(y).toBeCloseTo(-4 * reach, 9);
  // Time past the end adds nothing: the glide has stopped.
  expect(glideOffset(law, law.duration + 5000)).toEqual([x, y]);
});

it("covers the same offset at a given time however the frames in between fall", () => {
  const law = glideLaw(1.2, 0.4, TAU, FLOOR)!;
  const sum = (times: number[]) => {
    let applied = 0, at = 0;
    for (const t of times) { const [x] = glideOffset(law, t); applied += x - at; at = x; }
    return applied;
  };
  const even = Array.from({ length: 40 }, (_, i) => (i + 1) * 16);
  const ragged = [3, 40, 41, 100, 130, 131, 250, 251, 640].concat([640]);
  const end = [law.duration];
  // Partitions of the same span sum to the same total (the closed form telescopes).
  expect(sum([...even.filter(t => t < 600), 600])).toBeCloseTo(sum([...ragged.filter(t => t < 600), 600]), 9);
  expect(sum([...even, law.duration])).toBeCloseTo(sum(end), 9);
});

it("does not glide from a throw at or under the floor", () => {
  expect(glideLaw(0.01, 0, TAU, FLOOR)).toBeNull();
  expect(glideLaw(FLOOR, 0, TAU, FLOOR)).toBeNull();
});

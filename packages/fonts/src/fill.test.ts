import { describe, it, expect } from "vitest";
import { resolveFace } from "./fill";

// resolveFace's solid / texture / image branches are pure (no <canvas>), so
// they're unit-tested here. The gradient / rainbow branches paint to a canvas
// and are exercised in the browser (the /wordart Playwright runs) instead.
describe("resolveFace", () => {
  it("solid → just a color, no texture", () => {
    expect(resolveFace({ kind: "solid", color: "#ff0000" })).toEqual({ color: "#ff0000" });
  });

  it("texture → url + tile passed straight through (block fill)", () => {
    expect(resolveFace({ kind: "texture", color: "#abcabc", url: "/t/dirt.svg", tile: 50 })).toEqual({
      color: "#abcabc",
      texture: "/t/dirt.svg",
      tile: 50,
    });
  });

  it("image → src becomes the texture, no tile (stretch)", () => {
    const r = resolveFace({ kind: "image", src: "data:image/png;base64,AA" });
    expect(r.texture).toBe("data:image/png;base64,AA");
    expect(r.tile).toBeUndefined();
  });

  it("an empty texture / image source yields no texture", () => {
    expect(resolveFace({ kind: "texture", url: "" }).texture).toBeUndefined();
    expect(resolveFace({ kind: "image", src: "" }).texture).toBeUndefined();
  });
});

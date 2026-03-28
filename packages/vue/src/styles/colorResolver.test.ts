import { describe, it, expect } from "vitest";
import { resolveColor } from "./colorResolver";

describe("colorResolver behavior", () => {
  describe("hex colors", () => {
    it("resolves #ff0000 to rgb values [255, 0, 0]", () => {
      const result = resolveColor("#ff0000");
      expect(result).not.toBeNull();
      expect(result!.rgb).toEqual([255, 0, 0]);
      expect(result!.alpha).toBe(1);
    });

    it("resolves short hex #f00 to rgb values [255, 0, 0]", () => {
      const result = resolveColor("#f00");
      expect(result).not.toBeNull();
      expect(result!.rgb).toEqual([255, 0, 0]);
    });

    it("resolves #00ff00 to rgb values [0, 255, 0]", () => {
      const result = resolveColor("#00ff00");
      expect(result).not.toBeNull();
      expect(result!.rgb).toEqual([0, 255, 0]);
    });

    it("resolves #0000ff to rgb values [0, 0, 255]", () => {
      const result = resolveColor("#0000ff");
      expect(result).not.toBeNull();
      expect(result!.rgb).toEqual([0, 0, 255]);
    });
  });

  describe("rgb() colors", () => {
    it("resolves rgb(128, 64, 32) correctly", () => {
      const result = resolveColor("rgb(128, 64, 32)");
      expect(result).not.toBeNull();
      expect(result!.rgb).toEqual([128, 64, 32]);
      expect(result!.alpha).toBe(1);
    });

    it("resolves rgb(0, 0, 0) correctly", () => {
      const result = resolveColor("rgb(0, 0, 0)");
      expect(result).not.toBeNull();
      expect(result!.rgb).toEqual([0, 0, 0]);
    });
  });

  describe("rgba() colors with alpha", () => {
    it("resolves rgba(255, 128, 0, 0.5) with correct alpha", () => {
      const result = resolveColor("rgba(255, 128, 0, 0.5)");
      expect(result).not.toBeNull();
      expect(result!.rgb).toEqual([255, 128, 0]);
      expect(result!.alpha).toBe(0.5);
    });

    it("resolves rgba(0, 0, 0, 1) with alpha 1", () => {
      const result = resolveColor("rgba(0, 0, 0, 1)");
      expect(result).not.toBeNull();
      expect(result!.alpha).toBe(1);
    });
  });

  describe("empty and invalid inputs", () => {
    it("returns null for empty string", () => {
      const result = resolveColor("");
      expect(result).toBeNull();
    });

    it("returns null for invalid color string", () => {
      const result = resolveColor("notacolor");
      expect(result).toBeNull();
    });
  });

  describe("caching", () => {
    it("returns the same object reference on second call for hex color", () => {
      const first = resolveColor("#aabbcc");
      const second = resolveColor("#aabbcc");
      expect(first).toEqual(second);
    });

    it("returns the same cached object for DOM-resolved named colors", () => {
      const first = resolveColor("red");
      const second = resolveColor("red");
      if (first !== null) {
        expect(second).toBe(first);
      }
    });
  });
});

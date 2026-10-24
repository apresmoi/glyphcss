import { expect, it } from "vitest";
import { injectGlyphBaseStyles } from "./styles";

it("injects cheap fixed-cell shaping without sizing or containing the intrinsic output box", () => {
  const doc = document.implementation.createHTMLDocument("");
  injectGlyphBaseStyles(doc);
  const css = doc.getElementById("glyph-styles")!.textContent!;
  const output = /\.glyph-scene \.glyph-output\s*{([^}]+)}/.exec(css)![1]!;
  for (const declaration of ["font-variant-ligatures: none", "font-kerning: none", "font-feature-settings: normal", "text-rendering: optimizeSpeed"]) {
    expect(output).toContain(declaration);
  }
  expect(output).toContain("display: inline-block");
  expect(output).toContain("white-space: pre");
  expect(output).not.toMatch(/(?:^|;)\s*(?:width|height|letter-spacing|contain)\s*:/);
});

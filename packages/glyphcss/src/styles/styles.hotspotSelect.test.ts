/**
 * `.glyph-hotspot` must default to non-selectable text, for the same reason
 * `.glyph-output` does (its comment, verbatim: "dragging orbits the camera
 * instead of highlighting glyphs") — a hotspot label sits above the drag
 * surface with `pointer-events: all`, so without this rule dragging a
 * hotspot's label selects its text instead of orbiting the camera.
 */
import { describe, expect, it } from "vitest";
import { injectGlyphBaseStyles } from "./styles";

const GLYPH_STYLE_ID = "glyph-styles";

function injectedCss(): string {
  const doc = document.implementation.createHTMLDocument("");
  injectGlyphBaseStyles(doc);
  const style = doc.getElementById(GLYPH_STYLE_ID);
  expect(style).not.toBeNull();
  return style!.textContent ?? "";
}

describe("glyph-hotspot user-select", () => {
  it("matches .glyph-output's non-selectable default and opt-in escape", () => {
    const css = injectedCss();

    // .glyph-output's existing policy (the reference this mirrors).
    expect(css).toMatch(/\.glyph-output\s*{[^}]*user-select:\s*none/);
    expect(css).toMatch(/\.glyph-output\s*{[^}]*-webkit-user-select:\s*none/);
    expect(css).toMatch(/\.glyph-output\.glyph-selectable\s*{[^}]*user-select:\s*text/);

    // .glyph-hotspot must carry the same default and the same opt-in escape.
    expect(css).toMatch(/\.glyph-scene \.glyph-hotspot\s*{[^}]*user-select:\s*none/);
    expect(css).toMatch(/\.glyph-scene \.glyph-hotspot\s*{[^}]*-webkit-user-select:\s*none/);
    expect(css).toMatch(/\.glyph-scene \.glyph-hotspot\.glyph-selectable\s*{[^}]*user-select:\s*text/);
    expect(css).toMatch(/\.glyph-scene \.glyph-hotspot\.glyph-selectable\s*{[^}]*-webkit-user-select:\s*text/);

    // pointer-events stays "all" — hotspots must remain clickable; only
    // selection is disabled.
    expect(css).toMatch(/\.glyph-scene \.glyph-hotspot\s*{[^}]*pointer-events:\s*all/);
  });
});

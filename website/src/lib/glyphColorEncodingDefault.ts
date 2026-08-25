/**
 * The website's default `colorEncoding`, feature-detected — one implementation
 * every page that exposes the control shares.
 *
 * **The LIBRARY default stays `"spans"`.** `glyphcss` is byte-identical for an
 * external consumer who never opts in, and nothing here changes that; this is
 * a site-level preference, not an API change.
 *
 * ── What is detected, and what deliberately is not ──────────────────────
 *
 * `CSS.supports("font-palette", "--x")` — the atlas needs `font-palette` to
 * accept a custom palette IDENT, because that is how a scene's own
 * `@font-palette-values`/`override-colors` block recolours the render;
 * `font-palette: normal | light | dark` alone would leave every cell painted
 * in the font's baked CPAL hue ramp. Testing the dashed-ident form covers both
 * the property and the value type in one call. No user-agent sniffing: the
 * spike verified Chrome only, and the point of detecting is to stop guessing.
 *
 * This is a SYNCHRONOUS check on purpose. The default has to be decided before
 * the first render so the scene hydrates with a stable value and the URL
 * codecs see a settled state — an async probe cannot do that without either
 * delaying first paint or flipping the control under the user.
 *
 * It is knowingly incomplete: parsing `font-palette` is not the same as
 * PAINTING COLR/CPAL, and the atlas's base glyphs are empty outlines, so a
 * COLR-blind engine renders blanks rather than anything obviously wrong. That
 * gap is closed one layer down instead, at the only place that can close it:
 * `glyphcss`'s own `ensureGlyphAtlasFontFaceStyles` rasterizes a real atlas
 * code point to a canvas and refuses to encode PUA unless the result is
 * chromatic. So a browser that passes this check but cannot paint COLR still
 * renders correct spans — it just took the scenic route to get there.
 *
 * Where support is missing, the default is `"spans"` and the control stays
 * ENABLED: the user can still switch to atlas and see for themselves. This is
 * a default, not a lockout.
 */
export type GlyphColorEncodingChoice = "spans" | "atlas";

/** Whether this engine parses `font-palette: <dashed-ident>`. Cheap, but cached — pages call it during render. */
let supported: boolean | undefined;

export function supportsGlyphFontPalette(): boolean {
  if (supported !== undefined) return supported;
  supported =
    typeof CSS !== "undefined" &&
    typeof CSS.supports === "function" &&
    CSS.supports("font-palette", "--x");
  return supported;
}

/**
 * The encoding a page should start on when its URL carries no explicit choice.
 * An explicit `?…colorEncoding=…` value always wins over this — callers pass
 * it as the FALLBACK, never as an override.
 */
export function defaultGlyphColorEncoding(): GlyphColorEncodingChoice {
  return supportsGlyphFontPalette() ? "atlas" : "spans";
}

/** Test seam — clears the memoized `CSS.supports` answer. */
export function resetGlyphFontPaletteSupportForTests(): void {
  supported = undefined;
}

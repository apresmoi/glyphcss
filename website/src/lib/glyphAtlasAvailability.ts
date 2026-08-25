/**
 * Shared "can this scene actually use `colorEncoding: 'atlas'`?" check for
 * every page that exposes the atlas toggle (`/synth`, `/wordart`, `/gallery`,
 * the wired `/examples/*` pages). One implementation, reused everywhere, so
 * the disabled-state tooltip's reason can never drift into a wrong guess the
 * way the static-export button's did (see `packages/effects/src/staticExport.ts`'s
 * `glyphFieldSynthStaticExportUnsupportedReason` for that precedent) — the
 * structural checks below quote AGENTS.md's documented `colorEncoding` no-op
 * list verbatim, and the residual, content-dependent check uses `glyphcss`'s
 * own exported `isGlyphInFontAtlas` against the actually-rendered glyphs,
 * never a hand-maintained mirror of its rules.
 *
 * ── The palette is no longer this file's problem ────────────────────────
 *
 * This used to derive a palette by scraping the `<pre>`'s per-cell colours,
 * and to report "more than 31 distinct colors" as an unavailability reason.
 * Both are gone. glyphcss quantizes: `createGlyphScene` derives and pools its
 * own ≤31-slot palette (`render/paletteQuantize.ts`) from the real cell
 * buffers, which it can see and this cannot. Colour COUNT is therefore no
 * longer a reason for anything, and reporting it as one was the single thing
 * keeping the control disabled on almost every page that ships.
 *
 * What is left is a purely structural question plus one content check —
 * whether every rendered GLYPH has an outline in the checked-in atlas — and
 * that check needs no colours at all. It reads `pre.textContent` through
 * `decodeGlyphAtlasText`, which round-trips already-atlas-encoded PUA back to
 * plain glyphs and passes anything else through untouched. So it gives the
 * same answer whether the scene is currently rendering spans or atlas output,
 * and the old "freeze the last known-good result once atlas is on" dance —
 * forced by the fact that PUA text carries no readable per-cell colour — is
 * no longer needed either.
 */
import { decodeGlyphAtlasText, isGlyphInFontAtlas } from "glyphcss";

export interface GlyphAtlasAvailability {
  /** `null` when available; otherwise the real, user-facing reason it's not. */
  reason: string | null;
}

export interface GlyphAtlasGateInputs {
  /** `colorEncoding: "atlas"` is a documented no-op when colors are off. */
  useColors: boolean;
  /** Only `"ascii"` is in the atlas's glyph-set scope (AGENTS.md). */
  charMode: "ascii" | "braille" | "halfblock" | "quadrant";
  /** Semantic output is a documented `colorEncoding` no-op. */
  glyphOutput?: "visible" | "semantic";
  /** An active `solidWeightRamp` selection is a documented `colorEncoding` no-op. */
  solidWeightRampActive?: boolean;
}

const UNAVAILABLE = (reason: string): GlyphAtlasAvailability => ({ reason });

/**
 * Real availability check, run against the currently rendered stage `<pre>`.
 * Structural gates short-circuit first (cheap, and they're the same reasons
 * the encoder would refuse internally); the residual content gate asks only
 * whether the render's glyphs are in the atlas.
 */
export function computeGlyphAtlasAvailability(
  pre: HTMLElement | null,
  gate: GlyphAtlasGateInputs,
): GlyphAtlasAvailability {
  if (!gate.useColors) return UNAVAILABLE("Atlas color encoding needs colors on (useColors is off).");
  if (gate.charMode !== "ascii") {
    return UNAVAILABLE(`Atlas color encoding only covers the "ascii" character mode (current: "${gate.charMode}").`);
  }
  if (gate.glyphOutput === "semantic") {
    return UNAVAILABLE("Atlas color encoding doesn't support semantic glyph output.");
  }
  if (gate.solidWeightRampActive) {
    return UNAVAILABLE("Atlas color encoding doesn't support an active solid weight ramp.");
  }
  if (!pre) return UNAVAILABLE("Nothing rendered yet.");

  const text = decodeGlyphAtlasText(pre.textContent ?? "");
  if (text.trim().length === 0) return UNAVAILABLE("Nothing rendered yet.");

  for (const ch of text) {
    if (ch === " " || ch === "\n") continue;
    if (!isGlyphInFontAtlas(ch)) {
      return UNAVAILABLE(`Atlas color encoding doesn't cover this render's "${ch}" glyph.`);
    }
  }
  return { reason: null };
}

import { resolveCharset, type GlyphDiagram3dCharset, type GlyphDiagram3dColorMode } from "@glyphcss/diagrams/3d";
import type { GlyphCanvasTierName, RenderMode } from "glyphcss";

/**
 * Fix round 1, P1-1 — the live web 3D viewport must honour the SAME
 * target × charset × colour choices the static `renderGlyphDiagram3d`
 * frame does, and must REUSE the library's own charset -> render-mode
 * mapping (`resolveCharset`, exported from `@glyphcss/diagrams/3d` for
 * exactly this) rather than duplicating it. `Diagrams3DViewport.tsx` is
 * the only consumer; this file exists so the mapping is a pure function
 * with its own cheap, exhaustive test (`diagrams3dSceneOptions.test.ts`)
 * instead of logic buried inside a `useEffect`.
 *
 * Fix round 2, P1-1 — `resolveCharset`'s FULL result rides through here,
 * not just `mode`/`charMode`: `canvasTier`/`boxOutline` are what
 * `glyphDiagramObject` needs to build the SAME overlay (box outlines, the
 * braille-degrade wireframe) the static frame's object carries. Round 1
 * forwarded only the scene-level render options and left the live
 * viewport's OBJECT itself built from whatever charset the mount effect's
 * `renderGlyphDiagram3d` call happened to default to — this is the single
 * resolved-options shape both the object build AND `scene.setOptions` read,
 * so the two can never drift apart again.
 *
 * `useColors` is `color !== "none"` — a live DOM scene has no ANSI colour
 * DEPTH concept (that is a property of the TEXT export, `encodeGlyphCanvasAnsi`'s
 * own `colors: "16" | "256" | "truecolor"`), so `ansi16`/`ansi256`/`truecolor`/
 * `css` are all identically "colour on" here; a chrome NOTE says so rather
 * than the live picture silently ignoring the reader's ANSI-depth choice
 * with no explanation (AGENTS.md's "Targets and page": faithful downgrade,
 * never silent).
 */
export interface Diagrams3dSceneOptions {
  readonly mode: RenderMode;
  readonly charMode: "ascii" | "braille";
  /** `glyphDiagramObject`'s own `tier` option — the same overlay glyph table the static frame's object is built with. */
  readonly canvasTier: GlyphCanvasTierName;
  /** `glyphDiagramObject`'s own `boxOutline` option. */
  readonly boxOutline: boolean;
  /**
   * `resolveCharset`'s own `hiddenLines` — `"hide"` throughout the default
   * (ink) and wireframe styles (AGENTS.md's "Diagrams 3D": an occluded
   * object or back edge disappears rather than drawing through it). Must
   * reach `scene.setOptions` the SAME way `mode`/`charMode` do, or the live
   * scene keeps whatever `hiddenLines` it mounted with regardless of what
   * `resolveCharset` now says — live output would then diverge from
   * `renderGlyphDiagram3d`'s own static frame, which always reads it fresh.
   */
  readonly hiddenLines: "show" | "hide";
  readonly useColors: boolean;
  /** Present exactly when some requested choice can't be shown live as requested — chrome text, never a rendering decision. */
  readonly note?: string;
}

const LIVE_COLOR_DEPTH_NOTE = "Live 3D always renders full colour — the ANSI colour depth only affects Copy ANSI's exported text, not this view.";

/**
 * Fix round 4 — the reader-facing DIMMING reason for a Dock Charset option,
 * used by `DiagramsDock.tsx`'s `IconToggle` options (the `mapDirectionLocked`
 * idiom: the control stays visible, disabled, with a short plain-English
 * reason on its title/aria-label). Deliberately word-generic ("not available
 * yet") rather than naming what degrades or what it degrades TO — the
 * library is being redesigned so braille/ink become the PRIMARY 3D looks,
 * so a wording tied to today's specific downgrade (wireframe/ascii) would go
 * stale the moment that lands. The GATE itself is resolver-driven, never a
 * hard-coded charset list: it is simply "does `resolveCharset` need a ledger
 * entry for this charset AT ALL", so a future charset that resolves cleanly
 * dims nothing with no page-side edit.
 */
const DIAGRAMS_3D_CHARSET_DOCK_REASON = "Not available for 3D diagrams yet";

/**
 * Fix round 4 — the reader-facing DIMMING reason for a Dock Color option.
 * A live DOM scene has no ANSI colour DEPTH axis at all (see this module's
 * own top-of-file doc), so this is inherent to what a live scene even is,
 * not a per-value editorial judgement — mirrors the SAME `color === "ansi16"
 * || color === "ansi256"` test `resolveDiagrams3dSceneOptions` itself uses
 * for its own note, so the Dock and the viewport agree by construction.
 */
const DIAGRAMS_3D_COLOR_DEPTH_DOCK_REASON = "Live 3D always shows full colour — this only affects Copy ANSI's exported text";

/** `undefined` when the live 3D view draws this charset exactly as requested. */
export function diagrams3dCharsetDockReason(charset: GlyphDiagram3dCharset): string | undefined {
  return resolveCharset(charset).ledger.length > 0 ? DIAGRAMS_3D_CHARSET_DOCK_REASON : undefined;
}

/** `undefined` when this colour mode carries no ANSI-depth distinction the live view can't express. */
export function diagrams3dColorDockReason(color: GlyphDiagram3dColorMode): string | undefined {
  return color === "ansi16" || color === "ansi256" ? DIAGRAMS_3D_COLOR_DEPTH_DOCK_REASON : undefined;
}

export function resolveDiagrams3dSceneOptions(charset: GlyphDiagram3dCharset, color: GlyphDiagram3dColorMode): Diagrams3dSceneOptions {
  const { mode, charMode, canvasTier, boxOutline, hiddenLines, ledger } = resolveCharset(charset);
  const notes = ledger.map((entry) => entry.message);
  if (diagrams3dColorDockReason(color)) notes.push(LIVE_COLOR_DEPTH_NOTE);
  return { mode, charMode, canvasTier, boxOutline, hiddenLines, useColors: color !== "none", ...(notes.length > 0 ? { note: notes.join(" ") } : {}) };
}

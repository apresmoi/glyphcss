import { resolveCharset, type GlyphDiagram3dCharset, type GlyphDiagram3dColorMode } from "@glyphcss/diagrams/3d";
import type { RenderMode } from "glyphcss";

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
  readonly useColors: boolean;
  /** Present exactly when some requested choice can't be shown live as requested — chrome text, never a rendering decision. */
  readonly note?: string;
}

const LIVE_COLOR_DEPTH_NOTE = "Live 3D always renders full colour — the ANSI colour depth only affects Copy ANSI's exported text, not this view.";

export function resolveDiagrams3dSceneOptions(charset: GlyphDiagram3dCharset, color: GlyphDiagram3dColorMode): Diagrams3dSceneOptions {
  const { mode, charMode, ledger } = resolveCharset(charset);
  const notes = ledger.map((entry) => entry.message);
  if (color === "ansi16" || color === "ansi256") notes.push(LIVE_COLOR_DEPTH_NOTE);
  return { mode, charMode, useColors: color !== "none", ...(notes.length > 0 ? { note: notes.join(" ") } : {}) };
}

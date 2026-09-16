import { resolveCharset, type GlyphDiagram3dCharset, type GlyphDiagram3dColorMode, type GlyphDiagram3dTarget } from "@glyphcss/diagrams/3d";
import type { RenderMode } from "glyphcss";

/**
 * D2 round 7 — the live web 3D viewport must honour the SAME target x
 * charset x colour choices the static `renderGlyphDiagram3d` frame does,
 * and must REUSE the library's own charset -> render-mode mapping
 * (`resolveCharset`, exported from `@glyphcss/diagrams/3d` for exactly
 * this) rather than duplicating it. `Diagrams3DViewport.tsx` is the only
 * consumer; this file exists so the mapping is a pure function with its
 * own cheap, exhaustive test (`diagrams3dSceneOptions.test.ts`) instead of
 * logic buried inside a `useEffect`.
 *
 * Round 7's own charset redesign (braille/blocks only — AGENTS.md's
 * "Diagrams 3D") dropped `resolveCharset`'s `canvasTier`/`boxOutline`
 * fields entirely: box outlines and edges are now real MESH geometry
 * (`glyphDiagramObject`'s own top-of-file doc), built once regardless of
 * charset, so there is no more per-charset overlay tier for this module to
 * forward — `mode`/`charMode`/`hiddenLines` alone fully describe how the
 * SAME mounted object should be rasterized.
 *
 * `resolveCharset` now also takes the render TARGET (`"chat" | "terminal" |
 * "web"`) — `chat` degrades `ascii`/`box` to `blocks`, everywhere else to
 * `braille` — so this module's own `target` forwards straight through
 * rather than being a second, drifting copy of that table.
 *
 * `useColors` is `color !== "none"` — a live DOM scene has no ANSI colour
 * DEPTH concept (that is a property of the TEXT export, `encodeGlyphCanvasAnsi`'s
 * own `colors: "16" | "256" | "truecolor"`), so `ansi16`/`ansi256`/`truecolor`/
 * `css` are all identically "colour on" here; a chrome NOTE says so rather
 * than the live picture silently ignoring the reader's ANSI-depth choice
 * with no explanation (AGENTS.md's "Targets and page": faithful downgrade,
 * never silent). The "blocks" charset additionally has NO ANSI colour form
 * at all (`AGENTS.md`'s "Render modes" — `encodeGlyphBuffersDual` emits
 * `<span>` markup or plain text only), so an ANSI colour depth under
 * `charset: "blocks"` gets its own, more specific note.
 */
export interface Diagrams3dSceneOptions {
  readonly mode: RenderMode;
  readonly charMode: "braille" | "halfblock";
  /**
   * `resolveCharset`'s own `hiddenLines` — `"hide"` throughout (an
   * occluded object or back edge disappears rather than drawing through
   * it). Must reach `scene.setOptions` the SAME way `mode`/`charMode` do,
   * or the live scene keeps whatever `hiddenLines` it mounted with
   * regardless of what `resolveCharset` now says — live output would then
   * diverge from `renderGlyphDiagram3d`'s own static frame, which always
   * reads it fresh.
   */
  readonly hiddenLines: "show" | "hide";
  readonly useColors: boolean;
  /** Present exactly when some requested choice can't be shown live as requested — chrome text, never a rendering decision. */
  readonly note?: string;
}

const LIVE_COLOR_DEPTH_NOTE = "Live 3D always renders full colour — the ANSI colour depth only affects Copy ANSI's exported text, not this view.";
const LIVE_BLOCKS_ANSI_NOTE = "Blocks has no ANSI colour form — Copy ANSI exports plain text for it (AGENTS.md's own Render modes contract).";

/**
 * The reader-facing DIMMING reason for a Dock Charset option, used by
 * `DiagramsDock.tsx`'s `IconToggle` options (the `mapDirectionLocked`
 * idiom: the control stays visible, disabled, with a short plain-English
 * reason on its title/aria-label). Round 7 flips the old gate outright —
 * `braille`/`blocks` are now the PRIMARY, always-available 3D looks, and
 * only `ascii`/`box` degrade (box-drawing/bar glyphs can't trace an edge or
 * a box face at an angle, the user's own stated reason) — resolver-driven,
 * never a hard-coded charset list: it is simply "does `resolveCharset` need
 * a ledger entry for this charset AT ALL" for the given target.
 */
const DIAGRAMS_3D_CHARSET_DOCK_REASON = "3D diagrams render only through braille or blocks — box-drawing glyphs can't trace an edge or a box face at an angle";

/**
 * The reader-facing DIMMING reason for a Dock Color option. A live DOM
 * scene has no ANSI colour DEPTH axis at all (see this module's own
 * top-of-file doc), so this is inherent to what a live scene even is, not
 * a per-value editorial judgement — mirrors the SAME
 * `color === "ansi16" || color === "ansi256"` test
 * `resolveDiagrams3dSceneOptions` itself uses for its own note, so the
 * Dock and the viewport agree by construction.
 */
const DIAGRAMS_3D_COLOR_DEPTH_DOCK_REASON = "Live 3D always shows full colour — this only affects Copy ANSI's exported text";

/** `undefined` when the live 3D view draws this charset (at this target) exactly as requested. */
export function diagrams3dCharsetDockReason(charset: GlyphDiagram3dCharset, target: GlyphDiagram3dTarget): string | undefined {
  return resolveCharset(charset, target).ledger.length > 0 ? DIAGRAMS_3D_CHARSET_DOCK_REASON : undefined;
}

/** `undefined` when this colour mode carries no ANSI-depth distinction the live view can't express. */
export function diagrams3dColorDockReason(color: GlyphDiagram3dColorMode): string | undefined {
  return color === "ansi16" || color === "ansi256" ? DIAGRAMS_3D_COLOR_DEPTH_DOCK_REASON : undefined;
}

export function resolveDiagrams3dSceneOptions(charset: GlyphDiagram3dCharset, color: GlyphDiagram3dColorMode, target: GlyphDiagram3dTarget): Diagrams3dSceneOptions {
  const { mode, charMode, hiddenLines, ledger } = resolveCharset(charset, target);
  const notes = ledger.map((entry) => entry.message);
  if (diagrams3dColorDockReason(color)) notes.push(LIVE_COLOR_DEPTH_NOTE);
  if (charMode === "halfblock" && (color === "ansi16" || color === "ansi256" || color === "truecolor")) notes.push(LIVE_BLOCKS_ANSI_NOTE);
  return {
    mode, charMode: charMode === "quadrant" ? "halfblock" : charMode, hiddenLines,
    useColors: color !== "none", ...(notes.length > 0 ? { note: notes.join(" ") } : {}),
  };
}

/**
 * `createGlyphOrbitControls`'s own `zoomRange` auto-derive factor
 * (mirrors `chartsWorkbench3d.ts`'s `charts3dZoomRange`/
 * `CHARTS_3D_ZOOM_RANGE_FACTOR`) — an EXPLICIT range around the mounted
 * camera's own fitted zoom, so `Diagrams3DViewport.tsx` need not rely on
 * the library's mount-time auto-derive alone (which special-cases the
 * library's own `0.65` default zoom to keep the historical `[0.1, 500]`
 * clamp, a value a fitted diagram's own camera can legitimately land on
 * too — an EXPLICIT range is deterministic regardless).
 */
const DIAGRAMS_3D_ZOOM_RANGE_FACTOR = 64;
export function diagrams3dZoomRange(zoom: number): [number, number] {
  const z = Math.abs(zoom) || 1;
  return [z / DIAGRAMS_3D_ZOOM_RANGE_FACTOR, z * DIAGRAMS_3D_ZOOM_RANGE_FACTOR];
}

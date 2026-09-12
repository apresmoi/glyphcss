/**
 * Cell-canvas string encoders. Three separate exits, deliberately not one
 * function with a mode flag:
 *
 * - {@link encodeGlyphCanvasText} — raw text, literal `< > &`. A consumer
 *   piping into a terminal or a plain-text chat message must never see HTML
 *   entities; escaping here would corrupt the very characters it's asking for.
 * - {@link encodeGlyphCanvasHtml} — the opposite contract: escapes `< > &`
 *   itself (a canvas fill glyph is never `<`, but a `text()` label can carry
 *   arbitrary user content), and additionally carries `background-color` —
 *   a channel `encodeCellGrid`/`encodeGlyphBuffers` (`cells.ts`) don't have,
 *   because a rasterized 3D scene has no per-cell `bg` concept. Phase 0 emits
 *   spans ONLY (see the function doc for why the earlier atlas-delegation
 *   optimization was removed).
 * - {@link encodeGlyphCanvasAnsi} — terminal SGR, its own colour-channel
 *   downgrade ladder (16/256/truecolor) with no shared code path to the
 *   other two, since ANSI is the only exit that needs a colour distance
 *   metric at all.
 *
 * Keeping these three independent (rather than a shared "encode cell" with
 * per-format callbacks) is what lets each one state its own escaping/colour
 * contract as a type-level fact instead of a runtime option a caller could
 * get wrong. Every colour reaching this module has already been validated as
 * canonical `#rrggbb` by the PAINTER that wrote it (`canvas.ts`'s
 * `assertCanvasColor`) — these encoders never re-validate and never see an
 * attacker- or typo-supplied colour string.
 */

import { nearestPaletteIndex, packHexColor } from "../paletteQuantize";
import type { GlyphCanvas } from "./canvas";

/** Plain text, one row per line, `"\n"`-joined. No escaping of any kind. */
export function encodeGlyphCanvasText(canvas: GlyphCanvas): string {
  const { cols, rows, char } = canvas.grid;
  const lines: string[] = [];
  for (let r = 0; r < rows; r++) {
    lines.push(char.slice(r * cols, (r + 1) * cols).join(""));
  }
  return lines.join("\n");
}

// ── ANSI ─────────────────────────────────────────────────────────────────

export type GlyphCanvasAnsiColorMode = "16" | "256" | "truecolor";

export interface GlyphCanvasAnsiOptions {
  readonly colors: GlyphCanvasAnsiColorMode;
  /**
   * `NO_COLOR`/`FORCE_COLOR` are read ONLY from here, never from
   * `process.env` — this module has no Node dependency and must behave
   * identically in a browser, a worker, or a test sandbox with a fabricated
   * environment.
   */
  readonly env?: Readonly<Record<string, string | undefined>>;
}

const ANSI_RESET = "\x1b[0m";

// The standard 16-colour xterm/ANSI palette, in SGR order: index 0-7 map to
// 3x/4x, 8-15 to 9x/10x (the "bright" set) — see `ansiCodesFor16`.
const ANSI_16_RGB: readonly number[] = [
  0x000000, 0x800000, 0x008000, 0x808000, 0x000080, 0x800080, 0x008080, 0xc0c0c0,
  0x808080, 0xff0000, 0x00ff00, 0xffff00, 0x0000ff, 0xff00ff, 0x00ffff, 0xffffff,
];

// The standard 256-colour xterm palette: the same 16 above, then a 6x6x6
// colour cube, then a 24-step greyscale ramp — the well-known layout every
// terminal emulator's `38;5;n`/`48;5;n` already assumes.
const ANSI_256_RGB: readonly number[] = (() => {
  const table = ANSI_16_RGB.slice();
  const levels = [0, 95, 135, 175, 215, 255];
  for (let r = 0; r < 6; r++) {
    for (let g = 0; g < 6; g++) {
      for (let b = 0; b < 6; b++) {
        table.push((levels[r]! << 16) | (levels[g]! << 8) | levels[b]!);
      }
    }
  }
  for (let i = 0; i < 24; i++) {
    const v = 8 + 10 * i;
    table.push((v << 16) | (v << 8) | v);
  }
  return table;
})();

// `packHexColor` returns `undefined` only for a non-canonical string, which
// cannot reach this module: every colour in `grid.color`/`canvas.bg` was
// already validated as canonical lowercase `#rrggbb` by the painter that
// wrote it (`canvas.ts`'s `assertCanvasColor`), so the non-null assertion
// below is a proof, not a guess — a defensive `?? 0` fallback here would be
// dead code for an input that cannot occur, silently mapping a real bug
// (a colour reaching this module some other way) to black instead of
// surfacing it.
function packValidatedHexColor(hex: string): number {
  return packHexColor(hex)!;
}

function ansi16Index(hex: string): number {
  return nearestPaletteIndex(ANSI_16_RGB, packValidatedHexColor(hex));
}

function ansi256Index(hex: string): number {
  return nearestPaletteIndex(ANSI_256_RGB, packValidatedHexColor(hex));
}

function truecolorTriplet(hex: string): [number, number, number] {
  const packed = packValidatedHexColor(hex);
  return [(packed >> 16) & 0xff, (packed >> 8) & 0xff, packed & 0xff];
}

/** SGR codes for one channel (fg or bg) at the requested colour depth. */
function colorCodes(mode: GlyphCanvasAnsiColorMode, hex: string, isBg: boolean): number[] {
  if (mode === "16") {
    const index = ansi16Index(hex);
    const base = index < 8 ? (isBg ? 40 : 30) : (isBg ? 100 : 90);
    return [base + (index < 8 ? index : index - 8)];
  }
  if (mode === "256") {
    return [isBg ? 48 : 38, 5, ansi256Index(hex)];
  }
  const [r, g, b] = truecolorTriplet(hex);
  return [isBg ? 48 : 38, 2, r, g, b];
}

/**
 * A NON-EMPTY value counts; an unset OR empty-string value does not — per
 * <https://no-color.org/> and <https://force-color.org/>, both of which key
 * on the variable's mere (non-empty) presence, not its contents. `"0"` is
 * therefore just as "set" as `"1"` for either variable at this phase-0
 * layer: there is no numeric level parsing here (no `FORCE_COLOR=2` colour-
 * depth semantics), only "is colour forced/suppressed at all."
 */
function isEnvFlagSet(value: string | undefined): boolean {
  return value !== undefined && value !== "";
}

/**
 * Encode as ANSI SGR text: fg AND bg per run, `colors` bounding which escape
 * families may appear (`"16"` only `3x/4x/9x/10x`, `"256"` only `38;5`/
 * `48;5`, `"truecolor"` only `38;2`/`48;2`), downgrading every colour to the
 * nearest palette entry by redmean distance for `"16"`/`"256"`. `NO_COLOR`
 * disables colour entirely (falls back to `encodeGlyphCanvasText`'s bytes,
 * still no HTML escaping — this is a terminal exit); `FORCE_COLOR` (any
 * non-empty value) overrides `NO_COLOR`, matching both specs' documented
 * precedence. A reset (`\x1b[0m`) closes every coloured run AND
 * unconditionally ends every line, so a truncated read (a pager killed
 * mid-stream) can never leave a terminal's colour state stuck.
 */
export function encodeGlyphCanvasAnsi(canvas: GlyphCanvas, opts: GlyphCanvasAnsiOptions): string {
  const env = opts.env ?? {};
  const forceColor = isEnvFlagSet(env.FORCE_COLOR);
  const noColor = isEnvFlagSet(env.NO_COLOR);
  const colorsEnabled = forceColor || !noColor;
  if (!colorsEnabled) return encodeGlyphCanvasText(canvas);

  const { cols, rows, char, color } = canvas.grid;
  const bg = canvas.bg;
  const lines: string[] = [];
  for (let r = 0; r < rows; r++) {
    let line = "";
    let runFg: string | null = null;
    let runBg: string | null = null;
    let runText = "";
    const flush = () => {
      if (!runText) return;
      if (runFg !== null || runBg !== null) {
        const codes = [
          ...(runFg !== null ? colorCodes(opts.colors, runFg, false) : []),
          ...(runBg !== null ? colorCodes(opts.colors, runBg, true) : []),
        ];
        line += `\x1b[${codes.join(";")}m${runText}${ANSI_RESET}`;
      } else {
        line += runText;
      }
      runText = "";
    };
    for (let c = 0; c < cols; c++) {
      const idx = r * cols + c;
      const glyph = char[idx]!;
      // A space's FOREGROUND colour is meaningless (there is no ink to tint)
      // and is suppressed — but its BACKGROUND is exactly what makes a
      // blank cell a coloured cell (a shaded band, a legend swatch), so `bg`
      // is read unconditionally, independent of what glyph occupies the
      // cell. Suppressing both on a space (the previous behaviour) silently
      // discarded every background painted under blank space.
      const fg = glyph === " " ? null : color[idx] ?? null;
      const bgc = bg[idx] ?? null;
      if (fg !== runFg || bgc !== runBg) {
        flush();
        runFg = fg;
        runBg = bgc;
      }
      runText += glyph;
    }
    flush();
    line += ANSI_RESET;
    lines.push(line);
  }
  return lines.join("\n");
}

// ── HTML ─────────────────────────────────────────────────────────────────

function escapeCanvasHtml(glyph: string): string {
  if (glyph === "&") return "&amp;";
  if (glyph === "<") return "&lt;";
  if (glyph === ">") return "&gt;";
  return glyph;
}

/**
 * Encode for `innerHTML`. Escapes `< > &` itself (never delegates escaping
 * to `cells.ts`, which has no reason to export it) and emits `color` +
 * `background-color` per run.
 *
 * Phase 0 emits SPANS ONLY — an earlier version conditionally delegated to
 * the existing colour-font-atlas encoder (`encodeCellGridAtlas`) whenever
 * every glyph was atlas-covered and no cell had a `bg`, for a zero-`<span>`
 * result. That path was broken in a way spans-only avoids by construction:
 * the atlas encoder emits PUA code points keyed to a palette it builds and
 * then discards, so the caller received text with no way to recover which
 * colour each code point meant, and — because box-drawing glyphs (a chart's
 * axes and rules) ARE atlas-covered — it fired on the common case, not an
 * edge case. Reinstating it correctly needs the same thing
 * `encodeCellGridOutput` (`cells.ts`) already does for a 3D scene: return
 * `{ text, encoding, palette }` so the caller can actually render the
 * result (the right `font-family`/`@font-palette-values` CSS), which is
 * bindings/CSS surface a later phase can add deliberately rather than a
 * silent "sometimes atlas, sometimes spans" toggle a caller cannot detect.
 */
export function encodeGlyphCanvasHtml(canvas: GlyphCanvas): string {
  const { cols, rows, char, color } = canvas.grid;
  const bg = canvas.bg;
  const lines: string[] = [];
  for (let r = 0; r < rows; r++) {
    let line = "";
    let runFg: string | null = null;
    let runBg: string | null = null;
    let runText = "";
    const flush = () => {
      if (!runText) return;
      if (runFg !== null || runBg !== null) {
        const style = runFg !== null && runBg !== null
          ? `color:${runFg};background-color:${runBg}`
          : runFg !== null
            ? `color:${runFg}`
            : `background-color:${runBg}`;
        line += `<span style="${style}">${runText}</span>`;
      } else {
        line += runText;
      }
      runText = "";
    };
    for (let c = 0; c < cols; c++) {
      const idx = r * cols + c;
      const glyph = char[idx]!;
      // See the matching comment in `encodeGlyphCanvasAnsi`: `bg` is read
      // unconditionally, independent of the glyph occupying the cell.
      const fg = glyph === " " ? null : color[idx] ?? null;
      const bgc = bg[idx] ?? null;
      if (fg !== runFg || bgc !== runBg) {
        flush();
        runFg = fg;
        runBg = bgc;
      }
      runText += escapeCanvasHtml(glyph);
    }
    flush();
    lines.push(line);
  }
  return lines.join("\n");
}

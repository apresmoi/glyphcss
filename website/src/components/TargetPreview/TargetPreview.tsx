import { forwardRef, useMemo, type CSSProperties } from "react";
import { ansiSpansToHtml, parseAnsiToSpans } from "./ansiToSpans";
import styles from "./TargetPreview.module.css";

/**
 * `TargetPreview` — one component, shared by `/charts` and `/diagrams`
 * (packet item 3): the visible frame changes shape per render target, on
 * top of the SAME `<pre class="glyph-output">` content node both pages
 * already used, so "Copy ASCII"/"Copy ANSI"/"Download SVG" (which reads
 * that exact node — `website/src/lib/glyphSvgExport.ts`) keep working
 * unchanged regardless of which frame wraps it.
 *
 * - `web`: the `<pre>` as it always rendered — Glyph Mono, no chrome.
 *   `isHtml`/`html` wins whenever present (CHARTS-RESEARCH
 *   `REVIEW-batch4-codex.md` P1-3): at Density's own `textScale > 1`,
 *   `chartsWorkbenchRender.ts` now rebuilds `html` for EVERY colour mode
 *   (stripped for `none`, requantized to the ANSI palette for
 *   `ansi16`/`ansi256`, used as-is for `truecolor`/`css`) purely to carry
 *   the `.glyph-text` scaled-text markup an ANSI/plain decode has no way
 *   to express, so text keeps its size under Density regardless of colour
 *   mode. At `textScale === 1` (density 1, the library's own default) a
 *   non-`css` render carries no `html` at all, same as before, and falls
 *   through to the ANSI decode below — CHARTS-RESEARCH
 *   `DIAGNOSIS-target-matrix.md` C1: the SAME `ansiToSpans` decode
 *   `terminal` already used for `ansi16`/`ansi256`/`truecolor` (a browser
 *   has no ANSI decoder of its own). `color: "none"`/`"css"` at density 1
 *   render byte-identically to before either fix existed.
 * - `terminal`: a terminal-window frame (dark chrome + title bar showing
 *   the command a real CLI call would use) around the SGR string decoded
 *   into `<span>`s by `ansiToSpans`. `color: "css"` has no SGR to decode
 *   (C2) — the library still produces `html` (CHARTS-RESEARCH: "the `html`
 *   exit is produced for every target"), so the frame renders that (same
 *   RGB `truecolor` would use) rather than falling back to plain text, with
 *   a chrome note saying a real terminal needs ANSI, not CSS.
 * - `chat`: an assistant-style chat bubble around a Markdown-looking fenced
 *   code block, deliberately set in a ChatGPT-like font stack
 *   (`ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas,
 *   "Liberation Mono", monospace`) INSTEAD of Glyph Mono — the whole point
 *   of this frame is to show what a real chat client's own font would do
 *   to the output. **Colour never reaches this frame, regardless of what
 *   it is handed** (C3): a fenced code block in a real chat client carries
 *   no colour, and an EXPLICIT charset/colour override can outlive a
 *   target switch (AGENTS.md: "the page tracks explicit overrides per
 *   control"), so `ansi`/`html` can arrive here even though `chat`'s own
 *   defaults are `box`/`none` — this frame enforces the faithful downgrade
 *   itself rather than trusting the caller never to hand it colour, and
 *   says so in its own chrome when it actually dropped something.
 *   `charsetDowngraded` (below) is the one thing this frame cannot detect
 *   from `text` alone — a `braille` request already rendered as `box` by
 *   the caller (C4) looks identical to a `box` request — so the caller
 *   reports it explicitly.
 */
export interface TargetPreviewProps {
  readonly target: "chat" | "terminal" | "web";
  /** Terminal window title, e.g. `glyphcss chart …`. Unused for the other two targets. */
  readonly commandTitle: string;
  readonly isHtml: boolean;
  readonly text: string;
  readonly html?: string;
  /** SGR-escaped text, when the render actually produced one (colour enabled, not suppressed by NO_COLOR). */
  readonly ansi?: string;
  /** True when the caller substituted `box` for a requested `braille`
   *  charset because `target` is `chat` (CHARTS-RESEARCH C4 — chat's own
   *  fenced-code font carries no braille glyphs). Surfaces a chrome note;
   *  changes no rendering decision here, since the substitution already
   *  happened in `text`/`html` before either reached this component. */
  readonly charsetDowngraded?: boolean;
  readonly ariaLabel?: string;
  readonly ariaDescription?: string;
  readonly className?: string;
  /** Font size set by the chart/diagram Density control, independent of
   *  window resizing. Does not transform the rendered or copied cells. */
  readonly style?: CSSProperties;
}

export const TargetPreview = forwardRef<HTMLPreElement, TargetPreviewProps>(function TargetPreview(
  { target, commandTitle, isHtml, text, html, ansi, charsetDowngraded, ariaLabel, ariaDescription, className, style },
  ref,
) {
  // `web`'s class stays the literal "glyph-output" — nothing else — so the
  // web-target render (including its exact serialized markup) is byte-
  // identical to before this component existed.
  const preClassName =
    target === "web"
      ? ["glyph-output", className].filter(Boolean).join(" ")
      : ["glyph-output", "target-preview__pre", `target-preview__pre--${target}`, className].filter(Boolean).join(" ");

  // `chat` never shows colour (see this file's own doc, "C3") — checked
  // ahead of everything else so neither branch below has to re-derive it.
  const colorForChat = target === "chat" && (ansi !== undefined || (isHtml && html !== undefined));
  // `html` wins over `ansi` when both are present — the ONE case that
  // happens in is `web` under Density's own text-scale fix
  // (`chartsWorkbenchRender.ts`'s P1-3 fix, CHARTS-RESEARCH
  // `REVIEW-batch4-codex.md`/`-fable.md`): a web render at `textScale > 1`
  // under an ANSI colour mode carries BOTH the true `ansi` SGR text (for
  // Copy ANSI) AND an `html` rebuilt from a `color: "css"` render purely
  // to recover the `.glyph-text` scaled markup an ANSI decode has no way
  // to express. Every OTHER call site keeps the two mutually exclusive
  // (`ansi` is only ever set alongside `html` by this one path), so the
  // swap changes nothing for `terminal` or for `web` at density 1.
  const useHtml = target !== "chat" && isHtml && html !== undefined;
  const useAnsi = target !== "chat" && !useHtml && ansi !== undefined;
  // `ansi === undefined` is what tells `color: "css"` apart from an actual
  // ANSI mode here — the only other source of `useHtml` on `terminal`.
  const terminalCssNote = target === "terminal" && useHtml && ansi === undefined;

  const terminalHtml = useMemo(() => (useAnsi ? ansiSpansToHtml(parseAnsiToSpans(ansi!)) : undefined), [useAnsi, ansi]);

  const pre =
    terminalHtml !== undefined ? (
      <pre
        ref={ref}
        className={preClassName}
        style={style}
        aria-label={ariaLabel}
        aria-description={ariaDescription}
        dangerouslySetInnerHTML={{ __html: terminalHtml }}
      />
    ) : useHtml ? (
      <pre
        ref={ref}
        className={preClassName}
        style={style}
        aria-label={ariaLabel}
        aria-description={ariaDescription}
        dangerouslySetInnerHTML={{ __html: html ?? text }}
      />
    ) : (
      <pre ref={ref} className={preClassName} style={style} aria-label={ariaLabel} aria-description={ariaDescription}>
        {text}
      </pre>
    );

  // Chrome notes — never in the render area itself (the viewport holds
  // only the render, AGENTS.md's "Charts"/"Diagrams" — "feedback lives on
  // the buttons and in the rail"; a `TargetPreview` frame's OWN chrome,
  // the title bar / bubble header, is not that render area, same as the
  // terminal frame's command title already living there).
  const notes: string[] = [];
  if (colorForChat) notes.push("Chat clients drop colour — this is what a paste shows.");
  if (target === "chat" && charsetDowngraded) notes.push("Chat fonts lack braille glyphs — showing the box tier.");
  if (terminalCssNote)
    notes.push("A real terminal gets ANSI, not CSS — pick an ANSI colour mode for a working Copy ANSI export.");
  const note = notes.length > 0 ? <div className="target-preview__note">{notes.join(" ")}</div> : null;

  if (target === "terminal") {
    return (
      <div className={`${styles.root} target-preview target-preview--terminal`}>
        <div className="target-preview__titlebar">
          <span className="target-preview__dots" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
          <span className="target-preview__title">{commandTitle}</span>
        </div>
        {note}
        <div className="target-preview__terminal-body">{pre}</div>
      </div>
    );
  }
  if (target === "chat") {
    return (
      <div className={`${styles.root} target-preview target-preview--chat`}>
        <div className="target-preview__bubble">
          {note}
          <div className="target-preview__fence">{pre}</div>
        </div>
      </div>
    );
  }
  // `web` stays exactly what both pages already rendered — no chrome, no
  // extra wrapper — so the existing `.charts-grid-scroll > .glyph-output` /
  // `.diagrams-grid-scroll > .glyph-output` direct-child CSS (and every
  // byte of the pre-existing web-target render for `color: "none"`/`"css"`)
  // is untouched.
  return pre;
});

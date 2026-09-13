import { forwardRef, useMemo } from "react";
import { ansiSpansToHtml, parseAnsiToSpans } from "./ansiToSpans";

/**
 * `TargetPreview` — one component, shared by `/charts` and `/diagrams`
 * (packet item 3): the visible frame changes shape per render target, on
 * top of the SAME `<pre class="glyph-output">` content node both pages
 * already used, so "Copy ASCII"/"Copy ANSI"/"Download SVG" (which reads
 * that exact node — `website/src/lib/glyphSvgExport.ts`) keep working
 * unchanged regardless of which frame wraps it.
 *
 * - `web`: the `<pre>` as it always rendered — Glyph Mono, CSS colour
 *   (`isHtml`/`html`), no chrome. Byte-identical to before this component
 *   existed.
 * - `terminal`: a terminal-window frame (dark chrome + title bar showing
 *   the command a real CLI call would use) around the SGR string decoded
 *   into `<span>`s by `ansiToSpans` — a browser has no ANSI decoder of its
 *   own, so without this the preview would either show raw escape bytes or
 *   silently drop colour.
 * - `chat`: an assistant-style chat bubble around a Markdown-looking fenced
 *   code block, deliberately set in a ChatGPT-like font stack
 *   (`ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas,
 *   "Liberation Mono", monospace`) INSTEAD of Glyph Mono — the whole point
 *   of this frame is to show what a real chat client's own font would do
 *   to the output, which is also why `chat`'s default charset is `box`,
 *   never `braille` (AGENTS.md's "Charts"/"Diagrams" target tables).
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
  readonly ariaLabel?: string;
  readonly ariaDescription?: string;
  readonly className?: string;
}

export const TargetPreview = forwardRef<HTMLPreElement, TargetPreviewProps>(function TargetPreview(
  { target, commandTitle, isHtml, text, html, ansi, ariaLabel, ariaDescription, className },
  ref,
) {
  // `web`'s class stays the literal "glyph-output" — nothing else — so the
  // web-target render (including its exact serialized markup) is byte-
  // identical to before this component existed.
  const preClassName = target === "web"
    ? ["glyph-output", className].filter(Boolean).join(" ")
    : ["glyph-output", "target-preview__pre", `target-preview__pre--${target}`, className].filter(Boolean).join(" ");
  const terminalHtml = useMemo(() => (target === "terminal" && ansi !== undefined ? ansiSpansToHtml(parseAnsiToSpans(ansi)) : undefined), [target, ansi]);

  const pre = terminalHtml !== undefined
    ? <pre ref={ref} className={preClassName} aria-label={ariaLabel} aria-description={ariaDescription} dangerouslySetInnerHTML={{ __html: terminalHtml }} />
    : isHtml
      ? <pre ref={ref} className={preClassName} aria-label={ariaLabel} aria-description={ariaDescription} dangerouslySetInnerHTML={{ __html: html ?? text }} />
      : <pre ref={ref} className={preClassName} aria-label={ariaLabel} aria-description={ariaDescription}>{text}</pre>;

  if (target === "terminal") {
    return <div className="target-preview target-preview--terminal">
      <div className="target-preview__titlebar">
        <span className="target-preview__dots" aria-hidden="true"><span /><span /><span /></span>
        <span className="target-preview__title">{commandTitle}</span>
      </div>
      <div className="target-preview__terminal-body">{pre}</div>
    </div>;
  }
  if (target === "chat") {
    return <div className="target-preview target-preview--chat">
      <div className="target-preview__bubble">
        <div className="target-preview__fence">{pre}</div>
      </div>
    </div>;
  }
  // `web` stays exactly what both pages already rendered — no chrome, no
  // extra wrapper — so the existing `.charts-grid-scroll > .glyph-output` /
  // `.diagrams-grid-scroll > .glyph-output` direct-child CSS (and every
  // byte of the pre-existing web-target render) is untouched.
  return pre;
});

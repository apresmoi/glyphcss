import { useRef, useState } from "react";
import { ReadoutInput } from "../../EditableReadout";

// ── Editable readouts ─────────────────────────────────────────────────────

/**
 * The VALUE column of a layer-card row: a real text input, not a label, so a
 * number can be typed as well as dragged. The Dock's own number rows have
 * always been type-to-set (`.dn-floating-controls .lil-gui .controller.number
 * input`, gallery-workbench.css), and these static readouts were the visible
 * break in that system — the reported case being a contour floor that could
 * not be set to exactly 0 m.
 *
 * The commit contract is `SynthWorkbench`'s `EditableReadout` verbatim: a
 * draft string while focused, commit on blur and on Enter, revert on Escape,
 * and a value that fails to parse reverts rather than writing NaN. This is a
 * sibling of that component rather than a reuse of it because every readout
 * on this page either carries a unit its own `format` prints (`"1.2M"`,
 * `"120 km"`, `"≥ 3"`), or lives in a value space its slider does not share
 * (the height rows travel in LOG position), or has a non-numeric state at all
 * (the contour window's unbounded `null`, and a hex colour). `EditableReadout`
 * hardcodes `Number.parseFloat` + a numeric clamp, which inverts none of
 * those — and on such a row a bare focus-then-blur would silently commit the
 * wrong number. `parse` is therefore always the format's own inverse, passed
 * beside it. The default `className` is the same one `EditableReadout`
 * renders, so the two are visually identical.
 *
 * A typed value is deliberately NOT snapped to the slider's `step`: the step
 * is a DRAG granularity, and typing exists precisely to reach values between
 * two detents (the contour window persists at 10 m while its slider steps at
 * 50 m; a log height slider's step is very coarse in metres at the top of
 * its range).
 */
export function MapsReadout<T>({
  value,
  format,
  parse,
  onCommit,
  disabled = false,
  title,
  className = "voice-slider-readout",
  inputMode = "decimal",
}: {
  value: T;
  format: (v: T) => string;
  /** The inverse of {@link format}. `null` means "not a value" — revert. */
  parse: (raw: string) => { readonly value: T } | null;
  onCommit: (next: T) => void;
  disabled?: boolean;
  title?: string;
  className?: string;
  inputMode?: "decimal" | "text";
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const cancelledRef = useRef(false);
  return (
    <ReadoutInput
      type="text"
      inputMode={inputMode}
      spellCheck={false}
      className={className}
      title={title}
      disabled={disabled}
      value={draft ?? format(value)}
      onFocus={() => setDraft(format(value))}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (cancelledRef.current) {
          cancelledRef.current = false;
          setDraft(null);
          return;
        }
        const parsed = parse(draft ?? format(value));
        if (parsed) onCommit(parsed.value);
        setDraft(null);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          (e.target as HTMLInputElement).blur();
        } else if (e.key === "Escape") {
          cancelledRef.current = true;
          (e.target as HTMLInputElement).blur();
        }
      }}
    />
  );
}

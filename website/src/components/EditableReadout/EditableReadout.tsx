import { useRef, useState } from "react";
import styles from "./EditableReadout.module.css";
import { ReadoutInput } from "./ReadoutInput";

export function EditableReadout({
  value,
  min,
  max,
  format,
  onCommit,
  integer = false,
  disabled = false,
}: {
  value: number;
  min: number;
  max: number;
  /** Formats the live value for display while unfocused — keep each call
   *  site's existing precision/units (e.g. angle's trailing `°`). */
  format: (v: number) => string;
  onCommit: (next: number) => void;
  /** Rounds a committed value to the nearest integer (e.g. `iter`). */
  integer?: boolean;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const cancelledRef = useRef(false);
  const commit = (raw: string) => {
    const parsed = Number.parseFloat(raw);
    if (Number.isFinite(parsed)) {
      const clamped = Math.min(max, Math.max(min, parsed));
      onCommit(integer ? Math.round(clamped) : clamped);
    }
    setDraft(null);
  };
  return (
    <ReadoutInput
      type="text"
      inputMode="decimal"
      className={`${styles.input} voice-slider-readout`}
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
        commit(draft ?? format(value));
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

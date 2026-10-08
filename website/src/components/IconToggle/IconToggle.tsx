import { type KeyboardEvent, type ReactNode } from "react";
import { ChoiceButton } from "./ChoiceButton";
import styles from "./IconToggle.module.css";

export function IconToggle({
  options,
  value,
  onChange,
  groupTitle,
  groupLabel,
  className = "",
  optionClassName = "",
}: {
  // `disabled`/`disabledReason` (P3-6, REVIEW-showcase-opus.md): an option
  // that can't act on the CURRENT data — `/charts`' mark-type toggle, a
  // chart type the loaded dataset can't draw (`chartsMarkTypeFit.ts`) —
  // renders `disabled` with the reason on its
  // `title`/`aria-label`, the repo's `mapDirectionLocked` idiom
  // (AGENTS.md's "Maps"), rather than letting a reader pick it and hit a
  // raw ledger error. Both optional and undefined for every OTHER
  // `IconToggle` consumer (wave shapes, ramp densities, …), so this is a
  // zero-cost addition for them: `o.disabled` is `undefined` there,
  // `disabled={undefined}` is not disabled, byte-identical rendering.
  options: readonly {
    value: string;
    icon: ReactNode;
    label: string;
    desc?: string;
    disabled?: boolean;
    disabledReason?: string;
  }[];
  value: string;
  onChange: (v: string) => void;
  groupTitle?: string;
  groupLabel?: string;
  className?: string;
  optionClassName?: string;
}) {
  const name = groupLabel ?? groupTitle;
  const moveTo = (root: HTMLElement | null, index: number) => {
    root?.querySelectorAll<HTMLButtonElement>(":scope > .gx-toggle-btn")[index]?.focus();
  };
  // Arrow/Home/End navigation skips a disabled option entirely — selecting
  // one via `onChange` would silently override the very state that made it
  // disabled, and a keyboard user has no other way to know it was skipped.
  const nextEnabledIndex = (from: number, step: 1 | -1): number => {
    for (let i = 0, index = from; i < options.length; i++, index = (index + step + options.length) % options.length) {
      if (!options[index]!.disabled) return index;
    }
    return from;
  };
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next = -1;
    if (event.key === "ArrowRight" || event.key === "ArrowDown")
      next = nextEnabledIndex((index + 1) % options.length, 1);
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp")
      next = nextEnabledIndex((index - 1 + options.length) % options.length, -1);
    else if (event.key === "Home") next = nextEnabledIndex(0, 1);
    else if (event.key === "End") next = nextEnabledIndex(options.length - 1, -1);
    if (next < 0) return;
    event.preventDefault();
    const nextOption = options[next]!;
    onChange(nextOption.value);
    moveTo(event.currentTarget.parentElement, next);
  };
  return (
    <div className={`${styles.root} gx-toggle ${className}`} role="radiogroup" title={groupTitle} aria-label={name}>
      {options.map((o, i) => (
        <ChoiceButton
          key={o.value}
          type="button"
          className={`gx-toggle-btn ${optionClassName}${o.value === value ? " is-active" : ""}`}
          title={o.disabled && o.disabledReason ? o.disabledReason : o.desc ? `${o.label} — ${o.desc}` : o.label}
          aria-label={
            name ? `${name}: ${o.label}${o.disabled && o.disabledReason ? ` — ${o.disabledReason}` : ""}` : o.label
          }
          aria-pressed={o.value === value}
          disabled={o.disabled}
          tabIndex={o.value === value ? 0 : -1}
          onClick={() => onChange(o.value)}
          onKeyDown={(event) => onKeyDown(event, i)}
        >
          {o.icon}
        </ChoiceButton>
      ))}
    </div>
  );
}

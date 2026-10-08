export const EXPORT_FORMATS = [
  { id: "html", label: "HTML" },
  { id: "typescript", label: "TypeScript" },
  { id: "react", label: "React" },
  { id: "vue", label: "Vue" },
] as const;

/**
 * A copy/export confirmation lives on the CLICKED BUTTON's own label
 * (`ChartsWorkbench.tsx`'s own `flashButtonState`, the CodePanel/
 * SynthWorkbench idiom) — never a separate element that could shift the
 * layout around it. `idle` reverts automatically after `ms`.
 */
export function flashButtonState<T extends string>(setState: (value: T) => void, idle: T, value: T, ms = 1200): void {
  setState(value);
  window.setTimeout(() => setState(idle), ms);
}

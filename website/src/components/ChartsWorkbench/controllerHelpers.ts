export const EXPORT_FORMATS = [
  { id: "html", label: "HTML" },
  { id: "typescript", label: "TypeScript" },
  { id: "react", label: "React" },
  { id: "vue", label: "Vue" },
  { id: "json", label: "JSON" },
] as const;

/**
 * A copy/export confirmation lives on the CLICKED BUTTON's own label — the
 * `CodePanel.tsx`/`SynthWorkbench.tsx` idiom ("the user's own words: the
 * confirmations when I copy... it shouldn't be in the rendering area") —
 * never a separate element that could shift the layout around it. `idle`
 * reverts automatically after `ms`.
 */
export function flashButtonState<T extends string>(setState: (value: T) => void, idle: T, value: T, ms = 1200): void {
  setState(value);
  window.setTimeout(() => setState(idle), ms);
}

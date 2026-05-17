import type { ToolMode } from "../types";

const TOOLS: Array<{ mode: ToolMode; glyph: string; label: string }> = [
  { mode: "pointer", glyph: "↖", label: "Pointer" },
  { mode: "raise", glyph: "↑", label: "Raise" },
  { mode: "lower", glyph: "↓", label: "Lower" },
  { mode: "smooth", glyph: "~", label: "Smooth" },
];

export interface BuilderToolPaletteProps {
  toolMode: ToolMode;
  onChange: (mode: ToolMode) => void;
}

export function BuilderToolPalette({ toolMode, onChange }: BuilderToolPaletteProps) {
  return (
    <div className="builder-tool-palette" role="group" aria-label="Tool palette">
      {TOOLS.map(({ mode, glyph, label }) => (
        <button
          key={mode}
          type="button"
          className={`builder-tool-palette__btn${toolMode === mode ? " is-active" : ""}`}
          onClick={() => onChange(mode)}
          aria-pressed={toolMode === mode}
        >
          <span aria-hidden="true">{glyph}</span> {label}
        </button>
      ))}
    </div>
  );
}

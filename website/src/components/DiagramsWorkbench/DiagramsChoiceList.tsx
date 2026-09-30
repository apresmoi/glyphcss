/**
 * The ONE dropdown every choice on the page opens as (user: "more like a
 * dropdown instead of a weird selector"): a plain menu, one option per
 * row — the option's name, its syntax in dim mono, and, where the option
 * is a node shape, a small inline preview the page rendered through the
 * real library. The same rows serve the toolbar's `+ Node ▾` menu
 * (`role="menu"`), a cycle field's `▾` list and the render's node/edge
 * popover (`role="listbox"`, driven by the keyboard through
 * `aria-activedescendant`), so a shape looks the same wherever it is
 * offered. Styling: `.diagrams-choices*` in `diagrams-workbench.css`,
 * the page's own listbox look (`.diagrams-editor-completions`).
 */
import type { GlyphGraphNodeShape } from "@glyphcss/diagrams";
import type { CSSProperties } from "react";
import { DIAGRAMS_SHAPE_CATALOGUE } from "../../features/diagrams/model/diagramsSourceAid";
import type { DiagramsSourceSlot } from "../../features/diagrams/model/diagramsSourceSlots";
import type { GlyphDiagramsFormId } from "../../features/diagrams/model/diagramsWorkbenchState";

export interface DiagramsChoice {
  readonly value: string;
  readonly label: string;
  readonly syntax: string;
  readonly shape?: GlyphGraphNodeShape;
}

/** What a choice is called in its list (`form/role/value`); a value with no name is listed as itself (`opt`, `actor`, `true`). */
const CHOICE_NAMES: Readonly<Record<string, string>> = {
  "graph/arrow/-->": "Arrow",
  "graph/arrow/-.->": "Dotted arrow",
  "graph/arrow/==>": "Thick arrow",
  "graph/arrow/---": "Line, no head",
  "graph/style/solid": "Arrow",
  "graph/style/dotted": "Dotted arrow",
  "graph/style/thick": "Thick arrow",
  "graph/style/undirected": "Line, no head",
  "sequence/arrow/->>": "Solid, filled head",
  "sequence/arrow/-->>": "Dashed, filled head",
  "sequence/arrow/->": "Solid, open head",
  "sequence/arrow/-->": "Dashed, open head",
  "sequence/style/solid": "Solid",
  "sequence/style/dashed": "Dashed",
  "graph/direction/TB": "Top to bottom",
  "graph/direction/LR": "Left to right",
  "graph/direction/BT": "Bottom to top",
  "graph/direction/RL": "Right to left",
  "sequence/frame kind/alt": "Alternative",
  "sequence/frame kind/opt": "Optional",
  "sequence/frame kind/loop": "Loop",
  "sequence/frame kind/par": "Parallel",
  "sequence/kind/alt": "Alternative",
  "sequence/kind/opt": "Optional",
  "sequence/kind/loop": "Loop",
  "sequence/kind/par": "Parallel",
  "sequence/shape/lane": "Lifeline",
  "sequence/shape/actor": "Actor",
  "sequence/participant kind/participant": "Lifeline",
  "sequence/participant kind/actor": "Actor",
};

/** A cycle slot's option as the list shows it: a Mermaid shape opener or a JSON shape name resolves to the catalogue entry (name, `(Label)` syntax, live preview key). */
export function diagramsChoiceOf(
  form: GlyphDiagramsFormId,
  slot: Pick<DiagramsSourceSlot, "role" | "pair">,
  value: string,
): DiagramsChoice {
  const role = slot.role.replace(/^"|"$/g, ""); // a JSON slot's role is its quoted key
  if (role === "shape" && form === "graph") {
    const entry = slot.pair
      ? DIAGRAMS_SHAPE_CATALOGUE.find((s) => s.open === value)
      : DIAGRAMS_SHAPE_CATALOGUE.find((s) => s.shape === value);
    if (entry)
      return {
        value,
        label: entry.label,
        syntax: slot.pair ? `${entry.open}Label${entry.close}` : value,
        shape: entry.shape,
      };
  }
  const name = CHOICE_NAMES[`${form}/${role}/${value}`];
  return { value, label: name ?? value, syntax: name ? value : "" };
}

export function DiagramsChoiceList({
  id,
  label,
  role,
  items,
  previews = {},
  current,
  active,
  onPick,
  className,
  style,
}: {
  readonly id?: string;
  readonly label: string;
  /** `menu` for a command list (the toolbar's node snippets), `listbox` for a value picker (the current value ticked, the keyboard's highlight on `active`). */
  readonly role: "menu" | "listbox";
  readonly items: readonly DiagramsChoice[];
  readonly previews?: Readonly<Partial<Record<GlyphGraphNodeShape, string>>>;
  readonly current?: string;
  readonly active?: number;
  readonly onPick: (item: DiagramsChoice) => void;
  readonly className?: string;
  readonly style?: CSSProperties;
}) {
  const option = role === "listbox";
  return (
    <div
      id={id}
      role={role}
      aria-label={label}
      className={`diagrams-choices${className ? ` ${className}` : ""}`}
      style={style}
    >
      {items.map((item, index) => {
        const isCurrent = option && item.value === current;
        return (
          <button
            type="button"
            key={item.value}
            id={id && option ? `${id}-${index}` : undefined}
            role={option ? "option" : "menuitem"}
            className={`diagrams-choice${isCurrent ? " is-current" : ""}${option && index === active ? " is-active" : ""}`}
            aria-selected={option ? isCurrent : undefined}
            title={item.syntax || undefined}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onPick(item)}
          >
            <span className="diagrams-choice-tick" aria-hidden="true">
              {isCurrent ? "✓" : ""}
            </span>
            <span className="diagrams-choice-label">{item.label}</span>
            {item.syntax && <code className="diagrams-choice-syntax">{item.syntax}</code>}
            {item.shape && previews[item.shape] && (
              <pre className="diagrams-choice-preview" aria-hidden="true">
                {previews[item.shape]}
              </pre>
            )}
          </button>
        );
      })}
    </div>
  );
}

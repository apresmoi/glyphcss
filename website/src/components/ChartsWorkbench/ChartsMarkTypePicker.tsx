import { ChoiceButton } from "../IconToggle";
/**
 * The rail's own chart-TYPE picker (owner feedback, verbatim: "we want more
 * authorship" / "nicer selectors for the types of charts") — replaces the
 * old bare icon row (`IconToggle` over `CHART_MARK_TYPE_ICONS`) with real
 * tiles, grouped, each carrying a LIVE thumbnail rendered by the real
 * library off the reader's OWN loaded data (`chartsMarkTypeThumbnails`,
 * `chartsMarkTypeFit.ts`) — the exact trick `/diagrams`' shape menu uses for
 * node shapes (`DiagramsSourceEditor.tsx`'s `diagrams-editor-shapes`), so a
 * tile can never promise a shape picking it won't actually draw.
 *
 * Unavailable types stay dimmed and carry their reason in the tooltip and
 * accessible name. Explanations must not grow the picker and push the
 * field mappings out of view.
 *
 * `groups` orders the catalogue into named sections (Trend, Compare, …) —
 * `chartsWorkbenchState.ts`'s own `CHART_MARK_TYPES` is already sorted this
 * way, so a caller just slices it. Two types (`text`/`rule`) never
 * fit ANY data on this page (`CHARTS_MARK_TYPE_RULES.ranked: false`) — they
 * are left out of every group by design (dead, permanently-disabled tiles
 * are chrome with no authorship value) and instead surface only as a bare,
 * ungrouped, ALWAYS-ENABLED tile when they happen to be the mark's CURRENT
 * type (a "Line + rule" preset's second mark), so a reader is never left
 * looking at a picker with no active tile at all.
 */
import { useRef, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";

export interface ChartsMarkTypeTileOption {
  readonly value: string;
  /** Vector fallback — shown when no live `thumbnail` exists (an unfit type has no built mark to draw one of; 3D types keep their own vector icon, a live 3D thumbnail being out of this page's cost budget). */
  readonly icon: ReactNode;
  readonly label: string;
  readonly desc?: string;
  readonly disabled?: boolean;
  readonly disabledReason?: string;
  /** A live render of the mark this type would install, at a small size — `chartsMarkTypeThumbnails`'s own output, keyed by type. */
  readonly thumbnail?: string;
}
export interface ChartsMarkTypeGroup {
  readonly label: string;
  readonly values: readonly string[];
}

interface FlatTile {
  readonly section: number;
  readonly tile: ChartsMarkTypeTileOption;
}

export function ChartsMarkTypePicker({
  name,
  options,
  groups,
  value,
  onChange,
}: {
  /** The card's own name ("Chart" / "Mark 2") — the accessible group name is `${name} type`, matching the toggle this replaces byte-for-byte (`Chart type: line`, `Mark 2 type: rule`). */
  readonly name: string;
  readonly options: readonly ChartsMarkTypeTileOption[];
  readonly groups: readonly ChartsMarkTypeGroup[];
  readonly value: string;
  readonly onChange: (value: string) => void;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const byValue = new Map(options.map((o) => [o.value, o] as const));
  const grouped = new Set(groups.flatMap((g) => g.values));
  const sections: { readonly label: string | null; readonly tiles: readonly ChartsMarkTypeTileOption[] }[] = groups
    .map((g) => ({
      label: g.label,
      tiles: g.values.flatMap((v) => {
        const o = byValue.get(v);
        return o ? [o] : [];
      }),
    }))
    .filter((s) => s.tiles.length > 0);
  // The current type's own tile, when it isn't in any group at all (text/
  // rule — see this file's own doc) — appended bare, no section label,
  // so the picker is never left with no active tile.
  if (!grouped.has(value) && byValue.has(value)) sections.push({ label: null, tiles: [byValue.get(value)!] });

  const flat: readonly FlatTile[] = sections.flatMap((section, s) =>
    section.tiles.map((tile) => ({ section: s, tile })),
  );
  const groupTitle = `${name} type`;

  const nextEnabledIndex = (from: number, step: 1 | -1): number => {
    for (let i = 0, index = from; i < flat.length; i++, index = (index + step + flat.length) % flat.length) {
      if (!flat[index]!.tile.disabled) return index;
    }
    return from;
  };
  const focusTile = (index: number) => {
    rootRef.current?.querySelectorAll<HTMLButtonElement>(":scope .charts-type-tile")[index]?.focus();
  };
  const onKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>, index: number) => {
    let next = -1;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") next = nextEnabledIndex((index + 1) % flat.length, 1);
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp")
      next = nextEnabledIndex((index - 1 + flat.length) % flat.length, -1);
    else if (event.key === "Home") next = nextEnabledIndex(0, 1);
    else if (event.key === "End") next = nextEnabledIndex(flat.length - 1, -1);
    if (next < 0) return;
    event.preventDefault();
    onChange(flat[next]!.tile.value);
    focusTile(next);
  };

  return (
    <div className="charts-type-picker" role="radiogroup" aria-label={groupTitle} title={groupTitle} ref={rootRef}>
      {sections.map((section, s) => (
        <div className="charts-type-group" key={section.label ?? `_current-${s}`}>
          {section.label && <p className="charts-type-group-label">{section.label}</p>}
          <div className="charts-type-group-tiles">
            {section.tiles.map((tile) => {
              const flatIndex = flat.findIndex((f) => f.tile.value === tile.value);
              const reason = tile.disabled && tile.disabledReason ? tile.disabledReason : undefined;
              return (
                <ChoiceButton
                  type="button"
                  key={tile.value}
                  className={`gx-toggle-btn charts-type-tile${tile.value === value ? " is-active" : ""}`}
                  title={reason ?? (tile.desc ? `${tile.label} — ${tile.desc}` : tile.label)}
                  aria-label={`${groupTitle}: ${tile.label}${reason ? ` — ${reason}` : ""}`}
                  aria-pressed={tile.value === value}
                  disabled={tile.disabled}
                  tabIndex={tile.value === value ? 0 : -1}
                  onClick={() => onChange(tile.value)}
                  onKeyDown={(event) => onKeyDown(event, flatIndex)}
                >
                  {/* A plain `<div>`, never a `<pre>` — the page's own chart
                   *  viewport is read back in many tests as "the page's `pre`"
                   *  (`container.querySelector("pre")`), and this thumbnail must
                   *  never be mistaken for it. `white-space: pre` on the CSS
                   *  class (`charts-workbench.css`) reproduces a `<pre>`'s own
                   *  layout without claiming its tag. */}
                  {tile.thumbnail ? (
                    <div className="charts-type-tile-thumb" aria-hidden="true">
                      {tile.thumbnail}
                    </div>
                  ) : (
                    <span className="charts-type-tile-icon" aria-hidden="true">
                      {tile.icon}
                    </span>
                  )}
                  <span className="charts-type-tile-label">{tile.label}</span>
                </ChoiceButton>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

// @vitest-environment happy-dom
//
// The rail's chart controls (CHARTS-RESEARCH
// `DIAGNOSIS-scale-rows-mark-card.md`): the showcase builds ONE mark, so
// its controls sit straight in the rail — no "Mark 1" heading, no card box
// — under the rail's own section divider. Only a tray preset with two
// marks earns a "Mark N" heading and the same divider between them. Border
// and background are read through the REAL stylesheets: happy-dom resolves
// the cascade in `getComputedStyle` even though it has no layout (the
// idiom `InstrumentWorkbench/dockCascade.test.tsx` established).
import { readFileSync } from "node:fs";
import path from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@glyphcss/core", () => import("../../../../packages/core/src/index"));
// `synthKit.tsx` (the Type toggle's `IconToggle`) reaches the glyph-ramp
// calibration, a real-browser canvas measurement happy-dom can't make — the
// same one-function stub `ScaleDomainControl.test.tsx` uses.
vi.mock("@glyphcss/effects", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@glyphcss/effects")>();
  return { ...actual, calibrateGlyphRamp: () => ({ ramp: " .:-=+*#%@", steps: [] }) };
});
import { ChartsMarkCard } from "./ChartsMarkCard";
import { chartsMarkTypeBase, chartsMarkTypeFitTable } from "./chartsMarkTypeFit";
import {
  chartsFitTableFromRows, createChartsWorkbenchState, reduceChartsWorkbenchState,
  type ChartsWorkbenchAction, type ChartsWorkbenchState,
} from "./chartsWorkbenchState";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const INSTRUMENT_CSS = readFileSync(path.resolve(__dirname, "../InstrumentWorkbench/instrument-workbench.css"), "utf8");
const CHARTS_CSS = readFileSync(path.resolve(__dirname, "charts-workbench.css"), "utf8");

let root: Root | null = null;
let container: HTMLElement | null = null;
let styles: HTMLStyleElement[] = [];

function mountMarks(state: ChartsWorkbenchState): HTMLElement {
  for (const css of [INSTRUMENT_CSS, CHARTS_CSS]) {
    const style = document.createElement("style");
    style.textContent = css;
    document.head.appendChild(style);
    styles.push(style);
  }
  container = document.createElement("div");
  container.className = "charts-marks-section";
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(<>{state.marks.map((mark, index) => <ChartsMarkCard key={mark.id} mark={mark} index={index} markCount={state.marks.length}
      typeFits={chartsMarkTypeFitTable(chartsMarkTypeBase(state.data, mark))} series={[]} colorDisabled={false} dispatch={() => {}} />)}</>);
  });
  return container;
}

afterEach(() => {
  act(() => { root?.unmount(); });
  root = null;
  container?.remove();
  container = null;
  for (const style of styles) style.remove();
  styles = [];
});

describe("ChartsMarkCard — one mark sits straight in the rail", () => {
  it("renders no heading and no card box: no border, no background, no padding of its own", () => {
    const host = mountMarks(createChartsWorkbenchState());
    const card = host.querySelector(".charts-mark-card")!;
    expect(card.querySelector(".voice-title")).toBeNull();
    expect(card.textContent).not.toMatch(/Mark\s*\d/);
    // happy-dom reports a property no rule sets as "" (a browser: "none",
    // "0px", transparent); `.voice-card` would set all three.
    const cs = getComputedStyle(card);
    expect(["", "none"]).toContain(cs.borderTopStyle);
    expect(["", "0px"]).toContain(cs.paddingTop);
    expect(["", "transparent", "rgba(0, 0, 0, 0)"]).toContain(cs.backgroundColor);
  });

  it("names its controls after the chart, not a mark number", () => {
    const host = mountMarks(createChartsWorkbenchState());
    expect(host.querySelector('[aria-label^="Chart type: line"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="Chart x"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="Chart stroke width"]')).not.toBeNull();
    expect(host.querySelector('[aria-label^="Mark "]')).toBeNull();
  });
});

describe("ChartsMarkCard — a tray preset with two marks", () => {
  it("gives each mark a 'Mark N' heading, 'Mark N' names, and the rail's divider between them", () => {
    const lineRule = reduceChartsWorkbenchState(createChartsWorkbenchState(), { type: "apply-preset", id: "line-rule" });
    const host = mountMarks(lineRule);
    const cards = host.querySelectorAll(".charts-mark-card");
    expect(Array.from(cards, (card) => card.querySelector(".voice-title")?.textContent)).toEqual(["Mark 1", "Mark 2"]);
    expect(host.querySelector('[aria-label^="Mark 2 type: rule"]')).not.toBeNull();
    expect(["", "none"]).toContain(getComputedStyle(cards[0]!).borderTopStyle);
    expect(getComputedStyle(cards[1]!).borderTopStyle).toBe("solid");
  });
});

describe("ChartsMarkCard — Stroke row", () => {
  // A stacked area paints no boundary line, so its Stroke row must dim with
  // that reason rather than sit live and do nothing. Mutation: drop the
  // stacked-area clause in `chartMarkStrokeReason` -> red.
  it("dims Stroke with its reason on a stacked area, and keeps it live on an unstacked one", () => {
    const stacked = reduceChartsWorkbenchState(createChartsWorkbenchState(), { type: "select-dataset", id: "energy-consumption-by-source" });
    expect(stacked.marks[0]!.type).toBe("area");
    expect(stacked.marks[0]!.transform).toBe("stack");
    let host = mountMarks(stacked);
    let input = host.querySelector<HTMLInputElement>('[aria-label="Chart stroke width"]')!;
    expect(input.disabled).toBe(true);
    expect(host.querySelector('[data-row="strokeWidth"]')!.getAttribute("title")).toMatch(/stacked area draws no outline/);
    act(() => { root?.unmount(); });
    container?.remove();
    const unstacked = { ...stacked, marks: [{ ...stacked.marks[0]!, transform: "none" as const }] };
    host = mountMarks(unstacked);
    input = host.querySelector<HTMLInputElement>('[aria-label="Chart stroke width"]')!;
    expect(input.disabled).toBe(false);
  });
});

// Packet C6 — the mark card's Type row grows five 3D entries (Surface,
// Scatter 3D, Columns 3D, Line 3D, Parametric) alongside the 2D ones,
// offered only on the first card, and only when `chart3dFits` is passed.
describe("ChartsMarkCard — 3D Type row (packet C6)", () => {
  function mount3d(state: ChartsWorkbenchState, dispatch: (action: ChartsWorkbenchAction) => void = () => {}): HTMLElement {
    for (const css of [INSTRUMENT_CSS, CHARTS_CSS]) {
      const style = document.createElement("style");
      style.textContent = css;
      document.head.appendChild(style);
      styles.push(style);
    }
    container = document.createElement("div");
    container.className = "charts-marks-section";
    document.body.appendChild(container);
    root = createRoot(container);
    const chart3dFits = chartsFitTableFromRows(state.data, state.marks);
    act(() => {
      root!.render(<ChartsMarkCard mark={state.marks[0]!} index={0} markCount={state.marks.length}
        typeFits={chartsMarkTypeFitTable(chartsMarkTypeBase(state.data, state.marks[0]!))} series={[]} colorDisabled={false}
        dimension={state.dimension} chart3dMarkType={state.dimension === "3d" ? "surface" : undefined} chart3dFits={chart3dFits}
        dispatch={dispatch} />);
    });
    return container;
  }

  it("offers all five 3D type buttons, disabling parametric3d (preset-only) with its own reason", () => {
    const host = mount3d(createChartsWorkbenchState());
    // `[aria-label*=...]` (contains), not `$=` (ends-with) — a DISABLED
    // option's own aria-label carries " — <reason>" appended after the
    // label (`synthKit.tsx`'s `IconToggle`'s own doc), and several of
    // these five are genuinely disabled against the default 2D preset's
    // own non-gridded data.
    for (const label of ["Surface", "Scatter 3D", "Columns 3D", "Line 3D", "Parametric"]) {
      expect(host.querySelector(`[aria-label*=": ${label}"]`), label).not.toBeNull();
    }
    const parametricBtn = host.querySelector<HTMLButtonElement>('[aria-label*=": Parametric"]')!;
    expect(parametricBtn.disabled).toBe(true);
    expect(parametricBtn.title).toMatch(/preset-only/i);
  });

  it("clicking an enabled 3D type dispatches select-3d-table with that markType", () => {
    // A synthetic 3-numeric-column dataset fits scatter3d (and, being a
    // complete unique grid, surface too) on the built-in "Line" preset's
    // own data shape — swap in one that only fits scatter/line, not a grid.
    let state = createChartsWorkbenchState();
    const rows = Array.from({ length: 8 }, (_, i) => ({ a: i, b: Math.sin(i) * 10, c: Math.cos(i) * 3 }));
    state = reduceChartsWorkbenchState(state, { type: "update-mark", id: state.marks[0]!.id, patch: { dataText: JSON.stringify(rows) } });
    const dispatch = vi.fn();
    const host = mount3d(state, dispatch);
    const scatterBtn = host.querySelector<HTMLButtonElement>('[aria-label$=": Scatter 3D"]')!;
    expect(scatterBtn.disabled).toBe(false);
    act(() => scatterBtn.click());
    expect(dispatch).toHaveBeenCalledWith({ type: "select-3d-table", markType: "scatter3d" });
  });

  it("the CURRENTLY resolved 3D markType always stays enabled, even when the current table can't fit it", () => {
    const state = { ...createChartsWorkbenchState(), dimension: "3d" as const };
    const host = mount3d(state);
    // `chart3dMarkType` is forced to "surface" by the mount helper above;
    // none of the built-in "Line" preset's own rows form a grid, so surface
    // would otherwise be disabled — the CURRENT-type rule keeps it live.
    const surfaceBtn = host.querySelector<HTMLButtonElement>('[aria-label$=": Surface"]')!;
    expect(surfaceBtn.disabled).toBe(false);
  });

  it("no 3D buttons at all when chart3dFits is undefined (index !== 0, or the caller never resolved it)", () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    const state = createChartsWorkbenchState();
    act(() => {
      root!.render(<ChartsMarkCard mark={state.marks[0]!} index={0} markCount={1}
        typeFits={chartsMarkTypeFitTable(chartsMarkTypeBase(state.data, state.marks[0]!))} series={[]} colorDisabled={false} dispatch={() => {}} />);
    });
    expect(container.querySelector('[aria-label$=": Surface"]')).toBeNull();
  });

  // User feedback, verbatim: "could we make the chart selection on the left
  // maybe two rows? currently the one row is a bit difficult to see" — the
  // Type toggle is a fixed 11-column GRID (charts-workbench.css's own doc
  // above the rule), so the 11 2D entries always fill row 1 on their own and
  // any 3D entries (up to 5, this card only) spill onto row 2. happy-dom
  // resolves the cascade with no layout engine (this file's own top-of-file
  // doc), so `display`/`grid-template-columns` read back the AUTHORED
  // values — real enough to pin the rule without a browser.
  it("lays the 16-button Type toggle out as a fixed 11-column grid — two rows, not a ragged wrap", () => {
    const host = mount3d(createChartsWorkbenchState());
    const toggle = host.querySelector<HTMLElement>('[data-row="type"] > .gx-toggle')!;
    const cs = getComputedStyle(toggle);
    expect(cs.display).toBe("grid");
    expect(cs.gridTemplateColumns.replace(/\s+/g, "")).toContain("repeat(11,1fr)");

    const buttons = host.querySelectorAll<HTMLButtonElement>('[data-row="type"] .gx-toggle-btn');
    expect(buttons.length).toBe(16); // 11 2D + 5 3D
    // The 12th button (index 11, "Surface" — the first 3D entry) starts row
    // 2 in an 11-column grid, so the row-start border fix must apply there;
    // a mid-row button (index 1) keeps sharing its neighbour's border.
    // Mutation check: reverting the grid rule to plain `flex: 1 1 100%`
    // turns `display` back to "flex" and drops `grid-template-columns`
    // entirely, redding the two assertions above.
    expect(getComputedStyle(buttons[11]!).borderLeftWidth).toBe("1px");
    expect(getComputedStyle(buttons[1]!).borderLeftWidth).toBe("0px");
  });

  it("a plain 2D-only card (no 3D options) still fills exactly one row — 11 items never wrap an 11-column grid", () => {
    const host = mountMarks(createChartsWorkbenchState());
    const buttons = host.querySelectorAll<HTMLButtonElement>('[data-row="type"] .gx-toggle-btn');
    expect(buttons.length).toBe(11);
    const toggle = host.querySelector<HTMLElement>('[data-row="type"] > .gx-toggle')!;
    expect(getComputedStyle(toggle).display).toBe("grid");
  });
});

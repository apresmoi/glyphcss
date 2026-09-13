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
import { createChartsWorkbenchState, reduceChartsWorkbenchState, type ChartsWorkbenchState } from "./chartsWorkbenchState";

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

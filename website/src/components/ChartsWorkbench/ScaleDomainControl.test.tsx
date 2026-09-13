// @vitest-environment happy-dom
//
// Dock-fix bundle items 4 and 5 (DIAGNOSIS-scale-domain.md P3-4/P3-5),
// exercised directly against `ScaleDomainControl` (exported from
// `ChartsDock.tsx` for exactly this) rather than the full mounted Dock —
// its disabled/band/numeric branches are pure enough to drive with plain
// props, and mounting the whole page is `ChartsWorkbench.test.tsx`'s own
// territory (owned by another agent on this branch).
import { useState } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

// `ChartsDock.tsx` transitively imports `Dock/slots.tsx`, whose
// `useRenderingFolder` module calls `ensureCalibratedPalette()` at IMPORT
// TIME (a real-browser-only canvas measurement) — happy-dom has no canvas
// 2D context, so that module-load side effect throws before this file's own
// tests can run. Same stub `synthUrlState.e2e.test.ts`/`LayerGroup.test.tsx`
// use: only `calibrateGlyphRamp` is faked. `vi.mock` calls are hoisted
// above every import, so this takes effect before `ChartsDock.tsx` loads.
vi.mock("@glyphcss/effects", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@glyphcss/effects")>();
  return { ...actual, calibrateGlyphRamp: () => ({ ramp: " .:-=+*#%@", steps: [] }) };
});

import { ScaleDomainControl, CHARTS_NO_SCALE_REASON } from "./ChartsDock";
import { chartsWorkbenchHasCartesianMark, createChartsWorkbenchState, reduceChartsWorkbenchState, type ChartsWorkbenchAction, type ChartsWorkbenchAxisDomain, type ChartsWorkbenchScale } from "./chartsWorkbenchState";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLElement | null = null;

function render(node: React.ReactNode): HTMLElement {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => { root!.render(node); });
  return container;
}

afterEach(() => {
  act(() => { root?.unmount(); });
  root = null;
  container?.remove();
  container = null;
});

const scale = (patch: Partial<ChartsWorkbenchScale> = {}): ChartsWorkbenchScale => ({ type: "auto", min: "", max: "", ...patch });

function Harness(props: { scale: ChartsWorkbenchScale; inferred: ChartsWorkbenchAxisDomain | undefined; hasCartesianScale: boolean; onDispatch: (a: ChartsWorkbenchAction) => void }) {
  const [s, setS] = useState(props.scale);
  return <ScaleDomainControl axis="x" scale={s} inferred={props.inferred} zeroAnchored={false} hasCartesianScale={props.hasCartesianScale}
    dispatch={(a) => {
      props.onDispatch(a);
      if (a.type === "set-scale") setS((cur) => ({ ...cur, ...a.patch }));
    }} />;
}

describe("chartsWorkbenchHasCartesianMark (item 4)", () => {
  it("is false only when every mark is arc/sankey/funnel", () => {
    const sankey = reduceChartsWorkbenchState(createChartsWorkbenchState(), { type: "apply-preset", id: "sankey" });
    expect(chartsWorkbenchHasCartesianMark(sankey)).toBe(false);
    const funnel = reduceChartsWorkbenchState(createChartsWorkbenchState(), { type: "apply-preset", id: "funnel" });
    expect(chartsWorkbenchHasCartesianMark(funnel)).toBe(false);
    const pie = reduceChartsWorkbenchState(createChartsWorkbenchState(), { type: "apply-preset", id: "pie" });
    expect(chartsWorkbenchHasCartesianMark(pie)).toBe(false);
    // The default preset (line) reads x/y.
    expect(chartsWorkbenchHasCartesianMark(createChartsWorkbenchState())).toBe(true);
    // A mix of one cartesian mark and one non-cartesian one still counts.
    const mixed = reduceChartsWorkbenchState(createChartsWorkbenchState(), { type: "add-mark", markType: "sankey" });
    expect(chartsWorkbenchHasCartesianMark(mixed)).toBe(true);
  });
});

describe("ScaleDomainControl — no x/y scale (item 4)", () => {
  it("renders a disabled control with the reason instead of a live slider over a fabricated [0, 1] domain", () => {
    const onDispatch = vi.fn();
    // Exactly the placeholder `glyphChartScaleDomains` hands back for a
    // sankey/funnel/arc-only spec (DIAGNOSIS-scale-domain.md row 9-11).
    const placeholder: ChartsWorkbenchAxisDomain = { type: "linear", domain: [0, 1] };
    const host = render(<Harness scale={scale()} inferred={placeholder} hasCartesianScale={false} onDispatch={onDispatch} />);
    const row = host.querySelector(".range-slider")!;
    expect(row.classList.contains("is-disabled")).toBe(true);
    expect(row.getAttribute("title")).toBe(CHARTS_NO_SCALE_REASON);
    for (const el of host.querySelectorAll("input, button")) expect((el as HTMLInputElement | HTMLButtonElement).disabled).toBe(true);
    // Every control is inert — dragging/typing raises nothing to dispatch.
    const thumb = host.querySelector<HTMLInputElement>(".range-slider-range--lo")!;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
    act(() => { setter.call(thumb, "0.5"); thumb.dispatchEvent(new Event("input", { bubbles: true })); thumb.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(onDispatch).not.toHaveBeenCalled();
  });

  it("still renders the live slider when at least one mark is cartesian", () => {
    const inferred: ChartsWorkbenchAxisDomain = { type: "linear", domain: [0, 100] };
    const host = render(<Harness scale={scale()} inferred={inferred} hasCartesianScale onDispatch={vi.fn()} />);
    expect(host.querySelector(".range-slider.is-disabled")).toBeNull();
    expect(host.querySelector(".range-slider-range--lo")).not.toBeNull();
  });
});

describe("ScaleDomainControl — band axis (item 5)", () => {
  const bandDomain: ChartsWorkbenchAxisDomain = { type: "band", domain: ["Coal", "Gas", "Hydro", "Solar"] };

  it("renders two <select>s over the category names in data order, not free text", () => {
    const onDispatch = vi.fn();
    const host = render(<Harness scale={scale()} inferred={bandDomain} hasCartesianScale onDispatch={onDispatch} />);
    expect(host.querySelectorAll("input").length).toBe(0);
    const selects = host.querySelectorAll("select");
    expect(selects.length).toBe(2);
    const minOptions = Array.from(selects[0]!.options).map((o) => o.value);
    const maxOptions = Array.from(selects[1]!.options).map((o) => o.value);
    // The blank/auto option plus the four categories, in DATA order.
    expect(minOptions).toEqual(["", "Coal", "Gas", "Hydro", "Solar"]);
    expect(maxOptions).toEqual(["", "Coal", "Gas", "Hydro", "Solar"]);
  });

  it("a <select> can only ever commit one of its own categories — the 'Band bounds must name...' throw is unreachable from this control", () => {
    const onDispatch = vi.fn();
    const host = render(<Harness scale={scale()} inferred={bandDomain} hasCartesianScale onDispatch={onDispatch} />);
    const [minSelect] = host.querySelectorAll("select");
    act(() => {
      minSelect!.value = "Gas";
      minSelect!.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(onDispatch).toHaveBeenCalledWith({ type: "set-scale", axis: "x", patch: { min: "Gas" } });
    // No way to reach this control with a typed number or a near-miss
    // spelling — the DOM element itself is a closed set of options.
    expect(minSelect!.tagName).toBe("SELECT");
  });

  it("falls back to the plain text pair when band inference failed entirely (bad mark JSON)", () => {
    const host = render(<Harness scale={scale()} inferred={undefined} hasCartesianScale onDispatch={vi.fn()} />);
    expect(host.querySelectorAll("select").length).toBe(0);
    expect(host.querySelectorAll("input").length).toBe(2);
  });
});

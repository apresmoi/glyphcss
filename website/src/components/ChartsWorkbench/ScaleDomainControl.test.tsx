// @vitest-environment happy-dom
//
// `ScaleDomainControl` (exported from `ChartsDock.tsx` for exactly this),
// driven directly with plain props rather than through the full mounted
// Dock — its branches are pure enough, and mounting the whole page is
// `ChartsWorkbench.test.tsx`'s territory. Every branch renders ONE
// lil-gui-shaped row (CHARTS-RESEARCH `DIAGNOSIS-scale-rows-mark-card.md`):
// a slider, a pair of category selects, or a disabled row carrying the
// reason — never the old free-text pair or two stacked card rows.
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

import { ScaleDomainControl } from "./ChartsDock";
import {
  CHARTS_NO_SCALE_REASON, CHARTS_TIME_UNIT_MS, chartsWorkbenchHasCartesianMark, createChartsWorkbenchState, reduceChartsWorkbenchState,
  type ChartsTimePrecision, type ChartsWorkbenchAction, type ChartsWorkbenchAxisDomain, type ChartsWorkbenchScale,
} from "./chartsWorkbenchState";

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
const utc = (year: number, month = 1, day = 1) => Date.UTC(year, month - 1, day);

function Harness(props: {
  scale: ChartsWorkbenchScale; inferred: ChartsWorkbenchAxisDomain | undefined; hasCartesianScale: boolean;
  unfit?: { short: string; reason: string }; timePrecision?: ChartsTimePrecision; onDispatch: (a: ChartsWorkbenchAction) => void;
}) {
  const [s, setS] = useState(props.scale);
  return <ScaleDomainControl axis="x" scale={s} inferred={props.inferred} zeroAnchored={false} hasCartesianScale={props.hasCartesianScale}
    unfit={props.unfit} timePrecision={props.timePrecision}
    dispatch={(a) => {
      props.onDispatch(a);
      if (a.type === "set-scale") setS((cur) => ({ ...cur, ...a.patch }));
    }} />;
}

function typeInto(input: HTMLInputElement, text: string) {
  act(() => {
    input.focus();
    input.value = text;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.blur();
  });
}
function setRangeValue(input: HTMLInputElement, value: number) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setter.call(input, String(value));
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
/** The one row every branch renders, and its name cell's own label text. */
function onlyRow(host: HTMLElement): { row: Element; name: string } {
  const rows = host.querySelectorAll(".controller");
  expect(rows).toHaveLength(1);
  return { row: rows[0]!, name: rows[0]!.querySelector(".name")!.firstChild!.textContent! };
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
  it("renders ONE disabled row carrying the reason — no inputs, no selects, no fabricated 0/1", () => {
    const onDispatch = vi.fn();
    // Exactly the placeholder `glyphChartScaleDomains` hands back for a
    // sankey/funnel/arc-only spec (DIAGNOSIS-scale-domain.md row 9-11).
    const placeholder: ChartsWorkbenchAxisDomain = { type: "linear", domain: [0, 1] };
    const host = render(<Harness scale={scale()} inferred={placeholder} hasCartesianScale={false} onDispatch={onDispatch} />);
    const { row, name } = onlyRow(host);
    expect(name).toBe("X domain");
    expect(row.classList.contains("range-unavailable")).toBe(true);
    expect(row.classList.contains("disabled")).toBe(true);
    expect(row.getAttribute("title")).toBe(CHARTS_NO_SCALE_REASON);
    expect(row.querySelector(".widget .range-unavailable-reason")!.textContent).toBe("no x/y scale");
    expect(host.querySelectorAll("input, select")).toHaveLength(0);
    const reset = row.querySelector<HTMLButtonElement>(".instrument-row-reset")!;
    expect(reset.disabled).toBe(true);
    act(() => reset.click());
    expect(onDispatch).not.toHaveBeenCalled();
  });

  it("still renders the live slider when at least one mark is cartesian", () => {
    const inferred: ChartsWorkbenchAxisDomain = { type: "linear", domain: [0, 100] };
    const host = render(<Harness scale={scale()} inferred={inferred} hasCartesianScale onDispatch={vi.fn()} />);
    expect(host.querySelector(".range-slider.is-disabled")).toBeNull();
    expect(host.querySelector(".range-slider-range--lo")).not.toBeNull();
  });
});

describe("ScaleDomainControl — a type the data can't carry (legacy link)", () => {
  it("renders the disabled row with the fit table's reason, never free-text inputs", () => {
    const unfit = { short: "needs dates", reason: "A time scale needs date values (YYYY-MM-DD)." };
    const host = render(<Harness scale={scale({ type: "time", min: "2001", max: "2004" })} inferred={undefined} hasCartesianScale unfit={unfit} onDispatch={vi.fn()} />);
    const { row, name } = onlyRow(host);
    expect(name).toBe("X domain");
    expect(row.getAttribute("title")).toBe(unfit.reason);
    expect(row.querySelector(".range-unavailable-reason")!.textContent).toBe("needs dates");
    expect(host.querySelectorAll("input, select")).toHaveLength(0);
  });

  it("with no usable domain at all (bad mark data), renders the disabled row — the old free-text pair is gone", () => {
    const host = render(<Harness scale={scale()} inferred={undefined} hasCartesianScale onDispatch={vi.fn()} />);
    const { row } = onlyRow(host);
    expect(row.classList.contains("range-unavailable")).toBe(true);
    expect(host.querySelectorAll("input, select")).toHaveLength(0);
  });
});

describe("ScaleDomainControl — band axis (item 5)", () => {
  const bandDomain: ChartsWorkbenchAxisDomain = { type: "band", domain: ["Coal", "Gas", "Hydro", "Solar"] };

  it("is ONE row: the X domain name cell, then two category selects sharing its widget", () => {
    const host = render(<Harness scale={scale()} inferred={bandDomain} hasCartesianScale onDispatch={vi.fn()} />);
    const { row, name } = onlyRow(host);
    expect(name).toBe("X domain");
    expect(row.children[0]!.classList.contains("name")).toBe(true);
    expect(row.children[1]!.classList.contains("widget")).toBe(true);
    const selects = row.querySelectorAll<HTMLSelectElement>(".widget > select");
    expect(selects).toHaveLength(2);
    expect(host.querySelectorAll("input")).toHaveLength(0);
    // Every option is a real category, in DATA order — no blank "auto"
    // entry; an end that follows the data shows the data's own first/last.
    expect(Array.from(selects[0]!.options, (o) => o.value)).toEqual(["Coal", "Gas", "Hydro", "Solar"]);
    expect(Array.from(selects[1]!.options, (o) => o.value)).toEqual(["Coal", "Gas", "Hydro", "Solar"]);
    expect(selects[0]!.value).toBe("Coal");
    expect(selects[1]!.value).toBe("Solar");
  });

  it("a select only ever commits one of its own categories, one end at a time — the 'Band bounds must name...' throw is unreachable", () => {
    const onDispatch = vi.fn();
    const host = render(<Harness scale={scale()} inferred={bandDomain} hasCartesianScale onDispatch={onDispatch} />);
    const [minSelect] = host.querySelectorAll("select");
    act(() => {
      minSelect!.value = "Gas";
      minSelect!.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(onDispatch).toHaveBeenCalledWith({ type: "set-scale", axis: "x", patch: { min: "Gas" } });
    expect(minSelect!.tagName).toBe("SELECT");
  });

  it("disables every option that would put the minimum at or after the maximum", () => {
    const host = render(<Harness scale={scale({ min: "Gas", max: "Hydro" })} inferred={bandDomain} hasCartesianScale onDispatch={vi.fn()} />);
    const [minSelect, maxSelect] = host.querySelectorAll<HTMLSelectElement>("select");
    expect(Array.from(minSelect!.options, (o) => o.disabled)).toEqual([false, false, true, true]);
    expect(Array.from(maxSelect!.options, (o) => o.disabled)).toEqual([true, true, false, false]);
  });

  it("[reset] clears both ends, and is disabled while both follow the data", () => {
    const onDispatch = vi.fn();
    const host = render(<Harness scale={scale({ min: "Gas" })} inferred={bandDomain} hasCartesianScale onDispatch={onDispatch} />);
    const reset = host.querySelector<HTMLButtonElement>(".name .instrument-row-reset")!;
    expect(reset.disabled).toBe(false);
    act(() => reset.click());
    expect(onDispatch).toHaveBeenLastCalledWith({ type: "set-scale", axis: "x", patch: { min: "", max: "" } });
    expect(reset.disabled).toBe(true);
  });

  it("labels ISO-date categories at the data's own precision, but commits the category itself", () => {
    const onDispatch = vi.fn();
    const years: ChartsWorkbenchAxisDomain = { type: "band", domain: ["1980-01-01", "1985-01-01", "1990-01-01"] };
    const host = render(<Harness scale={scale({ type: "band" })} inferred={years} hasCartesianScale onDispatch={onDispatch} />);
    const [minSelect] = host.querySelectorAll<HTMLSelectElement>("select");
    expect(Array.from(minSelect!.options, (o) => o.textContent)).toEqual(["1980", "1985", "1990"]);
    act(() => {
      minSelect!.value = "1985-01-01";
      minSelect!.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(onDispatch).toHaveBeenLastCalledWith({ type: "set-scale", axis: "x", patch: { min: "1985-01-01" } });
  });
});

describe("ScaleDomainControl — time axis", () => {
  const yearly: ChartsWorkbenchAxisDomain = { type: "time", domain: [new Date(utc(1980)), new Date(utc(2024))] };

  it("shows a yearly domain as years, with fields sized for four characters", () => {
    const host = render(<Harness scale={scale({ type: "time" })} inferred={yearly} timePrecision="year" hasCartesianScale onDispatch={vi.fn()} />);
    const fields = host.querySelectorAll<HTMLInputElement>(".range-slider-number");
    expect(fields[0]!.value).toBe("1980");
    expect(fields[1]!.value).toBe("2024");
    expect((host.querySelector(".range-slider") as HTMLElement).style.getPropertyValue("--range-slider-number-ch")).toBe("4");
  });

  it("a typed year, month or date commits exactly as typed — never snapped", () => {
    const onDispatch = vi.fn();
    const host = render(<Harness scale={scale({ type: "time" })} inferred={yearly} timePrecision="year" hasCartesianScale onDispatch={onDispatch} />);
    typeInto(host.querySelectorAll<HTMLInputElement>(".range-slider-number")[0]!, "1990");
    expect(onDispatch).toHaveBeenLastCalledWith({ type: "set-scale", axis: "x", patch: { min: "1990-01-01T00:00:00.000Z", max: "" } });
    typeInto(host.querySelectorAll<HTMLInputElement>(".range-slider-number")[0]!, "1990-06");
    expect(onDispatch).toHaveBeenLastCalledWith({ type: "set-scale", axis: "x", patch: { min: "1990-06-01T00:00:00.000Z", max: "" } });
  });

  it("a thumb drag lands on the data's own unit, and the slider steps one unit from a unit-aligned bound", () => {
    const onDispatch = vi.fn();
    const host = render(<Harness scale={scale({ type: "time" })} inferred={yearly} timePrecision="year" hasCartesianScale onDispatch={onDispatch} />);
    const lo = host.querySelector<HTMLInputElement>(".range-slider-range--lo")!;
    expect(lo.step).toBe(String(CHARTS_TIME_UNIT_MS.year));
    const min = new Date(Number(lo.min));
    expect([min.getUTCMonth(), min.getUTCDate(), min.getUTCHours()]).toEqual([0, 1, 0]);
    setRangeValue(lo, utc(1990, 5, 1));
    expect(onDispatch).toHaveBeenLastCalledWith({ type: "set-scale", axis: "x", patch: { min: "1990-01-01T00:00:00.000Z", max: "" } });
  });

  it("a monthly axis spanning years shows years — the unit its ticks run at — with the month on each title", () => {
    const monthly: ChartsWorkbenchAxisDomain = { type: "time", domain: [new Date(utc(2011, 9)), new Date(utc(2026, 8))] };
    const host = render(<Harness scale={scale({ type: "time" })} inferred={monthly} timePrecision="month" hasCartesianScale onDispatch={vi.fn()} />);
    const fields = host.querySelectorAll<HTMLInputElement>(".range-slider-number");
    expect([fields[0]!.value, fields[1]!.value]).toEqual(["2011", "2026"]);
    expect([fields[0]!.title, fields[1]!.title]).toEqual(["2011-09", "2026-08"]);
    expect(host.querySelector<HTMLInputElement>(".range-slider-range--lo")!.step).toBe(String(CHARTS_TIME_UNIT_MS.year));
  });

  it("a daily axis spanning months shows YYYY-MM, with the full date on each field's title", () => {
    const daily: ChartsWorkbenchAxisDomain = { type: "time", domain: [new Date(utc(2025, 4, 11)), new Date(utc(2025, 12, 31))] };
    const host = render(<Harness scale={scale({ type: "time" })} inferred={daily} timePrecision="day" hasCartesianScale onDispatch={vi.fn()} />);
    const fields = host.querySelectorAll<HTMLInputElement>(".range-slider-number");
    expect([fields[0]!.value, fields[1]!.value]).toEqual(["2025-04", "2025-12"]);
    expect([fields[0]!.title, fields[1]!.title]).toEqual(["2025-04-11", "2025-12-31"]);
  });
});

describe("ScaleDomainControl — numeric axis", () => {
  it("shows each end at the slider step's precision, not every stored decimal", () => {
    const inferred: ChartsWorkbenchAxisDomain = { type: "linear", domain: [0, 175604.63] };
    const host = render(<Harness scale={scale()} inferred={inferred} hasCartesianScale onDispatch={vi.fn()} />);
    const fields = host.querySelectorAll<HTMLInputElement>(".range-slider-number");
    expect([fields[0]!.value, fields[1]!.value]).toEqual(["0", "175605"]);
  });
});

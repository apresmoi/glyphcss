// @vitest-environment happy-dom
import "../../test/dom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ChartsWorkbench from "./ChartsWorkbench";
import { createChartsWorkbenchState } from "../../features/charts/model/chartsSpec";
import { GLYPH_MERMAID_CHART_PRESETS } from "../../features/mermaid/model/presets";
import { reduceChartsWorkbenchState } from "../../features/charts/model/chartsWorkbenchState";
import { renderChartsWorkbenchState } from "../../features/charts/render/chartsWorkbenchRender";

vi.mock("@glyphcss/core", () => import("../../../../packages/core/src/index"));
vi.mock("../../services/rendering/calibratedPalette", () => ({ CALIBRATED_PALETTE_NAME: "calibrated", ensureCalibratedPalette: () => {} }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe("chart Mermaid preset tiles", () => {
  let host: HTMLDivElement;
  let root: Root;
  beforeEach(async () => {
    host = document.createElement("div"); document.body.append(host);
    root = createRoot(host);
    await act(async () => root.render(<ChartsWorkbench initialState={createChartsWorkbenchState()} />));
  });
  afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
  it.each(GLYPH_MERMAID_CHART_PRESETS)("$type loads into the editor and main canvas", async (preset) => {
    const tile = host.querySelector<HTMLButtonElement>(`[aria-label="Apply Mermaid ${preset.type}"]`)!;
    expect(tile.closest("#charts-presets-panel")).not.toBeNull();
    expect(tile.querySelector("pre")!.textContent!.trim()).not.toBe("");
    expect(tile.querySelector("pre")!.textContent).not.toContain("Preview unavailable");
    await act(async () => tile.click());
    expect(host.querySelector<HTMLTextAreaElement>('[aria-label="Mermaid source"]')!.value).toBe(preset.source);
    const state = reduceChartsWorkbenchState(createChartsWorkbenchState(), { type: "apply-mermaid-preset", id: preset.id });
    const result = renderChartsWorkbenchState(state);
    expect(result.ok).toBe(true);
    if (result.ok) expect(host.querySelector(".charts-viewport pre.glyph-output")!.textContent).toBe(result.text);
    for (const label of preset.labels) expect(host.querySelector(".charts-viewport pre")!.textContent).toContain(label);
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(host.querySelector("#charts-presets-panel textarea")).toBeNull();
    expect(host.querySelectorAll(".charts-mermaid-disabled[aria-disabled=true]")).toHaveLength(3);
  });
  it("edits source, shows named errors, and recovers via an ordinary preset", async () => {
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Apply Mermaid pie"]')!.click());
    const editor = host.querySelector<HTMLTextAreaElement>('[aria-label="Mermaid source"]')!;
    const set = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")!.set!;
    await act(async () => { set.call(editor, 'pie\n "Updated": 4'); editor.dispatchEvent(new Event("input", { bubbles: true })); });
    expect(host.querySelector(".charts-viewport pre")!.textContent).toContain("Updated");
    await act(async () => { set.call(editor, "notAChart"); editor.dispatchEvent(new Event("input", { bubbles: true })); });
    expect(host.querySelector('[role="alert"]')!.textContent).toContain("GLYPH_MERMAID_NOT_CHART_TYPE");
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Apply Line"]')!.click());
    expect(host.querySelector('[aria-label="Mermaid source"]')).toBeNull();
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(host.querySelector(".charts-mermaid-disabled")).toBeNull();
  });
});

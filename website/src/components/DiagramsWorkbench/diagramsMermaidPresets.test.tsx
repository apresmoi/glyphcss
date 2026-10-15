// @vitest-environment happy-dom
import "../../test/dom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import GlyphDiagramsWorkbench from "./DiagramsWorkbench";
import { createGlyphDiagramsWorkbenchState, reduceGlyphDiagramsWorkbenchState } from "../../features/diagrams/model/diagramsWorkbenchState";
import { renderGlyphDiagramsWorkbenchSequenceState, renderGlyphDiagramsWorkbenchState } from "../../features/diagrams/render/diagramsWorkbenchRender";
import { GLYPH_MERMAID_DIAGRAM_PRESETS } from "../../features/mermaid/model/presets";

vi.mock("@glyphcss/core", () => import("../../../../packages/core/src/index"));
vi.mock("../../services/rendering/calibratedPalette", () => ({ CALIBRATED_PALETTE_NAME: "calibrated", ensureCalibratedPalette: () => {} }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe("diagram Mermaid preset tiles", () => {
  let host: HTMLDivElement;
  let root: Root;
  async function settle() {
    await vi.waitFor(async () => {
      await act(async () => { await vi.dynamicImportSettled(); });
      expect(host.querySelector('.diagrams-preview[aria-busy="false"]')).not.toBeNull();
    }, { timeout: 10_000, interval: 10 });
  }
  beforeEach(async () => {
    host = document.createElement("div"); document.body.append(host); root = createRoot(host);
    await act(async () => root.render(<GlyphDiagramsWorkbench initialState={createGlyphDiagramsWorkbenchState()} />));
    await settle();
  });
  afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
  it.each(GLYPH_MERMAID_DIAGRAM_PRESETS)("$type loads into the source editor and main canvas", async (preset) => {
    const tile = host.querySelector<HTMLButtonElement>(`[aria-label="Apply Mermaid ${preset.type}"]`)!;
    expect(tile.closest("#diagrams-presets-panel")).not.toBeNull();
    await act(async () => tile.click()); await settle();
    expect(host.querySelector<HTMLTextAreaElement>("textarea")!.value).toBe(preset.source);
    const state = reduceGlyphDiagramsWorkbenchState(createGlyphDiagramsWorkbenchState(), { type: "apply-mermaid-preset", id: preset.id });
    const result = await (state.form === "sequence" ? renderGlyphDiagramsWorkbenchSequenceState : renderGlyphDiagramsWorkbenchState)(state);
    expect(result.ok).toBe(true);
    if (result.ok) expect(host.querySelector(".diagrams-viewport pre.glyph-output")!.textContent).toBe(result.text);
    for (const label of preset.labels) expect(host.querySelector(".diagrams-viewport pre")!.textContent).toContain(label);
    expect(host.querySelector(".diagrams-source-error")).toBeNull();
    expect(host.querySelector("#diagrams-presets-panel textarea")).toBeNull();
  });
});

// @vitest-environment happy-dom
import "../../test/dom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ChartsWorkbench from "./ChartsWorkbench";
import { createChartsWorkbenchState } from "../../features/charts/model/chartsSpec";
import { GLYPH_MERMAID_CHART_PRESETS } from "../../features/mermaid/model/presets";

vi.mock("@glyphcss/core", () => import("../../../../packages/core/src/index"));
vi.mock("../../services/rendering/calibratedPalette", () => ({
  CALIBRATED_PALETTE_NAME: "calibrated",
  ensureCalibratedPalette: () => {},
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe("chart Mermaid plain-source editing", () => {
  let host: HTMLDivElement;
  let root: Root;
  beforeEach(async () => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root.render(<ChartsWorkbench initialState={createChartsWorkbenchState()} />));
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });
  it.each(GLYPH_MERMAID_CHART_PRESETS)(
    "$type has no flowchart affordances and edits update the preview",
    async (preset) => {
      await act(async () =>
        host.querySelector<HTMLButtonElement>(`[aria-label="Apply Mermaid ${preset.type}"]`)!.click(),
      );
      const editor = host.querySelector<HTMLTextAreaElement>("textarea")!;
      expect(editor.value).toBe(preset.source);
      expect(
        host.querySelector(
          ".diagrams-editor-slot, .diagrams-editor-field, .diagrams-editor-choice-select, .diagrams-editor-completions",
        ),
      ).toBeNull();
      expect(editor.getAttribute("aria-autocomplete")).not.toBe("list");
      editor.setSelectionRange(1, 1);
      const nativeEdit = new InputEvent("beforeinput", {
        inputType: "insertText",
        data: "+new()",
        bubbles: true,
        cancelable: true,
      });
      editor.dispatchEvent(nativeEdit);
      expect(nativeEdit.defaultPrevented).toBe(false);
      const original = preset.labels[0]!;
      const replacement = "Updated";
      const next = preset.source.replace(original, replacement);
      expect(next).not.toBe(preset.source);
      await act(async () => {
        Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")!.set!.call(editor, next);
        editor.dispatchEvent(new Event("input", { bubbles: true }));
        editor.dispatchEvent(new Event("focusout", { bubbles: true }));
      });
      await vi.waitFor(
        () => {
          expect(host.querySelector(".charts-viewport pre.glyph-output")!.textContent).toContain(replacement);
        },
        { timeout: 10_000 },
      );
      expect(
        host.querySelector(
          ".diagrams-editor-slot, .diagrams-editor-field, .diagrams-editor-choice-select, .diagrams-editor-completions",
        ),
      ).toBeNull();
    },
  );
});

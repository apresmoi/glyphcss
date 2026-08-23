// @vitest-environment happy-dom
//
// VOLUMETRIC-2.md §4 P1 fix: `layerCombineL` (how a layer's OWN voices fold
// together before the layer's blended output joins the stack) had no live
// control after the LayerGroup rewrite — the Menger/Sierpinski presets set a
// non-default `layerCombineL` and it was uneditable from the UI. This is the
// first real DOM-rendered test for LayerGroup (the rest of this directory's
// tests are pure-function tests over plain data), following the
// `createRoot`/`act` pattern packages/react's own camera component tests use
// — the smallest addition (`happy-dom` as a devDependency, already used by
// four sibling packages) that lets a control's actual change → re-render
// wiring be asserted instead of only read from source. JSX (not
// `React.createElement`) so children merges through LayerGroup's required
// `children: ReactNode` prop the way the library-managed-attributes overload
// expects.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

// React 19 requires this flag for `act()`-based tests (createRoot + act, no
// React Testing Library here) — see packages/react/src/test-setup.ts, which
// this mirrors for the website's one DOM-rendered React test file.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Importing synthKit.tsx transitively imports Dock/slots.tsx, whose
// useRenderingFolder module calls `ensureCalibratedPalette()` at IMPORT TIME
// (a real-browser-only canvas measurement, unrelated to LayerGroup). happy-dom
// has no canvas 2D context, so that module-load side effect throws before
// this file's own tests can run. Stub just `calibrateGlyphRamp` — the rest of
// `@glyphcss/effects` stays real — so importing synthKit.tsx here doesn't
// require a real canvas, same as it never did in a plain vitest("node") run.
// `vi.mock` calls are hoisted above every import in this file, so this takes
// effect before synthKit.tsx (and its Dock/slots.tsx import chain) loads.
vi.mock("@glyphcss/effects", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@glyphcss/effects")>();
  return {
    ...actual,
    calibrateGlyphRamp: () => ({ ramp: " .:-=+*#%@", steps: [] }),
  };
});

import { LAYER_COMBINE_VALUES, LayerGroup, synthDefaults, type Params, type ParamValue } from "./synthKit";

function renderLayerGroup(params: Params, onParam: (key: string, value: ParamValue) => void): { container: HTMLElement; root: Root } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <LayerGroup layer={1} params={params} onParam={onParam} onAddVoice={() => {}} canAddVoice={true}>
        <div data-testid="voice-slot" />
      </LayerGroup>,
    );
  });
  return { container, root };
}

function combineSelect(container: HTMLElement): HTMLSelectElement {
  const select = container.querySelector<HTMLSelectElement>('label[title^="Combine"] select');
  if (!select) throw new Error("combine <select> not found in LayerGroup");
  return select;
}

describe("LayerGroup — combine control (VOLUMETRIC-2.md §4 P1 fix)", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("renders a combine <select> offering exactly LAYER_COMBINE_VALUES (add/multiply/max/min/difference/inherit)", () => {
    const { container } = renderLayerGroup(synthDefaults(), () => {});
    const options = Array.from(combineSelect(container).options).map((o) => o.value);
    expect(options).toEqual([...LAYER_COMBINE_VALUES]);
  });

  it("reflects the layer's current layerCombine1 value on mount", () => {
    const params = { ...synthDefaults(), layerCombine1: "multiply" };
    const { container } = renderLayerGroup(params, () => {});
    expect(combineSelect(container).value).toBe("multiply");
  });

  it("defaults to \"inherit\" — matches the schema default, so a preset that never overrides layerCombine1 reads as inherit here too", () => {
    const { container } = renderLayerGroup(synthDefaults(), () => {});
    expect(combineSelect(container).value).toBe("inherit");
  });

  it("changing the select calls onParam with layerCombine<layer> and the picked value, and re-rendering with the updated params reflects it back", () => {
    let params: Params = { ...synthDefaults(), layerCombine1: "inherit" };
    const calls: Array<[string, ParamValue]> = [];
    let root!: Root;
    let container!: HTMLElement;

    function rerender(): void {
      act(() => {
        root.render(
          <LayerGroup
            layer={1}
            params={params}
            onParam={(key, value) => {
              calls.push([key, value]);
              params = { ...params, [key]: value };
              rerender();
            }}
            onAddVoice={() => {}}
            canAddVoice={true}
          >
            <div />
          </LayerGroup>,
        );
      });
    }

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    rerender();

    act(() => {
      const select = combineSelect(container);
      select.value = "max";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(calls).toEqual([["layerCombine1", "max"]]);
    expect(params.layerCombine1).toBe("max");
    // The control itself re-rendered to show the new value — not just the
    // params object updating out from under a stale DOM node.
    expect(combineSelect(container).value).toBe("max");
  });

  it("targets the layer-specific key — a layer-2 group reads/writes layerCombine2, not layerCombine1", () => {
    const params = { ...synthDefaults(), layerCombine1: "add", layerCombine2: "difference" };
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
      root.render(
        <LayerGroup layer={2} params={params} onParam={() => {}} onAddVoice={() => {}} canAddVoice={true}>
          <div />
        </LayerGroup>,
      );
    });
    expect(combineSelect(container).value).toBe("difference");
  });
});

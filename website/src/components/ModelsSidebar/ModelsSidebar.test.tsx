// @vitest-environment happy-dom
import "../../test/dom";
import { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ModelsSidebar, type ModelsSidebarProps } from "./ModelsSidebar";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
let props: ModelsSidebarProps;
const render = (patch: Partial<ModelsSidebarProps> = {}) => {
  props = { ...props, ...patch };
  act(() => root.render(<ModelsSidebar {...props} />));
};
const toggle = (label: string) => host.querySelector<HTMLButtonElement>(`button[aria-label$=" ${label}"]`)!;
const model = (label: string) => host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
const click = (button: HTMLButtonElement) => act(() => button.click());

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  props = {
    modelSearch: "", onModelSearchChange: vi.fn(), onImportClick: vi.fn(),
    fileInputRef: createRef(), onFileInputChange: vi.fn(), onRandomPreset: vi.fn(),
    modelCategories: [
      { id: "primitives", label: "Primitives", models: [{ id: "cube", label: "Cube" }] },
      { id: "textured", label: "Textured", models: [{ id: "crate", label: "Crate" }] },
    ],
    activeCategoryId: "textured", presetId: "crate", onPresetClick: vi.fn(),
  };
  render();
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("model category disclosure", () => {
  it("starts with the selected category open and closes it on the first click", () => {
    expect(toggle("Textured").getAttribute("aria-expanded")).toBe("true");
    expect(toggle("Primitives").getAttribute("aria-expanded")).toBe("false");
    expect(model("Crate")?.getAttribute("aria-pressed")).toBe("true");
    click(toggle("Textured"));
    expect(toggle("Textured").getAttribute("aria-expanded")).toBe("false");
    expect(model("Crate")).toBeNull();
    click(toggle("Textured"));
    expect(model("Crate")).not.toBeNull();
  });

  it("toggles categories independently and keeps them closed across unrelated renders", () => {
    click(toggle("Primitives"));
    expect(model("Cube")).not.toBeNull();
    expect(model("Crate")).not.toBeNull();
    click(toggle("Primitives"));
    click(toggle("Textured"));
    render({ attribution: { creator: "Example" } });
    expect(model("Cube")).toBeNull();
    expect(model("Crate")).toBeNull();
  });

  it("opens search matches, lets them collapse, and restores browsing state when search clears", () => {
    click(toggle("Textured"));
    render({ modelSearch: "c" });
    expect(model("Cube")).not.toBeNull();
    expect(model("Crate")).not.toBeNull();
    click(toggle("Primitives"));
    expect(model("Cube")).toBeNull();
    expect(model("Crate")).not.toBeNull();
    render({ modelSearch: "cu" });
    expect(model("Cube")).not.toBeNull();
    render({ modelSearch: "" });
    expect(model("Cube")).toBeNull();
    expect(model("Crate")).toBeNull();
    render({ modelSearch: "c" });
    expect(model("Cube")).not.toBeNull();
    expect(model("Crate")).not.toBeNull();
  });

  it("reveals the selected category for a new model and dispatches model clicks", () => {
    click(model("Crate")!);
    expect(props.onPresetClick).toHaveBeenCalledWith("crate");
    click(toggle("Textured"));
    render({ presetId: "cube", activeCategoryId: "primitives" });
    expect(model("Cube")?.getAttribute("aria-pressed")).toBe("true");
    expect(model("Crate")).toBeNull();
    render({ presetId: "crate", activeCategoryId: "textured" });
    expect(model("Crate")?.getAttribute("aria-pressed")).toBe("true");
    expect(model("Cube")).not.toBeNull();
  });
});

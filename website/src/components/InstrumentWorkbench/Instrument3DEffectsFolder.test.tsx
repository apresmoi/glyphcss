// @vitest-environment node
// D3 fix round 1, P1-2 — the SHARED Effects folder (PLAN-3d.md §8), tested
// standalone against a real lil-gui root (the same split every other Dock
// hook test in this directory uses — see `mapsKit.viewFolder.test.tsx`'s own
// doc), so `/charts`' own C4 packet can reuse it with confidence it carries
// no diagram-specific assumption. `node` + the patched happy-dom `Window`
// below (not the bare `happy-dom` environment) mirrors
// `DiagramsWorkbench.3d.test.tsx`'s own setup: this harness mounts a real
// FOLDER plus two nested option controllers in one component, and React's
// unmount can destroy the folder (which recursively destroys its own
// children) before a child controller's own cleanup runs — lil-gui's
// `removeChild` then throws a `DOMException` whose `.name` happy-dom's raw
// implementation does not reliably set to `"NotFoundError"`, which is what
// `primitives.tsx`'s `destroyController` guards on.
vi.hoisted(async () => {
  const { Window } = await import("happy-dom");
  const window = new Window();
  const removeChild = window.Node.prototype.removeChild;
  window.Node.prototype.removeChild = function(child) {
    try { return removeChild.call(this, child); }
    catch (error) {
      if (error instanceof window.DOMException && error.message.includes("removeChild")) throw new window.DOMException(error.message, "NotFoundError");
      throw error;
    }
  };
  for (const key of ["window", "document", "navigator", "HTMLElement", "HTMLSelectElement", "Element", "Event", "DOMException", "getComputedStyle"] as const) {
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: key === "window" ? window : window[key] });
  }
});
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import GUI from "lil-gui";
import { Instrument3DEffectsFolder, INSTRUMENT_3D_EFFECT_ALL_TARGET, type Instrument3DEffectsState, type Instrument3DEffectTarget } from "./Instrument3DEffectsFolder";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLElement | null = null;
let guiHost: HTMLElement | null = null;
let gui: GUI | null = null;

interface Props {
  effectIds: readonly string[]; targets: readonly Instrument3DEffectTarget[]; state: Instrument3DEffectsState;
  allTargetsLabel?: string; onChange: (patch: Partial<Instrument3DEffectsState>) => void; visible: boolean;
}
function render(rawProps: Props): HTMLElement {
  const props = { allTargetsLabel: "All nodes", ...rawProps };
  container = document.createElement("div");
  guiHost = document.createElement("div");
  document.body.append(container, guiHost);
  gui = new GUI({ container: guiHost });
  root = createRoot(container);
  act(() => { root!.render(<Instrument3DEffectsFolder gui={gui} {...props} />); });
  return guiHost;
}
function rerender(rawProps: Props) {
  const props = { allTargetsLabel: "All nodes", ...rawProps };
  act(() => { root!.render(<Instrument3DEffectsFolder gui={gui} {...props} />); });
}
afterEach(() => {
  act(() => { root?.unmount(); });
  gui?.destroy();
  container?.remove(); guiHost?.remove();
  root = null; container = null; guiHost = null; gui = null;
  vi.restoreAllMocks();
});

function selectByLabel(host: HTMLElement, rowLabel: string): HTMLSelectElement {
  const controller = Array.from(host.querySelectorAll(".controller")).find((c) => c.querySelector(".name")?.textContent === rowLabel)!;
  return controller.querySelector("select")!;
}
function chooseOption(select: HTMLSelectElement, optionText: string) {
  const index = Array.from(select.options).findIndex((o) => o.textContent === optionText);
  select.selectedIndex = index;
  select.dispatchEvent(new Event("change", { bubbles: true }));
}

describe("Instrument3DEffectsFolder", () => {
  it("renders an Effect row and a Target row seeded with 'All nodes' plus every target", () => {
    const host = render({
      effectIds: ["none", "scan", "glitch"],
      targets: [{ id: "n0", label: "Planner" }, { id: "n1", label: "Worker" }],
      state: { effectId: "none", targetId: INSTRUMENT_3D_EFFECT_ALL_TARGET }, onChange: () => {}, visible: true,
    });
    const effectSelect = selectByLabel(host, "Effect");
    expect(Array.from(effectSelect.options).map((o) => o.textContent)).toEqual(["none", "scan", "glitch"]);
    const targetSelect = selectByLabel(host, "Target");
    expect(Array.from(targetSelect.options).map((o) => o.textContent)).toEqual(["All nodes", "Planner", "Worker"]);
  });

  // Mutation: swallow the onChange callback in the Effect controller → this reddens.
  it("picking an effect dispatches onChange({ effectId })", () => {
    const onChange = vi.fn();
    const host = render({
      effectIds: ["none", "scan", "glitch"],
      targets: [{ id: "n0", label: "Planner" }],
      state: { effectId: "none", targetId: INSTRUMENT_3D_EFFECT_ALL_TARGET }, onChange, visible: true,
    });
    chooseOption(selectByLabel(host, "Effect"), "scan");
    expect(onChange).toHaveBeenCalledWith({ effectId: "scan" });
  });

  // Mutation: swallow the onChange callback in the Target controller → this reddens.
  it("picking a target dispatches onChange({ targetId })", () => {
    const onChange = vi.fn();
    const host = render({
      effectIds: ["none", "scan"],
      targets: [{ id: "n0", label: "Planner" }, { id: "n1", label: "Worker" }],
      state: { effectId: "scan", targetId: INSTRUMENT_3D_EFFECT_ALL_TARGET }, onChange, visible: true,
    });
    chooseOption(selectByLabel(host, "Target"), "Worker");
    expect(onChange).toHaveBeenCalledWith({ targetId: "n1" });
  });

  // Mutation: drop the `targetCtrl?.setOptions(...)` refresh effect → this reddens (stale node list survives a graph swap).
  it("a changed targets list refreshes the Target dropdown's own options", () => {
    const host = render({
      effectIds: ["none"], targets: [{ id: "n0", label: "Planner" }],
      state: { effectId: "none", targetId: INSTRUMENT_3D_EFFECT_ALL_TARGET }, onChange: () => {}, visible: true,
    });
    rerender({
      effectIds: ["none"], targets: [{ id: "m0", label: "Supervisor" }, { id: "m1", label: "Coder" }],
      state: { effectId: "none", targetId: INSTRUMENT_3D_EFFECT_ALL_TARGET }, onChange: () => {}, visible: true,
    });
    const targetSelect = selectByLabel(host, "Target");
    expect(Array.from(targetSelect.options).map((o) => o.textContent)).toEqual(["All nodes", "Supervisor", "Coder"]);
  });

  // Fix round 2, P1-2 — `allTargetsLabel` is CALLER-provided, not a
  // hard-coded "All nodes": a `/charts`-style caller targeting marks, not
  // nodes, must be able to say so. Mutation: hard-code `"All nodes"` back
  // into the folder's own `targetOptions` construction → this reddens.
  it("the all-targets option uses the caller's own `allTargetsLabel`, not a hard-coded string", () => {
    const host = render({
      effectIds: ["none"], targets: [{ id: "m0", label: "Revenue" }],
      allTargetsLabel: "All marks",
      state: { effectId: "none", targetId: INSTRUMENT_3D_EFFECT_ALL_TARGET }, onChange: () => {}, visible: true,
    });
    const targetSelect = selectByLabel(host, "Target");
    expect(Array.from(targetSelect.options).map((o) => o.textContent)).toEqual(["All marks", "Revenue"]);
    expect(targetSelect.textContent).not.toMatch(/All nodes/);
  });

  // A CHANGED `allTargetsLabel` (not just a changed targets list) must also
  // refresh the dropdown's own options — the same refresh effect P1-2's own
  // "changed targets list" test above pins, now keyed on the label too.
  // Mutation: build `targetKey` from `targets` alone, dropping
  // `allTargetsLabel` → this reddens (the stale label survives the rerender).
  it("a changed `allTargetsLabel` alone refreshes the Target dropdown's own options", () => {
    const host = render({
      effectIds: ["none"], targets: [{ id: "n0", label: "Planner" }],
      allTargetsLabel: "All nodes",
      state: { effectId: "none", targetId: INSTRUMENT_3D_EFFECT_ALL_TARGET }, onChange: () => {}, visible: true,
    });
    rerender({
      effectIds: ["none"], targets: [{ id: "n0", label: "Planner" }],
      allTargetsLabel: "All marks",
      state: { effectId: "none", targetId: INSTRUMENT_3D_EFFECT_ALL_TARGET }, onChange: () => {}, visible: true,
    });
    const targetSelect = selectByLabel(host, "Target");
    expect(Array.from(targetSelect.options).map((o) => o.textContent)).toEqual(["All marks", "Planner"]);
  });

  // Mutation: drop the `visible ? folder.show() : folder.hide()` effect → this reddens.
  it("hides the whole folder when `visible` is false, shows it when true", () => {
    const host = render({
      effectIds: ["none"], targets: [],
      state: { effectId: "none", targetId: INSTRUMENT_3D_EFFECT_ALL_TARGET }, onChange: () => {}, visible: false,
    });
    const folderEl = Array.from(host.querySelectorAll(".lil-gui")).find((el) => el.querySelector(":scope > .title")?.textContent === "Effects") as HTMLElement;
    expect(folderEl.style.display).toBe("none");
    rerender({
      effectIds: ["none"], targets: [],
      state: { effectId: "none", targetId: INSTRUMENT_3D_EFFECT_ALL_TARGET }, onChange: () => {}, visible: true,
    });
    expect(folderEl.style.display).not.toBe("none");
  });
});

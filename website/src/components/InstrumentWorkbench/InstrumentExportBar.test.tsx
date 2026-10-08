// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { InstrumentExportBar } from "./InstrumentExportBar";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const measurement = vi.hoisted(() => ({ size: { width: 280, height: 70 } }));
vi.mock("../../hooks/useElementSize", () => ({ useElementSize: () => measurement.size }));

it("publishes the current footer height to the shared shell and removes it on unmount", () => {
  const shell = document.createElement("div");
  shell.className = "synth-shell";
  document.body.append(shell);
  const root = createRoot(shell);
  act(() => root.render(<InstrumentExportBar>Actions</InstrumentExportBar>));
  expect(shell.style.getPropertyValue("--instrument-export-height")).toBe("70px");
  measurement.size = { width: 600, height: 28 };
  act(() => root.render(<InstrumentExportBar>Actions</InstrumentExportBar>));
  expect(shell.style.getPropertyValue("--instrument-export-height")).toBe("28px");
  act(() => root.unmount());
  expect(shell.style.getPropertyValue("--instrument-export-height")).toBe("");
  shell.remove();
});

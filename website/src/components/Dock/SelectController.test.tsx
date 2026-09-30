// @vitest-environment happy-dom
import { StrictMode, act, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { Dock } from "./Dock";
import { useDockGui } from "./slots";
import { useOption, type DockOptionController } from "./primitives";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it("shares BracketSelect while retaining controlled values, disabled state, options and StrictMode cleanup", () => {
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  const changed = vi.fn();
  let control: DockOptionController<number> | null = null;
  function Field({ value }: { value: number }) {
    control = useOption(useDockGui(), "Selection", { Short: 1, "A longer label": 2 }, value, changed);
    useEffect(() => { control?.setEnabled(true); }, [control]);
    return null;
  }
  const render = (value: number) => act(() => root.render(<StrictMode><Dock><Field value={value} /></Dock></StrictMode>));
  try {
    render(1);
    expect(host.querySelectorAll(".gx-select select")).toHaveLength(1);
    let select = host.querySelector("select")!;
    expect(select.selectedOptions[0]!.textContent).toBe("Short");
    act(() => { select.selectedIndex = 1; select.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(changed).toHaveBeenCalledExactlyOnceWith(2);
    render(1);
    // Explicit state restoration must refresh the same native select.
    act(() => control!.setValue(1));
    expect(select.selectedOptions[0]!.textContent).toBe("Short");
    act(() => control!.raw.disable());
    expect(select.disabled).toBe(true);
    act(() => control!.setEnabled(true));
    expect(select.disabled).toBe(false);
    act(() => { control!.setOptions({ Updated: 1, Third: 3 }); control!.setValue(3); });
    select = host.querySelector("select")!;
    expect([...select.options].map(option => option.textContent)).toEqual(["Updated", "Third"]);
    expect(select.selectedOptions[0]!.textContent).toBe("Third");
    expect(host.querySelectorAll(".gx-select select")).toHaveLength(1);
  } finally { act(() => root.unmount()); host.remove(); }
  expect(host.childElementCount).toBe(0);
});

it("uses shared choices with typed values, keyboard selection and disabled state", () => {
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host); const changed = vi.fn();
  let control: DockOptionController<string> | null = null;
  function Field() {
    control = useOption(useDockGui(), "Color encoding", { Spans: "spans", Atlas: "atlas" }, "spans", changed, "choices");
    return null;
  }
  try {
    act(() => root.render(<StrictMode><Dock><Field /></Dock></StrictMode>));
    expect(host.querySelector("select")).toBeNull();
    const buttons = host.querySelectorAll<HTMLButtonElement>('[role="radiogroup"] button');
    expect(buttons).toHaveLength(2);
    expect(buttons[0]!.getAttribute("aria-pressed")).toBe("true");
    act(() => buttons[0]!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
    expect(changed).toHaveBeenCalledExactlyOnceWith("atlas");
    expect(buttons[1]!.getAttribute("aria-pressed")).toBe("true");
    act(() => control!.setEnabled(false));
    expect([...buttons].every(button => button.disabled)).toBe(true);
    act(() => { control!.setEnabled(true); control!.setValue("spans"); });
    expect(buttons[0]!.getAttribute("aria-pressed")).toBe("true");
  } finally { act(() => root.unmount()); host.remove(); }
});

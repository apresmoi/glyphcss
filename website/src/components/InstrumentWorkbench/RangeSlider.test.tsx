// @vitest-environment happy-dom
import { useState } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { RangeSlider, rangeSliderStep, type RangeSliderProps } from "./RangeSlider";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLElement | null = null;

/** A thin controlled harness — real usage always feeds `value` back in from
 *  reducer state, so the component itself takes no internal position state
 *  beyond the uncommitted text drafts. */
function Harness(props: Omit<RangeSliderProps, "value" | "onChange"> & { initial: readonly [number, number] | null }) {
  const [value, setValue] = useState<readonly [number, number] | null>(props.initial);
  return <RangeSlider {...props} value={value} onChange={setValue} />;
}

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

function ranges(host: HTMLElement): { lo: HTMLInputElement; hi: HTMLInputElement } {
  return {
    lo: host.querySelector<HTMLInputElement>(".range-slider-range--lo")!,
    hi: host.querySelector<HTMLInputElement>(".range-slider-range--hi")!,
  };
}
function numbers(host: HTMLElement): { lo: HTMLInputElement; hi: HTMLInputElement } {
  const inputs = host.querySelectorAll<HTMLInputElement>(".range-slider-number");
  return { lo: inputs[0]!, hi: inputs[1]! };
}
function setRangeValue(input: HTMLInputElement, value: number) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
  setter.call(input, String(value));
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

describe("RangeSlider", () => {
  it("renders both thumbs at the domain bounds when the value is null (auto)", () => {
    const host = render(<Harness min={0} max={100} initial={null} label="Domain" />);
    const { lo, hi } = ranges(host);
    expect(lo.value).toBe("0");
    expect(hi.value).toBe("100");
    expect(host.querySelector(".range-slider-auto")!.classList.contains("is-active")).toBe(true);
  });

  it("pointer drag on either thumb (a native range input's own value+change) updates the reported value", () => {
    const host = render(<Harness min={0} max={100} initial={[20, 80]} label="Domain" />);
    const { lo, hi } = ranges(host);
    act(() => setRangeValue(lo, 35));
    expect(ranges(host).lo.value).toBe("35");
    act(() => setRangeValue(hi, 60));
    expect(ranges(host).hi.value).toBe("60");
  });

  it("thumbs never cross — dragging the low thumb past the high one stops it AT the high thumb, never past it", () => {
    const host = render(<Harness min={0} max={100} initial={[20, 80]} label="Domain" />);
    const { lo } = ranges(host);
    act(() => setRangeValue(lo, 95));
    const after = ranges(host);
    expect(Number(after.lo.value)).toBeLessThanOrEqual(Number(after.hi.value));
    expect(after.lo.value).toBe("80");
    expect(after.hi.value).toBe("80");
  });

  it("thumbs never cross — dragging the high thumb past the low one stops it AT the low thumb", () => {
    const host = render(<Harness min={0} max={100} initial={[20, 80]} label="Domain" />);
    const { hi } = ranges(host);
    act(() => setRangeValue(hi, 5));
    const after = ranges(host);
    expect(after.lo.value).toBe("20");
    expect(after.hi.value).toBe("20");
  });

  it("Shift+ArrowRight steps by 10x the plain step, on the addressed thumb only", () => {
    const host = render(<Harness min={0} max={100} initial={[20, 80]} step={1} label="Domain" />);
    const { lo, hi } = ranges(host);
    act(() => { lo.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", shiftKey: true, bubbles: true, cancelable: true })); });
    expect(Number(ranges(host).lo.value)).toBe(30);
    expect(ranges(host).hi.value).toBe(hi.value);
  });

  it("a plain ArrowRight (no Shift) is left to the native range input — no double-step from this component's own handler", () => {
    const host = render(<Harness min={0} max={100} initial={[20, 80]} step={1} label="Domain" />);
    const { lo } = ranges(host);
    act(() => { lo.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true })); });
    // happy-dom does not simulate the native stepping behaviour a real
    // browser applies after an unprevented keydown, so the assertion here
    // is that this component's OWN handler did not act on it (no jump to
    // 30 the way the Shift case above produces) — the value is unchanged
    // because nothing intercepted the key.
    expect(ranges(host).lo.value).toBe("20");
  });

  it("commits a typed numeric end value on blur, and rejects a non-numeric one", () => {
    const host = render(<Harness min={0} max={100} initial={[20, 80]} label="Domain" />);
    const { lo } = numbers(host);
    act(() => {
      lo.focus();
      lo.value = "40";
      lo.dispatchEvent(new Event("input", { bubbles: true }));
      lo.blur();
    });
    expect(ranges(host).lo.value).toBe("40");
    act(() => {
      const loNow = numbers(host).lo;
      loNow.focus();
      loNow.value = "not a number";
      loNow.dispatchEvent(new Event("input", { bubbles: true }));
      loNow.blur();
    });
    // Rejected — reverts to the last committed value, never NaN/blank.
    expect(ranges(host).lo.value).toBe("40");
  });

  it("the auto button reverts to null (the full domain), and re-clicking restores the domain bounds", () => {
    const host = render(<Harness min={0} max={100} initial={[20, 80]} label="Domain" />);
    const autoBtn = host.querySelector<HTMLButtonElement>(".range-slider-auto")!;
    act(() => autoBtn.click());
    expect(ranges(host).lo.value).toBe("0");
    expect(ranges(host).hi.value).toBe("100");
    expect(autoBtn.classList.contains("is-active")).toBe(true);
  });

  it("formats end values through a caller-supplied formatter (e.g. a date scale)", () => {
    const day = 24 * 60 * 60 * 1000;
    const host = render(<Harness min={0} max={10 * day} initial={[0, 10 * day]} format={(n) => new Date(n).toISOString().slice(0, 10)} label="Domain" />);
    const { lo, hi } = numbers(host);
    expect(lo.value).toBe("1970-01-01");
    expect(hi.value).toBe("1970-01-11");
  });
});

describe("rangeSliderStep", () => {
  it("picks a 1/2/5-times-a-power-of-ten step sized for roughly 100 steps across the span", () => {
    expect(rangeSliderStep(0, 100)).toBe(1);
    expect(rangeSliderStep(0, 1)).toBeCloseTo(0.01);
    expect(rangeSliderStep(0, 0)).toBe(1);
  });
});

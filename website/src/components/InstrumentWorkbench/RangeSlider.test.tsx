// @vitest-environment happy-dom
import { useState } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RangeSlider, rangeSliderStep, type RangeSliderProps } from "./RangeSlider";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLElement | null = null;

/** A thin controlled harness — real usage always feeds `value` back in from
 *  reducer state, so the component itself takes no internal position state
 *  beyond the uncommitted text drafts. */
function Harness(props: Omit<RangeSliderProps, "value" | "onChange"> & { initial: readonly [number | null, number | null] | null }) {
  const [value, setValue] = useState<readonly [number | null, number | null] | null>(props.initial);
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

  it("focus+blur with NO edit commits nothing (P2-2)", () => {
    const onChange = vi.fn();
    function Controlled() {
      const [value, setValue] = useState<readonly [number | null, number | null] | null>(null);
      return <RangeSlider min={0} max={100} value={value} onChange={(next) => { onChange(next); setValue(next); }} label="Domain" />;
    }
    const host = render(<Controlled />);
    const { lo } = numbers(host);
    act(() => { lo.focus(); lo.blur(); });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("emptying an end field clears that end back to auto (per-end null), leaving the other explicit", () => {
    const host = render(<Harness min={0} max={100} initial={[20, 80]} label="Domain" />);
    const { lo } = numbers(host);
    act(() => { lo.focus(); lo.value = ""; lo.dispatchEvent(new Event("input", { bubbles: true })); lo.blur(); });
    // Cleared end reverts to the domain fallback (0, since no `domain` prop
    // was given here so it defaults to `[min, max]`) while the untouched
    // high end stays exactly 80 — never `Number("") === 0` silently
    // overwriting it, and never both ends wiped to full auto.
    expect(ranges(host).lo.value).toBe("0");
    expect(ranges(host).hi.value).toBe("80");
  });

  it("the auto button reverts to null (the full domain), and re-clicking materialises the DOMAIN (not the padded bounds)", () => {
    const host = render(<Harness min={-20} max={120} domain={[0, 100]} initial={[20, 80]} label="Domain" />);
    const autoBtn = host.querySelector<HTMLButtonElement>(".range-slider-auto")!;
    act(() => autoBtn.click());
    expect(ranges(host).lo.value).toBe("0"); // shows the wider PADDED bounds' own min while auto
    expect(autoBtn.classList.contains("is-active")).toBe(true);
    act(() => autoBtn.click());
    // Materialised to the DOMAIN (0, 100), never the padded bounds
    // (-20, 120) — a click from auto must never itself change the render.
    expect(ranges(host).lo.value).toBe("0");
    expect(ranges(host).hi.value).toBe("100");
    expect(autoBtn.classList.contains("is-active")).toBe(false);
  });

  it("a typed value may exceed min/max — the component never clamps a text-field commit to its own bounds (P2-1)", () => {
    const onChange = vi.fn();
    const host = render(<RangeSlider min={0} max={100} value={[20, 80]} onChange={onChange} label="Domain" />);
    const { hi } = numbers(host);
    act(() => { hi.focus(); hi.value = "1000"; hi.dispatchEvent(new Event("input", { bubbles: true })); hi.blur(); });
    expect(onChange).toHaveBeenCalledWith([20, 1000]);
  });

  it("loCeiling/hiFloor cap each THUMB independently of the outer min/max bounds — a bar/area/rect y-domain's own zero-anchor rule", () => {
    const host = render(<Harness min={-20} max={20} loCeiling={0} hiFloor={0} initial={[-10, 10]} label="Domain" />);
    const { lo, hi } = ranges(host);
    expect(lo.max).toBe("0");
    expect(hi.min).toBe("0");
    // A drag past the cap is clamped AT it, never past — the domain can
    // never end up excluding zero from this control alone.
    act(() => setRangeValue(lo, 15));
    expect(Number(ranges(host).lo.value)).toBeLessThanOrEqual(0);
    act(() => setRangeValue(hi, -15));
    expect(Number(ranges(host).hi.value)).toBeGreaterThanOrEqual(0);
  });

  it("loCeiling/hiFloor are enforced on a TYPED value too, not just a thumb drag", () => {
    const onChange = vi.fn();
    const host = render(<RangeSlider min={-20} max={20} loCeiling={0} hiFloor={0} value={[-10, 10]} onChange={onChange} label="Domain" />);
    const { lo } = numbers(host);
    act(() => { lo.focus(); lo.value = "5"; lo.dispatchEvent(new Event("input", { bubbles: true })); lo.blur(); });
    expect(onChange).toHaveBeenCalledWith([0, 10]);
  });

  // NEW-4 (REVIEW-dock-colours-sliders-opus-round2.md): WITH a `capReason`,
  // the same illegal typed value is REFUSED (never committed, structured
  // inline message shown) instead of silently substituted — the prior test
  // pins the no-`capReason` fallback (still a silent clamp) so this one
  // isolates exactly what `capReason` changes.
  it("with capReason, a typed value beyond loCeiling/hiFloor is refused with an inline message, never committed", () => {
    const onChange = vi.fn();
    const host = render(<RangeSlider min={-20} max={20} loCeiling={0} hiFloor={0} capReason="Must include zero." value={[-10, 10]} onChange={onChange} label="Domain" />);
    const { lo } = numbers(host);
    act(() => { lo.focus(); lo.value = "5"; lo.dispatchEvent(new Event("input", { bubbles: true })); lo.blur(); });
    expect(onChange).not.toHaveBeenCalled();
    expect(numbers(host).lo.value).toBe("-10"); // reverted, never "5" or the clamped "0"
    expect(host.querySelector(".range-slider-error")?.textContent).toBe("Must include zero.");
    // Retyping (even an eventually-rejected value) clears the stale
    // message immediately — via the native value SETTER, not a plain
    // `.value =` assignment, since React's own patched setter is what
    // makes it re-fire `onChange` for a value it already tracks as
    // current (the same reason `setRangeValue` above exists).
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
    act(() => { const field = numbers(host).lo; setter.call(field, "1"); field.dispatchEvent(new Event("input", { bubbles: true })); });
    expect(host.querySelector(".range-slider-error")).toBeNull();
  });

  // NEW-1 (REVIEW-dock-colours-sliders-opus-round2.md): `loFloor` is the
  // log scale's OWN cap — it refuses `0`/negative exactly like `capReason`
  // above, but on BOTH ends, and a value that's merely SMALL (not
  // illegal) stays reachable even when it undercuts the padded `min`,
  // because P2-1's "a typed value may exceed the visible bounds" rule
  // must survive this fix (round 1's own repro: 0.001 renders fine).
  it("with loFloor, a typed 0 or negative value is refused on EITHER end; a small positive value under min still commits", () => {
    const onChange = vi.fn();
    const host = render(<RangeSlider min={0.8} max={1200} loFloor={1e-6} capReason="A log domain must have one sign and exclude zero." value={[1, 1000]} onChange={onChange} label="Domain" />);
    const { lo, hi } = numbers(host);
    act(() => { lo.focus(); lo.value = "0"; lo.dispatchEvent(new Event("input", { bubbles: true })); lo.blur(); });
    expect(onChange).not.toHaveBeenCalled();
    expect(numbers(host).lo.value).toBe("1");
    expect(host.querySelector(".range-slider-error")?.textContent).toBe("A log domain must have one sign and exclude zero.");
    act(() => { const h = numbers(host).hi; h.focus(); h.value = "-5"; h.dispatchEvent(new Event("input", { bubbles: true })); h.blur(); });
    expect(onChange).not.toHaveBeenCalled();
    // Mutation: dropping the `loFloor` check entirely would let both of the
    // above commit (the log-domain rule's exact P2 regression) — asserted
    // above via `onChange` never firing, not merely via the message.
    act(() => { lo.focus(); lo.value = "0.001"; lo.dispatchEvent(new Event("input", { bubbles: true })); lo.blur(); });
    expect(onChange).toHaveBeenCalledWith([0.001, 1000]);
  });

  // NEW-2 (REVIEW-dock-colours-sliders-opus-round2.md): a commit from ONE
  // end must write only that end — the untouched sibling's own `value`
  // slot rides through as whatever it already was (here, `null` — fully
  // auto), never materialised into a concrete number it was never asked
  // to change. Gated at both the thumb-drag AND the typed-field commit
  // path, since each used to independently resolve the sibling through
  // `lo`/`hi` (the DOMAIN-fallback value) instead of `rawLo`/`rawHi`.
  describe("a commit from one end writes ONLY that end (NEW-2)", () => {
    it("dragging the low thumb leaves an auto high end untouched", () => {
      const onChange = vi.fn();
      const host = render(<RangeSlider min={0} max={100} domain={[0, 100]} value={[null, 80]} onChange={onChange} label="Domain" />);
      const { lo } = ranges(host);
      act(() => setRangeValue(lo, 35));
      expect(onChange).toHaveBeenCalledWith([35, 80]);
    });
    it("dragging the high thumb leaves an auto low end untouched", () => {
      const onChange = vi.fn();
      const host = render(<RangeSlider min={0} max={100} domain={[0, 100]} value={[20, null]} onChange={onChange} label="Domain" />);
      const { hi } = ranges(host);
      act(() => setRangeValue(hi, 60));
      expect(onChange).toHaveBeenCalledWith([20, 60]);
    });
    it("typing a low end value leaves a fully-auto high end untouched", () => {
      const onChange = vi.fn();
      const host = render(<RangeSlider min={0} max={100} domain={[0, 100]} value={null} onChange={onChange} label="Domain" />);
      const { lo } = numbers(host);
      act(() => { lo.focus(); lo.value = "35"; lo.dispatchEvent(new Event("input", { bubbles: true })); lo.blur(); });
      expect(onChange).toHaveBeenCalledWith([35, null]);
    });
    // Mutation: resolving the sibling from `lo`/`hi` (the auto-fallback
    // value) instead of `rawLo`/`rawHi` would make this assert `[null, 60]`
    // become `[0, 60]` instead — the exact NEW-2 defect (the untouched end
    // silently pinned to the domain's current edge, which then stops
    // tracking the data).
    it("emptying the low field back to auto, then dragging the high thumb, still writes a null low end", () => {
      let last: readonly [number | null, number | null] | null = [20, 80];
      const onChange = vi.fn((next: readonly [number | null, number | null] | null) => { last = next; });
      function Controlled() {
        const [value, setValue] = useState<readonly [number | null, number | null] | null>([20, 80]);
        return <RangeSlider min={0} max={100} domain={[0, 100]} value={value} onChange={(next) => { onChange(next); setValue(next); }} label="Domain" />;
      }
      const host = render(<Controlled />);
      const { lo: loField } = numbers(host);
      act(() => { loField.focus(); loField.value = ""; loField.dispatchEvent(new Event("input", { bubbles: true })); loField.blur(); });
      expect(last).toEqual([null, 80]);
      const { hi } = ranges(host);
      act(() => setRangeValue(hi, 60));
      expect(last).toEqual([null, 60]);
    });
  });

  it("coincident thumbs: a pointerDOWN (no prior hover) on the LEFT side re-grabs the low thumb — touch's first event is pointerdown, not pointermove (NEW-6)", () => {
    const host = render(<Harness min={0} max={100} initial={[50, 50]} label="Domain" />);
    const track = host.querySelector<HTMLDivElement>(".range-slider-track")!;
    Object.defineProperty(track, "getBoundingClientRect", { value: () => ({ left: 0, width: 100, top: 0, height: 18, right: 100, bottom: 18 }), configurable: true });
    expect(ranges(host).lo.classList.contains("is-front")).toBe(false);
    act(() => { track.dispatchEvent(new MouseEvent("pointerdown", { clientX: 20, bubbles: true })); });
    expect(ranges(host).lo.classList.contains("is-front")).toBe(true);
    expect(ranges(host).hi.classList.contains("is-front")).toBe(false);
  });

  it("coincident thumbs: hovering the LEFT side of the pinned point re-grabs the low thumb for the next click (P3-4)", () => {
    const host = render(<Harness min={0} max={100} initial={[50, 50]} label="Domain" />);
    const track = host.querySelector<HTMLDivElement>(".range-slider-track")!;
    const { lo, hi } = ranges(host);
    // Fresh coincidence, no hover yet — the base CSS (`--hi` z-index 2 over
    // `--lo`'s 1) is what a real click would hit; neither carries `.is-front`.
    expect(lo.classList.contains("is-front")).toBe(false);
    expect(hi.classList.contains("is-front")).toBe(false);
    Object.defineProperty(track, "getBoundingClientRect", { value: () => ({ left: 0, width: 100, top: 0, height: 18, right: 100, bottom: 18 }), configurable: true });
    act(() => { track.dispatchEvent(new MouseEvent("pointermove", { clientX: 20, bubbles: true })); });
    expect(ranges(host).lo.classList.contains("is-front")).toBe(true);
    expect(ranges(host).hi.classList.contains("is-front")).toBe(false);
    act(() => { track.dispatchEvent(new MouseEvent("pointermove", { clientX: 80, bubbles: true })); });
    expect(ranges(host).lo.classList.contains("is-front")).toBe(false);
    expect(ranges(host).hi.classList.contains("is-front")).toBe(true);
  });

  it("disabled renders every control inert and carries the reason as a title", () => {
    const host = render(<Harness min={0} max={100} initial={null} label="Domain" disabled disabledReason="A log domain must have one sign and exclude zero." />);
    expect(host.querySelector(".range-slider")!.getAttribute("title")).toBe("A log domain must have one sign and exclude zero.");
    for (const el of host.querySelectorAll("input, button")) expect((el as HTMLInputElement | HTMLButtonElement).disabled).toBe(true);
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

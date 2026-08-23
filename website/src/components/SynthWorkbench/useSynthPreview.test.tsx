// @vitest-environment happy-dom
//
// Item 4 (performance): the left-sidebar voice-card previews and footer
// preset tiles each mount their own `createGlyphScene` render loop via
// `useSynthPreview`. With ~20 preset tiles plus several voice cards live at
// once, that's dozens of concurrent rAF loops wrecking page performance.
// `useSynthPreview` now defaults to STATIC (one representative frame, no
// running loop) and only animates while its `animate` argument is `true` —
// callers drive that from hover state. This file proves the hook itself:
// no loop by default, and it starts/stops cleanly when `animate` flips.
// Uses the same happy-dom + createRoot/act + `@glyphcss/effects` canvas-stub
// pattern as LayerGroup.test.tsx (see that file's header for why the mock is
// needed just to import synthKit.tsx under happy-dom).
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@glyphcss/effects", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@glyphcss/effects")>();
  return {
    ...actual,
    calibrateGlyphRamp: () => ({ ramp: " .:-=+*#%@", steps: [] }),
  };
});

import { synthDefaults, useSynthPreview } from "./synthKit";

// A minimal host component: mounts the preview into a plain `<div>` and
// reports every `onTick` call (the same callback VoiceCard's own trendline
// SVG is driven by) so the test can assert "is the loop actually running"
// behaviorally, not by reaching into the hook's private rAF bookkeeping.
function PreviewHarness({ animate, onTickCount }: { animate: boolean; onTickCount: (n: number) => void }) {
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  let count = 0;
  useSynthPreview(
    host,
    () => synthDefaults(),
    [host],
    () => { count += 1; onTickCount(count); },
    "plane",
    animate,
  );
  return <div ref={setHost} />;
}

function renderHarness(animate: boolean, onTickCount: (n: number) => void): { container: HTMLElement; root: Root; setAnimate: (v: boolean) => void } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  let currentAnimate = animate;
  const paint = (): void => { act(() => { root.render(<PreviewHarness animate={currentAnimate} onTickCount={onTickCount} />); }); };
  paint();
  return {
    container,
    root,
    setAnimate: (v: boolean) => { currentAnimate = v; paint(); },
  };
}

// A second harness whose preview params carry a caller-supplied threshold —
// standing in for a LayerGroup shaping param (e.g. `layerThreshold1`) — so a
// test can prove `useSynthPreview` re-renders the STATIC frame when a param
// this hook's caller lists in `deps` changes, without starting a running
// loop. This is the missing static-refresh case the gate flagged: every
// existing test above only ever exercises the `animate` toggle, never a
// param edit while static.
// `onTick` fires with no payload — the caller's own closure counts calls.
// (Counting via a local variable INSIDE the component body, like
// `PreviewHarness` above, would reset that counter every re-render, which
// is exactly the re-render this test triggers via `setThreshold` — so it
// can't be used to prove a tick happened AFTER an edit.)
function ParamEditHarness({ threshold, onTick }: { threshold: number; onTick: () => void }) {
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  useSynthPreview(
    host,
    () => ({ ...synthDefaults(), layerThreshold1: threshold }),
    [threshold],
    onTick,
    "plane",
    false,
  );
  return <div ref={setHost} />;
}

function renderParamEditHarness(threshold: number, onTick: () => void): { setThreshold: (v: number) => void } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  let current = threshold;
  const paint = (): void => { act(() => { root.render(<ParamEditHarness threshold={current} onTick={onTick} />); }); };
  paint();
  return { setThreshold: (v: number) => { current = v; paint(); } };
}

describe("useSynthPreview — static-by-default, hover-to-animate (item 4)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance"] });
  });
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  it("animate: false settles on mount and never schedules a running loop afterward", () => {
    let ticks = 0;
    renderHarness(false, (n) => { ticks = n; });
    // Mount may fire the static render more than once (the scene-mount
    // effect and the animate-effect can both settle on the same frame — see
    // useSynthPreview's own doc) but that's a one-time, synchronous cost at
    // rest, never a per-frame one. What actually matters for the "dozens of
    // concurrent loops" perf problem this fixes is what happens NEXT.
    const settledOnMount = ticks;
    expect(settledOnMount).toBeGreaterThan(0);

    // Advance a full second of frames — a running loop would keep ticking;
    // a static preview must stay exactly where it settled.
    act(() => { vi.advanceTimersByTime(1000); });
    expect(ticks).toBe(settledOnMount);
  });

  it("animate: true keeps ticking as time advances (a genuinely running loop)", () => {
    let ticks = 0;
    renderHarness(true, (n) => { ticks = n; });
    const afterMount = ticks;

    act(() => { vi.advanceTimersByTime(500); });
    expect(ticks).toBeGreaterThan(afterMount);

    const afterHalfSecond = ticks;
    act(() => { vi.advanceTimersByTime(500); });
    expect(ticks).toBeGreaterThan(afterHalfSecond);
  });

  it("toggling animate false -> true starts the loop (hover begins)", () => {
    let ticks = 0;
    const { setAnimate } = renderHarness(false, (n) => { ticks = n; });
    act(() => { vi.advanceTimersByTime(500); });
    const stillStatic = ticks;
    expect(stillStatic).toBeGreaterThan(0);

    setAnimate(true);
    const afterToggleOn = ticks;
    act(() => { vi.advanceTimersByTime(500); });
    expect(ticks).toBeGreaterThan(afterToggleOn);
  });

  it("toggling animate true -> false stops the loop (hover ends) and freezes", () => {
    let ticks = 0;
    const { setAnimate } = renderHarness(true, (n) => { ticks = n; });
    act(() => { vi.advanceTimersByTime(500); });
    expect(ticks).toBeGreaterThan(1); // was animating

    setAnimate(false);
    const afterToggleOff = ticks;
    act(() => { vi.advanceTimersByTime(1000); });
    // The one static re-render fired by the toggle itself is allowed, but no
    // further ticks should follow — a stopped loop can't still be running.
    expect(ticks).toBeLessThanOrEqual(afterToggleOff + 1);
    const settled = ticks;
    act(() => { vi.advanceTimersByTime(1000); });
    expect(ticks).toBe(settled);
  });

  // Gate finding — the missing static-refresh test: a param edit while
  // `animate` stays `false` must still re-render the static frame (so a
  // voice card's preview/trendline reflects the edit), without that edit
  // ever starting a running loop.
  it("editing a deps param while static re-renders the frame without starting a running loop", () => {
    let ticks = 0;
    const { setThreshold } = renderParamEditHarness(0, () => { ticks += 1; });
    const afterMount = ticks;
    expect(afterMount).toBeGreaterThan(0);

    // No running loop yet: advancing time alone must not tick further.
    act(() => { vi.advanceTimersByTime(500); });
    expect(ticks).toBe(afterMount);

    // Editing the threshold param (a deps entry) re-renders exactly once,
    // synchronously, without scheduling a loop.
    setThreshold(0.5);
    expect(ticks).toBeGreaterThan(afterMount);
    const afterEdit = ticks;

    act(() => { vi.advanceTimersByTime(1000); });
    expect(ticks).toBe(afterEdit);
  });
});

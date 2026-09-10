import { useEffect, useId, useRef, useState } from "react";

import { AttributionCredit } from "../AttributionCredit/AttributionCredit";
import { mapCreditNoticeText, mapCreditSummary, type MapCreditSource } from "./mapsCredits";

/**
 * The map's credit, as every map product ships it: ONE line naming the
 * sources, with the full notice one tap behind a `©` affordance.
 *
 * `mapsCredits.ts` owns the rule (which credits are obligations, which are
 * courtesy, and why compressing the courtesy ones is compliant); this owns
 * only the presentation. Nothing is dropped — the expanded panel is the
 * unchanged `AttributionCredit`, every source with its licence, its date and
 * its link, and it is the SAME component `/gallery` renders under its models
 * sidebar rather than a second one written to look like it.
 *
 * The name budget is the one thing that varies by breakpoint, because the
 * line's width does: three names fit the desktop map's bottom edge, one fits
 * a 390px phone. `--maps-credit-names` is that budget, published by
 * `maps-workbench.css` at each breakpoint so the number lives beside the
 * layout it is derived from instead of in a second media query here.
 */
const NAME_BUDGET_FALLBACK = 3;

function useCreditNameBudget(host: HTMLElement | null): number {
  const [budget, setBudget] = useState(NAME_BUDGET_FALLBACK);
  useEffect(() => {
    if (!host) return;
    const read = () => {
      const raw = getComputedStyle(host).getPropertyValue("--maps-credit-names").trim();
      const parsed = Number.parseInt(raw, 10);
      setBudget(Number.isFinite(parsed) && parsed > 0 ? parsed : NAME_BUDGET_FALLBACK);
    };
    read();
    // The budget is a breakpoint's opinion, so it changes on resize and on
    // nothing else — no ResizeObserver on an element that is 20px tall.
    window.addEventListener("resize", read);
    return () => window.removeEventListener("resize", read);
  }, [host]);
  return budget;
}

export function MapCredits({ sources }: { readonly sources: readonly MapCreditSource[] }) {
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const budget = useCreditNameBudget(host);

  // Dismiss like the popover it is: Escape, or a pointer anywhere else. A
  // credit panel that stays open over the map after the reader has moved on
  // is the same cost the wall of rows was.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    const onDown = (e: PointerEvent) => {
      const root = rootRef.current;
      if (root && e.target instanceof Node && !root.contains(e.target)) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown);
    };
  }, [open]);

  if (sources.length === 0) return null;
  const summary = mapCreditSummary(sources, { maxNames: budget });

  return (
    <div
      className={`maps-attribution${open ? " is-open" : ""}`}
      ref={(el) => { rootRef.current = el; setHost(el); }}
    >
      {open && (
        <div className="maps-attribution__detail" id={panelId}>
          <AttributionCredit
            attributions={summary.sources.map((s) => ({
              creator: s.name,
              license: s.license,
              sourceUrl: s.url,
              date: s.date,
            }))}
          />
        </div>
      )}
      <button
        type="button"
        className="maps-attribution__toggle"
        aria-expanded={open}
        aria-controls={panelId}
        // The affordance is what makes the compression compliant on a
        // constrained display, so it says what it leads to in words a screen
        // reader gets whether or not the `+N` is on screen.
        aria-label={open
          ? "Hide data source credits"
          : `Show data source credits (${summary.sources.length} sources)`}
        title="Data sources and licences"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="maps-attribution__notice">{mapCreditNoticeText(summary)}</span>
        {summary.hiddenCount > 0 && (
          <span className="maps-attribution__more">+{summary.hiddenCount}</span>
        )}
      </button>
    </div>
  );
}

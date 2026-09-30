import { IconToggle } from "../../IconToggle";
import { SliderRow } from "../../SliderRow";
import { type LiveFeedInputs } from "./types";

/**
 * One row of the LIVE card: a public feed, its toggle, and what it is
 * currently showing.
 *
 * Geometry is `OsmSublayerRow`'s exactly — name / widget / value, with the
 * checkbox inside the same `.maps-osm-row-widget` flex head so the card
 * body's three-column grid is unchanged. The value column carries the
 * READOUT rather than a control, because what a reader wants to know there
 * is whether the row has anything and how old it is.
 *
 * The one thing a live row does tune sits beside the checkbox instead: its
 * TIME WINDOW, as the same small per-row segmented control the OSM card's
 * label placement is (`IconToggle` in a `.gx-toggle` group), with text
 * instead of icons because "24h" and "30d" are shorter and clearer than any
 * glyph for them. Only the two rows whose time axis is real carry it — see
 * {@link LiveFeedInputs.windows}.
 *
 * The reason line is a separate row underneath and appears ONLY while
 * something is wrong. A row showing 385 events whose last refresh failed is
 * still showing something true, and saying so in a second line is what
 * distinguishes it from a row that never loaded at all.
 */
export function LiveFeedRow({
  row,
  onToggle,
  onWindow,
}: {
  row: LiveFeedInputs;
  onToggle: (on: boolean) => void;
  onWindow: (window: string) => void;
}) {
  const windowed = row.windows.length > 1;
  return (
    <>
      <SliderRow
        className={`voice-slider maps-layer-slider maps-layer-bool-row maps-osm-row maps-live-row${windowed ? " maps-live-row--windowed" : ""}`}
        title={row.tooltip}
      >
        <span>{row.label}</span>
        <span className="maps-osm-row-widget">
          <span className="layer-group-check maps-layer-bool-check">
            <input type="checkbox" checked={row.on} onChange={(e) => onToggle(e.target.checked)} />
          </span>
          {windowed && (
            // `preventDefault` on the group, in the CAPTURE phase, for the
            // reason `OsmSublayerRow`'s anchor group carries it — see the
            // longer note there. Short version: the ROW is a `<label>` whose
            // control is the checkbox beside this, a DOM that does not
            // implement the spec's interactive-descendant exemption forwards
            // a button click to it, and React's root delegation makes a
            // bubble-phase handler here too late to be seen.
            <span className="maps-live-window" onClickCapture={(e) => e.preventDefault()}>
              <IconToggle
                groupTitle={`${row.label} — how far ${row.id === "launches" ? "AHEAD" : "BACK"} this row reads. Each window is its own feed, so a narrower one is a smaller download rather than a filtered big one; the buttons say what each costs.`}
                options={row.windows.map((w) => ({
                  value: w.value,
                  icon: <span className="maps-live-window-label">{w.label}</span>,
                  label: w.label,
                  desc: w.desc,
                }))}
                value={row.window}
                onChange={onWindow}
              />
            </span>
          )}
        </span>
        <span className={`maps-layer-info-value${row.warn ? " maps-layer-info-warn" : ""}`}>{row.value}</span>
      </SliderRow>
      {row.note === null ? null : (
        <div
          className="maps-layer-info-row maps-live-note"
          title="The last refresh did not land. Whatever the row already had is still on the map; the next refresh tries again."
        >
          <span aria-hidden="true">{"\u21b3"}</span>
          <span className="maps-layer-info-value maps-layer-info-warn">{row.note}</span>
        </div>
      )}
    </>
  );
}

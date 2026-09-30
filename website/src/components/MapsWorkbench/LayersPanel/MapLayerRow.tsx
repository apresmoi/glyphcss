import { type GlyphMapLabelAnchor } from "@glyphcss/maps";
import {
  DENSITY_MAX,
  DENSITY_MIN,
  DENSITY_STEP,
  formatDensity,
  MAP_ROW_DENSITYLESS_TYPES,
  MAP_ROW_LABEL_TYPES,
} from "../../../features/maps/model/config";
import { densityFill, parseMapsNumber } from "../../../features/maps/model/inputs";
import { IconToggle } from "../../IconToggle";
import { SliderRow, SliderTrack } from "../../SliderRow";
import { OSM_LABEL_ANCHOR_TOGGLE } from "../mapsOptions";
import { MapsReadout } from "../MapsReadout";
import { type MapLayerRowInputs } from "./types";

/**
 * One row of a multi-row card.
 *
 * `titles` and `tooltip` are props rather than the OSM tables inlined,
 * because those two ARE the card-specific half: what a row's density costs
 * depends on the card's own mounted set (three OSM stroke rows sharing one
 * overlay grid is a fact about that card), and what a row IS is the card's
 * own vocabulary. Everything else — which types get a density control, which
 * get a placement control, the markup, the disabled/dimmed states — is
 * derived from the row's own `type` and is genuinely shared.
 */
export function MapLayerRow({
  row,
  titles,
  tooltip,
  onToggle,
  onDensity,
  onAnchor,
}: {
  row: MapLayerRowInputs;
  titles: Record<string, (label: string) => string>;
  tooltip: (id: string) => string | null;
  onToggle: (on: boolean) => void;
  onDensity: (v: number) => void;
  onAnchor: (anchor: GlyphMapLabelAnchor) => void;
}) {
  const wired = !MAP_ROW_DENSITYLESS_TYPES.has(row.type);
  const labelled = MAP_ROW_LABEL_TYPES.has(row.type);
  return (
    <SliderRow
      // `maps-osm-row--density-off`, NOT `maps-layer-slider--off`: on this
      // row only the DENSITY is gated — the toggle beside it is exactly how
      // a reader turns the row back on, so dimming the whole line (which is
      // what `--off` does, name column included) would read as "this control
      // is dead" about a control that is not. A densityless row never takes
      // it: there is nothing there to dim.
      className={`voice-slider maps-layer-slider maps-layer-bool-row maps-osm-row${wired && !row.on ? " maps-osm-row--density-off" : ""}${labelled ? " maps-osm-row--labelled" : ""}`}
      title={titles[row.type]?.(row.label) ?? row.label}
    >
      {/*
        The row's NAME carries what the layer IS; the `title` on the `<label>`
        around it carries what the row's DENSITY costs. Two titles rather than
        one concatenation because a browser shows the INNERMOST one, so
        pointing at "Waterways" answers "what is this?" and pointing at its
        slider answers "what does moving this cost?" — which is the question
        each of those two targets actually raises. `undefined`, never an empty
        string, for a row `mapsOsm.ts` has no summary for: an empty `title`
        renders an empty tooltip box in some browsers, and the gap is a red
        test (`mapsOsm.tooltips.test.ts`) rather than something to paper over
        here.
      */}
      <span title={tooltip(row.id) ?? undefined}>{row.label}</span>
      <span className="maps-osm-row-widget">
        <span className="layer-group-check maps-layer-bool-check">
          <input type="checkbox" checked={row.on} onChange={(e) => onToggle(e.target.checked)} />
        </span>
        {wired && (
          <SliderTrack className="voice-slider-track">
            <input
              type="range"
              min={DENSITY_MIN}
              max={DENSITY_MAX}
              step={DENSITY_STEP}
              disabled={!row.on}
              value={row.density}
              style={densityFill(row.density, DENSITY_MIN, DENSITY_MAX)}
              onChange={(e) => onDensity(+e.target.value)}
            />
          </SliderTrack>
        )}
        {labelled && (
          // `preventDefault` on the group, not on each button: the ROW is a
          // `<label>` whose control is the toggle beside this, and a click
          // that reaches the label runs its activation behaviour on that
          // checkbox. The HTML spec already exempts interactive descendants,
          // so a real browser never forwards a button click here — this is
          // the guard for anything that does not implement that clause,
          // which includes the DOM these rows are tested against.
          //
          // CAPTURE, not bubble. React delegates every handler to the ROOT
          // CONTAINER, so a bubble-phase `onClick` here does not run until
          // the native event has already passed the `<label>` on its way up
          // — and a DOM that forwards the click reads `defaultPrevented` at
          // exactly that moment. The capture pass runs before the event
          // reaches the target at all, which is early enough; a `type=button`
          // has no default action of its own to lose, and preventing a
          // default never stops a handler, so `IconToggle`'s own `onClick`
          // still fires. `LayersPanel.liveWindows.test.ts` reddens on the
          // bubble version.
          <span className="maps-osm-anchor" onClickCapture={(e) => e.preventDefault()}>
            <IconToggle
              groupTitle={`${row.label} label placement — which part of the label sits on the feature's own point (MapLibre's text-anchor). It is a per-LAYER cartographic choice, so every labelled row answers it for itself.`}
              options={OSM_LABEL_ANCHOR_TOGGLE}
              value={row.anchor}
              onChange={(v) => onAnchor(v as GlyphMapLabelAnchor)}
            />
          </span>
        )}
      </span>
      {wired && (
        <MapsReadout
          value={row.density}
          disabled={!row.on}
          format={formatDensity}
          parse={parseMapsNumber(DENSITY_MIN, DENSITY_MAX)}
          onCommit={onDensity}
          title="Type a multiplier between 1 and 4 for this row alone."
        />
      )}
    </SliderRow>
  );
}

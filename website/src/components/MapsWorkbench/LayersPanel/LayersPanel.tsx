import { type MapPaletteName, OSM_DENSITY_TITLES, PALETTE_OPTIONS } from "../../../features/maps/model/config";
import { densityFill, parseMapsNumber } from "../../../features/maps/model/inputs";
import { mapDatasetRowTooltip } from "../../../features/maps/model/mapsDatasets";
import { mapOsmStrokeOverlayCount, mapOsmSublayerTooltip } from "../../../features/maps/model/mapsOsm";
import { DATASET_DENSITY_TITLES, elevationWindowTrack } from "../../../features/maps/model/terrain";
import { BracketSelect } from "../../BracketSelect";
import { SliderRow, SliderTrack } from "../../SliderRow";
import { MapsReadout } from "../MapsReadout";
import { BoolRow } from "./BoolRow";
import { ColorRow } from "./ColorRow";
import { DensityRow } from "./DensityRow";
import { ElevationWindowRow } from "./ElevationWindowRow";
import { GlyphRow } from "./GlyphRow";
import { InfoRow } from "./InfoRow";
import { LayerCard } from "./LayerCard";
import { LiveFeedRow } from "./LiveFeedRow";
import { MapLayerRow } from "./MapLayerRow";
import { ModeRow } from "./ModeRow";
import { type ExtraLayerInputs, type LayersFolderInputs } from "./types";

export function LayersPanel({
  background,
  terrain,
  borders,
  contour,
  fill,
  symbol,
  circle,
  heatmap,
  fillExtrusion,
  model,
  osm,
  datasets,
  live,
}: LayersFolderInputs) {
  const extra = (label: string, value: ExtraLayerInputs) => (
    <LayerCard label={label} visible={value.visible} onVisible={value.onVisible}>
      <ColorRow value={value.color} onChange={value.onColor} />
      {value.dataset && (
        <label className="maps-layer-select-row" title={value.dataset.title}>
          <span>data</span>
          <BracketSelect value={value.dataset.value} onChange={(e) => value.dataset!.onChange(e.target.value)}>
            {value.dataset.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </BracketSelect>
        </label>
      )}
      {value.shape && (
        <label className="maps-layer-select-row" title={value.shape.title}>
          <span>shape</span>
          <BracketSelect value={value.shape.value} onChange={(e) => value.shape!.onChange(e.target.value)}>
            {value.shape.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </BracketSelect>
        </label>
      )}
      {value.renderMode !== undefined && value.onRenderMode !== undefined && (
        <ModeRow label={label} value={value.renderMode} onChange={value.onRenderMode} />
      )}
      {value.glyphPalette !== undefined && value.onGlyphPalette !== undefined && (
        <GlyphRow label={label} value={value.glyphPalette} onChange={value.onGlyphPalette} />
      )}
      {value.sliders.map((s) => (
        <SliderRow key={s.key} className="voice-slider" title={s.title}>
          <span>{s.label}</span>
          <SliderTrack className="voice-slider-track">
            <input
              type="range"
              min={s.min}
              max={s.max}
              step={s.step}
              value={s.value}
              style={densityFill(s.value, s.min, s.max)}
              onChange={(e) => s.onChange(+e.target.value)}
            />
          </SliderTrack>
          <MapsReadout
            value={s.value}
            format={s.format}
            parse={s.parse ?? parseMapsNumber(s.min, s.max, s.integer)}
            onCommit={s.onChange}
          />
        </SliderRow>
      ))}
    </LayerCard>
  );
  return (
    <div className="maps-layers-list">
      {/*
        One Dock row, not a card header plus a separately-labelled swatch:
        the background has no toggleable state and no density, so "Background"
        IS this row's name. The old two-part shape printed "Background" and
        then "color" on the same line, a doubled label with no counterpart
        anywhere in the Dock.
      */}
      <div className="maps-layer-background-row">
        <ColorRow
          label="Background"
          value={background.color}
          onChange={background.onColor}
          title="Background — the page colour behind every layer. Click the bar to pick, or type a hex value."
        />
      </div>
      <LayerCard label="Terrain" visible={terrain.visible} onVisible={terrain.onVisible}>
        {/*
          Labelled `colors`, not `palette`: this card now carries TWO ramps
          and "palette" names neither of them unambiguously. This one is the
          elevation-band COLOUR ramp (`GlyphMapRasterLayer.colors`); `glyphs`
          just below is the CHARACTER ramp (`GlyphMapRasterLayer.glyphPalette`
          — see `GlyphRow`'s doc). Each title names the other so a reader who
          lands on one knows the other exists.
        */}
        <label
          className="maps-layer-select-row"
          title='Terrain color palette — which COLOUR each elevation band is painted in (not which characters carry the shade; that is the "glyphs" row).'
        >
          <span>colors</span>
          <BracketSelect value={terrain.palette} onChange={(e) => terrain.onPalette(e.target.value as MapPaletteName)}>
            {Object.entries(PALETTE_OPTIONS).map(([display, value]) => (
              <option key={value} value={value}>
                {display}
              </option>
            ))}
          </BracketSelect>
        </label>
        <GlyphRow label="Terrain" value={terrain.glyphPalette} onChange={terrain.onGlyphPalette} />
        <SliderRow
          className="voice-slider"
          title="Exaggeration — vertical relief multiplier. Construction-time only: changing this rebuilds the widget."
        >
          <span>exag ×</span>
          <SliderTrack className="voice-slider-track">
            <input
              type="range"
              min={1}
              max={60}
              step={1}
              value={terrain.exaggeration}
              style={densityFill(terrain.exaggeration, 1, 60)}
              onChange={(e) => terrain.onExaggeration(+e.target.value)}
            />
          </SliderTrack>
          <MapsReadout
            value={terrain.exaggeration}
            format={(v) => String(v)}
            parse={parseMapsNumber(1, 60, true)}
            onCommit={terrain.onExaggeration}
            title="Type a multiplier between 1 and 60."
          />
        </SliderRow>
        <ElevationWindowRow
          end="floor"
          value={terrain.minElevation}
          onChange={terrain.onMinElevation}
          track={elevationWindowTrack(null, [terrain.minElevation, terrain.maxElevation])}
          title="Floor — lowest elevation the terrain SHAPE is drawn at. Terrain below it is held at the floor rather than dropped, so a floor of 0m draws the land and replaces the seabed with a smooth plane at sea level. Colours are untouched: the sea keeps its own band, it just loses its relief. Drag to the far left for no floor."
        />
        <ElevationWindowRow
          end="ceiling"
          value={terrain.maxElevation}
          onChange={terrain.onMaxElevation}
          track={elevationWindowTrack(null, [terrain.minElevation, terrain.maxElevation])}
          title="Ceiling — highest elevation the terrain SHAPE is drawn at. A ceiling of 0m flattens the land and leaves the bathymetry; floor 0 with ceiling 2000 flattens everything outside the foothills. Drag to the far right for no ceiling."
        />
        {terrain.sampler !== null && <InfoRow label="sampler" value={terrain.sampler} />}
        <DensityRow label="Terrain" density={terrain.density} onDensity={terrain.onDensity} enabled={true} />
      </LayerCard>
      <LayerCard label="Borders" visible={borders.visible} onVisible={borders.onVisible}>
        <ColorRow value={borders.color} onChange={borders.onColor} />
        {borders.simplify !== null && <InfoRow label="simplify" value={borders.simplify} />}
        <DensityRow label="Borders" density={borders.density} onDensity={borders.onDensity} enabled={true} />
      </LayerCard>
      <LayerCard label="Contour" visible={contour.visible} onVisible={contour.onVisible}>
        <ColorRow value={contour.color} onChange={contour.onColor} />
        <SliderRow
          className="voice-slider"
          title="Interval — fixed elevation spacing between contour lines (e.g. every 500m). Stays stable while panning, unlike a fixed LINE COUNT which would re-space every line whenever the visible elevation range changes."
        >
          <span>interval</span>
          <SliderTrack className="voice-slider-track">
            <input
              type="range"
              min={100}
              max={2000}
              step={100}
              value={contour.interval}
              style={densityFill(contour.interval, 100, 2000)}
              onChange={(e) => contour.onInterval(+e.target.value)}
            />
          </SliderTrack>
          <MapsReadout
            value={contour.interval}
            format={(v) => `${v}m`}
            parse={parseMapsNumber(100, 2000, true)}
            onCommit={contour.onInterval}
            title="Type a spacing in metres between 100 and 2000. Not snapped to the slider's 100 m detents."
          />
        </SliderRow>
        <ElevationWindowRow
          end="floor"
          value={contour.minElevation}
          onChange={contour.onMinElevation}
          track={elevationWindowTrack(contour.fieldRange, [contour.minElevation, contour.maxElevation])}
          title="Floor — lowest elevation contoured. Levels are both CHOSEN inside the window and CLIPPED to it, so a floor of 0m spends every line on land instead of the abyssal plains. Drag to the far left for no floor."
        />
        <ElevationWindowRow
          end="ceiling"
          value={contour.maxElevation}
          onChange={contour.onMaxElevation}
          track={elevationWindowTrack(contour.fieldRange, [contour.minElevation, contour.maxElevation])}
          title="Ceiling — highest elevation contoured. A ceiling of 0m gives bathymetry alone; floor 0 with ceiling 2000 gives the foothills. Drag to the far right for no ceiling."
        />
        <InfoRow label="lines" value={contour.lineCount === null ? "—" : String(contour.lineCount)} />
        <BoolRow
          label="labels"
          value={contour.labels}
          onChange={contour.onLabels}
          title="Labels — print the elevation on every 5th contour, in a gap in the line."
        />
        <DensityRow label="Contour" density={contour.density} onDensity={contour.onDensity} enabled={true} />
      </LayerCard>
      {extra("Fill", fill)}
      {extra("Symbol", symbol)}
      {extra("Circle", circle)}
      {extra("Heatmap", heatmap)}
      {extra("Fill extrusion", fillExtrusion)}
      {extra("Model", model)}
      <LayerCard label="OpenStreetMap" visible={osm.visible} onVisible={osm.onVisible}>
        <InfoRow label="source" value={osm.source} />
        {/*
          Only while it is true. A tile that 404s or times out leaves that
          region without data for the frame and the rest of the view intact,
          so this says how many are missing rather than letting a thinner
          render read as a broken layer.
        */}
        {osm.missing === null ? null : (
          <div
            className="maps-layer-info-row"
            title="Tiles the service did not return this frame. That region simply has no data right now; everything else still drew."
          >
            <span>tiles</span>
            <span className="maps-layer-info-value maps-layer-info-warn">{osm.missing}</span>
          </div>
        )}
        {/*
          The one cost a reader of this card can spend by accident, stated
          LIVE and where the choice is being made rather than only in a
          tooltip. Derived here from the rows the panel already has — no page
          state, and it moves in the same render as the slider that caused it.
        */}
        {(() => {
          const grids = mapOsmStrokeOverlayCount(osm.sublayers);
          if (grids === 0) return null;
          return (
            <div
              className="maps-layer-info-row"
              title="Stroke rows (Waterways, Roads, Boundaries) are stamped into full-viewport overlay grids, one per DISTINCT density, each with its own depth pass. Measured at 140x63 over a relief mesh: 6.6 ms/render with none, 27.4 ms with one grid at 2x, 63.4 ms with three at 2/2.1/2.2 — so it is the grid COUNT that is charged for, not the sharpness. Give the strokes one shared number to pay for one."
            >
              <span>stroke grids</span>
              <span className={`maps-layer-info-value${grids > 1 ? " maps-layer-info-warn" : ""}`}>
                {grids === 1 ? "1 extra pass" : `${grids} extra passes`}
              </span>
            </div>
          );
        })()}
        {osm.sublayers.map((s) => (
          <MapLayerRow
            key={s.id}
            row={s}
            titles={OSM_DENSITY_TITLES}
            tooltip={mapOsmSublayerTooltip}
            onToggle={(v) => osm.onSublayer(s.id, v)}
            onDensity={(v) => osm.onSublayerDensity(s.id, v)}
            onAnchor={(v) => osm.onSublayerAnchor(s.id, v)}
          />
        ))}
      </LayerCard>
      {/*
        DATASETS, below OpenStreetMap: these are OVERLAYS on whatever basemap
        is underneath, and the rail reads top-to-bottom as ground first, then
        what is drawn on it. Live sits below it, on the same reading.
      */}
      <LayerCard label="Datasets" visible={datasets.visible} onVisible={datasets.onVisible}>
        <InfoRow label="loaded" value={datasets.source} />
        {/*
          Only while it is true, exactly as the OSM card's missing-tiles line
          is: a file that 404s leaves its row switched on and drawing nothing,
          which is the "did I break it" reading a card has to answer rather
          than let the reader guess at.
        */}
        {datasets.failed === null ? null : (
          <div
            className="maps-layer-info-row"
            title="Rows whose data file did not load. The row stays armed and draws nothing; every other row is unaffected."
          >
            <span>failed</span>
            <span className="maps-layer-info-value maps-layer-info-warn">{datasets.failed}</span>
          </div>
        )}
        {datasets.rows.map((row) => (
          <MapLayerRow
            key={row.id}
            row={row}
            titles={DATASET_DENSITY_TITLES}
            tooltip={mapDatasetRowTooltip}
            onToggle={(v) => datasets.onRow(row.id, v)}
            onDensity={(v) => datasets.onRowDensity(row.id, v)}
            onAnchor={(v) => datasets.onRowAnchor(row.id, v)}
          />
        ))}
      </LayerCard>
      {/*
        LIVE, last on the rail. Every row is a public, keyless, openly-licensed feed read
        straight from the reader's own browser, and every row is OFF by
        default — a live layer costs somebody else's bandwidth and a reader's
        own rate-limit budget, so it is opted into rather than out of. Each
        row's tooltip says what it is AND when it has something to show,
        following the OSM card's own idiom, because "I turned it on and
        nothing appeared" is the reading a sparse layer invites.
      */}
      <LayerCard label="Live" visible={live.visible} onVisible={live.onVisible}>
        <div
          className="maps-layer-info-row"
          title="Four public feeds, fetched by your own browser with no API key and no server in between: USGS earthquakes, GDACS disaster alerts, Launch Library 2 and CelesTrak orbital elements. Each refreshes on its own cadence and credits itself in the map's attribution line while it is on."
        >
          <span>source</span>
          <span className="maps-layer-info-value">public feeds, no key</span>
        </div>
        {live.feeds.map((row) => (
          <LiveFeedRow
            key={row.id}
            row={row}
            onToggle={(on) => live.onFeed(row.id, on)}
            onWindow={(window) => live.onWindow(row.id, window)}
          />
        ))}
      </LayerCard>
    </div>
  );
}

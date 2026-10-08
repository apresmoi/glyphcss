import { useEffect, useRef } from "react";
import { mountCityLabExample } from "../../features/examples/city-lab/mountCityLabExample";
import { BracketSelect } from "../BracketSelect";
import { ExampleControls, ExampleStage } from "../ExampleControls";
import { ChoiceButton, ChoiceGroup } from "../IconToggle";
import { InstrumentSectionHeading } from "../InstrumentWorkbench";
import { SliderTrack } from "../SliderRow";
import { StatsOverlay } from "../StatsOverlay";
import styles from "./CityLabExample.module.css";
export function CityLabExample() {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (root.current) return mountCityLabExample(root.current);
  }, []);
  return (
    <div ref={root} className={styles.root}>
      <header className="map-head">
        <h1>[ ENDLESS ASCII CITY ]</h1>
        <p>
          A procedural city moving through one shared glyph grid. Drag to orbit, scroll to zoom, or use Glyph Flow to
          animate a repeating word or Matrix-style droplets across the rendered surfaces.
        </p>
      </header>
      <ExampleStage className="map-stage">
        <div data-render-host className="city-host" id="city-host">
          <div className="loading" id="loading">
            Building city…
          </div>
        </div>
        <button
          className="city-ctl-toggle"
          type="button"
          id="ctl-toggle"
          aria-expanded="false"
          aria-controls="city-controls"
        >
          [ Controls ]
        </button>
        <ExampleControls className="city-controls" id="city-controls">
          <InstrumentSectionHeading>CITY CONTROLS</InstrumentSectionHeading>
          <details className="city-section" data-control-section="motion" open>
            <summary>[ MOTION ]</summary>
            <div className="city-section-body">
              <div className="city-ctl">
                <button className="city-play" type="button" id="play">
                  [ Pause motion ]
                </button>
              </div>
              <div className="city-ctl">
                <div className="city-ctl-row">
                  <span>speed</span>
                  <span className="val" id="speed-val">
                    1.00×
                  </span>
                </div>
                <SliderTrack>
                  <input type="range" id="speed" min="0" max="2.5" step="0.05" defaultValue="1" />
                </SliderTrack>
              </div>
              <div className="city-ctl">
                <div className="city-ctl-row">
                  <span>rotation axis</span>
                </div>
                <ChoiceGroup className="city-seg" id="rotation-axis">
                  <ChoiceButton type="button" className="active" data-rotation-axis="x">
                    X
                  </ChoiceButton>
                  <ChoiceButton type="button" data-rotation-axis="y">
                    Y
                  </ChoiceButton>
                </ChoiceGroup>
              </div>
              <div className="city-ctl">
                <button
                  className="city-play"
                  type="button"
                  id="tilt-play"
                  aria-pressed="false"
                  aria-describedby="tilt-sequence-values"
                >
                  [ Play rotation sequence ]
                </button>
                <div className="city-sequence" id="tilt-sequence-values">
                  60° → 70° → 30° → 60°
                </div>
              </div>
              <div className="city-ctl">
                <div className="city-ctl-row">
                  <span>rotation speed</span>
                  <span className="val" id="tilt-speed-val">
                    10°/s
                  </span>
                </div>
                <SliderTrack>
                  <input type="range" id="tilt-speed" min="1" max="40" step="1" defaultValue="10" />
                </SliderTrack>
              </div>
            </div>
          </details>

          <details className="city-section" data-control-section="camera-render">
            <summary>[ CAMERA / RENDER ]</summary>
            <div className="city-section-body">
              <div className="city-ctl">
                <div className="city-ctl-row">
                  <span>density</span>
                  <span className="val" id="density-val">
                    1.40
                  </span>
                </div>
                <SliderTrack>
                  <input type="range" id="density" min="0.75" max="5" step="0.05" defaultValue="1.4" />
                </SliderTrack>
              </div>
              <div className="city-ctl">
                <div className="city-ctl-row">
                  <span>motion LOD</span>
                  <span className="val" id="lod-val">
                    1.00×
                  </span>
                </div>
                <SliderTrack>
                  <input type="range" id="lod" min="1" max="3" step="0.25" defaultValue="1" />
                </SliderTrack>
              </div>
              <div className="city-ctl">
                <div className="city-ctl-row">
                  <span>tilt X°</span>
                  <span className="val" id="tilt-val">
                    60
                  </span>
                </div>
                <SliderTrack>
                  <input type="range" id="tilt" min="25" max="82" step="1" defaultValue="60" />
                </SliderTrack>
              </div>
              <div className="city-ctl">
                <div className="city-ctl-row">
                  <span>orbit Y°</span>
                  <span className="val" id="orbit-val">
                    90
                  </span>
                </div>
                <SliderTrack>
                  <input type="range" id="orbit" min="0" max="360" step="1" defaultValue="90" />
                </SliderTrack>
              </div>
              <div className="city-ctl">
                <div className="city-ctl-row">
                  <span>zoom</span>
                  <span className="val" id="zoom-val">
                    2.10×
                  </span>
                </div>
                <SliderTrack>
                  <input type="range" id="zoom" min="0.7" max="4" step="0.05" defaultValue="2.1" />
                </SliderTrack>
              </div>
              <div className="city-ctl">
                <div className="city-ctl-row">
                  <span>output</span>
                </div>
                <ChoiceGroup className="city-seg" id="color-mode">
                  <ChoiceButton type="button" className="active" data-color="true">
                    color
                  </ChoiceButton>
                  <ChoiceButton type="button" data-color="false">
                    mono
                  </ChoiceButton>
                </ChoiceGroup>
              </div>
              <div className="city-ctl" id="mono-color-control" hidden>
                <div className="city-ctl-row">
                  <span>mono color</span>
                  <span className="val" id="mono-color-val">
                    #FFE8B8
                  </span>
                </div>
                <input
                  className="city-color"
                  type="color"
                  id="mono-color"
                  defaultValue="#ffe8b8"
                  aria-label="Monochrome output color"
                />
              </div>
              <div className="city-ctl">
                <div className="city-ctl-row">
                  <span>color encoding</span>
                </div>
                <BracketSelect
                  id="colorEncoding"
                  title="Atlas color encoding — a single colour-font PUA text node (zero <span>s) instead of HTML spans, when the current render fits the atlas's palette/glyph budget."
                >
                  <option value="spans">spans</option>
                  <option value="atlas">atlas</option>
                </BracketSelect>
              </div>
            </div>
          </details>

          <details className="city-section" data-control-section="city-grid">
            <summary>[ CITY GRID ]</summary>
            <div className="city-section-body">
              <div className="city-ctl">
                <div className="city-ctl-row">
                  <span>depth blocks</span>
                  <span className="val" id="depth-blocks-val">
                    5
                  </span>
                </div>
                <SliderTrack>
                  <input type="range" id="depth-blocks" min="2" max="7" step="1" defaultValue="5" />
                </SliderTrack>
              </div>
              <div className="city-ctl">
                <div className="city-ctl-row">
                  <span>run blocks</span>
                  <span className="val" id="run-blocks-val">
                    8
                  </span>
                </div>
                <SliderTrack>
                  <input type="range" id="run-blocks" min="4" max="10" step="1" defaultValue="8" />
                </SliderTrack>
              </div>
              <div className="city-ctl">
                <div className="city-ctl-row">
                  <span>block depth</span>
                  <span className="val" id="block-depth-val">
                    188
                  </span>
                </div>
                <SliderTrack>
                  <input type="range" id="block-depth" min="144" max="224" step="4" defaultValue="188" />
                </SliderTrack>
              </div>
              <div className="city-ctl">
                <div className="city-ctl-row">
                  <span>block width</span>
                  <span className="val" id="block-width-val">
                    184
                  </span>
                </div>
                <SliderTrack>
                  <input type="range" id="block-width" min="144" max="224" step="4" defaultValue="184" />
                </SliderTrack>
              </div>
              <div className="city-ctl">
                <div className="city-ctl-row">
                  <span>street width</span>
                  <span className="val" id="street-val">
                    41
                  </span>
                </div>
                <SliderTrack>
                  <input type="range" id="street" min="28" max="60" step="1" defaultValue="41" />
                </SliderTrack>
              </div>
            </div>
          </details>

          <details className="city-section" data-control-section="buildings">
            <summary>[ BUILDINGS ]</summary>
            <div className="city-section-body">
              <div className="city-ctl">
                <div className="city-ctl-row">
                  <span>building size</span>
                  <span className="val" id="building-size-val">
                    40
                  </span>
                </div>
                <SliderTrack>
                  <input type="range" id="building-size" min="36" max="64" step="2" defaultValue="40" />
                </SliderTrack>
              </div>
              <div className="city-ctl">
                <div className="city-ctl-row">
                  <span>building gap</span>
                  <span className="val" id="building-gap-val">
                    21
                  </span>
                </div>
                <SliderTrack>
                  <input type="range" id="building-gap" min="16" max="32" step="1" defaultValue="21" />
                </SliderTrack>
              </div>
              <div className="city-ctl">
                <div className="city-ctl-row">
                  <span>block merge</span>
                  <span className="val" id="merge-val">
                    34%
                  </span>
                </div>
                <SliderTrack>
                  <input type="range" id="merge" min="0" max="0.7" step="0.01" defaultValue="0.34" />
                </SliderTrack>
              </div>
              <div className="city-ctl">
                <div className="city-ctl-row">
                  <span>min height</span>
                  <span className="val" id="min-height-val">
                    34
                  </span>
                </div>
                <SliderTrack>
                  <input type="range" id="min-height" min="20" max="100" step="2" defaultValue="34" />
                </SliderTrack>
              </div>
              <div className="city-ctl">
                <div className="city-ctl-row">
                  <span>max height</span>
                  <span className="val" id="max-height-val">
                    200
                  </span>
                </div>
                <SliderTrack>
                  <input type="range" id="max-height" min="80" max="320" step="5" defaultValue="200" />
                </SliderTrack>
              </div>
            </div>
          </details>

          <details className="city-section" data-control-section="glyph-flow">
            <summary>[ GLYPH FLOW ]</summary>
            <div className="city-section-body">
              <div className="city-ctl">
                <div className="city-ctl-row">
                  <span>glyph pattern</span>
                </div>
                <input
                  className="city-text"
                  type="text"
                  id="glyph-pattern"
                  defaultValue="HOLA"
                  maxLength={32}
                  autoComplete="off"
                  spellCheck={false}
                  aria-label="Glyph pattern"
                />
              </div>
              <div className="city-ctl">
                <div className="city-ctl-row">
                  <span>mapping</span>
                </div>
                <ChoiceGroup className="city-seg" id="glyph-mode">
                  <ChoiceButton type="button" className="active" data-glyph-mode="shaded">
                    shaded
                  </ChoiceButton>
                  <ChoiceButton type="button" data-glyph-mode="repeat">
                    repeat
                  </ChoiceButton>
                  <ChoiceButton type="button" data-glyph-mode="rain">
                    rain
                  </ChoiceButton>
                </ChoiceGroup>
              </div>
              <div className="city-ctl">
                <div className="city-ctl-row">
                  <span>direction</span>
                </div>
                <ChoiceGroup className="city-seg city-seg--four" id="glyph-direction">
                  <ChoiceButton type="button" className="active" data-glyph-direction="left" aria-label="Flow left">
                    ←
                  </ChoiceButton>
                  <ChoiceButton type="button" data-glyph-direction="right" aria-label="Flow right">
                    →
                  </ChoiceButton>
                  <ChoiceButton type="button" data-glyph-direction="up" aria-label="Flow up">
                    ↑
                  </ChoiceButton>
                  <ChoiceButton type="button" data-glyph-direction="down" aria-label="Flow down">
                    ↓
                  </ChoiceButton>
                </ChoiceGroup>
              </div>
              <div className="city-ctl" id="glyph-speed-control">
                <div className="city-ctl-row">
                  <span>glyph speed</span>
                  <span className="val" id="glyph-speed-val">
                    8 cells/s
                  </span>
                </div>
                <SliderTrack>
                  <input type="range" id="glyph-speed" min="1" max="24" step="1" defaultValue="8" />
                </SliderTrack>
              </div>
              <div className="city-ctl" id="rain-speed-min-control" hidden>
                <div className="city-ctl-row">
                  <span>trail speed min</span>
                  <span className="val" id="rain-speed-min-val">
                    5 cells/s
                  </span>
                </div>
                <SliderTrack>
                  <input type="range" id="rain-speed-min" min="1" max="24" step="1" defaultValue="5" />
                </SliderTrack>
              </div>
              <div className="city-ctl" id="rain-speed-max-control" hidden>
                <div className="city-ctl-row">
                  <span>trail speed max</span>
                  <span className="val" id="rain-speed-max-val">
                    12 cells/s
                  </span>
                </div>
                <SliderTrack>
                  <input type="range" id="rain-speed-max" min="1" max="24" step="1" defaultValue="12" />
                </SliderTrack>
              </div>
              <div className="city-ctl" id="rain-trail-control" hidden>
                <div className="city-ctl-row">
                  <span>rain trail</span>
                  <span className="val" id="rain-trail-val">
                    14 cells
                  </span>
                </div>
                <SliderTrack>
                  <input type="range" id="rain-trail" min="4" max="28" step="1" defaultValue="14" />
                </SliderTrack>
              </div>
              <div className="city-ctl" id="rain-composition-control" hidden>
                <div className="city-ctl-row">
                  <span>composition</span>
                </div>
                <ChoiceGroup className="city-seg" id="rain-composition">
                  <ChoiceButton type="button" className="active" data-rain-composition="mask">
                    rain only
                  </ChoiceButton>
                  <ChoiceButton type="button" data-rain-composition="overlay">
                    overlay
                  </ChoiceButton>
                </ChoiceGroup>
              </div>
              <div className="city-ctl" id="rain-stream-control" hidden>
                <div className="city-ctl-row">
                  <span>rain streams</span>
                  <span className="val" id="rain-stream-val">
                    55%
                  </span>
                </div>
                <SliderTrack>
                  <input type="range" id="rain-stream" min="20" max="100" step="5" defaultValue="55" />
                </SliderTrack>
              </div>
              <div className="city-ctl">
                <button className="city-play" type="button" id="glyph-play" aria-pressed="false" disabled>
                  [ Play glyph flow ]
                </button>
              </div>
            </div>
          </details>
        </ExampleControls>
      </ExampleStage>
      <footer className="map-foot">
        <span>
          buildings: <strong id="building-count">—</strong>
        </span>
        <span>
          polys: <strong id="poly-count">—</strong>
        </span>
        <span>
          FPS: <strong id="fps">—</strong>
        </span>
        <span>
          raster: <strong id="raster-ms">—</strong>
        </span>
        <span>
          DOM: <strong id="dom-ms">—</strong>
        </span>
        <span>
          cells: <strong id="cell-count">—</strong>
        </span>
      </footer>

      <StatsOverlay />
    </div>
  );
}

import { useEffect, useRef } from "react";
import { mountFlatmapExample } from "../../features/examples/flatmap/mountFlatmapExample";
import { BracketSelect } from "../BracketSelect";
import { ExampleControls, ExampleStage } from "../ExampleControls";
import { ChoiceButton, ChoiceGroup } from "../IconToggle";
import { InstrumentSectionHeading } from "../InstrumentWorkbench";
import { SliderTrack } from "../SliderRow";
import styles from "./FlatmapExample.module.css";

export function FlatmapExample() {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (root.current) return mountFlatmapExample(root.current);
  }, []);
  return (
    <div ref={root} className={styles.root}>
      <header className="map-head">
        <h1>[ ISO WORLD MAP ]</h1>
        <p>
          ETOPO1 global terrain on a flat iso plane. Drag to pan, scroll to zoom — only tiles in view are fetched. Tune
          relief / density / camera from the dock.
        </p>
      </header>
      <ExampleStage className="map-stage">
        <div data-render-host className="iso-host" id="iso-host">
          <div className="loading" id="loading">
            Loading terrain…
          </div>
        </div>
        <button
          className="iso-ctl-toggle"
          type="button"
          id="ctl-toggle"
          aria-expanded="false"
          aria-controls="iso-controls"
        >
          [ Controls ]
        </button>
        <ExampleControls className="iso-controls" id="iso-controls">
          <InstrumentSectionHeading>CONTROLS</InstrumentSectionHeading>
          <div className="iso-ctl">
            <div className="iso-ctl-row">
              <span>relief ×</span>
              <span className="val" id="exagg-val">
                0.2
              </span>
            </div>
            <SliderTrack>
              <input type="range" id="exagg" min="0.1" max="5" step="0.1" defaultValue="0.2" />
            </SliderTrack>
          </div>
          <div className="iso-ctl">
            <div className="iso-ctl-row">
              <span>density</span>
              <span className="val" id="density-val">
                2
              </span>
            </div>
            <SliderTrack>
              <input type="range" id="density" min="0.75" max="4" step="0.05" defaultValue="2" />
            </SliderTrack>
          </div>
          <div className="iso-ctl">
            <div className="iso-ctl-row">
              <span>tilt °</span>
              <span className="val" id="tilt-val">
                40
              </span>
            </div>
            <SliderTrack>
              <input type="range" id="tilt" min="20" max="89" step="1" defaultValue="40" />
            </SliderTrack>
          </div>
          <div className="iso-ctl">
            <div className="iso-ctl-row">
              <span>rotation °</span>
              <span className="val" id="rot-val">
                0
              </span>
            </div>
            <SliderTrack>
              <input type="range" id="rot" min="-180" max="180" step="1" defaultValue="0" />
            </SliderTrack>
          </div>
          <div className="iso-ctl">
            <div className="iso-ctl-row">
              <span>render</span>
            </div>
            <ChoiceGroup className="iso-seg" id="mode-seg">
              <ChoiceButton type="button" data-mode="solid" className="active">
                solid
              </ChoiceButton>
              <ChoiceButton type="button" data-mode="coast">
                coast
              </ChoiceButton>
              <ChoiceButton type="button" data-mode="wire">
                wire
              </ChoiceButton>
            </ChoiceGroup>
          </div>
          <div className="iso-ctl">
            <div className="iso-ctl-row">
              <span>palette</span>
            </div>
            <BracketSelect id="palette">
              <option value="terrain">terrain</option>
              <option value="viridis">viridis</option>
              <option value="heat">heat</option>
              <option value="ocean">ocean</option>
              <option value="grayscale">grayscale</option>
              <option value="mono">mono</option>
            </BracketSelect>
          </div>
          <div className="iso-ctl">
            <div className="iso-ctl-row">
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
          <div className="iso-ctl">
            <div className="iso-ctl-row">
              <span>sun azimuth °</span>
              <span className="val" id="az-val">
                50
              </span>
            </div>
            <SliderTrack>
              <input type="range" id="az" min="0" max="360" step="1" defaultValue="50" />
            </SliderTrack>
          </div>
          <div className="iso-ctl">
            <div className="iso-ctl-row">
              <span>sun elevation °</span>
              <span className="val" id="el-val">
                50
              </span>
            </div>
            <SliderTrack>
              <input type="range" id="el" min="5" max="90" step="1" defaultValue="50" />
            </SliderTrack>
          </div>
          <div className="iso-ctl">
            <div className="iso-ctl-row">
              <span>key light</span>
              <span className="val" id="key-val">
                1.15
              </span>
            </div>
            <SliderTrack>
              <input type="range" id="key" min="0" max="2" step="0.05" defaultValue="1.15" />
            </SliderTrack>
          </div>
          <div className="iso-ctl">
            <div className="iso-ctl-row">
              <span>ambient</span>
              <span className="val" id="amb-val">
                0.40
              </span>
            </div>
            <SliderTrack>
              <input type="range" id="amb" min="0" max="1.5" step="0.05" defaultValue="0.4" />
            </SliderTrack>
          </div>
        </ExampleControls>
      </ExampleStage>
      <footer className="map-foot">
        <span>Data: NOAA ETOPO1</span>
        <span id="tile-count">tiles: 0</span>
        <span id="zoom-mag">zoom: 1.00×</span>
        <span id="zoom-level">LOD: 0</span>
      </footer>
    </div>
  );
}

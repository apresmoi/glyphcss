import { useEffect, useRef } from "react";
import { mountImageExample } from "../../features/examples/image/mountImageExample";
import { BracketSelect } from "../BracketSelect";
import { ExampleControls, ExampleStage } from "../ExampleControls";
import { InstrumentSectionHeading } from "../InstrumentWorkbench";
import { SliderTrack } from "../SliderRow";
import styles from "./ImageExample.module.css";

export function ImageExample() {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (root.current) return mountImageExample(root.current);
  }, []);
  return (
    <div ref={root} className={styles.root}>
      <header className="map-head">
        <h1>[ IMAGE → GLYPH ]</h1>
        <p>
          Drop or paste any image. Flat mode maps it onto a single textured quad. Shapes mode posterizes it into color
          groups — every connected shape becomes a large plate at its group's height, with its own effect domain — so
          glyph effects land shape by shape, and plates cast drop shadows onto the layers beneath.
        </p>
      </header>
      <ExampleStage className="map-stage" id="stage">
        <div data-render-host className="img-host" id="host"></div>
        <div className="drop-hint" id="hint">
          <b>Drop an image here</b>
          <span>or click to choose · or paste from clipboard</span>
        </div>
        <input type="file" id="file" accept="image/*" hidden />
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
              <span>density</span>
              <span className="val" id="density-val">
                1.6
              </span>
            </div>
            <SliderTrack>
              <input type="range" id="density" min="0.75" max="4" step="0.05" defaultValue="1.6" />
            </SliderTrack>
          </div>
          <div className="iso-ctl">
            <div className="iso-ctl-row">
              <span>glyph set</span>
            </div>
            <BracketSelect id="palette"></BracketSelect>
          </div>
          <div className="iso-ctl">
            <label className="iso-check">
              <input type="checkbox" id="color" defaultChecked /> color
            </label>
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
          <div className="iso-sep"></div>
          <div className="iso-ctl">
            <div className="iso-ctl-row">
              <span>mode</span>
            </div>
            <BracketSelect id="mode">
              <option value="flat">flat image</option>
              <option value="shapes">color shapes</option>
            </BracketSelect>
          </div>
          <div className="iso-ctl" id="ctl-groups" hidden>
            <div className="iso-ctl-row">
              <span>color groups</span>
              <span className="val" id="groups-val">
                5
              </span>
            </div>
            <SliderTrack>
              <input type="range" id="groups" min="2" max="10" step="1" defaultValue="5" />
            </SliderTrack>
          </div>
          <div className="iso-ctl" id="ctl-depth" hidden>
            <div className="iso-ctl-row">
              <span>depth</span>
              <span className="val" id="depth-val">
                0.3
              </span>
            </div>
            <SliderTrack>
              <input type="range" id="depth" min="0" max="0.6" step="0.01" defaultValue="0.3" />
            </SliderTrack>
          </div>
          <div className="iso-ctl" id="ctl-res" hidden>
            <div className="iso-ctl-row">
              <span>segmentation detail</span>
              <span className="val" id="res-val">
                80
              </span>
            </div>
            <SliderTrack>
              <input type="range" id="res" min="32" max="128" step="8" defaultValue="80" />
            </SliderTrack>
          </div>
          <div className="iso-ctl" id="ctl-tex" hidden>
            <label className="iso-check">
              <input type="checkbox" id="tex" /> photo texels on plates
            </label>
          </div>
          <div className="iso-ctl" id="ctl-shadow" hidden>
            <label className="iso-check">
              <input type="checkbox" id="shadow" defaultChecked /> drop shadows
            </label>
          </div>
          <div className="iso-ctl" id="ctl-light" hidden>
            <div className="iso-ctl-row">
              <span>lighting</span>
              <span className="val" id="light-val">
                0.6
              </span>
            </div>
            <SliderTrack>
              <input type="range" id="light" min="0" max="1" step="0.05" defaultValue="0.6" />
            </SliderTrack>
          </div>
          <div className="iso-sep"></div>
          <div className="iso-ctl">
            <div className="iso-ctl-row">
              <span>effect</span>
            </div>
            <BracketSelect id="effect">
              <option value="">none</option>
            </BracketSelect>
          </div>
          <div className="iso-ctl" id="ctl-blend" hidden>
            <div className="iso-ctl-row">
              <span>blend</span>
            </div>
            <BracketSelect id="blend">
              <option value="over">over</option>
              <option value="replace">replace</option>
            </BracketSelect>
          </div>
          <div className="iso-ctl" id="ctl-opacity" hidden>
            <div className="iso-ctl-row">
              <span>opacity</span>
              <span className="val" id="opacity-val">
                1
              </span>
            </div>
            <SliderTrack>
              <input type="range" id="opacity" min="0" max="1" step="0.05" defaultValue="1" />
            </SliderTrack>
          </div>
          <div className="iso-ctl" id="ctl-speed" hidden>
            <div className="iso-ctl-row">
              <span>speed</span>
              <span className="val" id="speed-val">
                1
              </span>
            </div>
            <SliderTrack>
              <input type="range" id="speed" min="0" max="3" step="0.1" defaultValue="1" />
            </SliderTrack>
          </div>
          <div id="effect-params"></div>
          <div className="iso-sep"></div>
          <div className="iso-ctl">
            <button type="button" className="iso-btn" id="copy" disabled>
              copy
            </button>
          </div>
          <div className="iso-hint" id="dims"></div>
        </ExampleControls>
      </ExampleStage>
      <footer className="map-foot">
        <span>image → shape plates · glyphcss per-cell sampling</span>
        <span id="status">no image</span>
      </footer>
    </div>
  );
}

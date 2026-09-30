import { useEffect, useRef } from "react";
import { mountParthenonExample } from "../../features/examples/parthenon/mountParthenonExample";
import { BracketSelect } from "../BracketSelect";
import { ExampleControls, ExampleStage } from "../ExampleControls";
import { ChoiceButton, ChoiceGroup } from "../IconToggle";
import { InstrumentSectionHeading } from "../InstrumentWorkbench";
import { SliderTrack } from "../SliderRow";
import styles from "./ParthenonExample.module.css";

export function ParthenonExample() {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (root.current) return mountParthenonExample(root.current);
  }, []);
  return (
    <div ref={root} className={styles.root}>
      <div className="map-shell">
        <header className="map-head">
          <h1>[ PARTHENON · MATRIX ]</h1>
          <p>
            The Parthenon as an octastyle Doric peripteral temple — three crepidoma steps, an 8 × 17 colonnade,
            entablature, cornice, triangular pediments, and a walkable interior: porch columns, cella doorways, the naos
            colonnade, and a golden Athena Parthenos — built from glyphcss primitives while green Matrix rain from
            @glyphcss/effects streams down every surface. Orbit by default — drag to orbit, scroll to zoom. Switch to
            FPV in the dock to walk in: click the render to capture the mouse, WASD to walk (the steps carry you up onto
            the stylobate — go through the east door), Space to jump, Esc to release.
          </p>
        </header>
        <ExampleStage className="map-stage">
          <div data-render-host className="temple-host" id="temple-host"></div>
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
                <span>style</span>
                <span className="keys">
                  <kbd className="key">M</kbd>
                </span>
              </div>
              <ChoiceGroup className="iso-seg" id="style-seg">
                <ChoiceButton type="button" data-style="matrix" className="active">
                  matrix
                </ChoiceButton>
                <ChoiceButton type="button" data-style="marble">
                  marble
                </ChoiceButton>
              </ChoiceGroup>
            </div>
            <div className="iso-ctl">
              <div className="iso-ctl-row">
                <span>camera</span>
                <span className="keys">
                  <kbd className="key">C</kbd>
                </span>
              </div>
              <ChoiceGroup className="iso-seg" id="camera-seg">
                <ChoiceButton type="button" data-camera="orbit" className="active">
                  orbit
                </ChoiceButton>
                <ChoiceButton type="button" data-camera="fpv">
                  fpv
                </ChoiceButton>
              </ChoiceGroup>
            </div>
            <div className="iso-ctl fpv-hint">
              <div className="legend">
                <span>
                  <kbd className="key">W</kbd>
                  <kbd className="key">A</kbd>
                  <kbd className="key">S</kbd>
                  <kbd className="key">D</kbd> move
                </span>
                <span>
                  <kbd className="key">Space</kbd> jump
                </span>
                <span className="esc-unlocked">
                  <kbd className="key">click</kbd> look
                </span>
                <span className="esc-locked">
                  <kbd className="key">Esc</kbd> release
                </span>
              </div>
            </div>
            <div className="iso-ctl">
              <div className="iso-ctl-row">
                <span>density</span>
                <span className="val" id="density-val">
                  1.00
                </span>
              </div>
              <SliderTrack>
                <input type="range" id="density" min="0.5" max="3" step="0.05" defaultValue="1" />
              </SliderTrack>
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
            <div className="iso-ctl marble-only">
              <div className="iso-ctl-row">
                <span>environment</span>
              </div>
              <ChoiceGroup className="env-seg" id="env-seg">
                <ChoiceButton type="button" data-env="sky" className="active">
                  sky
                </ChoiceButton>
                <ChoiceButton type="button" data-env="clouds" className="active">
                  clouds
                </ChoiceButton>
                <ChoiceButton type="button" data-env="floor" className="active">
                  ground
                </ChoiceButton>
                <ChoiceButton type="button" data-env="hills" className="active">
                  hills
                </ChoiceButton>
              </ChoiceGroup>
            </div>
            <div className="iso-ctl marble-only">
              <div className="iso-ctl-row">
                <span>cloud size</span>
                <span className="val" id="cloud-size-val">
                  1.00
                </span>
              </div>
              <SliderTrack>
                <input type="range" id="cloud-size" min="0.5" max="3" step="0.05" defaultValue="1" />
              </SliderTrack>
            </div>
            <div className="iso-ctl marble-only">
              <div className="iso-ctl-row">
                <span>cloud cover</span>
                <span className="val" id="cloud-cover-val">
                  0.46
                </span>
              </div>
              <SliderTrack>
                <input type="range" id="cloud-cover" min="0" max="1" step="0.02" defaultValue="0.46" />
              </SliderTrack>
            </div>
            <div className="iso-ctl marble-only">
              <div className="iso-ctl-row">
                <span>cloud drift</span>
                <span className="val" id="cloud-drift-val">
                  1.00
                </span>
              </div>
              <SliderTrack>
                <input type="range" id="cloud-drift" min="0" max="3" step="0.05" defaultValue="1" />
              </SliderTrack>
            </div>
            <div className="iso-ctl marble-only">
              <div className="iso-ctl-row">
                <span>sun azimuth</span>
                <span className="val" id="sun-az-val">
                  340
                </span>
              </div>
              <SliderTrack>
                <input type="range" id="sun-az" min="0" max="360" step="5" defaultValue="340" />
              </SliderTrack>
            </div>
            <div className="iso-ctl marble-only">
              <div className="iso-ctl-row">
                <span>sun height</span>
                <span className="val" id="sun-elev-val">
                  38
                </span>
              </div>
              <SliderTrack>
                <input type="range" id="sun-elev" min="5" max="85" step="2" defaultValue="38" />
              </SliderTrack>
            </div>
            <div className="iso-ctl matrix-only">
              <div className="iso-ctl-row">
                <span>matrix scale</span>
                <span className="val" id="scale-val">
                  0.50
                </span>
              </div>
              <SliderTrack>
                <input type="range" id="scale" min="0.05" max="3" step="0.05" defaultValue="0.5" />
              </SliderTrack>
            </div>
            <div className="iso-ctl matrix-only">
              <div className="iso-ctl-row">
                <span>speed min</span>
                <span className="val" id="speed-min-val">
                  5
                </span>
              </div>
              <SliderTrack>
                <input type="range" id="speed-min" min="0" max="40" step="0.25" defaultValue="5" />
              </SliderTrack>
            </div>
            <div className="iso-ctl matrix-only">
              <div className="iso-ctl-row">
                <span>speed max</span>
                <span className="val" id="speed-max-val">
                  13
                </span>
              </div>
              <SliderTrack>
                <input type="range" id="speed-max" min="0" max="40" step="0.25" defaultValue="13" />
              </SliderTrack>
            </div>
            <div className="iso-ctl matrix-only">
              <div className="iso-ctl-row">
                <span>trail</span>
                <span className="val" id="trail-val">
                  13
                </span>
              </div>
              <SliderTrack>
                <input type="range" id="trail" min="1" max="64" step="1" defaultValue="13" />
              </SliderTrack>
            </div>
            <div className="iso-ctl matrix-only">
              <div className="iso-ctl-row">
                <span>streams</span>
                <span className="val" id="rain-density-val">
                  0.38
                </span>
              </div>
              <SliderTrack>
                <input type="range" id="rain-density" min="0.02" max="1" step="0.01" defaultValue="0.38" />
              </SliderTrack>
            </div>
            <div className="iso-ctl matrix-only">
              <div className="iso-ctl-row">
                <span>color mode</span>
              </div>
              <ChoiceGroup className="iso-seg" id="color-mode-seg">
                <ChoiceButton type="button" data-color-mode="monochrome" className="active">
                  mono
                </ChoiceButton>
                <ChoiceButton type="button" data-color-mode="original">
                  original
                </ChoiceButton>
              </ChoiceGroup>
            </div>
            <div className="iso-ctl matrix-only" id="mono-color-row">
              <div className="iso-ctl-row">
                <span>mono color</span>
                <span className="val" id="mono-color-val">
                  #00FF66
                </span>
              </div>
              <input
                className="iso-color"
                type="color"
                id="mono-color"
                defaultValue="#00ff66"
                aria-label="Monochrome rain color"
              />
            </div>
          </ExampleControls>
          <div className="game-pad" id="game-pad">
            <div className="game-joy" id="game-joy"></div>
            <div className="game-btns">
              <button type="button" className="game-btn" id="btn-m" aria-label="Toggle style">
                <span className="gb-scene" id="btn-m-scene"></span>
                <span className="gb-label">M</span>
              </button>
              <button type="button" className="game-btn" id="btn-c" aria-label="Toggle camera">
                <span className="gb-scene" id="btn-c-scene"></span>
                <span className="gb-label" id="btn-c-label">
                  FPV
                </span>
              </button>
            </div>
          </div>
        </ExampleStage>
      </div>
    </div>
  );
}

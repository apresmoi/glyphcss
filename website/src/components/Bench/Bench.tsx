import { useEffect, useRef } from "react";
import { mountBench } from "../../features/bench/mountBench";
import { ActionButton } from "../ActionButton";
import { BracketSelect } from "../BracketSelect";
import { CodePanelFrame } from "../CodePanel";
import { SliderTrack } from "../SliderRow";
import styles from "./Bench.module.css";
export function Bench() {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (root.current) return mountBench(root.current);
  }, []);
  return (
    <div ref={root} className={styles.root}>
      <div className="bar">
        <label>
          mesh
          <BracketSelect id="mesh">
            <optgroup label="primitives">
              <option value="geom:icosahedron">icosahedron</option>
              <option value="geom:cuboctahedron">cuboctahedron</option>
              <option value="geom:truncatedIcosahedron">truncatedIcosahedron</option>
              <option value="geom:dodecahedron">dodecahedron</option>
              <option value="geom:octahedron">octahedron</option>
              <option value="geom:cube">cube</option>
            </optgroup>
            <optgroup label="models">
              <option value="/gallery/vox/army.vox">army.vox</option>
              <option value="/gallery/glb/apocalypse/car.glb">car.glb</option>
            </optgroup>
          </BracketSelect>
        </label>
        <label>
          cell px{" "}
          <SliderTrack>
            <input type="range" id="cell" min="5" max="18" step="1" defaultValue="9" />
          </SliderTrack>
          <span className="val" id="cell-v">
            9
          </span>
        </label>
        <label>
          line-height{" "}
          <SliderTrack>
            <input type="range" id="lh" min="0.4" max="1.6" step="0.05" defaultValue="1" />
          </SliderTrack>
          <span className="val" id="lh-v">
            1.00
          </span>
        </label>
        <label>
          fill{" "}
          <SliderTrack>
            <input type="range" id="fill" min="0.5" max="0.98" step="0.02" defaultValue="0.9" />
          </SliderTrack>
          <span className="val" id="fill-v">
            0.90
          </span>
        </label>
        <label>
          rotX{" "}
          <SliderTrack>
            <input type="range" id="rotx" min="0" max="180" step="1" defaultValue="65" />
          </SliderTrack>
          <span className="val" id="rotx-v">
            65
          </span>
        </label>
        <label>
          rotY{" "}
          <SliderTrack>
            <input type="range" id="roty" min="0" max="360" step="1" defaultValue="45" />
          </SliderTrack>
          <span className="val" id="roty-v">
            45
          </span>
        </label>
        <label>
          <input type="checkbox" id="spin" /> spin
        </label>
        <label>
          <input type="checkbox" id="colors" defaultChecked /> colors
        </label>
      </div>
      <div className="stage">
        <div className="host" id="host">
          <div className="loading" id="loading">
            Loading…
          </div>
        </div>
        <div className="hud" id="hud"></div>
        <CodePanelFrame className="code" id="code">
          <header className="gw-code-panel__head">
            <span className="gw-code-panel__legend">[ CODE ]</span>
            <ActionButton type="button" id="code-copy">
              copy
            </ActionButton>
            <ActionButton type="button" id="code-toggle" aria-label="collapse">
              ▾
            </ActionButton>
          </header>
          <div className="gw-code-panel__body">
            <pre className="gw-code-panel__code" id="code-body"></pre>
          </div>
        </CodePanelFrame>
      </div>
    </div>
  );
}

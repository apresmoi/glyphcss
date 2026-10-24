import type { CSSProperties } from "react";
import type { DemoSource } from "../../services/glyph-scene/demoSnippets";
import type { GeometryName, Tunables } from "../../services/glyph-scene/types";
import { BracketSelect } from "../BracketSelect";
import { ControlSection } from "../ControlSection";
import { ReadoutInput } from "../EditableReadout";
import { InstrumentSectionHeading } from "../InstrumentWorkbench";
import { ChoiceButton } from "../IconToggle";
import { SliderRow, SliderTrack } from "../SliderRow";
import styles from "./GlyphDemo.module.css";

type NumberKey = "zoom" | "stretch" | "distance" | "rotX" | "duration" | "density" | "lineHeight" | "colorTolerance";
const numbers: {
  control: string;
  key: NumberKey;
  label: string;
  min: number;
  max: number;
  step: number;
  log?: boolean;
}[] = [
  { control: "scale", key: "zoom", label: "Zoom", min: 0.01, max: 10000, step: 0.01, log: true },
  { control: "stretch", key: "stretch", label: "Stretch", min: 0.5, max: 1.5, step: 0.01 },
  { control: "distance", key: "distance", label: "Distance", min: 0, max: 100000, step: 100 },
  { control: "rotX", key: "rotX", label: "Tilt", min: 0, max: 180, step: 1 },
  { control: "duration", key: "duration", label: "Period (s)", min: 1, max: 12, step: 0.25 },
  { control: "density", key: "density", label: "Density", min: 0.5, max: 4, step: 0.1 },
  { control: "lineHeight", key: "lineHeight", label: "Line height", min: 0.5, max: 1.2, step: 0.01 },
  { control: "colorTolerance", key: "colorTolerance", label: "Color tolerance", min: 0, max: 765, step: 1 },
];
function controlList(value?: string): string[] {
  try {
    if (value) return JSON.parse(value);
  } catch {}
  return ["renderMode", "scale", "stretch", "distance", "rotX", "duration", "geometry"];
}

export function GlyphDemoControls({
  id,
  tunables,
  source,
  controls,
  autoRotate,
  ready,
  onChange,
}: {
  id: string;
  tunables: Tunables;
  source: DemoSource;
  controls?: string;
  autoRotate?: boolean;
  ready: boolean;
  onChange: (partial: Partial<Tunables>) => void;
}) {
  const keys = controlList(controls);
  const hasGeometry = !source.mesh && !source.polygonsUrl && keys.includes("geometry");
  const renderKeys = ["density", "lineHeight", "colorTolerance"];
  const renderRows = numbers.filter((row) => keys.includes(row.control) && renderKeys.includes(row.key));
  const cameraRows = numbers.filter(
    (row) =>
      keys.includes(row.control) &&
      !renderKeys.includes(row.key) &&
      (row.key !== "duration" || (tunables.autoRotate ?? autoRotate)),
  );
  const renderNumber = (row: (typeof numbers)[number]) => {
    const value = tunables[row.key] ?? 0;
    const position = row.log
      ? Math.log(value / row.min) / Math.log(row.max / row.min)
      : (value - row.min) / (row.max - row.min);
    const change = (next: number) => onChange({ [row.key]: Math.min(row.max, Math.max(row.min, next)) });
    return (
      <SliderRow key={row.key} className={styles.numberRow} htmlFor={`${id}-${row.key}`}>
        <span>{row.label}</span>
        <SliderTrack style={{ "--fill": `${position * 100}%` } as CSSProperties}>
          <input
            id={`${id}-${row.key}`}
            aria-label={row.label}
            type="range"
            aria-valuetext={String(Number(value.toFixed(2)))}
            min={row.log ? 0 : row.min}
            max={row.log ? 1 : row.max}
            step={row.log ? 0.001 : row.step}
            value={row.log ? position : value}
            onChange={(event) =>
              change(
                row.log
                  ? Number((row.min * (row.max / row.min) ** Number(event.target.value)).toPrecision(3))
                  : Number(event.target.value),
              )
            }
          />
        </SliderTrack>
        <ReadoutInput
          aria-label={`${row.label} value`}
          type="number"
          min={row.min}
          max={row.max}
          step={row.step}
          value={Number(value.toFixed(2))}
          onChange={(event) => {
            if (event.target.value !== "" && Number.isFinite(event.target.valueAsNumber))
              change(event.target.valueAsNumber);
          }}
        />
      </SliderRow>
    );
  };
  return (
    <fieldset className={styles.controls} disabled={!ready} aria-label="Scene controls">
      {(hasGeometry ||
        source.mesh ||
        source.polygonsUrl ||
        ["renderMode", "charMode", "colorEncoding", "hiddenLines", "wireframeJunctions"].some((key) =>
          keys.includes(key),
        ) ||
        renderRows.length > 0) && (
        <ControlSection className={styles.section}>
          <InstrumentSectionHeading>Rendering</InstrumentSectionHeading>
          {(source.polygonsUrl || source.mesh) && (
            <div className={styles.source} title={source.polygonsUrl || source.mesh}>
              Mesh: {(source.polygonsUrl || source.mesh)!.split("/").pop()}
            </div>
          )}
          {hasGeometry && (
            <label className={styles.selectRow}>
              <span>Geometry</span>
              <BracketSelect
                aria-label="Geometry"
                value={tunables.geometry}
                onChange={(event) => onChange({ geometry: event.target.value as GeometryName })}
              >
                <option value="cuboctahedron">Cuboctahedron</option>
                <option value="icosahedron">Icosahedron</option>
                <option value="cube">Cube</option>
              </BracketSelect>
            </label>
          )}
          {keys.includes("renderMode") && (
            <label className={styles.selectRow}>
              <span>Mode</span>
              <BracketSelect
                aria-label="Render mode"
                value={tunables.renderMode ?? "wireframe"}
                onChange={(event) => onChange({ renderMode: event.target.value as Tunables["renderMode"] })}
              >
                <option value="wireframe">Wireframe</option>
                <option value="solid">Solid</option>
                <option value="ink">Ink</option>
              </BracketSelect>
            </label>
          )}
          {keys.includes("colorEncoding") && (
            <div className={styles.selectRow} role="group" aria-label="Color encoding">
              <span>Color encoding</span>
              {(["spans", "atlas"] as const).map((value) => (
                <ChoiceButton
                  key={value}
                  aria-pressed={(tunables.colorEncoding ?? "spans") === value}
                  onClick={() => onChange({ colorEncoding: value })}
                >
                  {value === "spans" ? "Spans" : "Atlas"}
                </ChoiceButton>
              ))}
            </div>
          )}
          {keys.includes("charMode") && (
            <label className={styles.selectRow}>
              <span>Characters</span>
              <BracketSelect
                aria-label="Character encoding"
                value={tunables.charMode ?? "ascii"}
                onChange={(event) => onChange({ charMode: event.target.value as Tunables["charMode"] })}
              >
                <option value="ascii">ASCII</option>
                <option
                  value="braille"
                  disabled={(tunables.renderMode ?? "wireframe") !== "wireframe"}
                  title="Wireframe only"
                >
                  Braille
                </option>
                <option value="halfblock" disabled={tunables.renderMode !== "solid"} title="Solid only">
                  Halfblock
                </option>
                <option value="quadrant" disabled={tunables.renderMode !== "solid"} title="Solid only">
                  Quadrant
                </option>
              </BracketSelect>
            </label>
          )}
          {keys.includes("hiddenLines") && (
            <label className={styles.selectRow}>
              <span>Hidden lines</span>
              <BracketSelect
                aria-label="Hidden lines"
                value={tunables.hiddenLines ?? "show"}
                onChange={(event) => onChange({ hiddenLines: event.target.value as Tunables["hiddenLines"] })}
              >
                <option value="show">Show</option>
                <option value="hide">Hide</option>
              </BracketSelect>
            </label>
          )}
          {keys.includes("wireframeJunctions") && (
            <label className={`${styles.selectRow} ${styles.toggle}`}>
              <span>Box junctions</span>
              <input
                type="checkbox"
                aria-label="Box junctions"
                checked={tunables.wireframeJunctions ?? false}
                onChange={(event) => onChange({ wireframeJunctions: event.target.checked })}
              />
            </label>
          )}
          {renderRows.map(renderNumber)}
        </ControlSection>
      )}
      {(cameraRows.length > 0 || autoRotate !== undefined) && (
        <ControlSection className={styles.section}>
          <InstrumentSectionHeading>Camera</InstrumentSectionHeading>
          {autoRotate !== undefined && (
            <label className={`${styles.selectRow} ${styles.toggle}`}>
              <span>Auto-rotate</span>
              <input
                type="checkbox"
                aria-label="Auto-rotate"
                checked={tunables.autoRotate ?? autoRotate}
                onChange={(event) => onChange({ autoRotate: event.target.checked })}
              />
            </label>
          )}
          {cameraRows.map(renderNumber)}
        </ControlSection>
      )}
    </fieldset>
  );
}

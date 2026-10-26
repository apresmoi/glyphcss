import type { ReactNode } from "react";
import { BracketSelect } from "../BracketSelect";
import { IconToggle } from "../IconToggle";
import { ControlSection } from "../ControlSection";
import { InstrumentSectionHeading } from "../InstrumentWorkbench";
import { SliderRow, SliderTrack } from "../SliderRow";
import styles from "./StaticWorkbench.module.css";

export function StaticSection({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <ControlSection className={styles.section}>
      <InstrumentSectionHeading>{title}</InstrumentSectionHeading>
      {children}
    </ControlSection>
  );
}

export function StaticChoice({ label, value }: { label: string; value: string | number }) {
  return (
    <label className={styles.row}>
      <span>{label}</span>
      <BracketSelect disabled aria-label={label} value={String(value)}>
        <option value={String(value)}>{value}</option>
      </BracketSelect>
    </label>
  );
}

export function StaticSlider({
  label,
  value,
  min = 0,
  max = 1,
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
}) {
  return (
    <SliderRow className={styles.slider}>
      <span>{label}</span>
      <SliderTrack>
        <input aria-label={label} type="range" disabled min={min} max={max} step="any" value={value} />
      </SliderTrack>
      <output>{value}</output>
    </SliderRow>
  );
}

export function StaticToggle({ label, value }: { label: string; value: boolean }) {
  return (
    <label className={`${styles.row} controller boolean`}>
      <span>{label}</span>
      <input aria-label={label} type="checkbox" disabled checked={value} />
    </label>
  );
}

export function StaticText({ label, value }: { label: string; value: string | number }) {
  return (
    <label className={styles.row}>
      <span>{label}</span>
      <input className={styles.text} aria-label={label} disabled value={value} />
    </label>
  );
}

export function StaticChoices({
  label,
  value,
  options,
}: {
  label: string;
  value: string;
  options: Record<string, string>;
}) {
  return (
    <div className={styles.row}>
      <span>{label}</span>
      <IconToggle
        groupLabel={label}
        value={value}
        onChange={() => {}}
        options={Object.entries(options).map(([value, icon]) => ({ value, icon, label: value, disabled: true }))}
      />
    </div>
  );
}

// Mirrors the dock's colour controller: a bracketed bar filled with the
// colour and its hex readout, laid out like a slider row.
export function StaticColor({ label, value }: { label: string; value: string }) {
  return (
    <SliderRow className={styles.slider}>
      <span>{label}</span>
      <SliderTrack>
        <span className={styles.colorFill} style={{ background: value }} aria-label={`${label} ${value}`} />
      </SliderTrack>
      <output>{value.replace(/^#/, "")}</output>
    </SliderRow>
  );
}

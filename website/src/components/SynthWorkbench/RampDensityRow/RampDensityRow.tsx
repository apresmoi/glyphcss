import { CALIBRATED_RAMP_NAME } from "../../../features/synth/model/parameters";
import styles from "./RampDensityRow.module.css";

// Small measured-coverage density bar per ramp option — darkest glyph's bar
// is shortest, densest glyph's bar is tallest, using the SAME per-font
// measurement `useRampCalibration` produces (so "Calibrated"'s bars and the
// authored ramps' bars are directly comparable, real ink coverage, not a
// synthetic index-based ramp). `disabledReason`, when set, replaces the
// swatches with a visible explanation instead of just dimming them (2x4
// subcell mode renders Braille dots and never reads the ramp at all).
export function RampDensityRow({
  names,
  coverageByOption,
  selected,
  onSelect,
  disabledReason,
}: {
  names: string[];
  coverageByOption: Record<string, number[]>;
  selected: string;
  onSelect: (name: string) => void;
  disabledReason?: string;
}) {
  if (disabledReason) {
    return <p className="dock-ramp-density-reason">{disabledReason}</p>;
  }
  return (
    <div className={styles.root + " dock-ramp-density"} role="listbox" aria-label="Ramp density preview">
      {names.map((name) => {
        const coverage = coverageByOption[name];
        return (
          <button
            key={name}
            type="button"
            role="option"
            aria-selected={name === selected}
            className={`dock-ramp-density-item${name === selected ? " is-active" : ""}`}
            onClick={() => onSelect(name)}
            title={
              name === CALIBRATED_RAMP_NAME ? "Font-calibrated — measured from the viewer's actual font stack" : name
            }
          >
            <span className="dock-ramp-density-bars">
              {coverage ? (
                coverage.map((c, i) => (
                  <span key={i} className="dock-ramp-density-bar" style={{ height: `${Math.max(6, c * 100)}%` }} />
                ))
              ) : (
                <span className="dock-ramp-density-pending">…</span>
              )}
            </span>
            <span className="dock-ramp-density-label">{name}</span>
          </button>
        );
      })}
    </div>
  );
}

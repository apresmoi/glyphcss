/**
 * The map's own pitch readout and its one-click way back to level.
 *
 * The reader's complaint that started this was that tilt was reachable only
 * from a slider inside a collapsible Dock they never opened — so the fix
 * cannot be a second thing inside that Dock, and it cannot be a keystroke or
 * a double-click either, which are exactly as undiscoverable as the slider
 * was. Every map product that ships a pitch gesture (Google Maps, Mapbox,
 * MapLibre, Cesium) resets it the same way: a small persistent control ON THE
 * MAP that only appears once the camera is off-level, and that doubles as the
 * INDICATOR that a pitch is in force at all. That is what this is.
 *
 * It renders nothing at all when the camera is already level — a permanent
 * chrome element for a state most readers never leave is clutter, and its
 * appearing is itself the feedback that the Ctrl+drag they just discovered
 * did something.
 */
import { mapTiltIsLevel } from "./mapsView";

export interface MapTiltResetProps {
  /** The pitch the camera actually has, degrees (the widget's `getTilt()`, not the page's request). */
  readonly tilt: number;
  readonly isOrbitProjection: boolean;
  readonly onReset: () => void;
}

export function MapTiltReset({ tilt, isOrbitProjection, onReset }: MapTiltResetProps) {
  if (mapTiltIsLevel(tilt, isOrbitProjection)) return null;
  const shown = Math.round(tilt);
  return (
    <button
      type="button"
      className="maps-tilt-reset"
      onClick={onReset}
      // The title carries the gesture as well as the action: a reader who
      // found this control by accident (it appeared) is exactly the reader
      // who has not yet been told how the pitch got there.
      title={`Pitch ${shown}°. Click to level the map. Ctrl+drag or right-drag up and down to pitch it.`}
      aria-label={`Level the map — pitch is currently ${shown} degrees`}
    >
      <span className="maps-tilt-reset__angle" aria-hidden="true">{shown}°</span>
      <span className="maps-tilt-reset__label" aria-hidden="true">Level</span>
    </button>
  );
}

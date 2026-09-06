/**
 * The map's own orientation readout and its one-click way back to north-up
 * and level.
 *
 * The reader's complaint that started this was that tilt was reachable only
 * from a slider inside a collapsible Dock they never opened — so the fix
 * cannot be a second thing inside that Dock, and it cannot be a keystroke or
 * a double-click either, which are exactly as undiscoverable as the slider
 * was. Every map product that ships an orient gesture (Google Maps, Mapbox,
 * MapLibre, Cesium) resets it the same way: a small persistent control ON THE
 * MAP that only appears once the camera is off-home, and that doubles as the
 * INDICATOR that a pitch or a heading is in force at all. That is what this
 * is.
 *
 * It renders nothing at all when the camera is already home — a permanent
 * chrome element for a state most readers never leave is clutter, and its
 * appearing is itself the feedback that the Ctrl+drag they just discovered
 * did something.
 *
 * ONE control for BOTH angles, not two. They come from one stroke (vertical
 * pitches, horizontal turns), a paper compass has always reported heading and
 * been the thing you square the map up with, and two buttons stacked in the
 * same corner for one camera is how a map ends up with chrome nobody reads.
 * It shows whichever angles are actually off home, and resets both.
 */
import { mapBearingIsNorth, mapOrientIsHome, mapTiltIsLevel } from "./mapsView";

export interface MapCompassProps {
  /** The pitch the camera actually has, degrees (the widget's `getTilt()`, not the page's request). */
  readonly tilt: number;
  /** The heading the camera actually has, degrees in `[0, 360)` (the widget's `getBearing()`). */
  readonly bearing: number;
  readonly isOrbitProjection: boolean;
  readonly onReset: () => void;
}

/**
 * The heading as a compass point, for the one-glance read.
 *
 * Sixteen points, which is the resolution a two-or-three-letter label can
 * carry honestly — the number beside it is the precise value, so this only
 * has to say roughly where you are pointing.
 */
const COMPASS_POINTS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"] as const;

export function mapCompassPoint(bearing: number): string {
  const norm = ((bearing % 360) + 360) % 360;
  return COMPASS_POINTS[Math.round(norm / 22.5) % 16]!;
}

export function MapCompass({ tilt, bearing, isOrbitProjection, onReset }: MapCompassProps) {
  if (mapOrientIsHome(tilt, bearing, isOrbitProjection)) return null;
  const shownTilt = Math.round(tilt);
  const shownBearing = Math.round(((bearing % 360) + 360) % 360) % 360;
  const level = mapTiltIsLevel(tilt, isOrbitProjection);
  const north = mapBearingIsNorth(bearing);
  // Only the angles that are actually off home are shown: a reader who has
  // only pitched should not have to read "0°" beside a compass point to work
  // out that they have not turned anything.
  const parts = [
    ...(north ? [] : [`${shownBearing}° ${mapCompassPoint(bearing)}`]),
    ...(level ? [] : [`${shownTilt}°`]),
  ];
  const spoken = [
    ...(north ? [] : [`heading is ${shownBearing} degrees`]),
    ...(level ? [] : [`pitch is ${shownTilt} degrees`]),
  ].join(" and ");
  return (
    <button
      type="button"
      className="maps-compass"
      onClick={onReset}
      // The title carries the gesture as well as the action: a reader who
      // found this control by accident (it appeared) is exactly the reader
      // who has not yet been told how the camera got there. Both axes of the
      // one stroke are named, because both of them can be what raised it.
      title={`${parts.join(" · ")}. Click to face north and level the map. Ctrl+drag or right-drag — sideways to turn, up and down to pitch.`}
      aria-label={`Face north and level the map — ${spoken}`}
    >
      <span className="maps-compass__needle" aria-hidden="true">
        {/* The needle turns with the map, so the control reads as an
            instrument rather than as a label: north is wherever it points. */}
        <svg viewBox="0 0 16 16" width="13" height="13" style={{ transform: `rotate(${-shownBearing}deg)` }}>
          <path d="M8 1 L11 12 L8 9.6 L5 12 Z" fill="currentColor" />
        </svg>
      </span>
      <span className="maps-compass__angles" aria-hidden="true">{parts.join(" · ")}</span>
      <span className="maps-compass__label" aria-hidden="true">Reset</span>
    </button>
  );
}

import type { GUI } from "lil-gui";
import { useEffect, useRef, useState } from "react";
import {
  MAP_BEARING_HOME,
  MAP_BEARING_SLIDER_RANGE,
  mapBearingIsNorth,
  mapTiltIsLevel,
  mapTiltResetValue,
  mapTiltSliderRange,
} from "../../../features/maps/model/mapsView";
import { useFolder, useReadonlyText, useSlider, type DockController } from "../../Dock";

// ── "View" folder — center/span/tilt (replaces DockCamera; see file doc).
//    No "Jump to" quick-travel control — Places navigation was removed
//    entirely (user ask: "remove the places from the left sidebar" plus
//    "we should remove the jump to from the right sidebar"), not relocated
//    a second time. ───────────────────────────────────────────────────────

export interface ViewFolderInputs {
  centerLon: number;
  centerLat: number;
  span: number;
  maxSpan: number;
  tilt: number;
  maxTilt: number;
  bearing: number;
  isOrbitProjection: boolean;
  lod: number;
  degPerCell: number;
  onCenter: (lon: number, lat: number) => void;
  onSpan: (span: number) => void;
  onTilt: (tilt: number) => void;
  onBearing: (bearing: number) => void;
}

/*
 * Street-level WALK is deliberately NOT a row in this folder.
 *
 * It shipped as one — a `Walk` toggle under Bearing plus a `Horizon`
 * readout — and was rejected as one ("it feels stupid as a checkbox"). It is
 * a MODE, not a setting: the reader stops looking at the map and stands in
 * it, and the entrance to that belongs ON the map, the way Google Maps'
 * pegman does. It now lives in `MapWalkButton.tsx`, an overlay beside
 * `MapCompass` and `MapSearchBox`, and it carries the same gate reason and
 * the same tile-budget readout there. Tilt and Bearing stay here and keep
 * meaning something while walking (the walker's pitch and heading), which is
 * what the old placement argument was really about.
 */

export function useViewFolder(parent: GUI | null, inputs: ViewFolderInputs): void {
  const {
    centerLon,
    centerLat,
    span,
    maxSpan,
    tilt,
    maxTilt,
    bearing,
    isOrbitProjection,
    lod,
    degPerCell,
    onCenter,
    onSpan,
    onTilt,
    onBearing,
  } = inputs;
  const folder = useFolder(parent, "View", { open: true });
  useSlider(folder, "Center lon", { min: -180, max: 180, step: 0.1 }, centerLon, (v) => onCenter(v, centerLat));
  useSlider(folder, "Center lat", { min: -90, max: 90, step: 0.1 }, centerLat, (v) => onCenter(centerLon, v));
  // The lil-gui controller is created ONCE per (folder, label) — its RANGE is
  // read at creation, so a live ceiling has to be pushed onto the raw
  // controller afterwards or the slider keeps offering a span the map will
  // clamp away. `maxSpan` is genuinely live: it follows the projection, the
  // tilt and the host's shape.
  const spanCtrl = useSlider(folder, "Span °", { min: 0.5, max: maxSpan, step: 0.5 }, span, onSpan);
  useEffect(() => {
    spanCtrl?.raw.max(maxSpan);
  }, [spanCtrl, maxSpan]);
  // `tilt` is unified across both navigation modes (widget.ts's
  // `GlyphMapHandle.setTilt` doc) as "additional pitch on top of the
  // projection's own base orientation" — see `mapTiltSliderRange` for why
  // the two families keep different SHAPES and why the ceiling is the
  // widget's own live `getMaxTilt()` rather than the literal it replaced.
  // Pushed onto the raw controller for the same reason `maxSpan` is: the
  // range is read once at creation, and this one moves with every wheel
  // notch (~21 degrees at a whole-world span, 85 by city scale).
  const tiltRange = mapTiltSliderRange(isOrbitProjection, maxTilt);
  const tiltCtrl = useSlider(folder, "Tilt °", tiltRange, tilt, onTilt);
  useEffect(() => {
    tiltCtrl?.raw.min(tiltRange.min);
    tiltCtrl?.raw.max(tiltRange.max);
  }, [tiltCtrl, tiltRange.min, tiltRange.max]);
  // Home is NOT zero for both families: an orbit `tilt` is a signed offset on
  // top of `cameraForCenter` so 0 is the head-on globe, while a sheet's IS
  // `camera.rotX` so 0 is a plan view looking straight down — a different map
  // from the one the page opens at. See `mapTiltResetValue`.
  const tiltHome = mapTiltResetValue(isOrbitProjection);
  useRowReset(tiltCtrl, {
    atHome: mapTiltIsLevel(tilt, isOrbitProjection),
    label: `Reset the pitch to ${tiltHome}°`,
    title: `Put the pitch back to ${tiltHome}° — ${
      isOrbitProjection
        ? "the globe seen head-on, this projection's own base orientation"
        : "the isometric pitch this page opens at; 0° would be a plan view looking straight down"
    }.`,
    onReset: () => onTilt(tiltHome),
  });
  // Bearing sits immediately under Tilt because they are the two halves of
  // ONE gesture (`controls.tilt`: vertical pitches, horizontal turns), and a
  // reader who finds one should find the other. Unlike Tilt its range is
  // FIXED — a heading has no ceiling — so there is no `raw.min`/`raw.max`
  // push here; see `MAP_BEARING_SLIDER_RANGE` for why it is 0..360 and what
  // the handle does at the north seam. The VALUE still syncs every frame
  // like Tilt's does, or the horizontal half of the gesture would leave this
  // showing a heading the camera no longer has.
  const bearingCtrl = useSlider(folder, "Bearing °", MAP_BEARING_SLIDER_RANGE, bearing, onBearing);
  useEffect(() => {
    // The compass direction at the TOP of the picture, spelled out on the row
    // itself: a heading a reader cannot orient is just a number, and the
    // label alone cannot say which way 0 faces.
    (bearingCtrl?.raw.domElement as HTMLElement | undefined)?.setAttribute(
      "title",
      "Compass heading at the top of the map. 0° = north up, 90° = east up. Ctrl+drag or right-drag sideways to turn.",
    );
  }, [bearingCtrl]);
  useRowReset(bearingCtrl, {
    atHome: mapBearingIsNorth(bearing),
    label: "Reset the heading to north",
    title: "Face the map north-up again. A compass has one home on either projection.",
    onReset: () => onBearing(MAP_BEARING_HOME),
  });
  useReadonlyText(folder, "LOD", `z${lod} · ${degPerCell.toFixed(3)}°/cell`);
}

/**
 * The inline `[reset]` beside a View slider's own label.
 *
 * Asked for in exactly that shape, and after a first attempt shipped it as two
 * full-width lil-gui button rows: "NO, THE RESET BUTTONS HAVE TO BE NEXT TO
 * THE TILT ° AND BEARING ° LABELS WE CANNOT ADD THOSE HUGE BUTTONS ... tiny
 * reset button ... [reset]". So it is literally that word in brackets, in the
 * rail's own monospace, at 9px — the same bracket language the Dock's slider
 * already draws around its track (`[ ─█──── ]`, gallery-workbench.css) and
 * the same row scale `/synth`'s `.voice-mode-toggle .gx-toggle-btn` uses when
 * a segmented control has to live inline in a title row rather than own one.
 *
 * It goes in the row's NAME cell, not its widget. That was the geometric
 * objection to inline in the first place — a number row is `.name` at 45%
 * plus a widget that already ends in a 45..70px value box, so an affordance
 * in the WIDGET buys itself out of the slider TRACK, the part a reader
 * drags. The name cell has the room instead: measured in a real browser on
 * the running page at the Dock's 360px, the cell is 152.09px (148px of
 * content), the longer of the two labels is 61.6px and this button 43.2px, so
 * the worse row uses 110.8 of 148 — and `Tilt °`/`Bearing °`/`Span °` all
 * still report a 120.05px slider track at the same x, unchanged to the third
 * decimal from before this existed. `.maps-view-name`'s `max-width:
 * var(--name-width)` then makes the guarantee structural rather than a
 * measurement that could rot — lil-gui gives `.name` a `min-width` and no
 * max, so pinning the max to the same 45% means the cell cannot grow into the
 * widget however long a label gets.
 *
 * Both write through the folder's OWN `onTilt`/`onBearing` — the callbacks
 * the sliders drive, which `MapsWorkbench` wires to `map.setTilt` /
 * `map.setBearing`. Nothing here writes page state directly: the tilt
 * ceiling, the `[0, 360)` bearing normalization, the widget's single motion
 * loop and the URL write all live behind those two setters.
 *
 * DISABLED at home — a real `disabled` attribute on a real `<button>`, so it
 * is inert rather than merely quiet — which also makes it the INDICATOR that
 * a pitch or a heading is in force at all (the same job the on-map
 * `MapCompass` does, which resets both angles at once and is the
 * discoverable half of this pair). The ROW stays enabled: it is the slider's,
 * and lil-gui's `.controller.disabled` would take the slider down with it.
 */
function useRowReset(
  ctrl: DockController<number> | null,
  inputs: { atHome: boolean; label: string; title: string; onReset: () => void },
): void {
  const { atHome, label, title, onReset } = inputs;
  const onResetRef = useRef(onReset);
  onResetRef.current = onReset;
  const [button, setButton] = useState<HTMLButtonElement | null>(null);

  useEffect(() => {
    // `.name` is lil-gui's own documented row class (the tests find rows by
    // it, and `Controller.$name` is not in the published typings), so this
    // stays on the same public-DOM footing as the `title` writes above.
    const name = ctrl?.raw.domElement.querySelector<HTMLElement>(".name");
    if (!name) return;
    const el = document.createElement("button");
    el.type = "button";
    el.className = "maps-view-reset instrument-row-reset";
    el.textContent = "[reset]";
    el.addEventListener("click", () => onResetRef.current());
    name.classList.add("maps-view-name");
    name.appendChild(el);
    setButton(el);
    return () => {
      el.remove();
      name.classList.remove("maps-view-name");
      setButton(null);
    };
  }, [ctrl]);

  useEffect(() => {
    if (!button) return;
    button.disabled = atHome;
    button.setAttribute("aria-label", label);
    button.setAttribute("title", title);
  }, [button, atHome, label, title]);
}

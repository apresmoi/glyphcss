import type { GUI } from "lil-gui";
import { useEffect } from "react";
import { createPortal } from "react-dom";
import { type MapSunMode } from "../../../features/maps/model/config";
import { useDockSlot, useSlider } from "../../Dock";
import { IconToggle } from "../../IconToggle";
import { SUN_MODE_TOGGLE } from "../mapsOptions";

/**
 * The sun controls, rendered INSIDE the shared Dock Lighting folder through
 * `DockLighting`'s `extras` seam — not a fourth lighting section of our own.
 *
 * The three-way mode toggle is portaled into a TOP dock slot (it gates the
 * Azimuth/Elev rows below it, so it has to read as the parent choice — the
 * same placement, and the same `.dock-subcell` row CSS, /synth's own Subcell
 * toggle uses). The two manual-time rows are ordinary `useSlider` lil-gui
 * controllers, created unconditionally and merely hidden outside manual mode
 * (a controller appended only once its mode is picked would land after the
 * ambient rows instead of next to the toggle that governs it — the same
 * create-always/show-in-place idiom /synth uses for Ink levels vs Ink
 * spacing).
 */
export function MapsSunControls({
  folder,
  mode,
  day,
  hour,
  onMode,
  onDay,
  onHour,
}: {
  folder: GUI | null;
  mode: MapSunMode;
  day: number;
  hour: number;
  onMode: (mode: MapSunMode) => void;
  onDay: (day: number) => void;
  onHour: (hour: number) => void;
}) {
  const slot = useDockSlot(folder, { position: "top", className: "dock-subcell-slot" });
  const dayCtrl = useSlider(folder, "Sun day", { min: 1, max: 366, step: 1 }, day, onDay);
  const hourCtrl = useSlider(folder, "Sun hour", { min: 0, max: 24, step: 0.25 }, hour, onHour);

  useEffect(() => {
    dayCtrl?.setVisible(mode === "manual");
    hourCtrl?.setVisible(mode === "manual");
  }, [dayCtrl, hourCtrl, mode]);

  if (!slot) return null;
  return createPortal(
    <div className="dock-subcell">
      <span className="dock-subcell-label">Sun</span>
      <IconToggle
        groupTitle="Sun — where the key light comes from. Full: no terminator, the sliders below are the whole light. Real time: the sun's true current position, advancing on its own. Manual: a day and UTC hour you pick."
        options={SUN_MODE_TOGGLE}
        value={mode}
        onChange={(v) => onMode(v as MapSunMode)}
      />
    </div>,
    slot,
  );
}

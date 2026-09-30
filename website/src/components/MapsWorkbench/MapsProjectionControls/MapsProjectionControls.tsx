import type { GUI } from "lil-gui";
import { createPortal } from "react-dom";
import { type MapProjectionId } from "../../../features/maps/model/config";
import { useDockSlot } from "../../Dock";
import { IconToggle } from "../../IconToggle";
import { PROJECTION_TOGGLE } from "../mapsOptions";

/**
 * Mirrors `MapsSunControls` exactly: a `folder` (here the Dock's ROOT `GUI`,
 * not a subfolder — `useDockSlot` reads `parent.$children` regardless of
 * whether `parent` is the root or a folder, so "top of the whole Dock" is
 * just "top slot on the root") gets a `dock-subcell-slot` inserted before
 * its first child, and the toggle portals into it.
 */
export function MapsProjectionControls({
  folder,
  projectionId,
  onProjectionId,
}: {
  folder: GUI | null;
  projectionId: MapProjectionId;
  onProjectionId: (id: MapProjectionId) => void;
}) {
  const slot = useDockSlot(folder, { position: "top", className: "dock-subcell-slot" });
  if (!slot) return null;
  return createPortal(
    <div className="dock-subcell">
      <span className="dock-subcell-label">Projection</span>
      <IconToggle
        groupTitle="Projection — the map's shape. Construction-time: switching rebuilds the widget."
        options={PROJECTION_TOGGLE}
        value={projectionId}
        onChange={(v) => onProjectionId(v as MapProjectionId)}
      />
    </div>,
    slot,
  );
}

import type { GUI } from "lil-gui";
import { createPortal } from "react-dom";
import { useDockSlot } from "../../Dock";
import { IconToggle } from "../../IconToggle";
import { SHADOW_TOGGLE } from "../mapsOptions";

/**
 * The cast-shadow toggle, in the SAME Dock Lighting folder and through the
 * same `extras` seam as {@link MapsSunControls} — because it is the same
 * subject. A shadow is thrown by the key light, so a reader who has just set
 * the sun is exactly the reader who wants to know whether it casts, and
 * putting this anywhere else (a Rendering row, a layer card) would separate a
 * light from what it does.
 *
 * It renders BELOW the Sun row, which is why it is rendered ABOVE it in the
 * JSX: `useDockSlot(folder, { position: "top" })` inserts each slot before the
 * folder's current first child, so the LAST one mounted ends up first.
 */
export function MapsShadowControls({
  folder,
  shadows,
  onShadows,
  casterReason,
}: {
  folder: GUI | null;
  shadows: boolean;
  onShadows: (on: boolean) => void;
  /** {@link mapShadowCasterReason} — shown under the row while shadows are ON and nothing can cast. */
  casterReason?: string | null;
}) {
  const slot = useDockSlot(folder, { position: "top", className: "dock-subcell-slot" });
  if (!slot) return null;
  // Only while the toggle is ON: with shadows off there is nothing inert to
  // explain, and a permanent caveat under an off switch is noise.
  const note = shadows ? (casterReason ?? null) : null;
  return createPortal(
    <>
      <div className="dock-subcell">
        <span className="dock-subcell-label">Shadows</span>
        <IconToggle
          groupTitle="Shadows — whether standing geometry (OSM buildings, the model layer) casts onto the ground under it. Off by default: it is a second pass, and it needs a layer that stands up off the ground to draw anything at all."
          options={SHADOW_TOGGLE}
          value={shadows ? "on" : "off"}
          onChange={(v) => onShadows(v === "on")}
        />
      </div>
      {note === null ? null : <p className="maps-shadow-note">{note}</p>}
    </>,
    slot,
  );
}

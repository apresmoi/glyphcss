import { useEffect, useState } from "react";
import { type MapWalkInput } from "../../../features/maps/services/mapsWalk";

/**
 * NO `maxSpan` is passed to `createGlyphMap` any more (it used to be 720 —
 * TWICE the world's own 360deg width, so a user could trivially pull back
 * until the map was a small rectangle in a field of page background).
 * Setting it at all is the widget's documented opt-OUT of the cover rule
 * ("overview margin around the whole projection" is exactly the background
 * cover removes), so the page simply omits it and takes the default: a sheet
 * projection is capped at its live COVER limit and the globe at its own
 * domain width. `map.getMaxSpan()` is the live ceiling, read into
 * `maxSpan` state below so the View folder's span slider offers the range
 * the map can actually show instead of one that snaps back.
 */

/**
 * The reader's input capability, for `mapsWalk.ts`'s device clause.
 *
 * SSR-safe: `MapsWorkbench` is `client:only`, but the first render still has
 * to produce something, and the safe default is the drivable one — a desktop
 * that answered `false` for a frame would flash a disabled Walk button.
 */
export function useWalkInput(): MapWalkInput {
  const [input, setInput] = useState<MapWalkInput>({ coarsePointer: false, pointerLock: true });
  useEffect(() => {
    const query = window.matchMedia("(pointer: coarse)");
    const read = () =>
      setInput({
        coarsePointer: query.matches,
        // The API's presence, not a permission — a browser that has it may
        // still refuse the lock, and that is a runtime failure the widget
        // already handles, not a reason to grey the entrance.
        pointerLock: typeof Element !== "undefined" && "requestPointerLock" in Element.prototype,
      });
    read();
    query.addEventListener("change", read);
    return () => query.removeEventListener("change", read);
  }, []);
  return input;
}

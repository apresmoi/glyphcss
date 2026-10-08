import { type Params } from "../../synth/model/parameters";

/** Live edit state pushed into an already-mounted scene. Absent for the footer
 *  thumbnails, which stay canonical so the catalog is a stable reference. */
export interface LiveEdits {
  layerParams: Record<number, Params>;
  drive: { current: { timeScale: number; paused: boolean } };
  /** Which voice the pointer is on, if any — drives the solo overlay below. */
  highlight: { current: { slot: number | null; params: Params } };
  /** `colorEncoding: "atlas"` (zero-`<span>` colour-font output) — shared
   *  across every live size tile (they all render the SAME patch, just at
   *  different grid sizes). Not URL-persisted, matching every other Dock
   *  control on this page except which loader is selected (`?l=`). The
   *  reported reason is derived at runtime — see `useLoaderScene`'s own
   *  recompute logic and `../../lib/glyphAtlasAvailability.ts`'s module doc. */
  colorEncoding: { current: "spans" | "atlas" };
  onAtlasAvailability: (reason: string | null) => void;
}

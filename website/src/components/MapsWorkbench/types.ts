import { type MapCharMode, type MapColorEncoding } from "../../features/maps/services/mapsUrlState";

// Small dock-content component (a Dock child, so `useDockGui()` resolves)
// bundling the map-specific folders + the reused DockLighting/DockRendering.
export interface RenderingPartial {
  charMode?: MapCharMode;
  wireframeJunctions?: boolean;
  hiddenLines?: "show" | "hide";
  solidWeightRamp?: boolean;
  colorEncoding?: MapColorEncoding;
  density?: number;
  dragDensity?: number;
  useColors?: boolean;
  smoothShading?: boolean;
}

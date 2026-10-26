// What the Markdown twins (and llms-full.txt) print in place of interactive
// docs components: the code a reader would copy, never the docs adapter's props.
import { demoSnippets } from "../glyph-scene/demoSnippets";
import { DEFAULT_TUNABLES, type Tunables } from "../glyph-scene/types";

export * from "./glyphRender";

export interface GlyphDemoTwinProps {
  geometry?: Tunables["geometry"];
  mesh?: string;
  meshes?: readonly { url: string }[];
  polygonsUrl?: string;
  hotspot?: boolean;
  defaults?: string;
}

/** The vanilla snippet a GlyphDemo's `[ Code ]` panel opens with. */
export function glyphDemoTwinCode(props: GlyphDemoTwinProps): string {
  const defaults = JSON.parse(props.defaults ?? "{}") as Partial<Tunables>;
  const tunables: Tunables = { ...DEFAULT_TUNABLES, geometry: props.geometry ?? "cuboctahedron", ...defaults };
  return demoSnippets(tunables, {
    mesh: props.meshes?.[0]?.url ?? props.mesh,
    polygonsUrl: props.polygonsUrl,
    hotspot: props.hotspot === true,
  }).vanilla!;
}

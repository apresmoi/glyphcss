import type {
  GlyphMapBackgroundLayer,
  GlyphMapContourLayer,
  GlyphMapLineLayer,
  GlyphMapMarkerOptions,
  GlyphMapOpenMapTilesLayersOptions,
  GlyphMapOptions,
  GlyphMapRasterLayer,
  GlyphMapSunOptions,
  glyphMapEquirectangular,
  glyphMapGlobe,
  glyphMapMercator,
  glyphMapOrthographic,
} from "@glyphcss/maps";

type Projection =
  | { type: "globe"; options?: Parameters<typeof glyphMapGlobe>[0] }
  | {
      type: "equirectangular";
      options?: Parameters<typeof glyphMapEquirectangular>[0];
    }
  | { type: "mercator"; options?: Parameters<typeof glyphMapMercator>[0] }
  | {
      type: "orthographic";
      options?: Parameters<typeof glyphMapOrthographic>[0];
    };

export type GlyphMapDemoLayer =
  | GlyphMapBackgroundLayer
  | Omit<GlyphMapRasterLayer, "source" | "classifier">
  | Omit<GlyphMapContourLayer, "source">
  | Omit<GlyphMapLineLayer, "source" | "filter">
  | ({ type: "osm" } & GlyphMapOpenMapTilesLayersOptions)
  | { type: "markers"; markers: readonly GlyphMapMarkerOptions[] };

/** Docs islands accept data only; providers and callbacks stay in the runtime. */
export interface GlyphMapDemoProps {
  label?: string;
  projection?: Projection;
  view?: Partial<GlyphMapOptions["view"]>;
  tilt?: number;
  bearing?: number;
  layers?: readonly GlyphMapDemoLayer[];
  controls?: GlyphMapOptions["controls"];
  scene?: Pick<
    NonNullable<GlyphMapOptions["scene"]>,
    "mode" | "charMode" | "useColors" | "glyphPalette" | "directionalLight" | "ambientLight" | "interactiveDownscale"
  >;
  sun?: Omit<GlyphMapSunOptions, "date"> & { date?: number };
  keyLight?: GlyphMapOptions["keyLight"];
}

# @glyphcss/maps

Geographic data as text: a static bake pipeline and the interactive `createGlyphMap` widget.

Zürich, the Limmat and Lake Zürich — © OpenStreetMap contributors, via the bundled OpenFreeMap [z12 fixture](fixtures/openfreemap/z12-2145-1434.mvt); 80 × 30, north up, `:` marks water.

```text
          \\ \\\  :/  /  ▔---▕--▔/\\  \\/ \\       ‾‾▔--\       ▔|/--_          
            \//‾-__ //       ▕ ::/ \   \\  \        \    \_     /\/   -__   ____
\           /  //  ‾▔        \ :/   \\  \--▔\      ▕/      ‾▔--/ \__-----\-▔    
 \\       // :/  : /--______ |::/   _\      \/----//               \            
  \\     // //    //___/    ‾‾‾‾/▔-‾  \\     \                     \\           
-_  \    -__/   /////         ::       \      \                      _          
____\--▔/ :‾▔▔--/-‾           ::        ‾\    \                       ▔-/       
‾    \ / //   /               :          ▏    /\                        /       
     \/_ /    \\              ::        //   //                        ▏        
     ///‾‾\:    \\            ::       \▏ ▔/_/                         -_       
   ////:  \\\ :   \\          ::        \  /| ‾▔-\__                     ▔|     
-_\///     --‾  :   \\         ::        /\  \\     ‾---___-\\            |     
  \\\  _-▔‾   \  :::  \        ::/      //    \\             ▔-_          ▏     
 :  \/‾       \\       \\     :::\\\ _-▔        \\\             ‾‾-\      \     
  _-▔          \        \\    : :_|-\              \\          _-/‾\\      \    
//       \\     \       : \/----▔‾\\_/              /\       _▔      \      \   
/        \\      \      __-‾   :::: \      ---___  //\   __-‾         \\_   /\  
        //\\      \   _-  ::::::::::\\   //      ‾--__\//                ‾--_\\ 
     _-▔‾| \\      _-▔  :::::::::::::\\_/            ‾▔-_                   ‾▔\ 
  -▔‾   -▏_ \    _-   ::::::::::::::::\                ▏ ‾▔\               _// \
//      ▕  ‾\\/▔/    ::::::::::::::::::\               \    \_          __-▔    
/       ▕    \  |    :::::::::::::::::: \               \     ‾\_   __-▔        
        ▕    ▕  |   :::::::::::::::::::: \               \\     ‾---_        _-‾
        ▕     ▏ ▕  :::::::::::::::::::::: \               \\  _--▔ \‾▔---▔▔‾‾\\ 
         \    | ▕   ::::::::::::::::::::: \\                -▔     _\ ▔---______
         \▏   | ▕  : ::::::::::::::::::::  \                \ _--▔‾             
          ▏   ▕ ▕  ::::::::::::::::::::::   \               /\\                 
          ▏    ▏ ▏ ::::::::::::::::::::::    \\           _// \\                
          |    ▏ ▏:::::::::::::::::::::::     \       --▔‾      \               
          |    |/  ::::::::::::::::::::::::    \\ _-▔‾           \              
```

## Install

```sh
npm install @glyphcss/maps
```

Import `@glyphcss/maps` in browsers; `@glyphcss/maps/node` re-exports it and adds the Node-only ASCII Grid file reader.

## Quick start

### Render Zürich

Run in a browser module through your bundler. Serve the package's bundled `fixtures/` directory at `./fixtures/` beside the page; this example loads only the local z12 tile linked above, with no online tile service. Use a monospace font with 8 × 16 px cells for the framing shown.

```js
import {
  createGlyphMap, glyphMapMercator, glyphMapOpenFreeMapProvider,
  glyphMapOpenMapTilesFeatureFilter,
} from "@glyphcss/maps";

const source = glyphMapOpenFreeMapProvider({
  tileUrl: "./fixtures/openfreemap/z{z}-{x}-{y}.mvt",
  minZoom: 12, maxZoom: 12,
  layers: ["water", "transportation"],
});
const host = document.createElement("div");
host.style.cssText = "width: 640px; height: 480px";
document.body.append(host);
const map = createGlyphMap(host, {
  view: { center: [8.547, 47.367], span: 0.04, cols: 80, rows: 30 },
  projection: glyphMapMercator(), tilt: 0, bearing: 0,
  scene: {
    useColors: false,
    ambientLight: { intensity: 2 / 9 },
    directionalLight: { direction: [0, 0, 1], intensity: 0 },
  },
  layers: [
    { type: "fill", source, sourceLayer: "water",
      filter: glyphMapOpenMapTilesFeatureFilter({
        geometry: "polygon", classes: ["lake", "river"],
      }) },
    { type: "line", source, sourceLayer: "transportation",
      filter: glyphMapOpenMapTilesFeatureFilter({
        geometry: "line", excludeBrunnel: ["tunnel"],
        classes: ["motorway", "trunk", "primary", "secondary", "tertiary"],
      }) },
  ],
});
await map.idle();
console.log(map.scene.output.textContent);
// Display map.getAttributions(); call map.destroy() when unmounting.
```

The widget's settled `<pre>` produces the text above directly: water polygons as `fill`, major streets as `line`, and no terrain or extrusions. Minor roads, paths and railways are omitted to keep this small grid readable. Display the credits returned by `map.getAttributions()` alongside an embedded map.

For static raster baking, use `loadGlyphMapSource` → `sampleGlyphMapField` → `classifyGlyphMapField` → `compileGlyphMap`; the returned `{ html, css }` needs no runtime JavaScript. The bundled [sample grid](fixtures/sample-region.asc) is synthetic terrain, not a city map.

## What it does

MapLibre-shaped layer names describe glyphcss rendering; this is not a MapLibre style-spec implementation. The current API has eleven layer types:

| Layer | Output |
|---|---|
| `background` | CSS background colour. |
| `raster` | Elevation tiles as a 3D relief mesh. |
| `line` | Vector lines stamped into the text grid. |
| `contour` | Elevation isolines, with optional labels. |
| `fill` | Polygon meshes, draped or flat. |
| `fill-extrusion` | Buildings and other extruded polygons. |
| `symbol` | Positioned DOM labels. |
| `circle` | Positioned DOM dots. |
| `glyph` | Point marks and labels stamped into the grid. |
| `heatmap` | Point density as a relief mesh. |
| `model` | Supplied polygon meshes. |

| Capability | Available |
|---|---|
| Raster sources | In-memory ASCII Grid parsing, Node file loading, elevation tiles and providers. |
| TopoJSON | Decode shared arcs and extract vector features. |
| MVT / PMTiles | Decode MVT; mount PMTiles archives through a vector provider. |
| OpenFreeMap / OpenMapTiles | Tile provider plus schema-aware layer presets and filters. |
| Protomaps | PMTiles extract helper, layer presets and filters. |
| Projections | Equirectangular, Mercator, globe, orthographic; adapter for d3 raw projections. |
| Camera / gestures | Pan/orbit, zoom, tilt, bearing, flights and projection transitions; mouse and touch. |
| Walk mode | Orbit-capable projections: perspective walking, collision and sky; enter with `map.setWalk({})`. |
| Lighting | Real-sun lighting, camera-following key light and optional cast shadows. |

Public coordinates use `[longitude, latitude]` and degrees. The imperative widget has no React or Vue binding; call `map.getAttributions()` to display mounted sources' credits.

## API at a glance

| Entry point | Purpose / key options |
|---|---|
| `parseGlyphMapAsciiGrid` / `loadGlyphMapSource` | Parse text / read a Node file; required `id`, optional `kind`, `units`, `noDataValue`; file reader adds `path`, `gzip`. |
| `glyphMapBounds` | Define an exact region with `west`, `east`, `south`, `north`, `cols`, `rows`. |
| `sampleGlyphMapField` | Sample a source into a view; `sampler`, `upsample`, `noData`. |
| `classifyGlyphMapField` | Assign bands using `glyphMapBreaks`, `glyphMapEqualInterval`, `glyphMapQuantile`, `glyphMapLog` or `GlyphMapClassifiers`. |
| `compileGlyphMap` | Bands to `{ html, css? }`; `ramp`, `colors`, `water`, `noData`, `hillshade`; compile options `mode`, `preClass`. |
| `buildGlyphMapArtifact` | Record bands and provenance with `source` and `sampler` IDs. |
| `glyphMapGlobe` / `glyphMapMercator` | Create projections; `exaggeration`, globe `radius`, Mercator `maxLat`; other projections listed above. |
| `glyphMapPolygons` / `glyphMapVectorPolygons` | Build relief / vector geometry for a projection; `color`, relief `resolution`, vector `height`. |
| `glyphMapOpenFreeMapProvider` / `glyphMapPMTilesProvider` | Mount vector tile sources; OpenFreeMap `tileUrl`, `layers`, zoom limits; PMTiles URL or reader, `layers`, `tileResolution`. |
| `createGlyphMap` | Mount with `view`, `projection`, `layers`; optional `autoSize`, `controls`, `groundElevation`, `sun`, `shadow`. |
| `GlyphMapHandle` | Update view/layers/sources; project coordinates, add markers, subscribe to events, `idle()`, `destroy()`. |

Full exports: [browser entry](src/index.ts), [Node entry](src/node.ts). Full options: [bake types](src/types.ts), [widget and layer types](src/widget.ts), [projection types](src/projection.ts), [provider types](src/provider.ts).

## Documentation

- [Overview](https://glyphcss.com/maps/overview) · [interactive /maps workbench](https://glyphcss.com/maps).
- [Terrain and baking](https://glyphcss.com/maps/terrain): classifiers, relief tiles, ground, lighting and shadows.
- [Layers](https://glyphcss.com/maps/layers): styling, draping, labels, contours, glyphs and extrusions.
- [Camera](https://glyphcss.com/maps/camera): gestures, cover limits, flights, settling and walk mode.
- [Projections](https://glyphcss.com/maps/projections): coordinate frames, capabilities and transitions.
- [OpenStreetMap](https://glyphcss.com/maps/openstreetmap): OpenFreeMap, OpenMapTiles, PMTiles, Protomaps and attribution.
- [Contributor contracts](AGENTS.md): invariants and rejected approaches; [sampling](src/sample.ts) and [artifact](src/artifact.ts) comments retain bake/no-data and provenance details.

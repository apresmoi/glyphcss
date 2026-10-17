# @glyphcss/maps

Geographic data as text: a static bake pipeline and the interactive `createGlyphMap` widget.

A fresh 60 × 20 bake of the bundled [sample grid](fixtures/sample-region.asc), a synthetic terrain fixture, using the quick start below:

```text
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
~~~~~~~~~~~~~~~~~~~.........~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
~~~~~~~~~~~~~~~~~.....:::::.....~~~~~~~~~~~~~~~~~~~~~~~~~~~~
~~~~~~~~~~~~~~~~...:::::::::::::....~~~~~~~~~~~~~~~~~~~~~~~~
~~~~~~~~~~~~~~...::::------------:::::.............~~~~~~~~~
~~~~~~~~~~~~...::::---==============-----::::......~~~~~~~~~
~~~~~~~~~....::::---===++++++++++++++++===---::....~~~~~~~~~
~~~~~.....:::::---===++++++***********++++==--::...~~~~~~~~~
~~~~....::::-----===+++++*******##*******+++=--::..~~~~~~~~~
~~~...:::::-----===+++++*****########****+++==-::..~~~~~~~~~
~~~...:::::-----===+++++*****#########****+++=-::..~~~~~~~~~
~~~....:::::----====+++++*****#######****+++==-::..~~~~~~~~~
~~~~.....::::----====+++++*************++++==--::..~~~~~~~~~
~~~~~~~.....::::---===++++++++****+++++++==---::...~~~~~~~~~
~~~~~~~~~~....::::---====+++++++++++====---::::....~~~~~~~~~
~~~~~~~~~~~~~...::::----========-----:::::.........~~~~~~~~~
~~~~~~~~~~~~~~~...::::-------:::::.......~~~~~~~~~~~~~~~~~~~
~~~~~~~~~~~~~~~~~...:::::::::....~~~~~~~~~~~~~~~~~~~~~~~~~~~
~~~~~~~~~~~~~~~~~~............~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
~~~~~~~~~~~~~~~~~~~~.......~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
```

## Install

```sh
npm install @glyphcss/maps
```

Import `@glyphcss/maps` in browsers; `@glyphcss/maps/node` re-exports it and adds the Node-only ASCII Grid file reader.

## Quick start

### Bake a region

Run this as a Node ES module after installation; the fixture ships with the package. Replace its path with your own georeferenced `.asc` or `.asc.gz` grid for real survey data.

```js
import { fileURLToPath } from "node:url";
import {
  loadGlyphMapSource, glyphMapBounds, sampleGlyphMapField,
  classifyGlyphMapField, glyphMapBreaks, compileGlyphMap,
} from "@glyphcss/maps/node";

const source = await loadGlyphMapSource({
  path: fileURLToPath(new URL(
    "../fixtures/sample-region.asc", import.meta.resolve("@glyphcss/maps/node"),
  )),
  id: "sample-region-fixture-v1",
});
const view = glyphMapBounds({ ...source.bounds, cols: 60, rows: 20 });
const field = await sampleGlyphMapField(source, view, { sampler: "max" });
const bands = classifyGlyphMapField(field, glyphMapBreaks([
  0, 250, 500, 750, 1000, 1500, 2000,
]));
const { html, css } = compileGlyphMap(bands, { ramp: "~.:-=+*#" });
console.log(html);
```

The `<pre>` contains every row shown above. Embed `html` and any returned `css` in a page; the baked output needs no JavaScript.

### Mount the widget

Run in a browser module through your bundler. This self-contained example draws the sample region's footprint without a tile service.

```js
import { createGlyphMap, glyphMapEquirectangular } from "@glyphcss/maps";

const host = document.createElement("div");
host.style.cssText = "width: 640px; height: 320px";
document.body.append(host);
const map = createGlyphMap(host, {
  view: { center: [-8.5, 41], span: 4, cols: 80, rows: 40 },
  projection: glyphMapEquirectangular(),
  tilt: 0,
  layers: [{
    type: "fill", color: "#69b5a4",
    source: { features: [{ geometryType: "polygon", rings: [[
      [-10, 40], [-7, 40], [-7, 42], [-10, 42], [-10, 40],
    ]] }] },
  }],
});
map.addMarker({ at: [-8.5, 41], label: "Sample region" });
await map.idle();
// Call map.destroy() when your component unmounts.
```

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

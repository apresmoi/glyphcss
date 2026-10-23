import { useEffect, useRef, useState } from "react";
import type { GlyphMapAttribution, GlyphMapHandle, GlyphMapLayer } from "@glyphcss/maps";
import { MAP_PALETTES } from "../../features/maps/model/config";
import { createOsmSource } from "../../features/maps/model/mapsOsm";
import { AttributionCredit } from "../AttributionCredit";
import styles from "./GlyphMapDemo.module.css";
import { loadBorders, loadTerrain } from "./loadProviders";
import type { GlyphMapDemoLayer, GlyphMapDemoProps } from "./types";

const DEFAULT_LAYERS: readonly GlyphMapDemoLayer[] = [{ type: "raster" }];

export function GlyphMapDemo(props: GlyphMapDemoProps) {
  const host = useRef<HTMLDivElement>(null);
  const [credits, setCredits] = useState<readonly GlyphMapAttribution[]>([]);
  const [status, setStatus] = useState("Loading terrain…");
  useEffect(() => {
    let disposed = false;
    let map: GlyphMapHandle | undefined;
    let missingOsm = false;
    const layers = props.layers ?? DEFAULT_LAYERS;
    setStatus(props.layers ? "Loading map…" : "Loading terrain…");
    setCredits([]);
    void Promise.all([
      import("@glyphcss/maps"),
      layers.some((layer) => layer.type === "raster" || layer.type === "contour") ? loadTerrain() : undefined,
      layers.some((layer) => layer.type === "line") ? loadBorders() : undefined,
    ])
      .then(async ([api, terrain, borders]) => {
        if (disposed || !host.current) return;
        const osm = layers.some((layer) => layer.type === "osm")
          ? createOsmSource({
              onError: () => {
                missingOsm = true;
                if (!disposed) setStatus("Some OpenStreetMap tiles could not be loaded.");
              },
            })
          : undefined;
        const projection = props.projection ?? {
          type: "globe",
          options: { exaggeration: 24 },
        };
        const factories = {
          globe: api.glyphMapGlobe,
          equirectangular: api.glyphMapEquirectangular,
          mercator: api.glyphMapMercator,
          orthographic: api.glyphMapOrthographic,
        };
        map = api.createGlyphMap(host.current, {
          view: {
            center: [0, 20],
            span: 140,
            cols: 100,
            rows: 48,
            ...props.view,
          },
          projection: factories[projection.type](projection.options),
          autoSize: true,
          controls: { drag: true, wheel: false, ...props.controls },
          tilt: props.tilt,
          bearing: props.bearing,
          sun: props.sun,
          keyLight: props.keyLight,
          layers: layers.flatMap((layer): GlyphMapLayer[] => {
            switch (layer.type) {
              case "raster":
                return [
                  {
                    classifier: api.GlyphMapClassifiers.etopo1V1,
                    colors: MAP_PALETTES.terrain,
                    ...layer,
                    source: terrain!,
                  },
                ];
              case "contour":
                return [{ ...layer, source: terrain! }];
              case "line":
                return [{ ...layer, source: borders! }];
              case "osm":
                return [...api.glyphMapOpenMapTilesLayers(osm!, layer)];
              case "markers":
                return [];
              default:
                return [layer];
            }
          }),
          scene: { mode: "solid", useColors: true, ...props.scene },
        });
        for (const layer of layers) {
          if (layer.type === "markers") for (const marker of layer.markers) map.addMarker(marker);
        }
        setCredits(map.getAttributions());
        await map.idle();
        if (!disposed && !missingOsm) setStatus("");
      })
      .catch(() => {
        if (!disposed) setStatus("Map could not be loaded. Try the maps workbench.");
      });
    return () => {
      disposed = true;
      map?.destroy();
    };
  }, [
    props.projection,
    props.view,
    props.tilt,
    props.bearing,
    props.layers,
    props.controls,
    props.scene,
    props.sun,
    props.keyLight,
  ]);
  return (
    <figure className={`${styles.root} not-content`} aria-label={props.label ?? "Interactive Earth terrain map"}>
      <div ref={host} className={styles.stage} />
      {status && <p role="status">{status}</p>}
      {credits.length > 0 && (
        <AttributionCredit
          attributions={credits.map((credit) => ({
            creator: credit.name,
            license: credit.license,
            sourceUrl: credit.url,
          }))}
        />
      )}
    </figure>
  );
}

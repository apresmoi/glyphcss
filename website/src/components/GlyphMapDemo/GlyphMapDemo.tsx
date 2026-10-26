import { useEffect, useRef, useState } from "react";
import type { GlyphMapAttribution, GlyphMapHandle, GlyphMapLayer } from "@glyphcss/maps";
import { MAP_PALETTES } from "../../features/maps/model/config";
import { createOsmSource } from "../../features/maps/model/mapsOsm";
import { ActionButton } from "../ActionButton";
import { AttributionCredit } from "../AttributionCredit";
import styles from "./GlyphMapDemo.module.css";
import { loadBorders, loadTerrain } from "./loadProviders";
import type { GlyphMapDemoLayer, GlyphMapDemoProjection, GlyphMapDemoProps } from "./types";

const DEFAULT_LAYERS: readonly GlyphMapDemoLayer[] = [{ type: "raster" }];
const DEFAULT_PROJECTION: GlyphMapDemoProjection = { type: "globe", options: { exaggeration: 24 } };
type MapsApi = typeof import("@glyphcss/maps");
// Long enough to watch the surface unwrap; the library default is 600ms.
const MORPH_MS = 1600;

function createProjection(api: MapsApi, projection: GlyphMapDemoProjection) {
  switch (projection.type) {
    case "globe":
      return api.glyphMapGlobe(projection.options);
    case "equirectangular":
      return api.glyphMapEquirectangular(projection.options);
    case "mercator":
      return api.glyphMapMercator(projection.options);
    case "orthographic":
      return api.glyphMapOrthographic(projection.options);
  }
}

export function GlyphMapDemo(props: GlyphMapDemoProps) {
  const host = useRef<HTMLDivElement>(null);
  const [credits, setCredits] = useState<readonly GlyphMapAttribution[]>([]);
  const [status, setStatus] = useState("Loading terrain…");
  const [active, setActive] = useState(0);
  const live = useRef<{ map: GlyphMapHandle; api: MapsApi } | undefined>(undefined);
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
        const projection = props.projections?.[0]?.projection ?? props.projection ?? DEFAULT_PROJECTION;
        map = api.createGlyphMap(host.current, {
          view: {
            center: [0, 20],
            span: 140,
            cols: 100,
            rows: 48,
            ...props.view,
          },
          projection: createProjection(api, projection),
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
        live.current = { map, api };
        setActive(0);
        setCredits(map.getAttributions());
        await map.idle();
        if (!disposed && !missingOsm) setStatus("");
      })
      .catch(() => {
        if (!disposed) setStatus("Map could not be loaded. Try the maps workbench.");
      });
    return () => {
      disposed = true;
      live.current = undefined;
      map?.destroy();
    };
  }, [
    props.projection,
    props.projections,
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
    <figure
      className={`${styles.root}${props.projections ? ` ${styles.compact}` : ""} not-content`}
      aria-label={props.label ?? "Interactive Earth terrain map"}
    >
      {props.projections && (
        <div className={styles.tabs} role="tablist">
          {props.projections.map((tab, index) => (
            <ActionButton
              key={tab.label}
              role="tab"
              aria-selected={index === active}
              className={index === active ? "is-active" : ""}
              onClick={() => {
                if (!live.current || index === active) return;
                setActive(index);
                const { map, api } = live.current;
                void map.setProjection(createProjection(api, tab.projection), { durationMs: MORPH_MS });
                if (tab.span !== undefined) void map.flyTo({ span: tab.span }, { durationMs: MORPH_MS });
              }}
            >
              {tab.label}
            </ActionButton>
          ))}
        </div>
      )}
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

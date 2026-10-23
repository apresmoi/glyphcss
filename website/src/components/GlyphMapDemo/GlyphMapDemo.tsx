import { useEffect, useRef, useState } from "react";
import type { GlyphMapAttribution, GlyphMapHandle } from "@glyphcss/maps";
import { MAP_PALETTES } from "../../features/maps/model/config";
import { createGeoTilesProvider } from "../../features/maps/providers/geoTilesProvider";
import { AttributionCredit } from "../AttributionCredit";
import styles from "./GlyphMapDemo.module.css";

export function GlyphMapDemo() {
  const host = useRef<HTMLDivElement>(null);
  const [credits, setCredits] = useState<readonly GlyphMapAttribution[]>([]);
  const [status, setStatus] = useState("Loading terrain…");
  useEffect(() => {
    let disposed = false;
    let map: GlyphMapHandle | undefined;
    void Promise.all([import("@glyphcss/maps"), createGeoTilesProvider()])
      .then(async ([{ createGlyphMap, glyphMapGlobe, GlyphMapClassifiers }, provider]) => {
        if (disposed || !host.current) return;
        map = createGlyphMap(host.current, {
          view: { center: [0, 20], span: 140, cols: 100, rows: 48 },
          projection: glyphMapGlobe({ exaggeration: 24 }),
          autoSize: true,
          controls: { drag: true, wheel: false },
          layers: [
            {
              type: "raster",
              source: provider,
              classifier: GlyphMapClassifiers.etopo1V1,
              colors: MAP_PALETTES.terrain,
            },
          ],
          scene: { mode: "solid", useColors: true },
        });
        setCredits(map.getAttributions());
        await map.idle();
        if (!disposed) setStatus("");
      })
      .catch(() => {
        if (!disposed) setStatus("Terrain could not be loaded. Try the maps workbench.");
      });
    return () => {
      disposed = true;
      map?.destroy();
    };
  }, []);
  return (
    <figure className={`${styles.root} not-content`} aria-label="Interactive Earth terrain map">
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

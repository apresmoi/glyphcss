import { useEffect, useRef } from "react";
import { mountWorldExample } from "../../features/examples/world/mountWorldExample";
import styles from "./WorldExample.module.css";

export function WorldExample() {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (root.current) return mountWorldExample(root.current);
  }, []);
  return (
    <div ref={root} className={styles.root}>
      <div className="map-shell">
        <header className="map-head">
          <h1>[ ASCII Earth · ETOPO1 ]</h1>
          <p>
            Global terrain + bathymetry baked from NOAA's ETOPO1 1-arc-minute dataset, projected onto a unit sphere with
            30× height exaggeration. Solid-mode glyphcss render, orthographic camera — drag to orbit, scroll to zoom.
          </p>
        </header>
        <div className="map-stage">
          <div className="globe-host" id="globe-host">
            <div className="loading" id="loading">
              Loading topography data…
            </div>
          </div>
        </div>
        <footer className="map-foot">
          <span>Data: NOAA ETOPO1 (Ice surface, 2013)</span>
          <span>Polygons: 16,200</span>
          <span>Renderer: glyphcss solid + dither + backface cull</span>
        </footer>
      </div>
    </div>
  );
}

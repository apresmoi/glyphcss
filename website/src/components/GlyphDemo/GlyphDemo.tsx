import { useEffect, useRef } from "react";
import styles from "./GlyphDemo.module.css";
import { loadRuntime } from "./loadRuntime";
export interface GlyphDemoProps {
  id: string;
  /** Fill an existing positioned frame without the standalone demo border. */
  embedded?: boolean;
  geometry?: "cuboctahedron" | "icosahedron" | "cube";
  /** URL of an OBJ / GLB / glTF / VOX mesh. Takes priority over `geometry`. */
  mesh?: string;
  controls?: string;
  defaults?: string;
  showStats?: boolean;
  /** Hide the code panel beneath the demo (landing hero, gallery). */
  noCode?: boolean;
  /** Hide the lil-gui controls column (landing hero clean view). */
  noControls?: boolean;
  /** Auto-rotate the camera around Y from the moment the demo mounts. */
  autoRotate?: boolean;
  /** Disable pointer/wheel interactivity. Useful for decorative landing demos. */
  interactive?: boolean;
  /** Disable wheel/pinch zoom while keeping drag-to-orbit. */
  noZoom?: boolean;
  /** Runtime downscale while dragging. Set to 1 to keep full detail during drag. */
  interactiveDownscale?: number;
  /**
   * Pre-baked indexed polygon data (URL). Takes priority over `mesh` /
   * `geometry`. Format: `{ vertices: [[x,y,z],...], colors: [hex,...],
   * faces: [{ v: [vertIdx,...], c: colorIdx }, ...] }`.
   */
  polygonsUrl?: string;
  /** Invert drag direction (grab-and-spin convention, good for globes). */
  invertDrag?: boolean;
  /**
   * Orbit-controls turntable pitch clamp in degrees, `[min, max]`, or `null`
   * to remove it (lets the user flip the model past the poles). Default
   * `[-90, 90]` (the library's own default) when omitted.
   */
  pitchRange?: [number, number] | null;
  /**
   * Light the scene with a real-time sun position: subsolar lat/lon at the
   * current UTC. Updates every 30 s. For an Earth globe, this makes the
   * day/night terminator match reality.
   */
  realSunLight?: boolean;
  /**
   * Override the default scene lighting. JSON of
   * `{ direction?: [x,y,z], intensity?: number, ambient?: number }`.
   * Ignored when `realSunLight` is set (the sun drives the direction).
   */
  light?: string;
}

export function GlyphDemo(props: GlyphDemoProps) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let disposed = false;
    let dispose: (() => void) | undefined;
    void loadRuntime().then(({ mountGlyphDemo }) => {
      if (!disposed && ref.current) dispose = mountGlyphDemo(ref.current);
    });
    return () => {
      disposed = true;
      dispose?.();
    };
  }, []);
  const {
    id,
    geometry,
    mesh,
    controls,
    defaults,
    showStats,
    noCode,
    noControls,
    autoRotate,
    interactive,
    noZoom,
    interactiveDownscale,
    polygonsUrl,
    invertDrag,
    pitchRange,
    realSunLight,
    light,
  } = props;
  const pitchRangeAttr = pitchRange === undefined ? undefined : pitchRange === null ? "none" : pitchRange.join(",");

  return (
    <div
      ref={ref}
      className={`glyph-demo ${styles.root}${props.embedded ? ` ${styles.embedded}` : ""}`}
      id={id}
      data-geometry={geometry || "cuboctahedron"}
      data-mesh={mesh || undefined}
      data-polygons-url={polygonsUrl || undefined}
      data-controls={controls}
      data-defaults={defaults}
      data-show-stats={showStats ? "1" : undefined}
      data-no-controls={noControls ? "1" : undefined}
      data-auto-rotate={autoRotate ? "1" : undefined}
      data-interactive={interactive === false ? "0" : undefined}
      data-no-zoom={noZoom ? "1" : undefined}
      data-interactive-downscale={interactiveDownscale !== undefined ? String(interactiveDownscale) : undefined}
      data-invert-drag={invertDrag ? "1" : undefined}
      data-pitch-range={pitchRangeAttr}
      data-real-sun-light={realSunLight ? "1" : undefined}
      data-light={light || undefined}
    >
      <div className="glyph-demo__viewer not-content" data-layout={noControls ? "canvas-only" : "two-col"}>
        <div className="glyph-demo__canvas">
          <div className="glyph-demo__scene-host">
            <div className="glyph-demo__viewport">
              <pre className="glyph-demo__strip"></pre>
            </div>
            <div className="glyph-demo__hit-layer"></div>
            <div className="glyph-demo__stats"></div>
          </div>
          <div className="glyph-demo__loading">Loading…</div>
        </div>
        {!noControls && <div className="glyph-demo__controls"></div>}
      </div>
      {!noCode && (
        <div className="glyph-demo__code not-content">
          <div className="glyph-demo__tabs">
            <button className="glyph-demo__tab active" data-fw="vanilla">
              Vanilla JS
            </button>
            <button className="glyph-demo__tab" data-fw="react">
              React
            </button>
            <button className="glyph-demo__tab" data-fw="vue">
              Vue
            </button>
          </div>
          <pre className="glyph-demo__snippet" data-fw="vanilla">
            <code></code>
          </pre>
          <pre className="glyph-demo__snippet glyph-demo__snippet--hidden" data-fw="react">
            <code></code>
          </pre>
          <pre className="glyph-demo__snippet glyph-demo__snippet--hidden" data-fw="vue">
            <code></code>
          </pre>
        </div>
      )}
    </div>
  );
}

import { useEffect, useRef, useState } from "react";
import type { GlyphEffects } from "@glyphcss/effects";
import { demoSnippets } from "../../services/glyph-scene/demoSnippets";
import { DEFAULT_TUNABLES, type RuntimeEffectConfig, type Tunables } from "../../services/glyph-scene/types";
import { ActionButton } from "../ActionButton";
import { CodePanel } from "../CodePanel";
import { GlyphDemoControls } from "./GlyphDemoControls";
import styles from "./GlyphDemo.module.css";
import { loadRuntime } from "./loadRuntime";
export interface GlyphDemoProps {
  id: string;
  /** Fill an existing positioned frame without standalone demo spacing. */
  embedded?: boolean;
  geometry?: "cuboctahedron" | "icosahedron" | "cube";
  /** URL of an OBJ / GLB / glTF / VOX mesh. Takes priority over `geometry`. */
  mesh?: string;
  controls?: string;
  defaults?: string;
  /** Stock effect mounted by the demo runtime, which owns its clock and disposal. */
  effect?: keyof typeof GlyphEffects;
  effectParams?: RuntimeEffectConfig["params"];
  showStats?: boolean;
  /** Hide the code panel beneath the demo (landing hero, gallery). */
  noCode?: boolean;
  /** Hide the controls column (landing hero clean view). */
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
  const updateTuning = useRef<((partial: Partial<Tunables>) => void) | undefined>(undefined);
  const [ready, setReady] = useState(false);
  // The feature leads; code opens on request beneath it.
  const [codeOpen, setCodeOpen] = useState(false);
  const [tunables, setTunables] = useState<Tunables>(() => {
    let defaults: Partial<Tunables> = {};
    try {
      defaults = JSON.parse(props.defaults || "{}");
    } catch {}
    return { ...DEFAULT_TUNABLES, geometry: props.geometry || "cuboctahedron", ...defaults };
  });
  useEffect(() => {
    let disposed = false;
    let dispose: (() => void) | undefined;
    void Promise.all([loadRuntime(), props.effect ? import("@glyphcss/effects") : undefined]).then(
      ([{ mountGlyphDemo }, effects]) => {
        if (!disposed && ref.current) {
          dispose = mountGlyphDemo(
            ref.current,
            props.noControls && props.noCode
              ? undefined
              : {
                  onReady: (update) => {
                    updateTuning.current = update;
                  },
                  onChange: (next) => {
                    if (disposed) return;
                    setTunables(next);
                    setReady(true);
                  },
                },
          );
          if (props.effect && effects) {
            const demo = ref.current as HTMLDivElement & {
              glyphcssDemo: { configureEffect: (config: RuntimeEffectConfig) => void };
            };
            demo.glyphcssDemo.configureEffect({
              effect: effects.GlyphEffects[props.effect],
              params: props.effectParams ?? {},
              blend: "replace",
              paused: false,
              timeScale: 1,
            });
          }
        }
      },
    );
    return () => {
      disposed = true;
      updateTuning.current = undefined;
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
        {!noControls && (
          <GlyphDemoControls
            id={id}
            source={{ mesh, polygonsUrl }}
            tunables={tunables}
            controls={controls}
            autoRotate={autoRotate}
            ready={ready}
            onChange={(partial) => updateTuning.current?.(partial)}
          />
        )}
      </div>
      {!noCode &&
        (codeOpen ? (
          <CodePanel
            id={`${id}-code`}
            inline
            title="Code"
            className="not-content"
            snippets={demoSnippets(tunables, { mesh, polygonsUrl })}
            formats={[
              { id: "vanilla", label: "JS" },
              { id: "react", label: "React" },
              { id: "vue", label: "Vue" },
            ]}
            defaultFormat="vanilla"
            onClose={() => setCodeOpen(false)}
          />
        ) : (
          <ActionButton aria-controls={`${id}-code`} aria-expanded={false} onClick={() => setCodeOpen(true)}>
            Code
          </ActionButton>
        ))}
    </div>
  );
}

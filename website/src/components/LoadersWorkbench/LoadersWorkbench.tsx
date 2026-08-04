import { useEffect, useRef, useState } from "react";
import {
  createGlyphScene,
  createGlyphOrthographicCamera,
  injectGlyphBaseStyles,
  type GlyphEffectDefinition,
  type GlyphEffectParamSchema,
  type GlyphSceneHandle,
} from "glyphcss";
import { getGlyphEffect } from "@glyphcss/effects";
import { readUrlParam, writeUrlParam } from "../../lib/urlState";
import { DEFAULT_LOADER, findLoader, LOADERS, LOADER_SIZES, type LoaderPreset } from "./loaders";
import { LoaderCodePanel } from "./LoaderCodePanel";
import { generateLoaderSnippets, type LoaderTab } from "./loaderSnippets";
import "../GalleryWorkbench/gallery-workbench.css";
import "./loaders.css";

type Polys = Parameters<GlyphSceneHandle["add"]>[0];

// Every loader is a texture on the same head-on flat quad, so the page compares
// patterns and box shapes rather than geometry.
function flatQuad(size: number, color: string): Polys {
  return [{
    vertices: [[-size, -size, 0], [size, -size, 0], [size, size, 0], [-size, size, 0]],
    uvs: [[0, 0], [1, 0], [1, 1], [0, 1]],
    color,
  }] as unknown as Polys;
}

// One rAF for the whole page. Each tile is tiny, but there are ~30 of them —
// thirty independent loops would each pay their own callback and their own clock
// drift, and a footer mini would visibly run out of phase with the stage tile
// showing the same loader.
type Tick = (t: number) => void;
const ticks = new Set<Tick>();
let clockRaf = 0;
let clockLast = 0;
let clockTime = 0;
function pumpClock(now: number): void {
  clockRaf = requestAnimationFrame(pumpClock);
  const dt = Math.min((now - clockLast) / 1000, 0.1);
  clockLast = now;
  clockTime += dt;
  for (const fn of ticks) fn(clockTime);
}
function registerTick(fn: Tick): () => void {
  if (ticks.size === 0) { clockLast = performance.now(); clockRaf = requestAnimationFrame(pumpClock); }
  ticks.add(fn);
  return () => {
    ticks.delete(fn);
    if (ticks.size === 0) cancelAnimationFrame(clockRaf);
  };
}

/** Zoom the head-on quad so it covers the whole cols×rows grid. Must project
 *  with the MEASURED cell (see SynthWorkbench's `frameObject` for the same
 *  rationale): the default `cellAspect` is ~20% off the real monospace cell, and
 *  a fixed-size scene has no `fitToHost` to correct it. */
function coverGrid(scene: GlyphSceneHandle, camera: ReturnType<typeof createGlyphOrthographicCamera>, polys: Polys): void {
  const o = scene.getOptions();
  const cols = o.cols ?? 80, rows = o.rows ?? 24;
  const pre = scene.host.querySelector("pre.glyph-output") as HTMLElement | null;
  let metrics: { cellWidth: number; cellHeight: number } | undefined;
  let cellAspect = o.cellAspect ?? 2;
  if (pre) {
    const r = pre.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) {
      metrics = { cellWidth: r.width / cols, cellHeight: r.height / rows };
      cellAspect = metrics.cellHeight / metrics.cellWidth;
      scene.setOptions({ cellAspect });
    }
  }
  camera.zoom = 1;
  let minc = Infinity, maxc = -Infinity, minr = Infinity, maxr = -Infinity;
  for (const p of polys as unknown as { vertices: [number, number, number][] }[]) {
    for (const v of p.vertices) {
      const pr = camera.project(v, cols, rows, cellAspect, metrics);
      if (!isFinite(pr[0]!) || !isFinite(pr[1]!)) continue;
      if (pr[0]! < minc) minc = pr[0]!; if (pr[0]! > maxc) maxc = pr[0]!;
      if (pr[1]! < minr) minr = pr[1]!; if (pr[1]! > maxr) maxr = pr[1]!;
    }
  }
  const w = maxc - minc, h = maxr - minr;
  if (w > 0 && h > 0) camera.zoom = Math.max(cols / w, rows / h);
}

/** Mount one live loader at an exact cols×rows. Fixed grid (no `autoSize`) is
 *  the whole point — the box shape is the variable under test. */
function useLoaderScene(host: HTMLElement | null, loader: LoaderPreset, cols: number, rows: number): void {
  useEffect(() => {
    if (!host) return;
    injectGlyphBaseStyles(host.ownerDocument ?? undefined);
    const camera = createGlyphOrthographicCamera({ rotX: 0, rotY: 0, zoom: 20 });
    const scene = createGlyphScene(host, {
      camera, cols, rows, autoSize: false, mode: "solid", useColors: true,
      doubleSided: true, glyphPalette: "default",
      directionalLight: { direction: [0.2, 0.3, 0.93], intensity: 0.85 },
      ambientLight: { intensity: 0.45 },
    });
    const polys = flatQuad(3, "#243244");
    scene.add(polys);
    scene.rerender();
    coverGrid(scene, camera, polys);
    scene.rerender();

    const mounted = loader.layers.map((spec) => {
      const definition = getGlyphEffect(spec.effectId);
      if (!definition) return null;
      const layer = scene.addEffectLayer({
        effect: definition as GlyphEffectDefinition<GlyphEffectParamSchema>,
        params: { ...spec.params },
        blend: spec.blend,
        target: "surfaces",
      });
      return { layer, spec };
    }).filter(Boolean) as { layer: ReturnType<GlyphSceneHandle["addEffectLayer"]>; spec: LoaderPreset["layers"][number] }[];
    scene.rerender();

    const stop = registerTick((t) => {
      for (const { layer, spec } of mounted) {
        const next: Record<string, number> = {};
        if (spec.timeScale) next.time = t * spec.timeScale;
        // A determinate loader's sweep is just another driven param — the page
        // owns the clock, the effect owns the shape. Ramp over the first
        // `1 - hold` of the loop, then rest at 1.0: a bar that snaps straight
        // from full back to empty reads as a glitch, not as completion.
        if (spec.progress) {
          const { param, cycle, hold = 0 } = spec.progress;
          const phase = (t % cycle) / cycle;
          const ramp = 1 - hold;
          next[param] = ramp <= 0 ? 1 : Math.min(1, phase / ramp);
        }
        if (Object.keys(next).length > 0) layer.setParams(next);
      }
    });
    return () => { stop(); for (const { layer } of mounted) layer.dispose(); scene.destroy(); };
  }, [host, cols, rows, loader]);
}

function LoaderTile({ loader, cols, rows, label, lang, onCode }: {
  loader: LoaderPreset;
  cols: number;
  rows: number;
  label: string;
  lang: LoaderTab;
  onCode: () => void;
}) {
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const [copied, setCopied] = useState(false);
  useLoaderScene(host, loader, cols, rows);

  // Each example is its own exportable size, so its snippet states THIS grid.
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(generateLoaderSnippets(loader, cols, rows)[lang]);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* clipboard unavailable — the panel keeps the code selectable */
    }
  };

  return (
    <figure className="ld-size">
      <div className="ld-size__view" ref={setHost} />
      <figcaption className="ld-size__meta">
        <span className="ld-size__label">{label}</span>
        <span className="ld-size__dims">{cols}×{rows}</span>
        <span className="ld-size__tools">
          <button type="button" className="ld-mini" onClick={onCode} title={`Code for ${cols}×${rows}`}>{"</>"}</button>
          <button type="button" className="ld-mini" onClick={copy} title={`Copy ${lang.toUpperCase()} for ${cols}×${rows}`}>
            {copied ? "✓" : "copy"}
          </button>
        </span>
      </figcaption>
    </figure>
  );
}

function LoaderThumb({ loader }: { loader: LoaderPreset }) {
  const [host, setHost] = useState<HTMLSpanElement | null>(null);
  useLoaderScene(host, loader, 16, 6);
  return <span className="ld-tile__thumb"><span className="ld-tile__glyph" ref={setHost} /></span>;
}

export default function LoadersWorkbench() {
  const [loaderId, setLoaderId] = useState<string>(() => readUrlParam("l") ?? DEFAULT_LOADER);
  // Which example's code is open — null = none. Export is per size, so the
  // panel is addressed by the grid it was opened from.
  const [openSize, setOpenSize] = useState<{ cols: number; rows: number } | null>(null);
  // Language choice is shared: pick it once in the panel, every tile's Copy
  // then hands you that language for its own size.
  const [lang, setLang] = useState<LoaderTab>("html");
  const loader = findLoader(loaderId);
  const first = useRef(true);

  useEffect(() => {
    // Keep the default out of the URL so a fresh visit shares a clean link.
    if (first.current) { first.current = false; if (loaderId === DEFAULT_LOADER) return; }
    writeUrlParam("l", loaderId === DEFAULT_LOADER ? null : loaderId);
  }, [loaderId]);

  const spinners = LOADERS.filter((l) => l.kind === "spinner");
  const progress = LOADERS.filter((l) => l.kind === "progress");

  return (
    <div className="ld-page">
      <main className="ld-stage">
        <header className="ld-stage__head">
          <div className="ld-stage__titlerow">
            <h1 className="ld-stage__title">{loader.label}</h1>
            <span className="ld-stage__kind">{loader.kind === "progress" ? "determinate" : "indeterminate"}</span>
          </div>
        </header>

        <div className="ld-sizes">
          {LOADER_SIZES.map((s) => (
            <LoaderTile
              key={`${loader.id}-${s.cols}x${s.rows}`}
              loader={loader}
              cols={s.cols}
              rows={s.rows}
              label={s.label}
              lang={lang}
              onCode={() => setOpenSize((cur) => (cur && cur.cols === s.cols && cur.rows === s.rows ? null : { cols: s.cols, rows: s.rows }))}
            />
          ))}
        </div>

        {openSize && (
          <LoaderCodePanel
            loader={loader}
            cols={openSize.cols}
            rows={openSize.rows}
            lang={lang}
            onLang={setLang}
            onClose={() => setOpenSize(null)}
          />
        )}
      </main>

      <footer className="ld-strip" aria-label="Loader presets">
        {[
          { key: "spinner", label: "Indeterminate", items: spinners },
          { key: "progress", label: "Determinate", items: progress },
        ].map((group) => (
          <section className="ld-group" key={group.key}>
            <h2 className="ld-group__label">{group.label}</h2>
            <div className="ld-group__items">
              {group.items.map((l) => (
                <div key={l.id} className={`ld-tile${l.id === loader.id ? " is-active" : ""}`}>
                  <button
                    type="button"
                    className="ld-tile__pick"
                    aria-pressed={l.id === loader.id}
                    onClick={() => { setLoaderId(l.id); setOpenSize(null); }}
                  >
                    <LoaderThumb loader={l} />
                    <span className="ld-tile__label">{l.label}</span>
                  </button>
                </div>
              ))}
            </div>
          </section>
        ))}
      </footer>
    </div>
  );
}

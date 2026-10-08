import { createGlyphOrthographicCamera, createGlyphScene, loadMesh, resolveGeometry } from "glyphcss";
import { createMountScope } from "../../services/lifecycle/mountScope";

import type { GlyphGeometryName, Polygon, Vec3 } from "glyphcss";

import { defaultGlyphColorEncoding } from "../../services/rendering/glyphColorEncodingDefault";
export function mountBench(root: HTMLElement) {
  const scope = createMountScope();
  let mountedTimer0: ReturnType<typeof setTimeout> | undefined;
  scope.onDispose(() => {
    if (mountedTimer0 !== undefined) clearTimeout(mountedTimer0);
  });
  let mountedTimer1: ReturnType<typeof requestAnimationFrame> | undefined;
  scope.onDispose(() => {
    if (mountedTimer1 !== undefined) cancelAnimationFrame(mountedTimer1);
  });
  let mountedTimer2: ReturnType<typeof requestAnimationFrame> | undefined;
  scope.onDispose(() => {
    if (mountedTimer2 !== undefined) cancelAnimationFrame(mountedTimer2);
  });

  const $ = (id: string) => root.querySelector(`#${id}`) as HTMLInputElement;

  const host = root.querySelector(`#${"host"}`) as HTMLElement;

  const hud = root.querySelector(`#${"hud"}`) as HTMLElement;

  const loadingEl = root.querySelector(`#${"loading"}`) as HTMLElement;

  const camera = createGlyphOrthographicCamera({ rotX: 65, rotY: 45, zoom: 1 });

  const scene = scope.own(
    createGlyphScene(host, {
      camera,
      autoSize: true,
      mode: "solid",
      useColors: true,
      glyphPalette: "default",
      // Feature-detected site default; no UI control on this bench page, so
      // this is the only place it's decided. Degrades to spans on its own
      // (colour/palette budget, unsupported engine) via isGlyphAtlasEncodable.
      colorEncoding: defaultGlyphColorEncoding(),
      directionalLight: { direction: [0.5, 0.7, 0.5], intensity: 1.1 },
      ambientLight: { intensity: 0.45 },
    }),
    (resource) => resource.destroy(),
  );

  // Center + scale to a unit, origin-centered bbox so the fit math is stable
  // regardless of the model's authored units.
  function normalizeUnit(polys: Polygon[]): Polygon[] {
    let mn: Vec3 = [Infinity, Infinity, Infinity],
      mx: Vec3 = [-Infinity, -Infinity, -Infinity];
    for (const p of polys)
      for (const v of p.vertices)
        for (let i = 0; i < 3; i++) {
          if (v[i] < mn[i]) mn[i] = v[i];
          if (v[i] > mx[i]) mx[i] = v[i];
        }
    const cx = (mn[0] + mx[0]) / 2,
      cy = (mn[1] + mx[1]) / 2,
      cz = (mn[2] + mx[2]) / 2;
    const span = Math.max(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]) || 1;
    const s = 2 / span;
    return polys.map((p) => ({
      ...p,
      vertices: p.vertices.map(([x, y, z]) => [(x - cx) * s, (y - cy) * s, (z - cz) * s] as Vec3),
    }));
  }

  function buildPrimitive(name: string): Polygon[] {
    return resolveGeometry(name as GlyphGeometryName, { size: 1 });
  }

  let polygons: Polygon[] = [];

  let meshHandle: { dispose(): void } | null = null;

  // Auto-fit: project the actual vertices, measure the col/row silhouette, and
  // scale zoom so it spans `fill` of the grid. Mirrors the gallery's fit.
  function fitZoom(fill: number): void {
    const o = scene.getOptions();
    const cols = o.cols ?? 80,
      rows = o.rows ?? 24,
      ca = o.cellAspect ?? 2;
    let minc = Infinity,
      maxc = -Infinity,
      minr = Infinity,
      maxr = -Infinity;
    for (const p of polygons)
      for (const v of p.vertices) {
        const pr = camera.project(v, cols, rows, ca);
        if (!isFinite(pr[0]) || !isFinite(pr[1])) continue;
        if (pr[0] < minc) minc = pr[0];
        if (pr[0] > maxc) maxc = pr[0];
        if (pr[1] < minr) minr = pr[1];
        if (pr[1] > maxr) maxr = pr[1];
      }
    const w = maxc - minc,
      h = maxr - minr;
    if (!(w > 0) || !(h > 0)) return;
    const factor = Math.min((fill * cols) / w, (fill * rows) / h);
    if (isFinite(factor) && factor > 0) camera.zoom = (camera.zoom || 1) * factor;
  }

  // Measure how many cells the object actually spans — the real "definition".
  function measureCoverage(): { objCols: number; objRows: number; cols: number; rows: number } {
    const pre = host.querySelector("pre.glyph-output");
    const lines = (pre?.textContent ?? "").split("\n");
    const rows = lines.length,
      cols = lines.reduce((m, l) => Math.max(m, l.length), 0);
    let minC = Infinity,
      maxC = -1,
      minR = Infinity,
      maxR = -1;
    lines.forEach((l, r) => {
      for (let c = 0; c < l.length; c++)
        if (l[c] !== " ") {
          if (c < minC) minC = c;
          if (c > maxC) maxC = c;
          if (r < minR) minR = r;
          if (r > maxR) maxR = r;
        }
    });
    return { objCols: maxC - minC + 1, objRows: maxR - minR + 1, cols, rows };
  }

  function refresh(refit = true): void {
    host.style.fontSize = `${$("cell").value}px`;
    host.style.lineHeight = $("lh").value;
    camera.rotX = parseFloat($("rotx").value);
    camera.rotY = parseFloat($("roty").value);
    scene.setOptions({ useColors: $("colors").checked });
    scene.fit(); // re-measure cols/rows/cellAspect for the cell size
    if (refit) fitZoom(parseFloat($("fill").value));
    scene.rerender();
    updateHud();
    updateCode();
  }

  let lastRaster = 0;

  // The rasterizer pushes per-render ms into these arrays when present.
  (globalThis as Record<string, unknown>).__glyphPerf = { raster: [] as number[], dom: [] as number[] };

  function updateHud(): void {
    const o = scene.getOptions();
    const cov = measureCoverage();
    const tris = polygons.reduce((n, p) => n + Math.max(0, p.vertices.length - 2), 0);
    const perf = (globalThis as Record<string, { raster?: number[] }>).__glyphPerf;
    const arr = perf?.raster;
    if (Array.isArray(arr) && arr.length) {
      lastRaster = arr[arr.length - 1];
      if (arr.length > 120) arr.splice(0, arr.length - 30); // keep it bounded
    }
    const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);
    hud.innerHTML =
      `<b>mesh</b>      ${$("mesh").selectedOptions[0].text}\n` +
      `polygons   ${polygons.length}   tris ${tris}\n` +
      `<b>grid</b>      ${o.cols} × ${o.rows} cells\n` +
      `cellAspect ${(o.cellAspect ?? 0).toFixed(2)}   cell ${$("cell").value}px\n` +
      `line-h     ${(+$("lh").value).toFixed(2)}\n` +
      `<b>zoom</b>      ${camera.zoom.toFixed(2)} px/unit  (fill ${(+$("fill").value).toFixed(2)})\n` +
      `<b class="hl">object</b>    ${cov.objCols} × ${cov.objRows} cells\n` +
      `coverage   ${pct(cov.objCols, cov.cols)}% × ${pct(cov.objRows, cov.rows)}%\n` +
      `raster     ${lastRaster.toFixed(2)} ms`;
  }

  // Vanilla glyphcss code to reproduce the current render (mirrors the gallery).
  function generateCode(): string {
    const sel = $("mesh").value;
    const isPrim = sel.startsWith("geom:");
    const geom = isPrim ? sel.slice(5) : "";
    const rotX = Math.round(+$("rotx").value);
    const rotY = Math.round(+$("roty").value);
    const zoom = Number(camera.zoom.toFixed(2));
    const lh = (+$("lh").value).toFixed(2);
    const cell = $("cell").value;
    const colors = $("colors").checked;
    const meshImport = isPrim ? "\n  resolveGeometry," : "\n  loadMesh,";
    const meshLine = isPrim
      ? `const polygons = resolveGeometry("${geom}", { size: 1 });`
      : `const { polygons } = await loadMesh("${sel}");`;
    return `import {
  createGlyphScene,
  createGlyphOrthographicCamera,
  createGlyphOrbitControls,${meshImport}
} from "glyphcss";

const host = root.querySelector("#scene");
host.style.fontSize = "${cell}px";   // cell size -> render resolution
host.style.lineHeight = "${lh}";

const camera = createGlyphOrthographicCamera({ rotX: ${rotX}, rotY: ${rotY}, zoom: ${zoom} });

const scene = createGlyphScene(host, {
  camera,
  autoSize: true,
  mode: "solid",
  useColors: ${colors},
  glyphPalette: "default",
  autoCenter: true,
  directionalLight: { direction: [0.5, 0.7, 0.5], intensity: 1.1 },
  ambientLight: { intensity: 0.45 },
});

${meshLine}
scene.add(polygons);

createGlyphOrbitControls(scene, { drag: true, wheel: true });`;
  }

  function updateCode(): void {
    const el = root.querySelector(`#${"code-body"}`);
    if (el) el.textContent = generateCode();
  }

  async function load(value: string): Promise<void> {
    loadingEl.style.display = "grid";
    try {
      if (value.startsWith("geom:")) {
        polygons = normalizeUnit(buildPrimitive(value.slice(5)));
      } else {
        const res = await loadMesh(value);
        polygons = normalizeUnit(res.polygons);
      }
      if (meshHandle) {
        meshHandle.dispose();
        meshHandle = null;
      }
      meshHandle = scene.add(polygons);
      loadingEl.style.display = "none";
      refresh(true);
    } catch (err) {
      loadingEl.textContent = `Failed: ${(err as Error).message}`;
    }
  }

  const syncRangeFill = (input: HTMLInputElement) => {
    const percent = ((Number(input.value) - Number(input.min)) / (Number(input.max) - Number(input.min))) * 100;
    input.style.setProperty("--fill", `${percent}%`);
  };
  // Live controls
  for (const id of ["cell", "lh", "fill", "rotx", "roty"]) {
    syncRangeFill($(id));
    $(id).addEventListener(
      "input",
      () => {
        const v = $(id).value;
        syncRangeFill($(id));
        const out = root.querySelector(`#${`${id}-v`}`);
        if (out) out.textContent = id === "lh" || id === "fill" ? (+v).toFixed(2) : v;
        // rot tweaks shouldn't refit (so you can inspect framing); size/fill do.
        refresh(id !== "rotx" && id !== "roty");
      },
      { signal: scope.signal },
    );
  }

  $("colors").addEventListener("change", () => refresh(false), { signal: scope.signal });

  $("mesh").addEventListener("change", () => load($("mesh").value), { signal: scope.signal });

  // Code panel: copy + collapse.
  root.querySelector(`#${"code-copy"}`)?.addEventListener(
    "click",
    async () => {
      const btn = root.querySelector(`#${"code-copy"}`) as HTMLButtonElement;
      try {
        await navigator.clipboard.writeText(generateCode());
        btn.textContent = "copied";
        mountedTimer0 = setTimeout(() => {
          btn.textContent = "copy";
        }, 1200);
      } catch {
        btn.textContent = "err";
      }
    },
    { signal: scope.signal },
  );

  root.querySelector(`#${"code-toggle"}`)?.addEventListener(
    "click",
    () => {
      const panel = root.querySelector(`#${"code"}`);
      const collapsed = panel?.classList.toggle("is-collapsed") ?? false;
      const t = root.querySelector(`#${"code-toggle"}`);
      if (t) t.textContent = collapsed ? "▸" : "▾";
    },
    { signal: scope.signal },
  );

  // Optional auto-spin
  let spinning = false;

  $("spin").addEventListener(
    "change",
    () => {
      spinning = $("spin").checked;
      if (spinning) tick();
    },
    { signal: scope.signal },
  );

  function tick(): void {
    if (!spinning) return;
    camera.rotY = (camera.rotY + 0.6) % 360;
    $("roty").value = String(Math.round(camera.rotY));
    scene.rerender();
    updateHud();
    mountedTimer1 = requestAnimationFrame(tick);
  }

  // Refit on resize (the grid changes with the viewport).
  if (typeof ResizeObserver !== "undefined") {
    let raf = 0;
    scope
      .own(
        new ResizeObserver(() => {
          cancelAnimationFrame(raf);
          raf = mountedTimer2 = requestAnimationFrame(() => refresh(true));
        }),
        (resource) => resource.disconnect(),
      )
      .observe(host);
  }

  void load($("mesh").value);

  return scope.dispose;
}

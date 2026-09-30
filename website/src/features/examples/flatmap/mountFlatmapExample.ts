import { createGlyphOrthographicCamera, createGlyphScene } from "glyphcss";
import { createMountScope } from "../../../services/lifecycle/mountScope";

import { readQueryEnum, readQueryNumber } from "../model/queryValues";
import { createExampleQuerySync } from "../services/querySync";

import { computeGlyphAtlasAvailability } from "../../../services/rendering/glyphAtlasAvailability";

import { defaultGlyphColorEncoding } from "../../../services/rendering/glyphColorEncodingDefault";

export function mountFlatmapExample(root: HTMLElement) {
  const scope = createMountScope();
  let mountedTimer0: ReturnType<typeof requestAnimationFrame> | undefined;
  scope.onDispose(() => {
    if (mountedTimer0 !== undefined) cancelAnimationFrame(mountedTimer0);
  });
  let mountedTimer1: ReturnType<typeof requestAnimationFrame> | undefined;
  scope.onDispose(() => {
    if (mountedTimer1 !== undefined) cancelAnimationFrame(mountedTimer1);
  });
  let mountedTimer2: ReturnType<typeof requestAnimationFrame> | undefined;
  scope.onDispose(() => {
    if (mountedTimer2 !== undefined) cancelAnimationFrame(mountedTimer2);
  });
  let mountedTimer3: ReturnType<typeof setTimeout> | undefined;
  scope.onDispose(() => {
    if (mountedTimer3 !== undefined) clearTimeout(mountedTimer3);
  });

  type Polygon = { vertices: [number, number, number][]; color?: string };

  type MeshHandle = { dispose(): void; setTransform(t: unknown): void };

  type Box = { x0: number; x1: number; y0: number; y1: number };

  type Manifest = {
    region: { lonC: number; latC: number; halfDeg: number };
    plane: { halfX: number; halfY: number };
    exagg: number;
    zooms: Array<{ z: number; cols: number; rows: number }>;
    tileBoxes: Record<string, Box>;
  };

  const INITIAL_ZOOM = 550;

  const BASE_FONT_SIZE = 13;

  const RENDER_MODES = ["solid", "coast", "wire"] as const;

  const PALETTE_NAMES = ["terrain", "viridis", "heat", "ocean", "grayscale", "mono"] as const;

  const COLOR_ENCODING_VALUES = ["spans", "atlas"] as const;

  type RenderMode = (typeof RENDER_MODES)[number];

  type PaletteName = (typeof PALETTE_NAMES)[number];

  function sunDirection(azimuth: number, elevation: number): [number, number, number] {
    const ar = (azimuth * Math.PI) / 180;
    const er = (elevation * Math.PI) / 180;
    return [Math.cos(er) * Math.cos(ar), Math.cos(er) * Math.sin(ar), Math.sin(er)];
  }

  // camera.zoom thresholds → LOD. zoom is absolute CSS px per world unit.
  // z0 = whole world, each higher level quarters tile coverage / doubles
  // definition. Only z0–z3 tiles ship, so the LOD is capped at 3.
  function targetLOD(zoom: number): number {
    // The default zoom shows the WHOLE world filling the viewport. At
    // that view a ~150-col grid can't resolve LOD-2 detail, so LOD 1 (4
    // tiles) looks identical to LOD 2 (16 tiles) while rasterising ~4× less
    // terrain geometry every drag frame. LOD only escalates once you zoom IN
    // past the whole-world view (where finer tiles actually become visible).
    if (zoom < 140) return 0;
    if (zoom < 800) return 1;
    if (zoom < 1600) return 2;
    return 3;
  }

  async function mount() {
    const $ = (id: string) => root.querySelector(`#${id}`);
    const host = root.querySelector(`#${"iso-host"}`) as HTMLDivElement;
    const loading = root.querySelector(`#${"loading"}`);
    const tileCountEl = root.querySelector(`#${"tile-count"}`);
    const zoomLevelEl = root.querySelector(`#${"zoom-level"}`);
    const zoomMagEl = root.querySelector(`#${"zoom-mag"}`);
    const updateZoomReadout = () => {
      if (zoomMagEl) zoomMagEl.textContent = `zoom: ${camera.zoom.toFixed(2)}×`;
    };
    if (!host) return;

    const manifestRes = await fetch("/data/flatmap/manifest.json", { signal: scope.signal });
    const manifest = (await manifestRes.json()) as Manifest;
    const params = new URLSearchParams(window.location.search);
    let heightScale = readQueryNumber(params, "relief", 0.2, { min: 0.1, max: 5, step: 0.1 });
    let density = readQueryNumber(params, "density", 2, { min: 0.75, max: 4, step: 0.05 });
    let renderMode = readQueryEnum(params, "mode", "solid", RENDER_MODES);
    let palette = readQueryEnum(params, "palette", "terrain", PALETTE_NAMES);
    // Feature-detected site default; an explicit `?colorEncoding=` always
    // wins, since `readQueryEnum` only reaches its fallback when the param
    // is absent or not one of the listed values.
    let colorEncoding = readQueryEnum(params, "colorEncoding", defaultGlyphColorEncoding(), COLOR_ENCODING_VALUES);
    let sunAz = readQueryNumber(params, "lightAz", 50, { min: 0, max: 360, step: 1 });
    let sunEl = readQueryNumber(params, "lightEl", 50, { min: 5, max: 90, step: 1 });
    let keyI = readQueryNumber(params, "lightI", 1.15, { min: 0, max: 2, step: 0.05 });
    let ambI = readQueryNumber(params, "ambI", 0.4, { min: 0, max: 1.5, step: 0.05 });
    const initialRotX = readQueryNumber(params, "rotX", 40, { min: 20, max: 89, step: 1 });
    const initialRotY = readQueryNumber(params, "rotY", 0, { min: -180, max: 180, step: 1 });
    const initialZoom = readQueryNumber(params, "zoom", INITIAL_ZOOM, { min: 360, max: 2000 });
    const initialTargetX = readQueryNumber(params, "targetX", 0, {
      min: -manifest.plane.halfX,
      max: manifest.plane.halfX,
    });
    const initialTargetY = readQueryNumber(params, "targetY", 0, {
      min: -manifest.plane.halfY,
      max: manifest.plane.halfY,
    });

    // Iso camera: tilt 40° from horizontal so we look mostly from above
    // while terrain relief still reads as vertical bumps.
    // rotY=0 keeps north up (worldX=lat axis → screen vertical, worldY=lon
    // axis → screen horizontal). No rotation interaction — pan/zoom only.
    // INITIAL_ZOOM shows the default LOD-1 region filling the viewport.
    const camera = createGlyphOrthographicCamera({ rotX: initialRotX, rotY: initialRotY, zoom: initialZoom });
    camera.target = [initialTargetX, initialTargetY, 0];

    const scene = scope.own(
      createGlyphScene(host, {
        camera,
        autoSize: true,
        mode: renderMode === "solid" ? "solid" : "wireframe",
        useColors: true,
        glyphPalette: "default",
        colorEncoding,
        directionalLight: { direction: sunDirection(sunAz, sunEl), intensity: keyI },
        ambientLight: { intensity: ambI },
      }),
      (resource) => resource.destroy(),
    );

    // Keeps the "color encoding" select's disabled state current by watching
    // the stage `<pre>` directly (a `MutationObserver`, not a dependency
    // list) — same pattern /synth, /wordart, and the gallery use.
    const colorEncodingSelect = $("colorEncoding") as HTMLSelectElement | null;
    if (colorEncodingSelect) colorEncodingSelect.value = colorEncoding;
    function recomputeAtlasAvailability(): void {
      const result = computeGlyphAtlasAvailability(scene.output, { useColors: true, charMode: "ascii" });
      if (colorEncodingSelect) {
        colorEncodingSelect.disabled = result.reason !== null;
        colorEncodingSelect.title =
          result.reason === null
            ? "Atlas color encoding — a single colour-font PUA text node (zero <span>s) instead of HTML spans, when the current render fits the atlas's palette/glyph budget."
            : `Atlas color encoding isn't available right now: ${result.reason}`;
      }
    }
    recomputeAtlasAvailability();
    new MutationObserver(recomputeAtlasAvailability).observe(scene.output, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    colorEncodingSelect?.addEventListener(
      "change",
      () => {
        colorEncoding = colorEncodingSelect.value as typeof colorEncoding;
        scene.setOptions({ colorEncoding });
        querySync.schedule();
      },
      { signal: scope.signal },
    );

    function setDensity(density: number): void {
      const next = Math.max(0.1, density);
      scene.output.style.fontSize = `${BASE_FONT_SIZE / next}px`;
      scene.fit();
    }
    setDensity(density);

    // Palettes: band 0 (water) … band 8 (summit). Swappable live.
    const PALETTES: Record<PaletteName, string[]> = {
      terrain: ["#2a55a8", "#2f5a36", "#3f6b32", "#5f7536", "#86713f", "#9c7b50", "#b09471", "#cdb49a", "#f0f0f0"],
      viridis: ["#21295c", "#443983", "#31688e", "#21918c", "#35b779", "#90d743", "#cae11f", "#e8e419", "#fde725"],
      heat: ["#0a1430", "#3b0f2e", "#6b1f2e", "#9c3a1f", "#c8651a", "#e89a1c", "#f4c83a", "#f8e98a", "#ffffff"],
      ocean: ["#041f3f", "#0b3a6b", "#1e5aa8", "#3a86c8", "#69aede", "#9fcdef", "#c8e4f7", "#e8f4ff", "#ffffff"],
      grayscale: ["#10243a", "#3a3a3a", "#4d4d4d", "#616161", "#767676", "#8c8c8c", "#a3a3a3", "#cccccc", "#ffffff"],
      mono: Array(9).fill("#ffe8b8"),
    };
    type TileRaw = {
      vertices: [number, number, number][];
      faces: { v: number[]; b: number }[];
      coast: number[]; // flat x0,y0,x1,y1,... (z=0)
      wire: { b: number; segs: number[] }[]; // contour groups by elevation band
    };
    type TileData = { raw: TileRaw; coast: Polygon[]; solidCache?: { palette: string; polys: Polygon[] } };
    const tileCache = new Map<string, TileData>();
    const activeHandles = new Map<string, MeshHandle>();
    let currentLOD: number | null = null;
    let updateInFlight = false;
    // "solid" → colored relief; "coast" → sea-level outline; "wire" →
    // decimated heightmap surface lattice.
    const tileTransform = () => ({ scale: [1, 1, heightScale] as [number, number, number] });
    const querySync = createExampleQuerySync(() => ({
      relief: heightScale,
      density,
      rotX: camera.rotX,
      rotY: camera.rotY,
      mode: renderMode,
      palette,
      colorEncoding,
      lightAz: sunAz,
      lightEl: sunEl,
      lightI: keyI,
      ambI,
      zoom: camera.zoom,
      targetX: camera.target[0],
      targetY: camera.target[1],
    }));
    const compactNumber = (value: number) => value.toFixed(2).replace(/\.?0+$/, "");
    const hydrateRange = (id: string, valueId: string, value: number, format = compactNumber) => {
      const input = $(id) as HTMLInputElement | null;
      const valueEl = $(valueId);
      if (input) input.value = String(value);
      if (valueEl) valueEl.textContent = format(value);
    };
    hydrateRange("exagg", "exagg-val", heightScale, (value) => value.toFixed(1));
    hydrateRange("density", "density-val", density);
    hydrateRange("tilt", "tilt-val", camera.rotX, String);
    hydrateRange("rot", "rot-val", camera.rotY, String);
    hydrateRange("az", "az-val", sunAz, (value) => String(Math.round(value)));
    hydrateRange("el", "el-val", sunEl, (value) => String(Math.round(value)));
    hydrateRange("key", "key-val", keyI, (value) => value.toFixed(2));
    hydrateRange("amb", "amb-val", ambI, (value) => value.toFixed(2));
    const initialPaletteSelect = $("palette") as HTMLSelectElement | null;
    if (initialPaletteSelect) initialPaletteSelect.value = palette;
    $("mode-seg")
      ?.querySelectorAll("button")
      .forEach((button) => {
        button.classList.toggle("active", (button as HTMLElement).dataset.mode === renderMode);
      });
    querySync.write();

    async function loadTile(z: number, x: number, y: number): Promise<TileData> {
      const key = `${z}/${x}_${y}`;
      const cached = tileCache.get(key);
      if (cached) return cached;
      const res = await fetch(`/data/flatmap/${key}.json`, { signal: scope.signal });
      const raw = (await res.json()) as TileRaw;
      // Coast: flat z=0 segments → degenerate-tri edges.
      const coast: Polygon[] = [];
      const cc = raw.coast ?? [];
      for (let i = 0; i + 3 < cc.length; i += 4) {
        coast.push({
          vertices: [
            [cc[i], cc[i + 1], 0],
            [cc[i + 2], cc[i + 3], 0],
            [cc[i], cc[i + 1], 0],
          ],
          color: "#7dd3fc",
        });
      }
      const td = { raw, coast };
      tileCache.set(key, td);
      return td;
    }

    // Build the terrain solid polys for a tile with the current palette.
    // Cached per-tile keyed by palette so re-mounting (LOD swaps, goto
    // arrival) reuses the array instead of rebuilding 4096 poly objects.
    function solidPolys(td: TileData): Polygon[] {
      if (td.solidCache && td.solidCache.palette === palette) return td.solidCache.polys;
      const pal = PALETTES[palette] ?? PALETTES.terrain;
      const polys = td.raw.faces.map((f) => ({
        vertices: f.v.map((i) => td.raw.vertices[i]) as Polygon["vertices"],
        color: pal[f.b] ?? pal[pal.length - 1],
      }));
      td.solidCache = { palette, polys };
      return polys;
    }

    // Build the contour-wireframe polys, colored per-level by the palette.
    function wirePolys(td: TileData): Polygon[] {
      const pal = PALETTES[palette] ?? PALETTES.terrain;
      const out: Polygon[] = [];
      for (const grp of td.raw.wire ?? []) {
        const color = pal[grp.b] ?? pal[pal.length - 1];
        const s = grp.segs;
        for (let i = 0; i + 5 < s.length; i += 6) {
          out.push({
            vertices: [
              [s[i], s[i + 1], s[i + 2]],
              [s[i + 3], s[i + 4], s[i + 5]],
              [s[i], s[i + 1], s[i + 2]],
            ],
            color,
          });
        }
      }
      return out;
    }

    const tilePolys = (td: TileData): Polygon[] =>
      renderMode === "coast" ? td.coast : renderMode === "wire" ? wirePolys(td) : solidPolys(td);

    const sceneModeFor = () => (renderMode === "solid" ? "solid" : "wireframe");

    // Live render grid. autoSize fits cols/rows to the host's box, so we
    // MUST project with the real cols/rows/cellAspect — projecting against a
    // hardcoded square grid mis-places everything (wrongly-culled edge tiles
    // → black wedges; mis-scaled pan).
    type ProjectionGrid = {
      cols: number;
      rows: number;
      cellAspect: number;
      cellWidth: number;
      cellHeight: number;
      centerCol: number;
      centerRow: number;
    };
    function grid(): { cols: number; rows: number; cellAspect: number } {
      const o = scene.getOptions();
      return { cols: o.cols ?? 80, rows: o.rows ?? 24, cellAspect: o.cellAspect ?? 2 };
    }
    function projectionGrid(): ProjectionGrid {
      const g = grid();
      const hostRect = host.getBoundingClientRect();
      const preRect = scene.output.getBoundingClientRect();
      const cellWidth =
        preRect.width > 0 ? preRect.width / g.cols : hostRect.width > 0 ? hostRect.width / g.cols : 50 / g.cellAspect;
      const cellHeight =
        preRect.height > 0 ? preRect.height / g.rows : hostRect.height > 0 ? hostRect.height / g.rows : 50;
      return {
        ...g,
        cellWidth,
        cellHeight,
        centerCol:
          g.cols * camera.center[0] +
          (hostRect.width > 0 ? (hostRect.width - g.cols * cellWidth) / (2 * cellWidth) : 0),
        centerRow:
          g.rows * camera.center[1] +
          (hostRect.height > 0 ? (hostRect.height - g.rows * cellHeight) / (2 * cellHeight) : 0),
      };
    }

    // The plane-space AABB currently visible on screen: unproject the four
    // screen corners (z=0) to world plane coords and bound them. Robust to
    // tilt, rotation, and zoom — and to tiles larger than the viewport
    // (which corner-sampling would wrongly cull, leaving black gaps).
    function visiblePlaneAABB(): Box {
      const pg = projectionGrid();
      const o = camera.project([0, 0, 0], pg.cols, pg.rows, pg.cellAspect, pg);
      const ux = camera.project([1, 0, 0], pg.cols, pg.rows, pg.cellAspect, pg);
      const uy = camera.project([0, 1, 0], pg.cols, pg.rows, pg.cellAspect, pg);
      // Jacobian plane→grid: [ax bx; ay by].
      const ax = ux[0] - o[0],
        ay = ux[1] - o[1];
      const bx = uy[0] - o[0],
        by = uy[1] - o[1];
      const det = ax * by - ay * bx || 1e-9;
      // Unproject a grid (col,row) back to world plane (u,v).
      const unproj = (col: number, row: number): [number, number] => {
        const dc = col - o[0],
          dr = row - o[1];
        return [(by * dc - bx * dr) / det, (-ay * dc + ax * dr) / det];
      };
      const cs = [unproj(0, 0), unproj(pg.cols, 0), unproj(0, pg.rows), unproj(pg.cols, pg.rows)];
      const xs = cs.map((c) => c[0]),
        ys = cs.map((c) => c[1]);
      // Pad by 8% of span so tiles straddling the edge load before they pop in.
      const padX = (Math.max(...xs) - Math.min(...xs)) * 0.08;
      const padY = (Math.max(...ys) - Math.min(...ys)) * 0.08;
      return {
        x0: Math.min(...xs) - padX,
        x1: Math.max(...xs) + padX,
        y0: Math.min(...ys) - padY,
        y1: Math.max(...ys) + padY,
      };
    }

    // Tile visible ⇔ its plane AABB overlaps the visible-region AABB.
    function tileVisible(z: number, tx: number, ty: number, vis: Box): boolean {
      const r = manifest.tileBoxes[`${z}/${tx}_${ty}`];
      if (!r) return false;
      return r.x0 <= vis.x1 && r.x1 >= vis.x0 && r.y0 <= vis.y1 && r.y1 >= vis.y0;
    }

    async function updateActiveSet() {
      if (updateInFlight) return;
      updateInFlight = true;
      try {
        const lod = targetLOD(camera.zoom);
        const def = manifest.zooms.find((zz) => zz.z === lod);
        if (!def) return;

        const vis = visiblePlaneAABB();
        const desired = new Set<string>();
        for (let ty = 0; ty < def.rows; ty++) {
          for (let tx = 0; tx < def.cols; tx++) {
            if (tileVisible(lod, tx, ty, vis)) desired.add(`${lod}/${tx}_${ty}`);
          }
        }
        // Failsafe: never blank the scene.
        if (desired.size === 0) desired.add(`${lod}/0_0`);

        const missing = [...desired].filter((k) => !tileCache.has(k));
        if (missing.length > 0) {
          await Promise.all(
            missing.map((k) => {
              const [z, xy] = k.split("/");
              const [x, y] = xy.split("_").map(Number);
              return loadTile(Number(z), x, y);
            }),
          );
        }

        for (const [key, handle] of activeHandles) {
          if (!desired.has(key)) {
            handle.dispose();
            activeHandles.delete(key);
          }
        }
        for (const key of desired) {
          if (!activeHandles.has(key)) {
            const td = tileCache.get(key);
            if (td) activeHandles.set(key, scene.add(tilePolys(td), tileTransform()) as unknown as MeshHandle);
          }
        }

        currentLOD = lod;
        scene.rerender();
        if (tileCountEl) tileCountEl.textContent = `tiles: ${activeHandles.size}`;
        if (zoomLevelEl) zoomLevelEl.textContent = `LOD: ${lod}`;
        updateZoomReadout();
      } finally {
        updateInFlight = false;
      }
    }

    await updateActiveSet();
    loading?.remove();

    // ── Pan + zoom (no rotation) ──────────────────────────────────────
    // Drag moves the camera target across the plane. Screen→plane mapping
    // depends on the iso tilt; we derive it empirically by projecting two
    // unit plane axes and inverting the 2×2 screen jacobian so a pixel drag
    // translates to the right plane delta regardless of camera angle/zoom.
    function screenToPlaneDelta(dxPx: number, dyPx: number): [number, number] {
      // Project plane origin + unit X + unit Y through the camera at the
      // REAL grid dims/aspect, then convert grid units → pixels. Using the
      // live grid is what makes the pan distance track the cursor exactly
      // at any zoom (a hardcoded grid mis-scales it).
      const pg = projectionGrid();
      const o = camera.project([0, 0, 0], pg.cols, pg.rows, pg.cellAspect, pg);
      const px = camera.project([1, 0, 0], pg.cols, pg.rows, pg.cellAspect, pg);
      const py = camera.project([0, 1, 0], pg.cols, pg.rows, pg.cellAspect, pg);
      // Jacobian columns: how 1 plane-unit moves in pixels.
      const ax = (px[0] - o[0]) * pg.cellWidth,
        ay = (px[1] - o[1]) * pg.cellHeight;
      const bx = (py[0] - o[0]) * pg.cellWidth,
        by = (py[1] - o[1]) * pg.cellHeight;
      const det = ax * by - ay * bx;
      if (Math.abs(det) < 1e-6) return [0, 0];
      // Solve [ax bx; ay by] · [du dv] = [dxPx dyPx].
      const du = (dxPx * by - dyPx * bx) / det;
      const dv = (-dxPx * ay + dyPx * ax) / det;
      return [du, dv];
    }

    // Coalesce renders to at most one per animation frame. Pointermove and
    // wheel fire faster than the display refresh (high-Hz mice, coalesced
    // moves), and scene.rerender() is a synchronous full rasterize — calling
    // it per event wastes whole frames of work. requestRender batches them.
    let renderQueued = false;
    function requestRender(): void {
      if (renderQueued) return;
      renderQueued = true;
      mountedTimer0 = requestAnimationFrame(() => {
        renderQueued = false;
        scene.rerender();
      });
    }

    // Eased fly-to: pan the target linearly and the zoom in log space (so the
    // zoom feels constant-rate), updating the visible tile set as LOD crosses.
    // updateActiveSet is async + guarded, so calling it each frame coalesces
    // fetches rather than thrashing them.
    let gotoRaf: number | null = null;
    function goto(tx: number, ty: number, zoom: number, durationMs = 1400): void {
      if (gotoRaf !== null) cancelAnimationFrame(gotoRaf);
      const s = { x: camera.target[0], y: camera.target[1], z: camera.zoom };
      const e = { x: tx, y: ty, z: zoom };
      const t0 = performance.now();
      const ease = (u: number) => (u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2);
      const lz0 = Math.log(s.z),
        lz1 = Math.log(e.z);

      // Prefetch the destination's tiles into cache NOW (async, off the
      // animation's critical path) so the arrival refine is a cheap
      // cache-hit swap instead of a fetch + decode stall.
      prefetchView(e.x, e.y, e.z);

      // During the flight we keep the currently-mounted (lower-LOD) tiles
      // and only re-rasterize them under the moving camera — no per-frame
      // tile swaps. That's what kills the 100ms+ hitches: crossing 5 LODs
      // used to remount a full tile set on 5 separate frames. We refine to
      // the destination LOD once, on arrival (Google-Earth style).
      const tick = (now: number) => {
        const u = Math.min(1, (now - t0) / durationMs);
        const k = ease(u);
        camera.target = [s.x + (e.x - s.x) * k, s.y + (e.y - s.y) * k, 0];
        camera.zoom = Math.exp(lz0 + (lz1 - lz0) * k); // log-space zoom lerp
        scene.rerender();
        updateZoomReadout();
        updateLabels();
        if (u < 1) gotoRaf = mountedTimer1 = requestAnimationFrame(tick);
        else {
          gotoRaf = null;
          querySync.write();
          void updateActiveSet();
        }
      };
      gotoRaf = mountedTimer2 = requestAnimationFrame(tick);
    }

    // Fetch (but don't mount) the tiles the given view will need, so they're
    // warm in the cache before the goto arrives.
    function prefetchView(tx: number, ty: number, zoom: number): void {
      const savedT = camera.target,
        savedZ = camera.zoom;
      camera.target = [tx, ty, 0];
      camera.zoom = zoom;
      const lod = targetLOD(zoom);
      const def = manifest.zooms.find((zz) => zz.z === lod);
      const vis = visiblePlaneAABB();
      camera.target = savedT;
      camera.zoom = savedZ; // restore immediately
      if (!def) return;
      for (let ty2 = 0; ty2 < def.rows; ty2++) {
        for (let tx2 = 0; tx2 < def.cols; tx2++) {
          const key = `${lod}/${tx2}_${ty2}`;
          if (!tileCache.has(key) && tileVisible(lod, tx2, ty2, vis)) {
            void loadTile(lod, tx2, ty2);
          }
        }
      }
    }

    let activePtr: number | null = null;
    let lastX = 0,
      lastY = 0;
    let wheelQueryTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleWheelQuerySync = () => {
      if (wheelQueryTimer !== null) clearTimeout(wheelQueryTimer);
      wheelQueryTimer = mountedTimer3 = setTimeout(() => {
        wheelQueryTimer = null;
        querySync.write();
      }, 160);
    };
    host.addEventListener(
      "pointerdown",
      (e) => {
        if (activePtr !== null) return;
        activePtr = e.pointerId;
        lastX = e.clientX;
        lastY = e.clientY;
        // Capture on the stable host, NOT e.target: each pointermove rerenders
        // the <pre> (innerHTML replaced), destroying a captured child and
        // dropping the gesture mid-drag — especially on touch.
        host.setPointerCapture(e.pointerId);
      },
      { signal: scope.signal },
    );
    host.addEventListener(
      "pointermove",
      (e) => {
        if (activePtr !== e.pointerId) return;
        // Use coalesced events so one rAF render consumes the whole burst.
        const events = (e as PointerEvent).getCoalescedEvents?.() ?? [e];
        const last = events[events.length - 1];
        const dxPx = last.clientX - lastX;
        const dyPx = last.clientY - lastY;
        lastX = last.clientX;
        lastY = last.clientY;
        const [du, dv] = screenToPlaneDelta(dxPx, dyPx);
        // Drag the map WITH the pointer: target moves opposite to the drag,
        // clamped to the plane extent so you can't pan into the void.
        const t = camera.target;
        const { halfX, halfY } = manifest.plane;
        const nx = Math.max(-halfX, Math.min(halfX, t[0] - du));
        const ny = Math.max(-halfY, Math.min(halfY, t[1] - dv));
        camera.target = [nx, ny, t[2]];
        requestRender();
      },
      { signal: scope.signal },
    );
    const release = (e: PointerEvent) => {
      if (activePtr !== e.pointerId) return;
      activePtr = null;
      try {
        host.releasePointerCapture(e.pointerId);
      } catch {}
      updateLabels();
      querySync.write();
      void updateActiveSet();
    };
    host.addEventListener("pointerup", release, { signal: scope.signal });
    host.addEventListener("pointercancel", release, { signal: scope.signal });
    host.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        const delta = e.deltaY * 0.001;
        // Only z0–z3 tiles ship, so deeper zoom just enlarges z3.
        camera.zoom = Math.max(360, Math.min(2000, camera.zoom * (1 - delta)));
        scene.rerender();
        updateZoomReadout();
        updateLabels();
        scheduleWheelQuerySync();
        void updateActiveSet();
      },
      { ...{ passive: false }, signal: scope.signal },
    );

    // ── Control dock wiring ───────────────────────────────────────────
    // Mobile: [ Controls ] button toggles the bottom drawer (collapsed by default).
    const ctlToggle = $("ctl-toggle");
    const ctlPanel = $("iso-controls");
    ctlToggle?.addEventListener(
      "click",
      () => {
        const open = ctlPanel?.classList.toggle("is-open") ?? false;
        ctlToggle.setAttribute("aria-expanded", String(open));
        ctlToggle.textContent = open ? "[ Close ]" : "[ Controls ]";
      },
      { signal: scope.signal },
    );

    // Relief exaggeration → restamp every active tile's Z-scale transform.
    const exaggInput = $("exagg") as HTMLInputElement | null;
    const exaggVal = $("exagg-val");
    exaggInput?.addEventListener(
      "input",
      () => {
        heightScale = parseFloat(exaggInput.value);
        if (exaggVal) exaggVal.textContent = heightScale.toFixed(1);
        const t = tileTransform();
        for (const h of activeHandles.values()) h.setTransform(t);
        scene.rerender();
        querySync.schedule();
      },
      { signal: scope.signal },
    );

    const densityInput = $("density") as HTMLInputElement | null;
    const densityVal = $("density-val");
    densityInput?.addEventListener(
      "input",
      () => {
        density = parseFloat(densityInput.value) || 1;
        if (densityVal) densityVal.textContent = density.toFixed(2).replace(/\.?0+$/, "");
        setDensity(density);
        scene.rerender();
        updateZoomReadout();
        querySync.schedule();
        void updateActiveSet();
      },
      { signal: scope.signal },
    );

    // Tilt (rotX) + rotation (rotY). Both change which tiles are visible, so
    // recompute the active set after.
    const tiltInput = $("tilt") as HTMLInputElement | null;
    const tiltVal = $("tilt-val");
    tiltInput?.addEventListener(
      "input",
      () => {
        const deg = parseFloat(tiltInput.value);
        if (tiltVal) tiltVal.textContent = String(deg);
        camera.rotX = deg;
        scene.rerender();
        querySync.schedule();
        void updateActiveSet();
      },
      { signal: scope.signal },
    );

    const rotInput = $("rot") as HTMLInputElement | null;
    const rotVal = $("rot-val");
    rotInput?.addEventListener(
      "input",
      () => {
        const deg = parseFloat(rotInput.value);
        if (rotVal) rotVal.textContent = String(deg);
        camera.rotY = deg;
        scene.rerender();
        querySync.schedule();
        void updateActiveSet();
      },
      { signal: scope.signal },
    );

    // Remount every active tile with the geometry for the current mode.
    function remountActive() {
      for (const [key, handle] of activeHandles) {
        handle.dispose();
        const td = tileCache.get(key);
        if (td) activeHandles.set(key, scene.add(tilePolys(td), tileTransform()) as unknown as MeshHandle);
      }
      scene.rerender();
    }

    // Render mode (solid / coast / wire).
    const modeSeg = $("mode-seg");
    modeSeg?.addEventListener(
      "click",
      (e) => {
        const btn = (e.target as HTMLElement).closest("[data-mode]") as HTMLElement | null;
        if (!btn) return;
        const mode = btn.dataset.mode as RenderMode;
        if (mode === renderMode) return;
        renderMode = mode;
        modeSeg
          .querySelectorAll("button")
          .forEach((b) => b.classList.toggle("active", (b as HTMLElement).dataset.mode === mode));
        scene.setOptions({ mode: sceneModeFor() });
        remountActive();
        querySync.schedule();
      },
      { signal: scope.signal },
    );

    // Palette — recolor the terrain. Only affects solid mode (coast/wire
    // use fixed line colors), so just remount when in solid.
    const paletteSel = $("palette") as HTMLSelectElement | null;
    paletteSel?.addEventListener(
      "change",
      () => {
        palette = paletteSel.value as PaletteName;
        // coast uses a fixed line color; solid + wire follow the palette.
        if (renderMode !== "coast") remountActive();
        querySync.schedule();
      },
      { signal: scope.signal },
    );

    // Lighting — directional "sun" (azimuth/elevation → world direction) +
    // key/ambient intensities. Applied via setOptions (no remount needed).
    function applyLight() {
      scene.setOptions({
        directionalLight: { direction: sunDirection(sunAz, sunEl), intensity: keyI },
        ambientLight: { intensity: ambI },
      });
      scene.rerender();
    }
    const bindLight = (id: string, valId: string, set: (v: number) => void, fmt: (v: number) => string) => {
      const input = $(id) as HTMLInputElement | null;
      const valEl = $(valId);
      input?.addEventListener(
        "input",
        () => {
          const v = parseFloat(input.value);
          set(v);
          if (valEl) valEl.textContent = fmt(v);
          applyLight();
          querySync.schedule();
        },
        { signal: scope.signal },
      );
    };
    bindLight(
      "az",
      "az-val",
      (v) => (sunAz = v),
      (v) => String(Math.round(v)),
    );
    bindLight(
      "el",
      "el-val",
      (v) => (sunEl = v),
      (v) => String(Math.round(v)),
    );
    bindLight(
      "key",
      "key-val",
      (v) => (keyI = v),
      (v) => v.toFixed(2),
    );
    bindLight(
      "amb",
      "amb-val",
      (v) => (ambI = v),
      (v) => v.toFixed(2),
    );

    // ── Country labels (GADM) as hotspot <div>s ───────────────────────
    // Each label is a 3D-anchored hotspot at its Mercator plane point; the
    // scene projects it to a screen cell every render, so labels pan/zoom
    // with the map for free. We fade them in by zoom (only the biggest
    // countries at world view; more as you zoom), and off-screen ones are
    // clipped by the host's overflow:hidden.
    type LabelRec = { name: string; x: number; y: number; w: number };
    const labelEls: HTMLElement[] = [];
    let labelData: LabelRec[] = [];
    // Greedy declutter: walk labels biggest-country-first, show each only if
    // it's on-screen AND its text box doesn't overlap an already-shown label.
    // Runs after a render (hotspot left/top are then current). Caps total
    // shown by zoom so the world view stays sparse.
    function updateLabels(): void {
      const maxShown = Math.max(10, Math.min(labelData.length, Math.round((camera.zoom / INITIAL_ZOOM) * 14)));
      const hostRect = host.getBoundingClientRect();
      const placed: Array<{ x: number; y: number; w: number; h: number }> = [];
      let count = 0;
      for (let i = 0; i < labelEls.length; i++) {
        const el = labelEls[i];
        const parent = el.parentElement as HTMLElement | null;
        const show = (() => {
          if (count >= maxShown || !parent || parent.style.display === "none") return false;
          const left = parseFloat(parent.style.left);
          const top = parseFloat(parent.style.top);
          if (!Number.isFinite(left) || !Number.isFinite(top)) return false;
          if (left < 0 || left > hostRect.width || top < 0 || top > hostRect.height) return false; // off-screen
          const w = labelData[i].name.length * 6 + 6,
            h = 13; // approx text box
          const r = { x: left - w / 2, y: top - h / 2, w, h };
          const hit = placed.some((p) => !(r.x + r.w < p.x || r.x > p.x + p.w || r.y + r.h < p.y || r.y > p.y + p.h));
          if (hit) return false;
          placed.push(r);
          count++;
          return true;
        })();
        // Inline opacity — the <style> block is Astro-scoped and won't match
        // these JS-created spans.
        el.style.opacity = show ? "0.92" : "0";
      }
    }
    void (async () => {
      try {
        const res = await fetch("/data/flatmap/labels.json", { signal: scope.signal });
        labelData = await res.json();
        for (const rec of labelData) {
          const h = scene.addHotspot({ id: `lbl-${rec.name}`, at: [rec.x, rec.y, 0], size: [1, 1] });
          const span = document.createElement("span");
          span.className = "glyph-label";
          // Inline styles (Astro scopes the <style> block; JS-created nodes
          // don't get the scope attribute so the CSS rules won't match).
          span.style.cssText =
            "transform:translate(-50%,-50%);white-space:nowrap;font-size:10px;" +
            "letter-spacing:0.08em;text-transform:uppercase;color:rgba(255,245,224,0.96);" +
            "text-shadow:0 0 3px #000,0 0 6px #000,0 1px 2px #000;opacity:0;" +
            "transition:opacity 160ms ease;pointer-events:none;";
          span.textContent = rec.name;
          h.el.appendChild(span);
          labelEls.push(span);
        }
        // Render first so updateHotspots() sets each label's screen
        // position, THEN declutter (which reads those positions).
        scene.rerender();
        updateLabels();
      } catch (e) {
        console.error("labels load failed", e);
      }
    })();

    scene.rerender();

    // Debug hook for precise camera positioning during iteration.
    (window as unknown as { __flatmap: unknown }).__flatmap = {
      camera,
      scene,
      setView(target: [number, number, number], zoom: number) {
        camera.target = target;
        camera.zoom = zoom;
        querySync.write();
        scene.rerender();
        updateZoomReadout();
        void updateActiveSet();
      },
      setMode(m: RenderMode) {
        renderMode = m;
        modeSeg?.querySelectorAll("button").forEach((button) => {
          button.classList.toggle("active", (button as HTMLElement).dataset.mode === renderMode);
        });
        scene.setOptions({ mode: sceneModeFor() });
        remountActive();
        querySync.write();
      },
      goto,
    };
  }

  void mount();

  return scope.dispose;
}

/**
 * Gallery picker runtime — wires search box, model selection, load-random,
 * and the right-rail controls to the GlyphcssDemo's exposed handle.
 * Controls mirror glyphcss DebugWorkbench exactly.
 */

interface ControlState {
  invertDrag?: boolean;
  dragEnabled?: boolean;
  wheelEnabled?: boolean;
  autoCenter?: boolean;
  rotYLocked?: boolean;
  projection?: 'perspective' | 'orthographic';
}

interface SelectionTriangle {
  vertices: [[number, number, number], [number, number, number], [number, number, number]];
}

interface DemoHandle {
  setMeshUrl: (url: string) => Promise<void>;
  setTunables: (partial: Record<string, number | string>) => void;
  setControlState: (partial: ControlState) => void;
  getStats: () => { cols: number; rows: number; edges: number; verts: number; triangles: number; bakeMs: number };
  getSelection: () => { index: number; triangle: SelectionTriangle | null };
  clearSelection: () => void;
  setSelectionChangeHandler: (fn: (idx: number, tri: SelectionTriangle | null) => void) => void;
  resumeAutoRotate: () => void;
  setProjection: (kind: 'perspective' | 'orthographic') => void;
}

function getDemo(): DemoHandle | null {
  const el = document.getElementById('gallery-demo') as unknown as { glyphcssDemo?: DemoHandle };
  return el?.glyphcssDemo ?? null;
}

function waitForDemo(maxMs = 6000): Promise<DemoHandle | null> {
  return new Promise((resolve) => {
    const start = performance.now();
    const tick = (): void => {
      const handle = getDemo();
      if (handle) { resolve(handle); return; }
      if (performance.now() - start > maxMs) { resolve(null); return; }
      requestAnimationFrame(tick);
    };
    tick();
  });
}

// ── Model picker ─────────────────────────────────────────────────────────────

function initPicker(): void {
  const tree = document.getElementById('model-tree');
  const search = document.getElementById('model-search') as HTMLInputElement | null;
  if (!tree || !search) return;

  const allItems = (): NodeListOf<HTMLButtonElement> =>
    tree.querySelectorAll<HTMLButtonElement>('.gallery-picker__item');

  // Click → swap mesh + apply per-preset camera defaults.
  tree.addEventListener('click', async (e) => {
    const target = e.target as HTMLElement;
    const item = target.closest<HTMLButtonElement>('.gallery-picker__item');
    if (item) {
      const url = item.dataset.url;
      if (!url) return;
      allItems().forEach((el) => el.classList.remove('active'));
      item.classList.add('active');

      // Read per-preset defaults from data attributes set by gallery.astro.
      const presetScale    = parseFloat(item.dataset.scale    ?? '');
      const presetDistance = parseFloat(item.dataset.distance ?? '');
      const presetRotX     = parseFloat(item.dataset.rotX     ?? '');
      const presetRotY     = parseFloat(item.dataset.rotY     ?? '');

      const demo = await waitForDemo();
      if (demo) {
        await demo.setMeshUrl(url);
        // Apply per-preset camera state after mesh loads.
        const tunables: Record<string, number> = {};
        if (Number.isFinite(presetScale))    tunables.zoom    = presetScale;
        if (Number.isFinite(presetDistance)) tunables.distance = presetDistance;
        if (Number.isFinite(presetRotX))     tunables.rotX     = presetRotX;
        if (Object.keys(tunables).length > 0) {
          demo.setTunables(tunables);
          // Reflect new values in the right-rail sliders.
          const rotXDeg = Number.isFinite(presetRotX) ? Math.round(presetRotX * 180 / Math.PI) : null;
          syncRailSlider('rail-scale',    'rail-scale-val',    3, presetScale,    null);
          syncRailSlider('rail-distance', 'rail-distance-val', 0, presetDistance, null);
          if (rotXDeg !== null) syncRailSlider('rail-rotX', 'rail-rotX-val', 0, rotXDeg, '°');
        }
        // Reset rotY to preset (resume auto-rotate so CSS animation takes over).
        if (Number.isFinite(presetRotY)) {
          demo.resumeAutoRotate();
          const rotYDeg = Math.round(presetRotY * 180 / Math.PI);
          syncRailSlider('rail-rotY', 'rail-rotY-val', 0, rotYDeg, '°');
        }
        // Reset targets to 0.
        syncRailSlider('rail-targetX', 'rail-targetX-val', 1, 0, null);
        syncRailSlider('rail-targetY', 'rail-targetY-val', 1, 0, null);
        syncRailSlider('rail-targetZ', 'rail-targetZ-val', 1, 0, null);
        demo.setTunables({ targetX: 0, targetY: 0, targetZ: 0 });
        updateRailStats(demo);
      }
      return;
    }
    // Category toggle.
    const catBtn = target.closest<HTMLButtonElement>('.gallery-picker__cat-button');
    if (catBtn) {
      const expanded = catBtn.getAttribute('aria-expanded') !== 'false';
      catBtn.setAttribute('aria-expanded', expanded ? 'false' : 'true');
    }
  });

  // Search → filter items.
  search.addEventListener('input', () => {
    const q = search.value.trim().toLowerCase();
    const categories = tree.querySelectorAll<HTMLElement>('.gallery-picker__category');
    for (const cat of categories) {
      let visibleCount = 0;
      const items = cat.querySelectorAll<HTMLElement>('.gallery-picker__item');
      for (const item of items) {
        const label = (item.dataset.label || item.textContent || '').toLowerCase();
        const kind = (item.dataset.kind || '').toLowerCase();
        const match = !q || label.includes(q) || kind.includes(q);
        item.hidden = !match;
        if (match) visibleCount++;
      }
      cat.hidden = visibleCount === 0;
      if (q && visibleCount > 0) {
        const catBtn = cat.querySelector<HTMLButtonElement>('.gallery-picker__cat-button');
        catBtn?.setAttribute('aria-expanded', 'true');
      }
    }
  });

  // Load Random button
  const randomBtn = document.getElementById('load-random-btn');
  if (randomBtn) {
    randomBtn.addEventListener('click', async () => {
      const items = Array.from(allItems()).filter((el) => !el.hidden);
      if (!items.length) return;
      const pick = items[Math.floor(Math.random() * items.length)]!;
      const url = pick.dataset.url;
      if (!url) return;
      allItems().forEach((el) => el.classList.remove('active'));
      pick.classList.add('active');
      // scroll into view
      pick.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      const presetScale    = parseFloat(pick.dataset.scale    ?? '');
      const presetDistance = parseFloat(pick.dataset.distance ?? '');
      const presetRotX     = parseFloat(pick.dataset.rotX     ?? '');
      const presetRotY     = parseFloat(pick.dataset.rotY     ?? '');

      const demo = await waitForDemo();
      if (demo) {
        await demo.setMeshUrl(url);
        const tunables: Record<string, number> = {};
        if (Number.isFinite(presetScale))    tunables.zoom    = presetScale;
        if (Number.isFinite(presetDistance)) tunables.distance = presetDistance;
        if (Number.isFinite(presetRotX))     tunables.rotX     = presetRotX;
        if (Object.keys(tunables).length > 0) {
          demo.setTunables(tunables);
          const rotXDeg = Number.isFinite(presetRotX) ? Math.round(presetRotX * 180 / Math.PI) : null;
          syncRailSlider('rail-scale',    'rail-scale-val',    3, presetScale,    null);
          syncRailSlider('rail-distance', 'rail-distance-val', 0, presetDistance, null);
          if (rotXDeg !== null) syncRailSlider('rail-rotX', 'rail-rotX-val', 0, rotXDeg, '°');
        }
        if (Number.isFinite(presetRotY)) {
          demo.resumeAutoRotate();
          const rotYDeg = Math.round(presetRotY * 180 / Math.PI);
          syncRailSlider('rail-rotY', 'rail-rotY-val', 0, rotYDeg, '°');
        }
        syncRailSlider('rail-targetX', 'rail-targetX-val', 1, 0, null);
        syncRailSlider('rail-targetY', 'rail-targetY-val', 1, 0, null);
        syncRailSlider('rail-targetZ', 'rail-targetZ-val', 1, 0, null);
        demo.setTunables({ targetX: 0, targetY: 0, targetZ: 0 });
        updateRailStats(demo);
      }
    });
  }
}

// ── Right rail ────────────────────────────────────────────────────────────────

/** Sync a rail slider's value and display text without triggering the input handler. */
function syncRailSlider(sliderId: string, valId: string, decimals: number, value: number, suffix: string | null): void {
  if (!Number.isFinite(value)) return;
  const slider = document.getElementById(sliderId) as HTMLInputElement | null;
  const valEl  = document.getElementById(valId);
  if (slider) slider.value = String(value);
  if (valEl)  valEl.textContent = value.toFixed(decimals) + (suffix ?? '');
}

function updateRailStats(demo: DemoHandle): void {
  const stats = demo.getStats();
  // Model section stat rows
  const cellsEl = document.getElementById('rail-cells');
  const edgesEl = document.getElementById('rail-edges');
  const triEl   = document.getElementById('rail-triangles');
  const vertsEl = document.getElementById('rail-verts');
  const bakeEl  = document.getElementById('rail-bake-ms');
  if (cellsEl) cellsEl.textContent = `${stats.cols} × ${stats.rows}`;
  if (edgesEl) edgesEl.textContent = String(stats.edges);
  if (triEl)   triEl.textContent   = stats.triangles > 0 ? String(stats.triangles) : (stats.edges > 0 ? `~${Math.round(stats.edges * 2 / 3)}` : '—');
  if (vertsEl) vertsEl.textContent = String(stats.verts);
  if (bakeEl)  bakeEl.textContent  = stats.bakeMs > 0 ? `${stats.bakeMs} ms` : '—';
  // FPS dock cell count
  const cellsValEl = document.getElementById('rail-cells-val');
  if (cellsValEl) cellsValEl.textContent = `${stats.cols}×${stats.rows}`;
}

function updateRailSelection(idx: number, tri: SelectionTriangle | null): void {
  const idxEl  = document.getElementById('rail-sel-index');
  const v0El   = document.getElementById('rail-sel-v0');
  const v1El   = document.getElementById('rail-sel-v1');
  const v2El   = document.getElementById('rail-sel-v2');
  const noneEl = document.getElementById('rail-sel-none');
  const dataEl = document.getElementById('rail-sel-data');
  const clearBtn = document.getElementById('rail-sel-clear') as HTMLButtonElement | null;

  if (idx < 0 || !tri) {
    if (noneEl)  noneEl.hidden  = false;
    if (dataEl)  dataEl.hidden  = true;
    if (clearBtn) clearBtn.disabled = true;
    return;
  }
  if (noneEl)  noneEl.hidden  = true;
  if (dataEl)  dataEl.hidden  = false;
  if (clearBtn) clearBtn.disabled = false;
  const fmt  = (v: number) => v.toFixed(3);
  const fmtV = (v: [number, number, number]) => `(${fmt(v[0])}, ${fmt(v[1])}, ${fmt(v[2])})`;
  if (idxEl) idxEl.textContent = String(idx);
  if (v0El)  v0El.textContent  = fmtV(tri.vertices[0]);
  if (v1El)  v1El.textContent  = fmtV(tri.vertices[1]);
  if (v2El)  v2El.textContent  = fmtV(tri.vertices[2]);
}

/** Wire a slider with −/+ buttons and a value readout. */
function makeSliderHandler(opts: {
  sliderId: string;
  valId: string;
  decBtnId?: string;
  incBtnId?: string;
  decimals: number;
  suffix?: string;
  step?: number;
  tunable?: string;
  onChange?: (v: number) => void;
}): void {
  const slider  = document.getElementById(opts.sliderId) as HTMLInputElement | null;
  const valEl   = document.getElementById(opts.valId);
  const decBtn  = opts.decBtnId ? document.getElementById(opts.decBtnId) as HTMLButtonElement | null : null;
  const incBtn  = opts.incBtnId ? document.getElementById(opts.incBtnId) as HTMLButtonElement | null : null;
  if (!slider) return;

  const suffix  = opts.suffix ?? '';
  const step    = opts.step ?? (parseFloat(slider.step) || 1);
  const fmt     = (v: number) => v.toFixed(opts.decimals) + suffix;

  const update  = (v: number): void => {
    const min = parseFloat(slider.min);
    const max = parseFloat(slider.max);
    const clamped = Math.max(min, Math.min(max, v));
    slider.value = String(clamped);
    if (valEl) valEl.textContent = fmt(clamped);
    if (opts.tunable) {
      const demo = getDemo();
      if (demo) demo.setTunables({ [opts.tunable]: clamped });
    }
    opts.onChange?.(clamped);
  };

  slider.addEventListener('input', () => update(parseFloat(slider.value)));
  decBtn?.addEventListener('click', () => update(parseFloat(slider.value) - step));
  incBtn?.addEventListener('click', () => update(parseFloat(slider.value) + step));
}

// FPS / MS tracking
let fpsFrames = 0;
let fpsStart  = 0;
let lastFrameTime = 0;
let fpsRafId: number | null = null;

function startFpsDock(): void {
  if (fpsRafId !== null) return;
  const fpsEl  = document.getElementById('rail-fps-val');
  const msEl   = document.getElementById('rail-ms-val');

  const tick = (now: number): void => {
    fpsRafId = requestAnimationFrame(tick);
    const delta = now - (lastFrameTime || now);
    lastFrameTime = now;
    fpsFrames++;
    if (!fpsStart) fpsStart = now;
    const elapsed = now - fpsStart;
    if (elapsed >= 1000) {
      const fps = Math.round((fpsFrames * 1000) / elapsed);
      if (fpsEl) fpsEl.textContent = String(fps);
      if (msEl)  msEl.textContent  = delta.toFixed(1);
      fpsFrames = 0;
      fpsStart  = now;
    }
  };
  fpsRafId = requestAnimationFrame(tick);
}

// Glyph density — counts edge weight classes from geometry stats.
function updateGlyphDensity(edges: number, verts: number): void {
  // Heuristic: thin = verts × 0 (endpoints not drawn), mid = feature edges, core = weight-3 (selection)
  // We approximate proportions from edge count for display purposes.
  if (edges === 0) return;
  // Thin (weight 1) ≈ 20%, Normal (weight 2) ≈ 70%, Core (weight 3, selection) ≈ ~10% or 0 if no selection
  const thin = Math.round(verts * 0.35);
  const mid  = Math.round(edges * 0.65);
  const core = Math.max(0, edges - mid - thin);
  const total = thin + mid + core || 1;
  const setBar = (barId: string, countId: string, count: number): void => {
    const bar   = document.getElementById(barId) as HTMLElement | null;
    const countEl = document.getElementById(countId);
    if (bar)     bar.style.width = `${Math.round((count / total) * 100)}%`;
    if (countEl) countEl.textContent = String(count);
  };
  setBar('rail-glyph-thin-bar', 'rail-glyph-thin', thin);
  setBar('rail-glyph-mid-bar',  'rail-glyph-mid',  mid);
  setBar('rail-glyph-core-bar', 'rail-glyph-core', core);
}

function initRail(): void {
  // ── Interaction ────────────────────────────────────────────────────────
  const autorotate = document.getElementById('rail-autorotate') as HTMLInputElement | null;
  if (autorotate) {
    autorotate.addEventListener('change', () => {
      const demoEl = document.getElementById('gallery-demo');
      if (!demoEl) return;
      demoEl.classList.toggle('no-autorotate', !autorotate.checked);
    });
  }

  makeSliderHandler({
    sliderId: 'rail-speed',
    valId:    'rail-speed-val',
    decBtnId: 'rail-speed-dec',
    incBtnId: 'rail-speed-inc',
    decimals: 2,
    suffix:   '×',
    step:     0.05,
    onChange: (mult) => {
      const demoEl = document.getElementById('gallery-demo');
      if (!demoEl) return;
      const sceneHost = demoEl.querySelector('.glyphcss-demo__scene-host') as HTMLElement | null;
      if (sceneHost) sceneHost.style.setProperty('--dur', `${(6 * mult).toFixed(2)}s`);
    },
  });

  const dragEnabled = document.getElementById('rail-drag-enabled') as HTMLInputElement | null;
  if (dragEnabled) {
    dragEnabled.addEventListener('change', () => {
      const demo = getDemo();
      if (demo) demo.setControlState({ dragEnabled: dragEnabled.checked });
    });
  }

  const wheelEnabled = document.getElementById('rail-wheel-enabled') as HTMLInputElement | null;
  if (wheelEnabled) {
    wheelEnabled.addEventListener('change', () => {
      const demo = getDemo();
      if (demo) demo.setControlState({ wheelEnabled: wheelEnabled.checked });
    });
  }

  const invertDrag = document.getElementById('rail-invert') as HTMLInputElement | null;
  if (invertDrag) {
    invertDrag.addEventListener('change', () => {
      const demo = getDemo();
      if (demo) demo.setControlState({ invertDrag: invertDrag.checked });
    });
  }

  // ── Camera ─────────────────────────────────────────────────────────────
  const resetCamera = document.getElementById('rail-reset-camera');
  if (resetCamera) {
    resetCamera.addEventListener('click', async () => {
      const demo = await waitForDemo();
      if (!demo) return;
      // Reset to defaults: scale 0.65, distance 8000, rotX 65°, rotY=auto
      demo.resumeAutoRotate();
      demo.setTunables({ scale: 0.65, distance: 8000, rotX: 1.134, targetX: 0, targetY: 0, targetZ: 0 });
      syncRailSlider('rail-scale',    'rail-scale-val',    3, 0.65,   null);
      syncRailSlider('rail-distance', 'rail-distance-val', 0, 8000,   null);
      syncRailSlider('rail-rotX',     'rail-rotX-val',     0, 65,     '°');
      syncRailSlider('rail-targetX',  'rail-targetX-val',  1, 0,      null);
      syncRailSlider('rail-targetY',  'rail-targetY-val',  1, 0,      null);
      syncRailSlider('rail-targetZ',  'rail-targetZ-val',  1, 0,      null);
      const autoRotateCheck = document.getElementById('gallery-demo');
      if (autoRotateCheck) autoRotateCheck.classList.remove('no-autorotate');
    });
  }

  const autoCenter = document.getElementById('rail-auto-center') as HTMLInputElement | null;
  if (autoCenter) {
    autoCenter.addEventListener('change', () => {
      const demo = getDemo();
      if (demo) demo.setControlState({ autoCenter: autoCenter.checked });
    });
  }

  const projection = document.getElementById('rail-projection') as HTMLSelectElement | null;
  if (projection) {
    projection.addEventListener('change', () => {
      const demo = getDemo();
      if (demo) demo.setProjection(projection.value as 'perspective' | 'orthographic');
    });
  }

  // Zoom (scale)
  makeSliderHandler({
    sliderId: 'rail-scale',
    valId:    'rail-scale-val',
    decBtnId: 'rail-scale-dec',
    incBtnId: 'rail-scale-inc',
    decimals: 3,
    step:     0.005,
    tunable:  'scale',
  });

  // Perspective (distance)
  makeSliderHandler({
    sliderId: 'rail-distance',
    valId:    'rail-distance-val',
    decBtnId: 'rail-distance-dec',
    incBtnId: 'rail-distance-inc',
    decimals: 0,
    step:     500,
    tunable:  'distance',
  });

  // Rot X (degrees, convert to radians for tunable)
  const rotXSlider = document.getElementById('rail-rotX') as HTMLInputElement | null;
  const rotXVal    = document.getElementById('rail-rotX-val');
  const rotXDec    = document.getElementById('rail-rotX-dec') as HTMLButtonElement | null;
  const rotXInc    = document.getElementById('rail-rotX-inc') as HTMLButtonElement | null;
  if (rotXSlider) {
    const applyRotX = (deg: number): void => {
      const clamped = Math.max(-90, Math.min(90, deg));
      rotXSlider.value = String(clamped);
      if (rotXVal) rotXVal.textContent = `${clamped}°`;
      const demo = getDemo();
      if (demo) demo.setTunables({ rotX: (clamped * Math.PI) / 180 });
    };
    rotXSlider.addEventListener('input', () => applyRotX(parseFloat(rotXSlider.value)));
    rotXDec?.addEventListener('click', () => applyRotX(parseFloat(rotXSlider.value) - 1));
    rotXInc?.addEventListener('click', () => applyRotX(parseFloat(rotXSlider.value) + 1));
  }

  // Rot Y (degrees, convert to radians; pauses auto-rotate when dragged)
  const rotYSlider = document.getElementById('rail-rotY') as HTMLInputElement | null;
  const rotYVal    = document.getElementById('rail-rotY-val');
  const rotYDec    = document.getElementById('rail-rotY-dec') as HTMLButtonElement | null;
  const rotYInc    = document.getElementById('rail-rotY-inc') as HTMLButtonElement | null;
  if (rotYSlider) {
    const applyRotY = (deg: number): void => {
      const wrapped = ((deg % 360) + 360) % 360;
      rotYSlider.value = String(wrapped);
      if (rotYVal) rotYVal.textContent = `${Math.round(wrapped)}°`;
      const demo = getDemo();
      // setTunables with rotY will pause autorotate
      if (demo) demo.setTunables({ rotY: (wrapped * Math.PI) / 180 });
      // Uncheck autorotate checkbox to reflect paused state
      const autorotateCheck = document.getElementById('rail-autorotate') as HTMLInputElement | null;
      if (autorotateCheck && autorotateCheck.checked) autorotateCheck.checked = false;
    };
    rotYSlider.addEventListener('input', () => applyRotY(parseFloat(rotYSlider.value)));
    rotYDec?.addEventListener('click', () => applyRotY(parseFloat(rotYSlider.value) - 5));
    rotYInc?.addEventListener('click', () => applyRotY(parseFloat(rotYSlider.value) + 5));
  }

  // Target X/Y/Z
  makeSliderHandler({ sliderId: 'rail-targetX', valId: 'rail-targetX-val', decBtnId: 'rail-targetX-dec', incBtnId: 'rail-targetX-inc', decimals: 1, step: 1, tunable: 'targetX' });
  makeSliderHandler({ sliderId: 'rail-targetY', valId: 'rail-targetY-val', decBtnId: 'rail-targetY-dec', incBtnId: 'rail-targetY-inc', decimals: 1, step: 1, tunable: 'targetY' });
  makeSliderHandler({ sliderId: 'rail-targetZ', valId: 'rail-targetZ-val', decBtnId: 'rail-targetZ-dec', incBtnId: 'rail-targetZ-inc', decimals: 1, step: 1, tunable: 'targetZ' });

  // Stretch
  makeSliderHandler({ sliderId: 'rail-stretch', valId: 'rail-stretch-val', decBtnId: 'rail-stretch-dec', incBtnId: 'rail-stretch-inc', decimals: 2, step: 0.05, tunable: 'stretch' });

  // ── Selection ──────────────────────────────────────────────────────────
  const clearSelBtn = document.getElementById('rail-sel-clear') as HTMLButtonElement | null;
  if (clearSelBtn) {
    clearSelBtn.addEventListener('click', () => {
      const demo = getDemo();
      if (demo) demo.clearSelection();
    });
  }

  // ── FPS dock ───────────────────────────────────────────────────────────
  startFpsDock();

  // ── Populate stats + register handlers once demo is ready ─────────────
  waitForDemo().then((demo) => {
    if (!demo) return;

    // Register selection change handler.
    demo.setSelectionChangeHandler((idx, tri) => {
      updateRailSelection(idx, tri);
    });

    // Poll until edges > 0 (initial mesh load completes asynchronously)
    let attempts = 0;
    const poll = (): void => {
      const s = demo.getStats();
      if (s.edges > 0 || attempts > 20) {
        updateRailStats(demo);
        updateGlyphDensity(s.edges, s.verts);
        return;
      }
      attempts++;
      setTimeout(poll, 300);
    };
    setTimeout(poll, 500);
  });
}

document.addEventListener('astro:page-load', () => { initPicker(); initRail(); });
if (document.readyState !== 'loading') { initPicker(); initRail(); }
else document.addEventListener('DOMContentLoaded', () => { initPicker(); initRail(); });

import { createGlyphOrthographicCamera, createGlyphScene, WIREFRAME_PALETTES } from "glyphcss";
import { createMountScope } from "../../../services/lifecycle/mountScope";

import type { GlyphEffectLayerHandle } from "glyphcss";

import { GlyphEffectCatalog } from "@glyphcss/effects";

import { buildFlatQuad, buildShapePlates, sampleImageToGrid } from "./image-relief";

import { extractAsciiFromPre, glyphAtlasCellsFromPre } from "../../../services/export/asciiClipboard";

import { readQueryBoolean, readQueryEnum, readQueryNumber, readQueryString } from "../model/queryValues";
import { createExampleQuerySync } from "../services/querySync";

import { computeGlyphAtlasAvailability } from "../../../services/rendering/glyphAtlasAvailability";

export function mountImageExample(root: HTMLElement) {
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
  let mountedTimer3: ReturnType<typeof requestAnimationFrame> | undefined;
  scope.onDispose(() => {
    if (mountedTimer3 !== undefined) cancelAnimationFrame(mountedTimer3);
  });
  let mountedTimer4: ReturnType<typeof setTimeout> | undefined;
  scope.onDispose(() => {
    if (mountedTimer4 !== undefined) clearTimeout(mountedTimer4);
  });

  const stage = root.querySelector(`#${"stage"}`) as HTMLElement;

  const host = root.querySelector(`#${"host"}`) as HTMLElement;

  const hint = root.querySelector(`#${"hint"}`) as HTMLElement;

  const fileInput = root.querySelector(`#${"file"}`) as HTMLInputElement;

  const paletteSel = root.querySelector(`#${"palette"}`) as HTMLSelectElement;

  const modeSel = root.querySelector(`#${"mode"}`) as HTMLSelectElement;

  const effectSel = root.querySelector(`#${"effect"}`) as HTMLSelectElement;

  const blendSel = root.querySelector(`#${"blend"}`) as HTMLSelectElement;

  const paramsPanel = root.querySelector(`#${"effect-params"}`) as HTMLElement;

  const colorEncodingSel = root.querySelector(`#${"colorEncoding"}`) as HTMLSelectElement;

  const copyBtn = root.querySelector(`#${"copy"}`) as HTMLButtonElement;

  const dims = root.querySelector(`#${"dims"}`) as HTMLElement;

  const statusEl = root.querySelector(`#${"status"}`) as HTMLElement;

  // Mobile: [ Controls ] button toggles the bottom drawer (collapsed by default).
  const ctlToggle = root.querySelector(`#${"ctl-toggle"}`);

  const ctlPanel = root.querySelector(`#${"iso-controls"}`);

  ctlToggle?.addEventListener(
    "click",
    () => {
      const open = ctlPanel?.classList.toggle("is-open") ?? false;
      ctlToggle.setAttribute("aria-expanded", String(open));
      ctlToggle.textContent = open ? "[ Close ]" : "[ Controls ]";
    },
    { signal: scope.signal },
  );

  const paletteNames = Object.keys(WIREFRAME_PALETTES);

  for (const name of paletteNames) {
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = name;
    paletteSel.appendChild(opt);
  }

  const effectIds = GlyphEffectCatalog.map((d) => d.id as string);

  for (const def of GlyphEffectCatalog) {
    const opt = document.createElement("option");
    opt.value = def.id;
    opt.textContent = def.label;
    effectSel.appendChild(opt);
  }

  const ctl = {
    density: root.querySelector(`#${"density"}`) as HTMLInputElement,
    color: root.querySelector(`#${"color"}`) as HTMLInputElement,
    groups: root.querySelector(`#${"groups"}`) as HTMLInputElement,
    depth: root.querySelector(`#${"depth"}`) as HTMLInputElement,
    res: root.querySelector(`#${"res"}`) as HTMLInputElement,
    tex: root.querySelector(`#${"tex"}`) as HTMLInputElement,
    shadow: root.querySelector(`#${"shadow"}`) as HTMLInputElement,
    light: root.querySelector(`#${"light"}`) as HTMLInputElement,
    opacity: root.querySelector(`#${"opacity"}`) as HTMLInputElement,
    speed: root.querySelector(`#${"speed"}`) as HTMLInputElement,
  };

  const BASE_FONT_SIZE = 13;

  const query = new URLSearchParams(window.location.search);

  ctl.density.value = String(readQueryNumber(query, "density", 1.6, { min: 0.75, max: 4, step: 0.05 }));

  paletteSel.value = readQueryString(query, "palette", "default", (value) => paletteNames.includes(value));

  ctl.color.checked = readQueryBoolean(query, "color", true);

  // DELIBERATELY still "spans" while /synth, /gallery, /wordart and the other
  // wired examples default to the feature-detected atlas. This page is a
  // PHOTOGRAPH — 2,495 distinct colours against the atlas's 31 slots, 80x the
  // budget — and it ships `colorTolerance` at glyphcss's own default of 0, so
  // it currently guarantees exact per-cell colour. `bench/color-font-atlas-quantize.md`
  // measures what atlas would cost it: mean redmean 9.2, p95 25.4, and 2.9%
  // of cells past redmean 32, the only scene in that table to cross the bar
  // /synth itself ships. Every other page either already merges colour runs
  // or has fewer distinct colours than the atlas has slots (parthenon 291 ->
  // mean 1.2; the flat-shaded renders skip quantization entirely and encode
  // exactly), so none of them trades away anything it was promising. The
  // control stays one click away, so the zero-<span> win is still on show.
  colorEncodingSel.value = readQueryEnum(query, "colorEncoding", "spans", ["spans", "atlas"] as const);

  modeSel.value = readQueryString(query, "mode", "flat", (v) => v === "flat" || v === "shapes");

  ctl.groups.value = String(readQueryNumber(query, "groups", 5, { min: 2, max: 10, step: 1 }));

  ctl.depth.value = String(readQueryNumber(query, "depth", 0.3, { min: 0, max: 0.6, step: 0.01 }));

  ctl.res.value = String(readQueryNumber(query, "res", 80, { min: 32, max: 128, step: 8 }));

  ctl.tex.checked = readQueryBoolean(query, "tex", false);

  ctl.shadow.checked = readQueryBoolean(query, "shadow", true);

  ctl.light.value = String(readQueryNumber(query, "light", 0.6, { min: 0, max: 1, step: 0.05 }));

  effectSel.value = readQueryString(query, "effect", "", (v) => effectIds.includes(v));

  blendSel.value = readQueryString(query, "blend", "over", (v) => v === "over" || v === "replace");

  ctl.opacity.value = String(readQueryNumber(query, "opacity", 1, { min: 0, max: 1, step: 0.05 }));

  ctl.speed.value = String(readQueryNumber(query, "speed", 1, { min: 0, max: 3, step: 0.1 }));

  function syncControlVisibility(): void {
    const shapes = modeSel.value === "shapes";
    for (const id of ["ctl-groups", "ctl-depth", "ctl-res", "ctl-tex", "ctl-shadow", "ctl-light"]) {
      root.querySelector(`#${id}`)!.hidden = !shapes;
    }
    const hasEffect = effectSel.value !== "";
    for (const id of ["ctl-blend", "ctl-opacity", "ctl-speed"]) {
      root.querySelector(`#${id}`)!.hidden = !hasEffect;
    }
  }

  function applyDensity(): void {
    const density = Math.max(0.1, parseFloat(ctl.density.value) || 1);
    root.querySelector(`#${"density-val"}`)!.textContent = density.toFixed(2).replace(/\.?0+$/, "");
    host.style.fontSize = `${BASE_FONT_SIZE / density}px`;
  }

  function showVal(id: string, value: string): void {
    root.querySelector(`#${`${id}-val`}`)!.textContent = value;
  }

  applyDensity();

  syncControlVisibility();

  // Head-on orthographic camera — the plates are depth-staged for shadows
  // and effects, not for orbiting. The view stays flat like the image.
  const camera = createGlyphOrthographicCamera({ rotX: 0, rotY: 0, zoom: 8 });

  const scene = scope.own(
    createGlyphScene(host, {
      mode: "solid",
      useColors: ctl.color.checked,
      glyphPalette: paletteSel.value,
      colorEncoding: colorEncodingSel.value as "spans" | "atlas",
      autoSize: true,
      doubleSided: true,
      camera,
      directionalLight: { direction: [0, 0, 1], intensity: 0 },
      ambientLight: { intensity: 1 },
    }),
    (resource) => resource.destroy(),
  );

  const querySync = createExampleQuerySync(() => ({
    density: Number(ctl.density.value),
    palette: paletteSel.value,
    color: ctl.color.checked,
    colorEncoding: colorEncodingSel.value,
    mode: modeSel.value,
    groups: Number(ctl.groups.value),
    depth: Number(ctl.depth.value),
    res: Number(ctl.res.value),
    tex: ctl.tex.checked,
    shadow: ctl.shadow.checked,
    light: Number(ctl.light.value),
    effect: effectSel.value,
    blend: blendSel.value,
    opacity: Number(ctl.opacity.value),
    speed: Number(ctl.speed.value),
  }));

  querySync.write();

  // Keeps the "color encoding" select's disabled state current by watching
  // the stage `<pre>` directly (a `MutationObserver`, not a dependency
  // list) — same pattern /synth, /wordart, and the gallery use.
  function recomputeAtlasAvailability(): void {
    const result = computeGlyphAtlasAvailability(scene.output, { useColors: ctl.color.checked, charMode: "ascii" });
    colorEncodingSel.disabled = result.reason !== null;
    colorEncodingSel.title =
      result.reason === null
        ? "Atlas color encoding — a single colour-font PUA text node (zero <span>s) instead of HTML spans, when the current render fits the atlas's palette/glyph budget."
        : `Atlas color encoding isn't available right now: ${result.reason}`;
  }

  recomputeAtlasAvailability();

  new MutationObserver(recomputeAtlasAvailability).observe(scene.output, {
    childList: true,
    subtree: true,
    characterData: true,
  });

  colorEncodingSel.addEventListener(
    "change",
    () => {
      scene.setOptions({ colorEncoding: colorEncodingSel.value as "spans" | "atlas" });
      querySync.schedule();
    },
    { signal: scope.signal },
  );

  let meshHandle: ReturnType<typeof scene.add> | null = null;

  let sourceImg: HTMLImageElement | null = null;

  let textureUrl = "";

  let aspect = 1;

  let sampled: { rows: number; data: ImageData } | null = null;

  // Flat mode = full ambient so each texel passes through unshaded (the
  // original behavior). Shapes mode trades ambient for an off-axis key light
  // so the plate stack shades and its drop shadows land offset.
  function applyLighting(): void {
    if (modeSel.value === "flat") {
      scene.setOptions({
        directionalLight: { direction: [0, 0, 1], intensity: 0 },
        ambientLight: { intensity: 1 },
        shadow: undefined,
      });
      return;
    }
    const l = Number(ctl.light.value);
    scene.setOptions({
      directionalLight: { direction: [0.35, 0.45, 0.85], intensity: l },
      ambientLight: { intensity: 1 - 0.5 * l },
      shadow: ctl.shadow.checked ? { opacity: 0.3, lift: 0.05 } : undefined,
    });
  }

  function fit(): void {
    const o = scene.getOptions();
    const cols = o.cols || 1,
      rows = o.rows || 1;
    const rect = host.getBoundingClientRect();
    const zoom = Math.min((0.98 * rect.width) / aspect, 0.98 * rect.height);
    if (Number.isFinite(zoom) && zoom > 0) {
      camera.zoom = zoom;
      scene.rerender();
    }
    dims.textContent = `${cols} × ${rows} cells · ${paletteSel.value}`;
  }

  function rebuildMesh(): void {
    if (!sourceImg) return;
    if (meshHandle) {
      meshHandle.dispose();
      meshHandle = null;
    }
    if (modeSel.value === "flat") {
      meshHandle = scene.add(buildFlatQuad(textureUrl, aspect));
      statusEl.textContent = `${sourceImg.naturalWidth}×${sourceImg.naturalHeight}`;
    } else {
      const rows = Number(ctl.res.value);
      if (!sampled || sampled.rows !== rows) {
        sampled = { rows, data: sampleImageToGrid(sourceImg, rows).data };
      }
      const result = buildShapePlates(sampled.data, {
        textureUrl,
        aspect,
        groups: Number(ctl.groups.value),
        depth: Number(ctl.depth.value),
        texture: ctl.tex.checked,
      });
      meshHandle = scene.add(result.polygons, { castShadow: true, receiveShadow: true });
      statusEl.textContent =
        `${sourceImg.naturalWidth}×${sourceImg.naturalHeight} · ${result.groupCount} groups · ` +
        `${result.shapeCount} shapes · ${result.polygons.length} plates`;
    }
    mountedTimer0 = requestAnimationFrame(fit);
  }

  // ── Effect composer ──────────────────────────────────────────────────
  let effectLayer: GlyphEffectLayerHandle<Record<string, unknown>> | null = null;

  let effectTime = 0;

  let effectPrev = 0;

  let effectRaf = 0;

  function tickEffect(now: number): void {
    if (!effectLayer || effectLayer.disposed) return;
    const speed = Number(ctl.speed.value);
    effectTime += Math.min((now - effectPrev) / 1000, 0.1) * speed;
    effectPrev = now;
    if (speed > 0) effectLayer.params.time = effectTime;
    effectRaf = mountedTimer1 = requestAnimationFrame(tickEffect);
  }

  // Build a control row per schema param — the composer is generated from
  // the effect's own parameterSchema, so every stock effect is fully
  // adjustable without hand-written UI.
  function buildParamPanel(def: (typeof GlyphEffectCatalog)[number]): void {
    paramsPanel.replaceChildren();
    for (const [name, spec] of Object.entries(def.parameterSchema)) {
      if (name === "time") continue;
      const row = document.createElement("div");
      row.className = "iso-ctl";
      const label = document.createElement("div");
      label.className = "iso-ctl-row";
      const nameEl = document.createElement("span");
      nameEl.textContent = spec.label ?? name;
      label.appendChild(nameEl);
      row.appendChild(label);
      const set = (value: unknown): void => {
        effectLayer?.setParams({ [name]: value });
      };

      if (spec.kind === "number") {
        const valEl = document.createElement("span");
        valEl.className = "val";
        valEl.textContent = String(spec.default);
        label.appendChild(valEl);
        const input = document.createElement("input");
        input.type = "range";
        const min = spec.min ?? 0;
        const max = spec.max ?? (spec.default > 0 ? spec.default * 4 : 1);
        input.min = String(min);
        input.max = String(max);
        input.step = String(spec.step ?? ((max - min) / 100 || 0.01));
        input.value = String(spec.default);
        input.addEventListener(
          "input",
          () => {
            valEl.textContent = input.value;
            set(Number(input.value));
          },
          { signal: scope.signal },
        );
        row.appendChild(input);
      } else if (spec.kind === "string" && spec.values?.length) {
        const select = document.createElement("select");
        for (const v of spec.values) {
          const opt = document.createElement("option");
          opt.value = v;
          opt.textContent = v;
          select.appendChild(opt);
        }
        select.value = spec.default;
        select.addEventListener("change", () => set(select.value), { signal: scope.signal });
        row.appendChild(select);
      } else if (spec.kind === "string") {
        const input = document.createElement("input");
        input.type = "text";
        input.value = spec.default;
        input.style.width = "100%";
        input.addEventListener("input", () => set(input.value), { signal: scope.signal });
        row.appendChild(input);
      } else if (spec.kind === "boolean") {
        label.remove();
        const check = document.createElement("label");
        check.className = "iso-check";
        const input = document.createElement("input");
        input.type = "checkbox";
        input.checked = spec.default;
        input.addEventListener("input", () => set(input.checked), { signal: scope.signal });
        check.append(input, document.createTextNode(` ${spec.label ?? name}`));
        row.appendChild(check);
      } else if (spec.kind === "color") {
        const input = document.createElement("input");
        input.type = "color";
        input.value = spec.default;
        input.addEventListener("input", () => set(input.value), { signal: scope.signal });
        row.appendChild(input);
      }
      paramsPanel.appendChild(row);
    }
  }

  function applyEffect(): void {
    if (effectLayer) {
      effectLayer.dispose();
      effectLayer = null;
    }
    cancelAnimationFrame(effectRaf);
    paramsPanel.replaceChildren();
    const def = GlyphEffectCatalog.find((d) => d.id === effectSel.value);
    if (!def) {
      syncControlVisibility();
      return;
    }
    const params: Record<string, unknown> = {};
    for (const [name, spec] of Object.entries(def.parameterSchema)) {
      if (name === "time") continue;
      params[name] = spec.default;
    }
    effectLayer = scene.addEffectLayer({
      effect: def,
      params,
      target: "surfaces",
      blend: blendSel.value as "over" | "replace",
    }) as GlyphEffectLayerHandle<Record<string, unknown>>;
    effectLayer.opacity = Number(ctl.opacity.value);
    buildParamPanel(def);
    if ("time" in def.parameterSchema) {
      effectTime = 0;
      effectPrev = performance.now();
      effectRaf = mountedTimer2 = requestAnimationFrame(tickEffect);
    }
    syncControlVisibility();
  }

  function loadFile(file: File): void {
    if (!file || !file.type.startsWith("image/")) return;
    const url = URL.createObjectURL(file);
    const im = new Image();
    im.onload = () => {
      aspect = im.naturalWidth / im.naturalHeight || 1;
      sourceImg = im;
      textureUrl = url;
      sampled = null;
      hint.style.display = "none";
      copyBtn.disabled = false;
      rebuildMesh();
    };
    im.src = url;
    statusEl.textContent = `loading ${file.name}…`;
  }

  // Controls
  ctl.density.addEventListener(
    "input",
    () => {
      applyDensity();
      scene.fit();
      fit();
      querySync.schedule();
    },
    { signal: scope.signal },
  );

  ctl.color.addEventListener(
    "input",
    () => {
      scene.setOptions({ useColors: ctl.color.checked });
      querySync.schedule();
    },
    { signal: scope.signal },
  );

  paletteSel.addEventListener(
    "change",
    () => {
      scene.setOptions({ glyphPalette: paletteSel.value });
      querySync.schedule();
    },
    { signal: scope.signal },
  );

  modeSel.addEventListener(
    "change",
    () => {
      syncControlVisibility();
      applyLighting();
      rebuildMesh();
      querySync.schedule();
    },
    { signal: scope.signal },
  );

  for (const [input, label] of [
    [ctl.groups, "groups"],
    [ctl.depth, "depth"],
    [ctl.res, "res"],
  ] as const) {
    input.addEventListener(
      "input",
      () => {
        showVal(label, input.value);
        rebuildMesh();
        querySync.schedule();
      },
      { signal: scope.signal },
    );
  }

  ctl.tex.addEventListener(
    "input",
    () => {
      rebuildMesh();
      querySync.schedule();
    },
    { signal: scope.signal },
  );

  ctl.shadow.addEventListener(
    "input",
    () => {
      applyLighting();
      querySync.schedule();
    },
    { signal: scope.signal },
  );

  ctl.light.addEventListener(
    "input",
    () => {
      showVal("light", ctl.light.value);
      applyLighting();
      querySync.schedule();
    },
    { signal: scope.signal },
  );

  effectSel.addEventListener(
    "change",
    () => {
      applyEffect();
      querySync.schedule();
    },
    { signal: scope.signal },
  );

  blendSel.addEventListener(
    "change",
    () => {
      effectLayer?.setOptions({ blend: blendSel.value as "over" | "replace" });
      querySync.schedule();
    },
    { signal: scope.signal },
  );

  ctl.opacity.addEventListener(
    "input",
    () => {
      showVal("opacity", ctl.opacity.value);
      if (effectLayer) effectLayer.opacity = Number(ctl.opacity.value);
      querySync.schedule();
    },
    { signal: scope.signal },
  );

  ctl.speed.addEventListener(
    "input",
    () => {
      showVal("speed", ctl.speed.value);
      querySync.schedule();
    },
    { signal: scope.signal },
  );

  // Restore URL-loaded state.
  showVal("groups", ctl.groups.value);

  showVal("depth", ctl.depth.value);

  showVal("res", ctl.res.value);

  showVal("light", ctl.light.value);

  showVal("opacity", ctl.opacity.value);

  showVal("speed", ctl.speed.value);

  applyLighting();

  if (effectSel.value) applyEffect();

  // Drop / click / paste
  fileInput.addEventListener(
    "change",
    () => {
      if (fileInput.files?.[0]) loadFile(fileInput.files[0]);
    },
    { signal: scope.signal },
  );

  stage.addEventListener(
    "click",
    (e) => {
      if (!meshHandle && (e.target === hint || (e.target as Element).closest(".drop-hint"))) fileInput.click();
    },
    { signal: scope.signal },
  );

  stage.addEventListener(
    "dragover",
    (e) => {
      e.preventDefault();
      stage.classList.add("dragover");
    },
    { signal: scope.signal },
  );

  stage.addEventListener("dragleave", () => stage.classList.remove("dragover"), { signal: scope.signal });

  stage.addEventListener(
    "drop",
    (e) => {
      e.preventDefault();
      stage.classList.remove("dragover");
      const f = e.dataTransfer?.files?.[0];
      if (f) loadFile(f);
    },
    { signal: scope.signal },
  );

  window.addEventListener(
    "paste",
    (e) => {
      const item = [...(e.clipboardData?.items ?? [])].find((it) => it.type.startsWith("image/"));
      const f = item?.getAsFile();
      if (f) loadFile(f);
    },
    { signal: scope.signal },
  );

  window.addEventListener(
    "resize",
    () => {
      if (meshHandle) mountedTimer3 = requestAnimationFrame(fit);
    },
    { signal: scope.signal },
  );

  // Copy both plain text and rich HTML (color survives a paste).
  // Under `colorEncoding: "atlas"` the `<pre>` is PUA code points naming
  // palette slots, so neither `textContent` nor `innerHTML` is copyable as
  // is: the text pastes as unreadable private-use characters and the markup
  // carries no per-cell colour at all. Both flavours are rebuilt from the
  // decoded cells instead — `glyphAtlasCellsFromPre` resolves each slot
  // through the scene's own `@font-palette-values` block, so the coloured
  // paste survives the atlas rather than degrading to plain text.
  copyBtn.addEventListener(
    "click",
    async () => {
      const pre = scene.output;
      const atlasRows = glyphAtlasCellsFromPre(pre);
      const text = extractAsciiFromPre(pre) ?? "";
      const cs = getComputedStyle(pre);
      const escapeHtml = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      const body = atlasRows
        ? atlasRows
            .map((row) => {
              let out = "";
              let runColor: string | undefined;
              let runText = "";
              const flush = () => {
                if (!runText) return;
                out += runColor ? `<span style="color:${runColor}">${escapeHtml(runText)}</span>` : escapeHtml(runText);
                runText = "";
              };
              for (const cell of row) {
                if (cell.color !== runColor) {
                  flush();
                  runColor = cell.color;
                }
                runText += cell.ch;
              }
              flush();
              return out;
            })
            .join("\n")
        : pre.innerHTML;
      const html =
        `<pre style="font-family:ui-monospace,'JetBrains Mono','SF Mono',Menlo,monospace;` +
        `white-space:pre;font-size:${cs.fontSize};line-height:${cs.lineHeight};background:#04060b;color:#e8edf2;margin:0;padding:10px">${body}</pre>`;
      const done = () => {
        copyBtn.textContent = "copied!";
        mountedTimer4 = setTimeout(() => (copyBtn.textContent = "copy"), 1200);
      };
      try {
        const CI = (globalThis as { ClipboardItem?: typeof ClipboardItem }).ClipboardItem;
        if (CI && navigator.clipboard?.write) {
          await navigator.clipboard.write([
            new CI({
              "text/plain": new Blob([text], { type: "text/plain" }),
              "text/html": new Blob([html], { type: "text/html" }),
            }),
          ]);
        } else {
          await navigator.clipboard.writeText(text);
        }
        done();
      } catch {
        try {
          await navigator.clipboard.writeText(text);
          done();
        } catch {
          /* blocked */
        }
      }
    },
    { signal: scope.signal },
  );

  return scope.dispose;
}

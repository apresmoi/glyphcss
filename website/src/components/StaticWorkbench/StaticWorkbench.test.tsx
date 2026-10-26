import path from "node:path";
import styles from "./StaticWorkbench.module.css";
import { readCss } from "../../test/styles";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { Window } from "happy-dom";
import { describe, expect, it } from "vitest";
import { StaticWorkbench, StaticWorkbenchIntro } from "./StaticWorkbench";
import { staticGallery, staticSynth, staticMap, staticWordArt, staticLoader } from "../../services/static-workbench/scenes";
import { staticCharts } from "../../features/charts/render/staticCharts";
import { staticDiagrams } from "../../features/diagrams/render/staticDiagrams";
import { LOADER_SIZES } from "../../features/loaders/model/loaders";
import type { StaticWorkbenchPage } from "./StaticPanels";

const pages = ["gallery", "synth", "maps", "wordart", "loaders", "charts", "diagrams"] as const;
const renderers = { gallery: staticGallery, synth: staticSynth, maps: staticMap, wordart: staticWordArt, loaders: staticLoader };
const railIds = { gallery: "gallery-models-panel", synth: "synth-voices-panel", maps: "maps-layers-panel", wordart: "wa-compose-panel", loaders: "loaders-voices-panel", charts: "charts-data-panel", diagrams: "diagrams-source-panel" };

function assertShell(document: Document, page: StaticWorkbenchPage) {
  const root = document.querySelector(`[data-static-workbench="${page}"]`)!;
  expect(root).not.toBeNull();
  expect(document.defaultView!.getComputedStyle(root).display).toBe("contents");
  expect(root.querySelector(".synth-shell .synth-body .synth-main")).not.toBeNull();
  expect(root.querySelector(`#${railIds[page]}`)).not.toBeNull();
  expect(root.querySelector(".dn-floating-controls .instrument-section-heading")).not.toBeNull();
  const stage = page === "loaders" ? ".ld-stage .ld-size__view" : ".synth-viewport";
  const pre = root.querySelector(`${stage} pre[data-static-render]`)!;
  expect(pre).not.toBeNull();
  expect(pre.textContent!.trim()).not.toBe("");
  expect(root.querySelector(`${stage} span[style*="color"]`)).not.toBeNull();
  expect(root.querySelector(".dn-floating-controls")!.innerHTML).not.toMatch(/undefined|NaN/);
  expect(root.querySelector(".dn-mobile-tabs")).not.toBeNull();
  expect(document.querySelector("h1")?.textContent).toBe("Workbench");
  expect(document.querySelector("h1")?.closest("[data-static-workbench]")).toBeNull();
}

describe("server workbench fallbacks", () => {
  it.each(pages)("%s emits the real shell with colored text inside its stage", async (page) => {
    const rich = page === "charts" ? staticCharts() : page === "diagrams" ? await staticDiagrams() : null;
    const initial = rich ? rich.initial : await renderers[page as keyof typeof renderers]();
    const tiles = page === "loaders" ? Object.fromEntries(LOADER_SIZES.map(({ cols, rows }) => [`${cols}x${rows}`, staticLoader(undefined, 0, cols, rows)])) : {};
    const window = new Window();
    try {
      const html = renderToStaticMarkup(<><StaticWorkbenchIntro heading="Workbench" description="The workbench description remains after hydration." /><StaticWorkbench page={page} heading="Workbench" description="Static examples" initial={initial} examples={rich?.examples} kind={page === "charts" ? "chart" : page === "diagrams" ? "diagram" : undefined} tiles={tiles} /></>);
      const style = window.document.createElement("style");
      style.textContent = readCss(path.resolve(__dirname, "StaticWorkbench.module.css"), styles);
      window.document.head.append(style);
      window.document.body.innerHTML = html;
      assertShell(window.document as unknown as Document, page);
      if (rich) {
        const gallery = window.document.querySelector("details")!;
        expect(gallery.querySelectorAll("section")).toHaveLength(18);
        expect(gallery.querySelectorAll("section > details pre code")).toHaveLength(17);
        expect(gallery.querySelector(`a[href="/${page}/overview/"]`)).not.toBeNull();
        expect(gallery.querySelector('a[href="/coding-agents/install/"]')).not.toBeNull();
        expect(gallery.textContent).not.toContain("git clone");
      }
      if (page === "loaders") {
        const renders = window.document.querySelectorAll(".ld-size__view pre[data-static-render]");
        expect(renders).toHaveLength(LOADER_SIZES.length);
        renders.forEach((pre, index) => {
          const size = LOADER_SIZES[index]!;
          expect(pre.textContent!.split("\n")).toHaveLength(size.rows);
          expect(pre.textContent!.split("\n").every((row) => row.length === size.cols)).toBe(true);
        });
      }
      // Real mutations: deleting either the shell or the seeded stage must fail the same contract.
      window.document.querySelectorAll("pre[data-static-render]").forEach((pre) => pre.remove());
      expect(() => assertShell(window.document as unknown as Document, page)).toThrow();
      window.document.body.innerHTML = html;
      window.document.querySelector(".synth-shell")!.remove();
      expect(() => assertShell(window.document as unknown as Document, page)).toThrow();
      const route = page === "loaders" ? "examples/loaders" : page;
      const source = readFileSync(new URL(`../../pages/${route}.astro`, import.meta.url), "utf8");
      expect(source).toMatch(new RegExp(`<StaticWorkbench\\s+page="${page}"`));
      expect(source).toContain('slot="fallback"');
      expect(source).toContain("<StaticWorkbenchIntro");
    } finally { window.happyDOM.abort(); }
  }, 60000);
});

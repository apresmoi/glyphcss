// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { GlyphMermaidExamples } from "./MermaidExamples";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const roots: ReturnType<typeof createRoot>[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await act(() => root.unmount()); document.body.innerHTML = ""; });

describe("Mermaid examples selector", () => {
  it.each(["charts", "diagrams"] as const)("offers every %s header and renders a selected source in the web preview", async owner => {
    const host = document.createElement("div"); document.body.append(host);
    const root = createRoot(host); roots.push(root);
    await act(() => root.render(<GlyphMermaidExamples owner={owner} />));
    const select = host.querySelector("select")!;
    expect(select.options.length).toBe(owner === "charts" ? 11 : 16);
    const details = host.querySelector("details")!;
    await act(async () => {
      const toggled = new Promise<void>(resolve => details.addEventListener("toggle", () => resolve(), { once: true }));
      details.open = true;
      await toggled;
    });
    await act(async () => { await import("../../features/mermaid/render/renderMermaidExample"); });
    await act(async () => {
      select.value = owner === "charts" ? "kanban" : "sequenceDiagram";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const source = host.querySelector("textarea")!;
    expect(source.value).toMatch(owner === "charts" ? /^kanban/ : /^sequenceDiagram/);
    await act(async () => {
      await expect.poll(() => host.querySelector("pre")?.textContent, { timeout: 5000 }).toContain(owner === "charts" ? "Todo" : "Hello");
    });
    expect(host.querySelector("pre")?.className).toContain("glyph-output");
  });
});

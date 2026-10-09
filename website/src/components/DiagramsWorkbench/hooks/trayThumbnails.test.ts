import { describe, expect, it, vi } from "vitest";
import { glyphDiagramsTrayThumbnails } from "./useDiagramsWorkbenchInner";
import { GLYPH_DIAGRAMS_TRAY } from "../../../features/diagrams/model/diagramsWorkbenchState";

vi.mock("@glyphcss/core", () => import("../../../../../packages/core/src/index"));

describe("glyphDiagramsTrayThumbnails", () => {
  // Rendering every preset costs seconds of layout search on CI runners; a
  // remount or a return to an earlier target must reuse the first render.
  it("renders the tray once per target", async () => {
    const web = glyphDiagramsTrayThumbnails("web");
    expect(glyphDiagramsTrayThumbnails("web")).toBe(web);
    const terminal = glyphDiagramsTrayThumbnails("terminal");
    expect(terminal).not.toBe(web);
    expect(glyphDiagramsTrayThumbnails("web")).toBe(web);
    const thumbnails = await web;
    expect(Object.keys(thumbnails)).toHaveLength(GLYPH_DIAGRAMS_TRAY.length);
    expect(Object.values(thumbnails)).not.toContain("Preview unavailable");
    await terminal;
  }, 30_000);
});

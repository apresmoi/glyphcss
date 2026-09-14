import { describe, expect, it } from "vitest";
import { createGlyphOrthographicCamera, createGlyphScene, type Vec3 } from "glyphcss";
import type { GlyphGraph } from "../types";
import { glyphDiagramObject } from "./glyphDiagramObject";
import {
  renderGlyphDiagram3d, renderGlyphDiagram3dJson, GLYPH_DIAGRAM_3D_LIGHT, GLYPH_DIAGRAM_3D_AMBIENT_LIGHT,
  type GlyphDiagram3dCharset, type GlyphDiagram3dColorMode, type GlyphDiagram3dTarget,
} from "./render3d";

/**
 * Packet D2 (PLAN-3d.md §11) acceptance gates for `renderGlyphDiagram3d`.
 * Each `it` names, in a comment, the mutation the PLAN requires it to
 * redden.
 */

const agentGraph: GlyphGraph = {
  direction: "TB",
  nodes: [
    { id: "orchestrator", label: "Orchestrator" },
    { id: "planner", label: "Planner" },
    { id: "coder", label: "Coder" },
    { id: "reviewer", label: "Reviewer" },
  ],
  edges: [
    { from: "orchestrator", to: "planner" },
    { from: "planner", to: "coder" },
    { from: "coder", to: "reviewer" },
    { from: "reviewer", to: "planner" },
  ],
};

// A larger, wider graph than `agentGraph` — a supervisor fanning out to five
// workers — so a camera zoom tuned for the 4-node graph provably does not
// also fit this one (the auto-fit mutation gate below).
const supervisorGraph: GlyphGraph = {
  direction: "TB",
  nodes: [
    { id: "supervisor", label: "Supervisor" },
    { id: "researcher", label: "Researcher" },
    { id: "writer", label: "Writer" },
    { id: "coder", label: "Coder" },
    { id: "reviewer", label: "Reviewer" },
    { id: "archivist", label: "Archivist" },
  ],
  edges: [
    { from: "supervisor", to: "researcher" },
    { from: "supervisor", to: "writer" },
    { from: "supervisor", to: "coder" },
    { from: "supervisor", to: "reviewer" },
    { from: "supervisor", to: "archivist" },
    { from: "researcher", to: "supervisor" },
    { from: "writer", to: "supervisor" },
    { from: "coder", to: "supervisor" },
    { from: "reviewer", to: "supervisor" },
    { from: "archivist", to: "supervisor" },
  ],
};

function foldedLabels(text: string): string {
  return text.toUpperCase();
}

function everyLabelVisible(text: string, graph: GlyphGraph): boolean {
  const folded = foldedLabels(text);
  return graph.nodes.every((n) => folded.includes(foldedLabels(String(n.label ?? n.id)).slice(0, 3)));
}

describe("renderGlyphDiagram3d", () => {
  it("renders a non-empty frame with every node label visible at the default camera (mutation: fixed zoom instead of auto-fit) → red", async () => {
    const small = await renderGlyphDiagram3d(agentGraph, { target: "web" });
    expect(small.text.replace(/\s/g, "").length).toBeGreaterThan(0);
    expect(everyLabelVisible(small.text, agentGraph)).toBe(true);

    // The SAME renderer, SAME output size, on a graph almost twice the
    // extent — a hard-coded zoom tuned to fit `agentGraph` cannot also fit
    // `supervisorGraph`'s wider fan-out, so this only passes when the
    // camera is genuinely refit to each object's own bounds.
    const big = await renderGlyphDiagram3d(supervisorGraph, { target: "web" });
    expect(everyLabelVisible(big.text, supervisorGraph)).toBe(true);
  });

  it("auto-fit still centers and fits at every target size", async () => {
    for (const target of ["chat", "terminal", "web"] as const) {
      const result = await renderGlyphDiagram3d(agentGraph, { target });
      expect(everyLabelVisible(result.text, agentGraph)).toBe(true);
    }
  });

  it("an explicit camera zoom is honoured verbatim (no auto-fit override)", async () => {
    const result = await renderGlyphDiagram3d(agentGraph, { target: "web", camera: { rotX: 55, rotY: 35, zoom: 12 } });
    expect(result.camera.zoom).toBe(12);
  });

  it("rejects mat and rotX/rotY together", async () => {
    await expect(renderGlyphDiagram3d(agentGraph, { camera: { mat: [1, 0, 0, 0, 1, 0, 0, 0, 1], rotX: 10 } })).rejects.toThrow(/bad-options/);
  });

  it("the static frame equals the live createGlyphScene frame for the same camera and object (mutation: skip overlay stamping in the static path) → red", async () => {
    // An EXPLICIT camera (auto-fit off) so both sides use the identical
    // rotX/rotY/zoom/target with nothing for either path to compute
    // independently — the honest form of "same camera" this gate asks for.
    const object = await glyphDiagramObject(agentGraph);
    const centroid: Vec3 = [
      (object.bounds.min[0] + object.bounds.max[0]) / 2,
      (object.bounds.min[1] + object.bounds.max[1]) / 2,
      (object.bounds.min[2] + object.bounds.max[2]) / 2,
    ];
    const rotX = 55, rotY = 35, zoom = 15;

    const result = await renderGlyphDiagram3d(agentGraph, { target: "web", color: "none", camera: { rotX, rotY, zoom } });

    const host = document.createElement("div");
    document.body.appendChild(host);
    const camera = createGlyphOrthographicCamera({ rotX, rotY, zoom });
    camera.target = centroid;
    const scene = createGlyphScene(host, {
      cols: 96, rows: 32, useColors: false, camera,
      directionalLight: GLYPH_DIAGRAM_3D_LIGHT, ambientLight: GLYPH_DIAGRAM_3D_AMBIENT_LIGHT,
    });
    scene.addObject(object);
    await Promise.resolve(); await Promise.resolve();
    const liveText = scene.output.textContent!;
    scene.destroy();

    expect(result.text).toBe(liveText);
  });

  it("every target × charset × colour cell renders or degrades with a reason; NO_COLOR is honoured", async () => {
    const targets: GlyphDiagram3dTarget[] = ["chat", "terminal", "web"];
    const charsets: GlyphDiagram3dCharset[] = ["ascii", "box", "blocks", "braille"];
    const colors: GlyphDiagram3dColorMode[] = ["none", "ansi16", "ansi256", "truecolor", "css"];
    for (const target of targets) {
      for (const charset of charsets) {
        for (const color of colors) {
          const result = await renderGlyphDiagram3d(agentGraph, { target, charset, color, env: color === "ansi16" || color === "ansi256" || color === "truecolor" ? { NO_COLOR: "1" } : undefined });
          expect(result.text.length).toBeGreaterThan(0);
          if (charset === "blocks" || charset === "braille") {
            expect(result.report.ledger.some((e) => e.code === "3d-charset-degraded")).toBe(true);
          }
          if (color === "ansi16" || color === "ansi256" || color === "truecolor") {
            // NO_COLOR: no SGR color-introducing escape reaches the output.
            expect(result.text).not.toMatch(/\x1b\[3[0-9;]*m/);
          }
        }
      }
    }
  });

  it("renderGlyphDiagram3dJson returns a structured error for malformed JSON", async () => {
    const raw = await renderGlyphDiagram3dJson("{not json", {});
    const parsed = JSON.parse(raw) as { error?: string; code?: string | null };
    expect(parsed.error).toBeTruthy();
    expect(parsed.code).toBeTruthy();
  });

  it("renderGlyphDiagram3dJson returns a text frame for valid JSON", async () => {
    const raw = await renderGlyphDiagram3dJson(JSON.stringify(agentGraph), { target: "chat" });
    const parsed = JSON.parse(raw) as { text?: string; camera?: unknown };
    expect(parsed.text).toBeTruthy();
    expect(parsed.camera).toBeTruthy();
  });
});

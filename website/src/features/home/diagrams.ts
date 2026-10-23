import type { GlyphGraph } from "@glyphcss/diagrams";
import type { GlyphDocsRenderInput } from "../../services/docs-render/glyphRender";

const liveRender: GlyphGraph = {
  direction: "LR",
  nodes: [
    { id: "mesh", label: "Mesh / geometry" },
    { id: "scene", label: "Scene + camera" },
    { id: "grid", label: "Rasterise polygons\ncols × rows grid" },
    { id: "encode", label: "Encode text\nor colour spans" },
    { id: "pre", label: "<pre>\none write / render" },
    { id: "anchors", label: "Project 3D anchors\nsame camera" },
    { id: "hotspots", label: "DOM hotspots\nposition + depth" },
  ],
  edges: [
    { from: "mesh", to: "scene" },
    { from: "scene", to: "grid" },
    { from: "grid", to: "encode" },
    { from: "encode", to: "pre" },
    { from: "scene", to: "anchors" },
    { from: "anchors", to: "hotspots" },
  ],
};

export const homeDiagrams = (
  [
    { layout: "wide", direction: "LR", width: 122, height: 20, labelWidth: 18 },
    { layout: "narrow", direction: "TB", width: 36, height: 44, labelWidth: 14 },
  ] as const
).map(({ layout, direction, width, height, labelWidth }) => ({
  layout,
  input: {
    kind: "diagram",
    source: { ...liveRender, direction },
    options: {
      target: "web",
      color: "css",
      charset: "box",
      width,
      height,
      labelWidth,
      autoDirection: false,
      detail: "faithful",
      overflow: "expand",
      ranksep: 4,
      nodesep: 3,
    },
  } satisfies GlyphDocsRenderInput,
}));

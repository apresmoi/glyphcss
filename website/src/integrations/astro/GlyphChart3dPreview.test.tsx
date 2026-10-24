// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it } from "vitest";
import { GlyphChart3dPreview, glyphChart3dFrameHtml } from "../../components/GlyphChart3dPreview";
import { cropGlyphDocsRows, resolveGlyphDocsChart3d, type GlyphDocsRenderInput } from "../../services/docs-render/glyphRender";
import { renderGlyphChart3d } from "@glyphcss/charts/3d";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const inputs = [...readFileSync("src/content/docs/charts/3d.mdx", "utf8").matchAll(/kind="chart-3d" source={(.*?)} options={(.*?)} \/>/g)].map(
  (match) =>
    ({ kind: "chart-3d", source: JSON.parse(match[1]!), options: JSON.parse(match[2]!) }) as Extract<
      GlyphDocsRenderInput,
      { kind: "chart-3d" }
    >,
);

let root: Root | undefined;
let container: HTMLDivElement;
afterEach(() => {
  if (root) act(() => root!.unmount());
  root = undefined;
  container?.remove();
});

function drag(target: Element, dx: number) {
  for (const [type, x] of [["pointerdown", 100], ["pointermove", 100 + dx], ["pointerup", 100 + dx]] as const) {
    target.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: 100, pointerId: 1, isPrimary: true, bubbles: true }));
  }
}

it("covers every 3D docs example", () => {
  expect(inputs.length).toBe(5);
});

it.each(inputs)("re-renders the $source.type frame at the dragged angle with the static size", async (input) => {
  const { mark, options, crop, result } = resolveGlyphDocsChart3d(input);
  const frame = (r: Parameters<typeof glyphChart3dFrameHtml>[0]) => cropGlyphDocsRows(glyphChart3dFrameHtml(r), crop);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root!.render(<GlyphChart3dPreview mark={mark} options={options} crop={crop} initialHtml={frame(result)} />));
  const pre = container.querySelector("pre.glyph-docs-output")!;
  expect(pre.innerHTML).toBe(frame(result));
  const surface = container.firstElementChild!;
  act(() => drag(surface, 60));
  await act(() => new Promise((resolve) => requestAnimationFrame(() => resolve(undefined))));
  const rotY = (result.resolved.camera.rotY ?? 0) + 30;
  const expected = renderGlyphChart3d(mark, {
    ...options,
    camera: { ...options.camera, rotX: result.resolved.camera.rotX ?? 0, rotY },
  });
  // The dragged frame keeps the build's zoom instead of refitting the angle.
  expect(expected.resolved.camera.zoom).toBe(result.resolved.camera.zoom);
  expect(pre.innerHTML).toBe(frame(expected));
  expect(pre.innerHTML).not.toBe(frame(result));
  // Same grid at every angle: the frame's footprint never changes while orbiting.
  expect(expected.text.split("\n").length).toBe(result.text.split("\n").length);
});

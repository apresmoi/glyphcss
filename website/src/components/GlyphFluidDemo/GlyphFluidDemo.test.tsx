// @vitest-environment happy-dom
import { readdirSync, readFileSync } from "node:fs";
import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { FLUID_READER_DEFAULTS } from "../../features/fluid/model/fluidWorkbench";
import type { GlyphFluidDemoProps } from "./GlyphFluidDemo";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const runtime = vi.hoisted(() => {
  const mounts: { kind: string; args: unknown[]; destroy: ReturnType<typeof vi.fn>; setWpm: ReturnType<typeof vi.fn> }[] = [];
  const make = (kind: string) =>
    vi.fn((...args: unknown[]) => {
      const mount = { kind, args, destroy: vi.fn(), setWpm: vi.fn(), setPlaying: vi.fn(), setText: vi.fn() };
      mounts.push(mount);
      return mount;
    });
  return { mounts, mountFluidField: make("field"), mountFluidReader: make("reader") };
});
vi.mock("../../features/fluid/services/fluidRuntime", () => runtime);

const { GlyphFluidDemo } = await import("./index");

let root: Root | undefined;
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
  runtime.mounts.length = 0;
  vi.clearAllMocks();
});
async function mount(props: GlyphFluidDemoProps) {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(<StrictMode><GlyphFluidDemo {...props} /></StrictMode>));
  await vi.waitFor(() => expect(runtime.mounts.some((m) => !m.destroy.mock.calls.length)).toBe(true), { timeout: 5000 });
  return host;
}
const live = () => runtime.mounts.filter((m) => !m.destroy.mock.calls.length);

it("fluid: condenses its heading out of one surviving field and destroys it on unmount", async () => {
  const host = await mount({ variant: "fluid" });
  expect(live()).toHaveLength(1);
  const [field] = live();
  expect(field!.kind).toBe("field");
  const heading = host.querySelector("figure p")!;
  expect(heading.textContent).toBe("glyphcss");
  expect(field!.args[1]).toBe(heading);
  await act(async () => root!.unmount());
  root = undefined;
  expect(live()).toHaveLength(0);
});

it("reader: mounts the round reader with its sentence and changes wpm in place", async () => {
  const host = await mount({ variant: "reader" });
  const [reader] = live();
  expect(reader!.kind).toBe("reader");
  expect(reader!.args[1]).toMatchObject({ text: FLUID_READER_DEFAULTS.text, wpm: 400, loop: true });
  expect(host.querySelector("figure")!.getAttribute("aria-label")).toBe(`Speed reader: ${FLUID_READER_DEFAULTS.text}`);
  await act(async () => (host.querySelector('[aria-label="Words per minute: 250 wpm"]') as HTMLElement).click());
  expect(reader!.setWpm).toHaveBeenCalledWith(250);
  expect(live()).toEqual([reader]);
});

// The literal tags from the real docs, so the examples readers see are the ones tested.
const docs = "src/content/docs/fluid";
const tags = readdirSync(docs)
  .filter((file) => file.endsWith(".mdx"))
  .flatMap((file) =>
    [...readFileSync(`${docs}/${file}`, "utf8").matchAll(/<GlyphFluidDemo\b[^\n]*\/>/g)].map(([tag]) => ({ file, tag })),
  );

it("is embedded in the fluid docs", () => {
  expect(tags.length).toBeGreaterThan(0);
});

it.each(tags)("renders $file: $tag", async ({ tag }) => {
  expect(tag).toContain("client:visible");
  const variant = /variant="(fluid|reader)"/.exec(tag)?.[1] as GlyphFluidDemoProps["variant"];
  expect(variant).toBeDefined();
  await mount({ variant });
  expect(live()[0]!.kind).toBe(variant === "reader" ? "reader" : "field");
});

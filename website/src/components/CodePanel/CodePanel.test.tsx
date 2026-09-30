// @vitest-environment happy-dom
import "../../test/dom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { CodePanel } from "./CodePanel";
(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement, root: Root;
beforeEach(() => { host=document.createElement("div"); document.body.append(host); root=createRoot(host); });
afterEach(() => { act(()=>root.unmount()); host.remove(); vi.restoreAllMocks(); });
const button=(label:string)=>[...host.querySelectorAll<HTMLButtonElement>("button")].find(b=>b.textContent===label)!;
it("disables unsupported formats and selects only an available format", () => {
  act(()=>root.render(<CodePanel snippets={{html:"html",vue:"vue"}} onClose={()=>{}} />));
  const select=host.querySelector("select")!;
  expect(select.querySelector<HTMLOptionElement>('[value="vanilla"]')!.disabled).toBe(true);
  expect(select.querySelector<HTMLOptionElement>('[value="react"]')!.title).toContain("not available");
  expect(select.value).toBe("html");
  act(()=>{select.value="vue";select.dispatchEvent(new Event("change",{bubbles:true}));});
  expect(host.querySelector("code")!.textContent).toBe("vue");
});
it("resets selection when capabilities change and never copies an unavailable format", async () => {
  const write=vi.spyOn(navigator.clipboard,"writeText").mockResolvedValue();
  act(()=>root.render(<CodePanel snippets={{react:"react"}} onClose={()=>{}} />));
  act(()=>root.render(<CodePanel snippets={{vanilla:"map"}} onClose={()=>{}} />));
  await act(async()=>button("Copy code").click()); expect(write).toHaveBeenLastCalledWith("map");
  act(()=>root.render(<CodePanel snippets={{}} unavailableReason="Fix the source" onClose={()=>{}} />));
  expect(button("Copy code").disabled).toBe(true);
  expect(host.querySelector("code")!.textContent).toBe("Fix the source");
});
it("reports clipboard failure and resets feedback when switching formats", async()=>{
  vi.spyOn(navigator.clipboard,"writeText").mockRejectedValue(new Error("denied"));
  act(()=>root.render(<CodePanel snippets={{react:"react",vue:"vue"}} onClose={()=>{}} />));
  await act(async()=>button("Copy code").click());expect(button("Copy failed")).toBeDefined();
  act(()=>{const select=host.querySelector("select")!;select.value="vue";select.dispatchEvent(new Event("change",{bubbles:true}));});expect(button("Copy code")).toBeDefined();
});
it("has all actions in the header, no footer, and closes through its owner",()=>{
  const close=vi.fn();
  act(()=>root.render(<CodePanel snippets={{react:"react"}} onClose={close} />));
  expect(host.querySelector("footer")).toBeNull();
  for(const action of host.querySelectorAll("button")) expect(action.closest("header")).not.toBeNull();
  act(()=>button("Close").click());expect(close).toHaveBeenCalledOnce();
  act(()=>window.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape"})));
  expect(close).toHaveBeenCalledTimes(2);
});

it.each([
  ["html", '<style>pre { color: red; }</style>\n<script>const value = "<&>";</script><pre title="glyph">Hello</pre>'],
  ["vanilla", 'const value = "</code><img src=x onerror=alert(1)>&";\nrender(value);'],
  ["react", 'export const App = () => <GlyphScene zoom={2} title="<&>" />;'],
  ["vue", '<script setup lang="ts">\nconst value: number = 2;\n</script>\n<template><GlyphScene :zoom="value" /></template>'],
  ["typescript", 'const value: number = 2;\n// <&>\nrender(value);'],
  ["json", '{"label":"<img src=x onerror=alert(1)>&", "count":2}'],
])("highlights %s without interpreting source as markup or changing copied code", async (format, snippet) => {
  const write = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
  act(() => root.render(<CodePanel snippets={{ [format]: snippet }} formats={[{ id: format, label: format }]} onClose={() => {}} />));
  const code = host.querySelector("code")!;
  expect(code.querySelectorAll('span[class^="hljs-"]').length).toBeGreaterThan(0);
  expect(code.querySelector("script, style, img, template")).toBeNull();
  expect(code.textContent).toBe(snippet);
  await act(async () => button("Copy code").click());
  expect(write).toHaveBeenLastCalledWith(snippet);
});

it("updates highlighting when the format or snippet changes and keeps unavailable messages plain", () => {
  const render = (react: string) => <CodePanel snippets={{ react, html: '<pre title="hello">Hello</pre>' }} onClose={() => {}} />;
  act(() => root.render(render('const value = "first";')));
  expect(host.querySelector(".hljs-string")!.textContent).toBe('"first"');
  act(() => root.render(render('const value = "second";')));
  expect(host.querySelector(".hljs-string")!.textContent).toBe('"second"');
  act(() => { const select = host.querySelector("select")!; select.value = "html"; select.dispatchEvent(new Event("change", { bubbles: true })); });
  expect(host.querySelector(".hljs-name")!.textContent).toBe("pre");
  act(() => root.render(<CodePanel snippets={{}} unavailableReason="Fix <source> first" onClose={() => {}} />));
  expect(host.querySelector("code")!.textContent).toBe("Fix <source> first");
  expect(host.querySelector("code")!.children).toHaveLength(0);
});

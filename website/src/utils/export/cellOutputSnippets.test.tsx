// @vitest-environment happy-dom
import "../../test/dom";
import * as React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import * as Vue from "vue";
import { compileScript, parse } from "vue/compiler-sfc";
import ts from "typescript";
import { expect, it, vi } from "vitest";
import { renderGlyphDiagram } from "@glyphcss/diagrams";
import { renderGlyphSequence } from "@glyphcss/diagrams/sequence";
import { renderGlyphLaneDag } from "@glyphcss/diagrams/lanes";
import { glyphChartPlot, renderGlyphChart } from "@glyphcss/charts";
import { cellOutputSnippets } from "./cellOutputSnippets";
(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true;
const cases = [
  { name:"graph", package:"@glyphcss/diagrams", api:{renderGlyphDiagram}, setup:'const source = "flowchart LR\\nA[Alpha] --> B[Beta]";', expression:'renderGlyphDiagram(source, {target:"web", width:80, height:24, color:"css"})' },
  { name:"sequence", package:"@glyphcss/diagrams/sequence", api:{renderGlyphSequence}, setup:'const source = "sequenceDiagram\\nparticipant A as Alpha\\nparticipant B as Beta\\nA->>B: Hello";', expression:'renderGlyphSequence(source, {target:"web", width:80, height:24, color:"css"})' },
  { name:"lanes", package:"@glyphcss/diagrams/lanes", api:{renderGlyphLaneDag}, setup:'const source = {nodes:[{id:"b",label:"Beta",parents:["a"]},{id:"a",label:"Alpha",parents:[]}]};', expression:'renderGlyphLaneDag(source, {target:"web", width:80, height:24, color:"css"})' },
  { name:"chart", package:"@glyphcss/charts", api:{glyphChartPlot,renderGlyphChart}, setup:'const spec={marks:[{type:"bar",data:[{x:"Alpha",y:3},{x:"Beta",y:5}],channels:{x:"x",y:"y"}}]};', expression:'renderGlyphChart(glyphChartPlot(spec), {target:"web", width:80, height:24, color:"css"})' },
];
function evaluate(source:string, api:Record<string,unknown>, packageName:string) {
  const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.React}}).outputText;
  const exports:Record<string,any>={};
  new Function("require","exports","React",js)((name:string)=>name===packageName?api:name==="react"?React:Vue,exports,React);
  return exports.default;
}
it.each(cases)("runs the $name HTML, React and Vue exports against the real renderer", async c=>{
  const snippets=cellOutputSnippets({imports:`import { ${Object.keys(c.api).join(", ")} } from "${c.package}";`,setup:c.setup,expression:c.expression,component:"GlyphExample"});
  const host=document.createElement("div"); document.body.append(host);
  try {
    host.innerHTML='<pre class="glyph-output"></pre>';
    const script=snippets.html.match(/<script type="module">\n([\s\S]*)\n<\/script>/)![1]!.replace(/^import[^\n]+\n/,"");
    const AsyncFunction=Object.getPrototypeOf(async()=>{}).constructor;
    await new AsyncFunction(...Object.keys(c.api),script)(...Object.values(c.api));
    const expected=host.textContent;
    expect(expected).toContain("Alpha");expect(expected).toContain("Beta");
    host.replaceChildren();
    const Component=evaluate(snippets.react,c.api,c.package);
    const root=createRoot(host);
    await act(async()=>root.render(<Component/>));
    await vi.waitFor(()=>expect(host.textContent).toBe(expected),{timeout:10000});
    act(()=>root.unmount());
    const {descriptor}=parse(snippets.vue);
    const compiled=compileScript(descriptor,{id:"export-test",inlineTemplate:true});
    const app=Vue.createApp(evaluate(compiled.content,c.api,c.package));
    app.mount(host);
    await vi.waitFor(()=>expect(host.textContent).toBe(expected),{timeout:10000});
    app.unmount();
  } finally {host.remove();}
});
it("escapes script terminators without changing the source data",async()=>{
  const input='</script><script>alert(1)</script>';
  const snippets=cellOutputSnippets({imports:'import { render } from "@glyphcss/diagrams";',setup:`const source=${JSON.stringify(input)};`,expression:'render(source)',component:"GlyphExample"});
  expect(snippets.html.match(/<\/script>/gi)).toHaveLength(1);
  const render=vi.fn(async(text:string)=>({text}));
  const host=document.createElement("pre");host.className="glyph-output";document.body.append(host);
  try {
    const script=snippets.html.match(/<script type="module">\n([\s\S]*)\n<\/script>/)![1]!.replace(/^import[^\n]+\n/,"");
    await new (Object.getPrototypeOf(async()=>{}).constructor)("render",script)(render);
    expect(render).toHaveBeenCalledWith(input);expect(host.textContent).toBe(input);expect(host.querySelector("script")).toBeNull();
  }finally{host.remove();}
});

it("keeps ANSI output browser-readable in each diagram form's generated HTML", async()=>{
  const { createGlyphDiagramsWorkbenchState, generateGlyphDiagramsWorkbenchSnippets } = await import("../../features/diagrams/model/diagramsWorkbenchState");
  const { encodeGlyphCanvasHtml, nearestAnsiCanvasColor } = await import("glyphcss");
  const api={renderGlyphDiagram,renderGlyphSequence,renderGlyphLaneDag,encodeGlyphCanvasHtml,nearestAnsiCanvasColor};
  for(const form of ["graph","sequence","lanes"] as const){
    const state=createGlyphDiagramsWorkbenchState();
    const snippets=generateGlyphDiagramsWorkbenchSnippets({...state,form,controls:{target:"terminal",overrides:{color:"ansi16",width:100,height:40}}});
    const host=document.createElement("pre");host.className="glyph-output";document.body.append(host);
    try {
      const script=snippets.html.match(/<script type="module">\n([\s\S]*)\n<\/script>/)![1]!.replace(/^import[^\n]+\n/gm,"");
      await new (Object.getPrototypeOf(async()=>{}).constructor)(...Object.keys(api),script)(...Object.values(api));
      expect(host.textContent!.trim().length).toBeGreaterThan(20);
      expect(host.textContent).not.toContain("\x1b[");
      expect(host.querySelector("span")).not.toBeNull();
      expect(snippets.html).toContain('from "https://esm.sh/glyphcss@latest"');
    }finally{host.remove();}
  }
});

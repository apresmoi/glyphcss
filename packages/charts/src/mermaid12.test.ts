import { expect, it } from "vitest";
import { renderGlyphChartMermaid } from "./mermaid";

it.each(["chat", "web"] as const)("closing br matches br everywhere the %s chart reader accepts breaks", target => {
  for (const source of [
    'pie\n"one<br>two": 3\n"other": 2',
    'timeline\n2026 : one<br>two',
    'packet-beta\n0-15: "one<br>two"',
    'kanban\n  Todo\n    a["one<br>two"]',
  ]) {
    const options = { target, width: 72, height: 24, color: "none" as const };
    const expected = renderGlyphChartMermaid(source, options);
    expect(expected.text).not.toContain("<br>");
    expect(renderGlyphChartMermaid(source.replace(/<br>/g, "</br>"), options).text).toBe(expected.text);
  }
});

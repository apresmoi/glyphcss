import hljs from "highlight.js/lib/core";
import css from "highlight.js/lib/languages/css";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";

const highlighter = hljs.newInstance();
highlighter.registerLanguage("css", css);
highlighter.registerLanguage("javascript", javascript);
highlighter.registerLanguage("json", json);
highlighter.registerLanguage("typescript", typescript);
highlighter.registerLanguage("xml", xml);

const LANGUAGES = new Map([
  ["html", "xml"],
  ["vanilla", "javascript"],
  ["react", "typescript"],
  ["vue", "xml"],
  ["typescript", "typescript"],
  ["json", "json"],
]);

export function highlightSnippet(snippet: string, format: string): string | undefined {
  const language = LANGUAGES.get(format);
  return language ? highlighter.highlight(snippet, { language, ignoreIllegals: true }).value : undefined;
}

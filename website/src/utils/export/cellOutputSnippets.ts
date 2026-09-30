interface CellOutputSnippetInput {
  imports: string;
  setup: string;
  expression: string;
  component: string;
  htmlExpression?: string;
}

/** Frameworks mount the 2D renderer's escaped HTML; plain targets use textContent. */
export function cellOutputSnippets({ imports, setup, expression, component, htmlExpression }: CellOutputSnippetInput) {
  const renderBody = htmlExpression
    ? `const output = await ${expression};\n  return { ...output, html: ${htmlExpression} };`
    : `return ${expression};`;
  const render = `async function renderOutput() {\n  ${renderBody}\n}`;
  const shared = `${imports}\n\n${setup}\n\n${render}`;
  const css = ".glyph-output { margin: 0; font: 12px/1 monospace; white-space: pre; }";
  const cdnImports = imports.replace(
    /from "(glyphcss|@glyphcss\/[^"/]+)([^\"]*)"/g,
    'from "https://esm.sh/$1@latest$2"',
  );
  const htmlScript = `${cdnImports}\n\n${setup}\n\n${render}\n\nconst output = await renderOutput();\nconst host = document.querySelector(".glyph-output");\nif (output.html !== undefined) host.innerHTML = output.html;\nelse host.textContent = output.text;`;
  return {
    html: `<!doctype html>\n<meta charset="utf-8">\n<title>${component}</title>\n<style>${css}</style>\n<pre class="glyph-output" aria-label="${component}"></pre>\n<script type="module">\n${htmlScript.replace(/<\/script/gi, "<\\/script")}\n</script>\n`,
    react: `import { useEffect, useState } from "react";\n${shared}\n\n// Add to your stylesheet: ${css}\nexport default function ${component}() {\n  const [output, setOutput] = useState(null);\n  const [error, setError] = useState("");\n  useEffect(() => {\n    let active = true;\n    renderOutput().then(result => { if (active) setOutput(result); })\n      .catch(error => { if (active) setError(String(error)); });\n    return () => { active = false; };\n  }, []);\n  if (error) return <p role="alert">{error}</p>;\n  if (output?.html !== undefined) return <pre className="glyph-output" aria-label="${component}" dangerouslySetInnerHTML={{ __html: output.html }} />;\n  return <pre className="glyph-output" aria-label="${component}">{output?.text ?? ""}</pre>;\n}\n`,
    vue: `<script setup>\nimport { onMounted, onBeforeUnmount, shallowRef, ref } from "vue";\n${shared.replace(/<\/script/gi, "<\\/script")}\n\nconst output = shallowRef(null);\nconst error = ref("");\nlet active = true;\nonMounted(async () => {\n  try {\n    const result = await renderOutput();\n    if (active) output.value = result;\n  } catch (cause) {\n    if (active) error.value = String(cause);\n  }\n});\nonBeforeUnmount(() => { active = false; });\n</script>\n\n<template>\n  <p v-if="error" role="alert">{{ error }}</p>\n  <pre v-else-if="output?.html !== undefined" class="glyph-output" aria-label="${component}" v-html="output.html"></pre>\n  <pre v-else class="glyph-output" aria-label="${component}">{{ output?.text ?? "" }}</pre>\n</template>\n\n<style scoped>\n${css}\n</style>\n`,
  };
}

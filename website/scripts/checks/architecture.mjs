import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import postcss from 'postcss';
import { parse } from '@astrojs/compiler';

const root = process.argv[2] ? path.resolve(process.argv[2]) : path.resolve(import.meta.dirname, '../../src');
const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)]);
const files = walk(root);
const errors = [];
const report = (file, message) => errors.push(`${path.relative(root, file)}: ${message}`);
const production = file => !/\.test\.|\/test\/|\/fixtures\//.test(file);
const resolve = (file, spec) => {
  if (!spec.startsWith('.')) return;
  const base = path.resolve(path.dirname(file), spec);
  return [base, ...['.ts', '.tsx', '/index.ts'].map(ext => base + ext)].find(file => fs.existsSync(file) && fs.statSync(file).isFile());
};
const owner = file => /^components\/([^/]+)/.exec(path.relative(root, file))?.[1];
const graph = new Map();
const primitives = new Set(['ActionButton', 'BracketSelect', 'ColorSwatch', 'ControlSection', 'EditableReadout', 'IconToggle', 'InstrumentWorkbench', 'RangeSlider', 'SliderRow']);

function checkImport(file, target) {
  const fromOwner = owner(file), toOwner = owner(target);
  const relative = path.relative(root, file);
  if (toOwner && toOwner !== fromOwner && path.basename(target) !== 'index.ts') report(file, `Import ${toOwner} through its public index.ts.`);
  if (toOwner && path.basename(target) !== 'index.ts') {
    let boundary = path.dirname(target);
    while (boundary !== path.join(root, 'components')) {
      if (fs.existsSync(path.join(boundary, 'index.ts')) && fs.existsSync(path.join(boundary, path.basename(boundary) + '.tsx'))) {
        if (!file.startsWith(boundary + path.sep)) report(file, `Import ${path.basename(boundary)} through its public index.ts.`);
        break;
      }
      boundary = path.dirname(boundary);
    }
  }
  if (toOwner && /^(features|utils|services|hooks)\//.test(relative)) report(file, 'Lower layers cannot depend on UI components.');
  if (primitives.has(fromOwner) && (path.relative(root, target).startsWith('features/') || toOwner?.endsWith('Workbench') && toOwner !== 'InstrumentWorkbench')) report(file, 'Shared controls cannot depend on feature implementations.');
}

if (fs.existsSync(path.join(root, 'lib'))) report(root, 'Use hooks, utils, services or a feature owner instead of lib.');
for (const dir of fs.readdirSync(path.join(root, 'components'))) {
  const folder = path.join(root, 'components', dir);
  if (!fs.statSync(folder).isDirectory()) { report(folder, 'Components belong in a named folder.'); continue; }
  for (const filename of [`${dir}.tsx`, 'index.ts']) if (!fs.existsSync(path.join(folder, filename))) report(folder, `Missing ${filename}.`);
}
for (const file of files.filter(production)) {
  const relative = path.relative(root, file);
  if (file.endsWith('.astro')) {
    if (owner(file)) report(file, 'Reusable UI belongs in TSX; Astro adapters belong in integrations.');
    const { ast } = await parse(fs.readFileSync(file, 'utf8'));
    const visit = node => {
      if (node.type === 'frontmatter') {
        const source = ts.createSourceFile(file + '.ts', node.value, ts.ScriptTarget.Latest, true);
        for (const statement of source.statements) if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
          const target = resolve(file, statement.moduleSpecifier.text);
          if (target) checkImport(file, target);
        }
      }
      if (node.type === 'element' && node.name === 'style') report(file, 'Page styles belong to a component CSS Module.');
      if (node.type === 'element' && node.name === 'script' && relative.startsWith('pages/') && !node.attributes?.some(a => a.name === 'type' && a.value === 'application/ld+json')) report(file, 'Page runtime belongs in a mounted component.');
      node.children?.forEach(visit);
    };
    visit(ast);
  }
  if (/\.tsx?$/.test(file)) {
    const sf = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const edges = [];
    for (const node of sf.statements) {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        const target = resolve(file, node.moduleSpecifier.text);
        if (!target) continue;
        checkImport(file, target);
        const typesOnly = ts.isExportDeclaration(node) ? node.isTypeOnly : node.importClause?.isTypeOnly || (node.importClause?.namedBindings && ts.isNamedImports(node.importClause.namedBindings) && !node.importClause.name && node.importClause.namedBindings.elements.every(spec => spec.isTypeOnly));
        if (!typesOnly && /\.tsx?$/.test(target)) edges.push(target);
      }
      if (owner(file) && path.basename(file) === 'index.ts' && (!ts.isExportDeclaration(node) || !node.exportClause || !ts.isNamedExports(node.exportClause))) report(file, 'Public barrels contain explicit exports only.');
    }
    graph.set(file, edges);
    const visit = node => {
      if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && node.tagName.getText(sf) === 'select' && !['components/BracketSelect/BracketSelect.tsx', 'components/DiagramsWorkbench/DiagramsSourceEditor/DiagramsSourceEditor.tsx'].includes(relative)) report(file, 'Use BracketSelect for visible dropdowns. The diagram editor owns its invisible text-overlay selects.');
      if (ts.isJsxAttribute(node) && node.name.text === 'style' && node.initializer && ts.isJsxExpression(node.initializer) && node.initializer.expression && ts.isObjectLiteralExpression(node.initializer.expression)) {
        for (const prop of node.initializer.expression.properties) if (ts.isPropertyAssignment(prop) && (ts.isStringLiteral(prop.initializer) || ts.isNumericLiteral(prop.initializer))) report(file, `Static inline ${prop.name.getText(sf)} belongs in CSS (${sf.getLineAndCharacterOfPosition(prop.pos).line + 1}).`);
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  if (file.endsWith('.css') && !file.endsWith('/tokens.css')) {
    const css = postcss.parse(fs.readFileSync(file, 'utf8'));
    if (owner(file) && !file.endsWith('.module.css')) report(file, 'Component styles must be CSS Modules.');
    css.walkDecls(decl => {
      if (/#(?:[\da-f]{3,8})\b|rgba?\(\s*\d/i.test(decl.value)) report(file, `Use a color token for ${decl.prop} (line ${decl.source.start.line}).`);
      if ((decl.prop === 'font-family' || decl.prop === 'font') && /monospace|sans-serif|serif/.test(decl.value)) report(file, `Use a font token (line ${decl.source.start.line}).`);
    });
  }
}
const visited = new Set(), active = new Set(), stack = [];
function cycles(file) {
  if (active.has(file)) { report(file, `Runtime import cycle: ${stack.slice(stack.indexOf(file)).map(f => path.relative(root, f)).join(' → ')}`); return; }
  if (visited.has(file)) return;
  visited.add(file); active.add(file); stack.push(file);
  graph.get(file)?.forEach(cycles);
  stack.pop(); active.delete(file);
}
for (const file of graph.keys()) cycles(file);
if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; }
else console.log(`Website architecture and style checks passed (${files.filter(production).length} files).`);

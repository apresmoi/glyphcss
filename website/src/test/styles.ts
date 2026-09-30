import { readFileSync } from 'node:fs';
import path from 'node:path';
import postcss from 'postcss';

const tokens = postcss.parse(readFileSync(path.resolve(__dirname, '../styles/tokens.css'), 'utf8'));
const values = new Map<string, string>();
tokens.walkDecls((decl) => { if (decl.prop.startsWith('--gc-')) values.set(decl.prop, decl.value); });

/** Inspect declarations independently of the generated CSS Module class name.
 * Fragment tests attach the owner's root themselves; live browser checks cover
 * the compiled scope. Global selectors and their specificity stay intact. */
export function readCss(file: string, classes: Record<string, string> = {}): string {
  let css = readFileSync(file, 'utf8')
    .replace(/:global\([^)]*\)|:local\(\.root\)|\.root\b/g, match => match.startsWith(':global') || !classes.root ? match : '.' + classes.root)
    .replace(/:global\(([^()]*)\)/g, '$1')
    .replace(/:local\(\.root\)/g, '.root');
  for (let pass = 0; pass < 3; pass++) {
    css = css.replace(/var\((--gc-[\w-]+)\)/g, (match, token) => values.get(token) ?? match);
  }
  const sheet = postcss.parse(css);
  sheet.walkRules(rule => { rule.selector = rule.selector.replace(/\s+/g, " "); });
  return sheet.toString();
}

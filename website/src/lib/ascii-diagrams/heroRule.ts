import { Rule } from "../ascii-layout";
import type { Renderable } from "../ascii-layout";

// Full-width "═" divider that fills its container — replaces a hardcoded
// 65-char string in the hero overlay that didn't reflow on narrow viewports.
export function heroRule(): Renderable {
  return Rule({ char: "═" });
}

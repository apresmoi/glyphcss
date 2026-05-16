export function getInlineStyleDeclaration(styleAttr: string, property: string): string | null {
  const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = styleAttr.match(new RegExp(`(?:^|;)\\s*${escaped}\\s*:\\s*([^;]*)`, "i"));
  return match?.[1]?.trim() ?? null;
}

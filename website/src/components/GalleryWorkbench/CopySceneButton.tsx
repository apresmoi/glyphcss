import { useCallback, useState } from "react";
import { ActionButton } from "../ActionButton";
import { parseStripCells, renderHtmlAndText } from "./controllerHelpers";

/**
 * Floating "Copy" button overlaid on the viewport. Grabs the rendered ASCII
 * (trimmed to the mesh bounding box) and writes both plain text and HTML to
 * the clipboard so color is preserved in rich-text editors.
 */
export function CopySceneButton() {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    const strip = document.querySelector(".glyph-output") as HTMLElement | null;
    if (!strip) return;
    const parsed = parseStripCells(strip);
    if (!parsed) return;
    const { text, html } = renderHtmlAndText(parsed);
    try {
      const ClipboardItemCtor = (globalThis as { ClipboardItem?: typeof ClipboardItem }).ClipboardItem;
      if (ClipboardItemCtor && navigator.clipboard?.write) {
        const item = new ClipboardItemCtor({
          "text/plain": new Blob([text], { type: "text/plain" }),
          "text/html": new Blob([html], { type: "text/html" }),
        });
        await navigator.clipboard.write([item]);
      } else {
        await navigator.clipboard.writeText(text);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      try {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      } catch {
        // No-op.
      }
    }
  }, []);

  return (
    <ActionButton
      type="button"
      className="gw-code-panel__action"
      onClick={handleCopy}
      title="Copy rendered ASCII to clipboard"
    >
      {copied ? "Copied" : "Copy ASCII"}
    </ActionButton>
  );
}

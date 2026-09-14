import { useEffect, useRef } from "react";
import type { GUI } from "lil-gui";

/**
 * Folder-title-bar reset: "OUTPUT ═══════ [reset]" lives on the folder's OWN
 * native title line — its "═══" rule is the same `.title::after`
 * pseudo-element every nested Dock folder already draws
 * (`gallery-workbench.css`) — rather than a separate row inside the folder
 * body. lil-gui's `.title` is a native `<button>`, so the `[reset]` control
 * is mounted as a plain DOM SIBLING inserted directly into the folder's own
 * root element (`folder.domElement`), right after `.title` and before
 * `folder.$children` (REVIEW-dock-addenda-opus.md P3-1 — appending it after
 * `.children` instead put it 19 tab stops past the title, behind every row
 * in the folder). `.dock-folder-title-reset` (`instrument-workbench.css`)
 * gives that element `position: relative` and reserves room in `.title`'s
 * own padding for the overlaid button. The button paints on top of the
 * (non-positioned) title row by ordinary CSS stacking order, so only its
 * own small rect intercepts a click — the rest of the row still toggles the
 * folder open/closed; `stopPropagation` on its own click is a defensive
 * belt-and-braces (it's a SIBLING of `.title`, never a descendant, so a
 * click on it was never going to reach `.title`'s own listener regardless).
 *
 * Shared by `/charts` (Output AND Chart folders, `ChartsDock.tsx`) and
 * `/diagrams` (Output folder, `DiagramsDock.tsx`) — REVIEW-dock-addenda-
 * opus.md P3-5: the two pages used to carry two different reset idioms in
 * the same shared instrument shell (this one, and a `useDockSlot({
 * position: "top" })` header row). One idiom now, one place it lives.
 */
export function useFolderTitleReset(folder: GUI | null, title: string, onReset: () => void): void {
  const onResetRef = useRef(onReset);
  onResetRef.current = onReset;
  useEffect(() => {
    if (!folder) return;
    folder.domElement.classList.add("dock-folder-title-reset");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "dock-folder-title-reset-button";
    button.textContent = "reset";
    button.title = title;
    const onClick = (e: MouseEvent) => { e.stopPropagation(); onResetRef.current(); };
    button.addEventListener("click", onClick);
    folder.domElement.insertBefore(button, folder.$children);
    return () => {
      button.removeEventListener("click", onClick);
      button.remove();
      folder.domElement.classList.remove("dock-folder-title-reset");
    };
  }, [folder, title]);
}

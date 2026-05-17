/**
 * Scene folder for the Dock: builder-only outliner.
 *
 * Hosts two pieces of UI inside a real lil-gui "Scene" folder:
 *   1. A React portal mount point at the TOP of the folder body — the builder
 *      uses it for its placed-items list and gizmo button set.
 *   2. A lil-gui "Scale" slider BELOW the portal div, bound to the selected
 *      item's scale. The slider is dimmed when nothing is selected.
 *
 * The portal target is held in React state; the returned ReactNode is a
 * `createPortal(content, portalEl)` the caller must render somewhere in its
 * tree so React drives the children inside the lil-gui DOM.
 */
import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { GUI } from "lil-gui";

import { useFolder, useSlider } from "../primitives";

export interface SceneFolderInputs {
  /** React content rendered into a portal inside the Scene folder body
   *  (above the Scale slider). The builder uses this for its items list +
   *  gizmo button set. */
  content: ReactNode;
  /** ID of the currently selected placed item. `null` disables the Scale
   *  slider. */
  selectedId: string | null;
  /** Current scale of the selected item — drives the lil-gui slider. */
  selectedScale: number;
  /** Fires when the user drags the slider. */
  onScaleChange: (next: number) => void;
}

/** Returns a JSX element you must include in the render output. Internally
 *  it's a `createPortal(content, portalEl)` — the hook owns the portal
 *  target and renders the React content into the lil-gui folder body. */
export function useSceneFolder(parent: GUI | null, inputs: SceneFolderInputs): ReactNode {
  const folder = useFolder(parent, "Scene");
  const [portalEl, setPortalEl] = useState<HTMLElement | null>(null);

  // Insert the portal host into the folder body BEFORE the Scale slider so
  // it ends up above the slider in DOM order. The slider is added via
  // `useSlider` AFTER this effect (well, after this hook returns its
  // folder) — but since `useSlider` runs in the same render pass and only
  // appends on mount, ordering is guaranteed by call order in the
  // setup effect: `useFolder` resolves first, this effect runs first
  // (it depends only on `folder`), then `useSlider`'s mount effect
  // appends the slider underneath.
  useEffect(() => {
    if (!folder) return;
    const children = (folder as unknown as { $children: HTMLElement }).$children;
    const div = children.ownerDocument.createElement("div");
    div.className = "dn-scene-folder-content";
    children.appendChild(div);
    setPortalEl(div);
    return () => {
      div.remove();
      setPortalEl(null);
    };
  }, [folder]);

  const slider = useSlider(
    folder,
    "Scale",
    { min: 0.1, max: 5, step: 0.05 },
    inputs.selectedScale,
    inputs.onScaleChange,
  );

  // Dim the slider when nothing is selected — drag has no target.
  useEffect(() => {
    if (slider) slider.setEnabled(inputs.selectedId != null, { dim: true });
  }, [slider, inputs.selectedId]);

  return portalEl ? createPortal(inputs.content, portalEl) : null;
}

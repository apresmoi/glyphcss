import { useRef, type ReactNode } from "react";
import { useGui } from "./primitives";
import { DockGuiContext } from "./slots";

export interface DockProps {
  children?: ReactNode;
  loading?: boolean;
  loadError?: string | null;
}

/**
 * Container that owns the lil-gui instance and exposes it to `Dock*` slot
 * children via context. Pages compose the dock by listing the slots they
 * want — GalleryWorkbench uses Model/Rendering/Animation/Camera/Lighting.
 *
 * `loading` and `loadError` render status notes below the GUI for model
 * loading feedback; this is Dock-level chrome rather than per-folder state.
 */
export function Dock({ children, loading, loadError }: DockProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const gui = useGui(hostRef, { closeFolders: true });
  return (
    <div className="dn-floating-controls">
      <div ref={hostRef} />
      <DockGuiContext.Provider value={gui}>
        {children}
      </DockGuiContext.Provider>
      {loading && <p className="dn-note">Loading model...</p>}
      {loadError && <p className="dn-note dn-note--error">{loadError}</p>}
    </div>
  );
}

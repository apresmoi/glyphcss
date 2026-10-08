import { useLayoutEffect, useRef, type ReactNode } from "react";
import { useElementSize } from "../../hooks/useElementSize";
import styles from "./InstrumentExportBar.module.css";

/** The render owns its actions; preset trays never contain export controls. */
export function InstrumentExportBar({ children }: { readonly children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const size = useElementSize(ref);
  useLayoutEffect(() => {
    const shell = ref.current?.closest<HTMLElement>(".synth-shell");
    if (!shell || !size) return;
    shell.style.setProperty("--instrument-export-height", `${size.height}px`);
    return () => {
      shell.style.removeProperty("--instrument-export-height");
    };
  }, [size]);
  return (
    <div ref={ref} className={`${styles.root} synth-export-bar`} role="group" aria-label="Render actions">
      {children}
    </div>
  );
}

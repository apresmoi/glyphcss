import type { ReactNode } from "react";
import { ControlSection } from "../../ControlSection";

export function LayerCard({
  label,
  visible,
  onVisible,
  children,
}: {
  label: string;
  visible: boolean;
  onVisible: (v: boolean) => void;
  children: ReactNode;
}) {
  // Disclosure IS the enable checkbox — an enabled layer always shows its
  // controls and cannot be collapsed away from them, and a disabled layer has
  // nothing worth tuning. That removes the separate caret button entirely
  // rather than keeping two controls whose states could disagree.
  return (
    <ControlSection className="layer-group maps-layer-card">
      <div className="layer-group-head maps-layer-head">
        <label className="layer-group-check maps-layer-check" title={`${label} — show or hide this layer`}>
          <input type="checkbox" checked={visible} onChange={(e) => onVisible(e.target.checked)} />
          <span>{label}</span>
        </label>
      </div>
      {visible && <div className="layer-group-body maps-layer-body">{children}</div>}
    </ControlSection>
  );
}

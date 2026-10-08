import { useId, useState, type ReactNode } from "react";
import { ControlSection } from "./ControlSection";

export function CollapsibleSection({
  title,
  label,
  actions,
  children,
  className = "",
  defaultOpen = true,
  open: controlledOpen,
  onOpenChange,
  count,
  sticky = false,
}: {
  title: ReactNode;
  label: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  count?: number;
  sticky?: boolean;
}) {
  const [localOpen, setLocalOpen] = useState(defaultOpen);
  const open = controlledOpen ?? localOpen;
  const id = useId();
  return (
    <ControlSection className={`layer-group${sticky ? " layer-group--sticky" : ""} ${className}`}>
      <div className="layer-group-head">
        <button
          type="button"
          className="layer-group-toggle"
          aria-label={`${open ? "Collapse" : "Expand"} ${label}`}
          aria-expanded={open}
          aria-controls={id}
          onClick={() => {
            if (controlledOpen === undefined) setLocalOpen(!open);
            onOpenChange?.(!open);
          }}
        >
          <span className="layer-group-caret" aria-hidden="true">
            {open ? "▾" : "▸"}
          </span>
          <span className="layer-group-title">{title}</span>
          {count !== undefined && <span className="layer-group-count">{count}</span>}
        </button>
        {actions}
      </div>
      {open && (
        <div className="layer-group-body" id={id}>
          {children}
        </div>
      )}
    </ControlSection>
  );
}

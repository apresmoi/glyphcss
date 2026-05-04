import { useState } from "react";
import { createPortal } from "react-dom";
import type { ReactNode } from "react";
import { useDebug } from "./DebugLayout";

interface DebugSectionProps {
  title: string;
  defaultCollapsed?: boolean;
  /** When false, the header is just a label — no caret, no toggle. */
  collapsible?: boolean;
  /**
   * Where this section docks. Convention: left rail = navigation, right rail
   * = page configuration. Default is "right" so per-page controls land where
   * they belong without each page having to opt in.
   *
   *   - "right" (default): right sidebar — for page config / scene controls
   *   - "left":            below the page nav in the left sidebar
   *   - "bottom":          pinned to the foot of the left sidebar (legacy)
   */
  dock?: "right" | "left" | "bottom";
  children: ReactNode;
}

/**
 * Portals its children into one of the debug sidebars. Multiple sections
 * sharing a dock stack in render-tree order.
 */
export function DebugSection({
  title,
  defaultCollapsed = false,
  collapsible = true,
  dock = "right",
  children,
}: DebugSectionProps) {
  const { sectionsHost, bottomHost, rightHost } = useDebug();
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const host = dock === "bottom" ? bottomHost : dock === "left" ? sectionsHost : rightHost;
  if (!host) return null;
  const isCollapsed = collapsible && collapsed;
  return createPortal(
    <div className="debug-section">
      <div
        className="debug-section-header"
        onClick={collapsible ? () => setCollapsed((c) => !c) : undefined}
        style={collapsible ? undefined : { cursor: "default" }}
      >
        <span>{title}</span>
        {collapsible && <span style={{ opacity: 0.6 }}>{isCollapsed ? "▸" : "▾"}</span>}
      </div>
      {!isCollapsed && <div className="debug-section-body">{children}</div>}
    </div>,
    host
  );
}

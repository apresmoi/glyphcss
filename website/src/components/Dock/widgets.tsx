import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

type SetWidget = (host: HTMLElement, content: ReactNode | null) => void;
export const DockWidgetsContext = createContext<SetWidget | null>(null);

export function useDockWidgets() {
  const [widgets, setWidgets] = useState(new Map<HTMLElement, ReactNode>());
  const setWidget = useCallback<SetWidget>((host, content) => {
    setWidgets((previous) => {
      const next = new Map(previous);
      if (content === null) next.delete(host);
      else next.set(host, content);
      return next;
    });
  }, []);
  return { setWidget, portals: [...widgets].map(([host, content]) => createPortal(content, host)) };
}

export function useDockWidget(): SetWidget {
  const setWidget = useContext(DockWidgetsContext);
  if (!setWidget) throw new Error("Dock controls must be rendered inside Dock");
  return setWidget;
}

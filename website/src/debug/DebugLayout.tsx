import { createContext, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import "../styles/debug.css";

export interface DebugRoute {
  path: string;
  label: string;
}

export const DEBUG_ROUTES: DebugRoute[] = [
  { path: "/debug/sphere", label: "Sphere" },
  { path: "/debug/platonic", label: "Platonic solids" },
  { path: "/debug/spans", label: "Spans" },
  { path: "/debug/triangle-editor", label: "Triangle editor" },
  { path: "/debug/obj", label: "OBJ models" },
];

interface DebugContextValue {
  sectionsHost: HTMLDivElement | null;
  bottomHost: HTMLDivElement | null;
  rightHost: HTMLDivElement | null;
  statsHost: HTMLDivElement | null;
  voxSceneRef: React.RefObject<HTMLDivElement | null>;
}

const DebugContext = createContext<DebugContextValue | null>(null);

export function useDebug(): DebugContextValue {
  const ctx = useContext(DebugContext);
  if (!ctx) throw new Error("useDebug must be used inside <DebugLayout>");
  return ctx;
}

interface DebugLayoutProps {
  current: string; // path of current page, e.g. "/debug/sphere"
  children: ReactNode;
}

export function DebugLayout({ current, children }: DebugLayoutProps) {
  const [sectionsHost, setSectionsHost] = useState<HTMLDivElement | null>(null);
  const [bottomHost, setBottomHost] = useState<HTMLDivElement | null>(null);
  const [rightHost, setRightHost] = useState<HTMLDivElement | null>(null);
  const [statsHost, setStatsHost] = useState<HTMLDivElement | null>(null);
  const voxSceneRef = useRef<HTMLDivElement | null>(null);

  return (
    <DebugContext.Provider value={{ sectionsHost, bottomHost, rightHost, statsHost, voxSceneRef }}>
      <div className="debug-root">
        <aside className="debug-sidebar">
          <a href="/" className="debug-logo" title="Back to voxcss home">
            <img src="/voxisologo.png" alt="VoxCSS" />
          </a>
          <nav className="debug-nav">
            <a href="/debug" className={current === "/debug" ? "active" : undefined}>
              Index
            </a>
            {DEBUG_ROUTES.map((r) => (
              <a key={r.path} href={r.path} className={r.path === current ? "active" : undefined}>
                {r.label}
              </a>
            ))}
          </nav>
          <div className="debug-sections" ref={setSectionsHost} />
          <div className="debug-bottom" ref={setBottomHost} />
        </aside>
        <main className="debug-main">
          <div className="debug-statsbar" ref={setStatsHost} />
          <div className="debug-viewport">{children}</div>
        </main>
        <aside className="debug-right-sidebar" ref={setRightHost} />
      </div>
    </DebugContext.Provider>
  );
}

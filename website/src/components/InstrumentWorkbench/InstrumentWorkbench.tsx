import React, { type ReactNode, type Ref } from "react";
import "./instrument-workbench.css";

function classes(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(" ");
}

export function InstrumentShell({ kind, children }: { readonly kind: "synth" | "generative"; readonly children: ReactNode }) {
  return <div className={classes("synth-shell", "dn-root", `dn-root--${kind}`)}>{children}</div>;
}

export function InstrumentBody({ children }: { readonly children: ReactNode }) {
  return <div className="synth-body">{children}</div>;
}

export function InstrumentRail({
  id,
  title,
  action,
  open,
  children,
}: {
  readonly id: string;
  readonly title: ReactNode;
  readonly action?: ReactNode;
  readonly open?: boolean;
  readonly children: ReactNode;
}) {
  return <aside id={id} className={classes("synth-voices", open && "is-mobile-open")}>
    <div className="synth-voices-head"><span>{title}</span>{action}</div>
    <div className="synth-voices-list">{children}</div>
  </aside>;
}

export function InstrumentMain({ children }: { readonly children: ReactNode }) {
  return <main className="synth-main">{children}</main>;
}

export function InstrumentViewport({ children, className, elementRef }: { readonly children?: ReactNode; readonly className?: string; readonly elementRef?: Ref<HTMLDivElement> }) {
  return <div className={classes("synth-viewport", className)} ref={elementRef}>{children}</div>;
}

export function InstrumentTray({
  id,
  label,
  open,
  children,
}: {
  readonly id: string;
  readonly label: string;
  readonly open?: boolean;
  readonly children: ReactNode;
}) {
  return <div id={id} className={classes("synth-presets", open && "is-mobile-open")} role="list" aria-label={label}>{children}</div>;
}

export interface InstrumentMobileTab {
  readonly id: string;
  readonly label: string;
  readonly controls: string;
  readonly expanded: boolean;
  readonly onClick: () => void;
}

export function InstrumentMobileTabs({ label, items }: { readonly label: string; readonly items: readonly InstrumentMobileTab[] }) {
  return <nav className="dn-mobile-tabs" aria-label={label}>
    {items.map((item) => <button
      type="button"
      className={classes("dn-mobile-tabs__button", item.expanded && "is-active")}
      aria-controls={item.controls}
      aria-expanded={item.expanded}
      onClick={item.onClick}
      key={item.id}
    >{item.label}</button>)}
  </nav>;
}

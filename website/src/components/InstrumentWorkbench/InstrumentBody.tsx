import { type ReactNode } from "react";

export function InstrumentBody({ children }: { readonly children: ReactNode }) {
  return <div className="synth-body">{children}</div>;
}

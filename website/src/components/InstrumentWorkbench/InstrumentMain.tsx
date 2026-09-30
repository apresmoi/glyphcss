import { type ReactNode, type Ref } from "react";

export function InstrumentMain({
  children,
  elementRef,
}: {
  readonly children: ReactNode;
  readonly elementRef?: Ref<HTMLElement>;
}) {
  return (
    <main className="synth-main" ref={elementRef}>
      {children}
    </main>
  );
}

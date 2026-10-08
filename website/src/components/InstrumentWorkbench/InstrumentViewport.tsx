import { type ReactNode, type Ref } from "react";
import { classes } from "../../utils/classes/classes";
import styles from "./InstrumentViewport.module.css";

export function InstrumentViewport({
  children,
  className,
  elementRef,
  inset = false,
}: {
  readonly children?: ReactNode;
  readonly className?: string;
  readonly elementRef?: Ref<HTMLDivElement>;
  readonly inset?: boolean;
}) {
  return (
    <div className={classes(styles.surface, "synth-viewport", inset && styles.inset, className)} ref={elementRef}>
      {children}
    </div>
  );
}

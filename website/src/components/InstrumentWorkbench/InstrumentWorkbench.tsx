import { type HTMLAttributes, type ReactNode } from "react";
import { classes } from "../../utils/classes/classes";
import styles from "./InstrumentWorkbench.module.css";

/** Server-only content supplied by the route fallback; absent from live workbenches. */
export interface InstrumentSnapshot {
  readonly viewport: ReactNode;
  readonly controls: ReactNode;
  readonly examples?: ReactNode;
  readonly railControls?: ReactNode;
  readonly tiles?: Readonly<Record<string, ReactNode>>;
}

export function InstrumentWorkbench({
  kind,
  className,
  children,
  embedded = false,
  ...attributes
}: {
  readonly embedded?: boolean;
  readonly kind: "synth" | "generative" | "gallery";
  readonly className?: string;
  readonly children: ReactNode;
} & Omit<HTMLAttributes<HTMLDivElement>, "children">) {
  return (
    <div
      {...attributes}
      className={classes(
        styles.root,
        embedded && styles.embedded,
        "synth-shell",
        "dn-root",
        `dn-root--${kind}`,
        className,
      )}
    >
      {children}
    </div>
  );
}

import { type ReactNode } from "react";
import { classes } from "../../utils/classes/classes";
import styles from "./InstrumentSectionHeading.module.css";

export function InstrumentSectionHeading({
  children,
  action,
  className,
}: {
  readonly children: ReactNode;
  readonly action?: ReactNode;
  readonly className?: string;
}) {
  return (
    <div className={classes(styles.root, "instrument-section-heading", className)}>
      <span className="instrument-section-label">{children}</span>
      <span className="instrument-section-rule" aria-hidden="true" />
      {action}
    </div>
  );
}

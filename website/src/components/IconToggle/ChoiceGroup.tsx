import type { HTMLAttributes } from "react";
import styles from "./IconToggle.module.css";

export function ChoiceGroup({ className = "", ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={`${styles.root} ${className}`} />;
}

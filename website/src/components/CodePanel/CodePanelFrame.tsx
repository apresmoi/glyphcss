import type { ComponentProps } from "react";
import styles from "./CodePanel.module.css";
export function CodePanelFrame({
  className = "",
  inline = false,
  ...props
}: ComponentProps<"aside"> & { inline?: boolean }) {
  return <aside {...props} className={`${styles.root} ${inline ? styles.inline : ""} ${className}`} />;
}

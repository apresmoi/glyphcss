import type { ComponentPropsWithRef } from "react";
import styles from "./ControlSection.module.css";
export function ControlSection({ className = "", ...props }: ComponentPropsWithRef<"div">) {
  return <div {...props} className={styles.root + " " + className} />;
}

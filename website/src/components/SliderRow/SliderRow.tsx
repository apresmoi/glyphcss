import type { ComponentPropsWithoutRef } from "react";
import styles from "./SliderRow.module.css";
export function SliderRow({ className = "", ...props }: ComponentPropsWithoutRef<"label">) {
  return <label {...props} className={styles.root + " " + className} />;
}

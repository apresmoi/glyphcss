import type { ComponentPropsWithoutRef } from "react";
import styles from "./SliderRow.module.css";
export function SliderTrack({ className = "", ...props }: ComponentPropsWithoutRef<"span">) {
  return <span {...props} className={styles.track + " " + className} />;
}

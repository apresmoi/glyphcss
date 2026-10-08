import type { ComponentPropsWithRef } from "react";
import styles from "./EditableReadout.module.css";
export function ReadoutInput({ className = "", ...props }: ComponentPropsWithRef<"input">) {
  return <input {...props} className={styles.input + " " + className} />;
}

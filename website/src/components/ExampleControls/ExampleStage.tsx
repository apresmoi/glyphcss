import type { ComponentPropsWithoutRef } from "react";
import styles from "./ExampleControls.module.css";
export function ExampleStage({ className = "", ...props }: ComponentPropsWithoutRef<"div">) {
  return <div {...props} className={styles.stage + " " + className} />;
}

import type { ComponentPropsWithoutRef } from "react";
import styles from "./ExampleControls.module.css";
export function ExampleControls({ className = "", ...props }: ComponentPropsWithoutRef<"div">) {
  return <div {...props} data-example-controls className={styles.root + " " + className} />;
}

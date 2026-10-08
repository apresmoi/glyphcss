import type { ComponentPropsWithRef } from "react";
import styles from "./VoiceCard.module.css";
export function VoiceCardFrame({ className = "", ...props }: ComponentPropsWithRef<"div">) {
  return <div {...props} className={styles.root + " " + className} />;
}

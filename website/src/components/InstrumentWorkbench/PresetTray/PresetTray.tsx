import { type ReactNode, type Ref } from "react";
import { classes } from "../../../utils/classes/classes";
import { InstrumentSectionHeading } from "../InstrumentSectionHeading";

export function PresetTray({
  id,
  label,
  open,
  title = "Presets",
  children,
  sectionRef,
}: {
  readonly id: string;
  readonly label: string;
  readonly open?: boolean;
  readonly title?: string;
  readonly children: ReactNode;
  readonly sectionRef?: Ref<HTMLElement>;
}) {
  return (
    <section
      ref={sectionRef}
      id={id}
      className={classes("instrument-tray", open && "is-mobile-open")}
      aria-label={label}
    >
      <InstrumentSectionHeading>{title}</InstrumentSectionHeading>
      <div className="synth-presets" role="list" aria-label={label}>
        {children}
      </div>
    </section>
  );
}

import { useEffect, useRef, useState } from "react";
import { FLUID_DEFAULTS, FLUID_READER_DEFAULTS, FLUID_WPM_CHOICES } from "../../features/fluid/model/fluidWorkbench";
import { mountFluidField, mountFluidReader, type FluidReaderMount } from "../../features/fluid/services/fluidRuntime";
import { IconToggle } from "../IconToggle";
import styles from "./GlyphFluidDemo.module.css";

export interface GlyphFluidDemoProps {
  /** `"fluid"`: a heading condensing out of a stirrable field. `"reader"`: round speed reader. */
  variant: "fluid" | "reader";
  /** The fluid variant's heading, or the reader variant's sentence. */
  text?: string;
}

const WPM_OPTIONS = FLUID_WPM_CHOICES.map((wpm) => ({ value: String(wpm), icon: String(wpm), label: `${wpm} wpm` }));

export function GlyphFluidDemo({ variant, text }: GlyphFluidDemoProps) {
  const host = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLParagraphElement>(null);
  const reader = useRef<FluidReaderMount | null>(null);
  const [wpm, setWpm] = useState<number>(FLUID_READER_DEFAULTS.wpm);
  const wpmAtMount = useRef(wpm);
  wpmAtMount.current = wpm;
  const content = text ?? (variant === "reader" ? FLUID_READER_DEFAULTS.text : "glyphcss");

  // Docs embed this with `client:visible`, so the fluid's code already loads only on view.
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    if (variant === "reader") {
      const mount = mountFluidReader(
        el,
        { ...FLUID_READER_DEFAULTS, text: content, wpm: wpmAtMount.current },
        FLUID_DEFAULTS,
      );
      reader.current = mount;
      return () => {
        reader.current = null;
        mount.destroy();
      };
    }
    if (heading.current) return mountFluidField(el, heading.current, FLUID_DEFAULTS).destroy;
  }, [variant, content]);

  return (
    <figure
      className={`${styles.root} not-content`}
      aria-label={variant === "reader" ? `Speed reader: ${content}` : "Interactive braille fluid"}
    >
      {variant === "reader" ? (
        <>
          <div ref={host} className={styles.reader} />
          <IconToggle
            className={styles.wpm}
            groupLabel="Words per minute"
            options={WPM_OPTIONS}
            value={String(wpm)}
            onChange={(value) => {
              setWpm(Number(value));
              reader.current?.setWpm(Number(value));
            }}
          />
        </>
      ) : (
        <div ref={host} className={styles.stage}>
          <p ref={heading} className={styles.heading} aria-hidden="true">
            {content}
          </p>
        </div>
      )}
    </figure>
  );
}

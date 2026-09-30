import { useId, useState } from "react";
import { ChoiceButton } from "../IconToggle";
import styles from "./FrameworkTabs.module.css";
export interface FrameworkTab {
  id: string;
  label: string;
  language: string;
  highlighted: string;
}
export function FrameworkTabs({ tabs }: { tabs: readonly FrameworkTab[] }) {
  const [active, setActive] = useState(0);
  const id = useId();
  return (
    <div className={styles.editor}>
      <div className={styles.bar}>
        <span>~/project/</span>
        <div role="tablist" aria-label="Framework">
          {tabs.map((tab, i) => (
            <ChoiceButton
              key={tab.id}
              type="button"
              role="tab"
              id={id + "-tab-" + i}
              aria-controls={id + "-panel-" + i}
              aria-selected={active === i}
              tabIndex={active === i ? 0 : -1}
              onClick={() => setActive(i)}
              onKeyDown={(e) => {
                let next = i;
                if (e.key === "ArrowRight") next = (i + 1) % tabs.length;
                else if (e.key === "ArrowLeft") next = (i + tabs.length - 1) % tabs.length;
                else if (e.key === "Home") next = 0;
                else if (e.key === "End") next = tabs.length - 1;
                else return;
                e.preventDefault();
                setActive(next);
                e.currentTarget.parentElement?.querySelectorAll("button")[next]?.focus();
              }}
            >
              {tab.label}
            </ChoiceButton>
          ))}
        </div>
      </div>
      {tabs.map((tab, i) => (
        <pre
          key={tab.id}
          role="tabpanel"
          tabIndex={0}
          id={id + "-panel-" + i}
          aria-labelledby={id + "-tab-" + i}
          hidden={active !== i}
        >
          <code
            className={"language-" + tab.language + " hljs"}
            dangerouslySetInnerHTML={{ __html: tab.highlighted }}
          />
        </pre>
      ))}
    </div>
  );
}
